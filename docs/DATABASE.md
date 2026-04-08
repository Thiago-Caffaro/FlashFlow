# Database Schema

**Engine**: PostgreSQL 16  
**ORM**: Prisma  
**Padrão de ID**: `cuid2` em todos os modelos

---

## Schema Prisma completo

```prisma
// packages/db/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Multi-tenant ──────────────────────────────────────────

model Organization {
  id        String   @id @default(cuid())
  name      String
  clerkOrgId String  @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users               OrganizationUser[]
  whatsappConnections WhatsappConnection[]
  products            Product[]
  flows               Flow[]
  conversations       Conversation[]
}

model OrganizationUser {
  id             String       @id @default(cuid())
  organizationId String
  clerkUserId    String
  role           UserRole     @default(AGENT)
  createdAt      DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, clerkUserId])
}

enum UserRole {
  OWNER
  ADMIN
  AGENT
}

// ─── WhatsApp ──────────────────────────────────────────────

model WhatsappConnection {
  id             String              @id @default(cuid())
  organizationId String
  instanceName   String              @unique  // nome na Evolution API
  phoneNumber    String?
  status         ConnectionStatus    @default(DISCONNECTED)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organization   Organization        @relation(fields: [organizationId], references: [id])
  conversations  Conversation[]
}

enum ConnectionStatus {
  CONNECTED
  DISCONNECTED
  CONNECTING
  QR_PENDING
}

// ─── Produtos & Fluxos ─────────────────────────────────────

model Product {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  triggerKeyword String   // palavra-chave que dispara o fluxo
  geminiPrompt   String   @db.Text  // prompt base do produto para Gemini
  currency       String   @default("BRL")
  country        String   @default("BR")
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization   Organization  @relation(fields: [organizationId], references: [id])
  flows          Flow[]
  conversations  Conversation[]
}

model Flow {
  id             String     @id @default(cuid())
  organizationId String
  productId      String
  name           String
  data           Json       // estrutura do xyflow (nodes + edges)
  version        Int        @default(1)
  isActive       Boolean    @default(false)
  publishedAt    DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  organization   Organization    @relation(fields: [organizationId], references: [id])
  product        Product         @relation(fields: [productId], references: [id])
  executions     FlowExecution[]
}

// ─── Conversas ─────────────────────────────────────────────

model Conversation {
  id                   String             @id @default(cuid())
  organizationId       String
  whatsappConnectionId String
  productId            String?
  contactNumber        String
  contactName          String?
  status               ConversationStatus @default(ACTIVE)
  isHuman              Boolean            @default(false)
  isAiEnabled          Boolean            @default(true)
  tags                 String[]
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  organization         Organization       @relation(fields: [organizationId], references: [id])
  whatsappConnection   WhatsappConnection @relation(fields: [whatsappConnectionId], references: [id])
  product              Product?           @relation(fields: [productId], references: [id])
  messages             Message[]
  flowExecutions       FlowExecution[]

  @@index([organizationId, status])
  @@index([contactNumber])
}

enum ConversationStatus {
  ACTIVE
  WAITING_HUMAN
  RESOLVED
  ABANDONED
}

model Message {
  id             String      @id @default(cuid())
  conversationId String
  direction      Direction
  content        String      @db.Text
  type           MessageType @default(TEXT)
  metadata       Json?       // mídia, reações, etc.
  sentAt         DateTime    @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, sentAt])
}

enum Direction {
  INBOUND   // lead → sistema
  OUTBOUND  // sistema → lead
}

enum MessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  BUTTON_REPLY
}

// ─── Execução de Fluxos ────────────────────────────────────

model FlowExecution {
  id             String          @id @default(cuid())
  conversationId String
  flowId         String
  currentNodeId  String?
  status         ExecutionStatus @default(RUNNING)
  variables      Json            @default("{}")
  startedAt      DateTime        @default(now())
  finishedAt     DateTime?

  conversation   Conversation @relation(fields: [conversationId], references: [id])
  flow           Flow         @relation(fields: [flowId], references: [id])

  @@index([conversationId])
}

enum ExecutionStatus {
  RUNNING
  COMPLETED
  ABANDONED
  ERROR
}

// ─── Analytics ─────────────────────────────────────────────

model AnalyticsEvent {
  id             String    @id @default(cuid())
  organizationId String
  eventType      String    // conversation_started, message_sent, ai_response, etc.
  productId      String?
  flowId         String?
  conversationId String?
  metadata       Json      @default("{}")
  createdAt      DateTime  @default(now())

  @@index([organizationId, eventType, createdAt])
  @@index([organizationId, productId, createdAt])
}
```

---

## Índices importantes

```sql
-- Busca rápida de conversa por número (webhook do WhatsApp)
CREATE INDEX idx_conversations_contact ON conversations(organization_id, contact_number);

-- Dashboard: eventos por data
CREATE INDEX idx_analytics_date ON analytics_events(organization_id, created_at DESC);

-- Fluxo ativo por produto
CREATE INDEX idx_flows_active ON flows(product_id, is_active) WHERE is_active = true;
```

---

## Dados no Redis

| Chave | Valor | TTL |
|-------|-------|-----|
| `conv:state:{conversationId}` | JSON do ConversationState | 24h |
| `ws:session:{instanceName}` | status da conexão Evolution | 5min |
| `gemini:cache:{productId}` | context cache do Gemini | 1h |
