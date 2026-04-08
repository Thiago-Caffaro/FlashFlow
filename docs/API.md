# API Reference

**Base URL**: `/api/v1`  
**Auth**: Bearer token (Clerk JWT) em todas as rotas, exceto `/webhook/*`  
**Content-Type**: `application/json`

---

## Módulos

### WhatsApp (`/whatsapp`)

```
POST   /whatsapp/connect          → Criar instância e obter QR code
GET    /whatsapp/status            → Status da conexão atual
DELETE /whatsapp/disconnect        → Desconectar número
POST   /whatsapp/send              → Enviar mensagem manual
```

```typescript
// POST /whatsapp/connect - response
{
  instanceName: string
  qrCode: string        // base64 da imagem QR
  status: "QR_PENDING"
}

// GET /whatsapp/status - response
{
  status: "CONNECTED" | "DISCONNECTED" | "QR_PENDING"
  phoneNumber: string | null
  connectedAt: string | null
}

// POST /whatsapp/send
{
  conversationId: string
  content: string
  type: "TEXT"
}
```

---

### Webhook Evolution API (`/webhook`)

```
POST /webhook/evolution/:instanceName  → Recebe eventos do WhatsApp
```

> ⚠️ Rota pública (sem auth Clerk). Validar `x-evolution-secret` header.

```typescript
// Payload recebido da Evolution API
{
  event: "messages.upsert"
  instance: string
  data: {
    key: { remoteJid: string, fromMe: boolean, id: string }
    message: { conversation?: string, ... }
    pushName?: string
  }
}
```

---

### Fluxos (`/flows`)

```
GET    /flows?productId=...        → Listar fluxos do produto
POST   /flows                      → Criar fluxo
GET    /flows/:id                  → Buscar fluxo por ID
PUT    /flows/:id                  → Atualizar fluxo (salva JSON)
POST   /flows/:id/publish          → Publicar fluxo
DELETE /flows/:id/publish          → Despublicar fluxo
```

```typescript
// PUT /flows/:id - body
{
  name: string
  data: FlowData   // nodes[] + edges[] do xyflow
}

// FlowData type
interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
  variables: FlowVariable[]
}
```

---

### Produtos (`/products`)

```
GET    /products                   → Listar produtos
POST   /products                   → Criar produto
PUT    /products/:id               → Atualizar produto
PATCH  /products/:id/toggle        → Ativar/desativar
```

---

### Conversas (`/conversations`)

```
GET    /conversations              → Listar (paginado, filtros)
GET    /conversations/:id          → Detalhes + mensagens
PATCH  /conversations/:id/human    → { isHuman: true/false }
PATCH  /conversations/:id/ai       → { isAiEnabled: true/false }
POST   /conversations/:id/tags     → Adicionar tag
```

```typescript
// GET /conversations - query params
{
  status?: "ACTIVE" | "WAITING_HUMAN" | "RESOLVED"
  productId?: string
  page?: number     // default 1
  limit?: number    // default 30
}
```

---

### Dashboard (`/analytics`)

```
GET /analytics/overview            → Métricas principais
GET /analytics/conversations       → Conversas por período
GET /analytics/products            → Performance por produto
GET /analytics/ai-costs            → Custo estimado IA
```

```typescript
// GET /analytics/overview - query params
{
  startDate: string   // ISO 8601
  endDate: string
}

// response
{
  conversationsStarted: number
  responseRate: number          // % que respondeu à msg inicial
  activeConversations: number
  estimatedAiCost: number       // em USD
}
```

---

## Tipos do Flow Builder

```typescript
// Tipos dos nodes do xyflow
type NodeType = "start" | "message" | "button" | "condition" | "gemini" | "action" | "end"

interface FlowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData
}

// NodeData por tipo
interface MessageNodeData {
  content: string
  delayMs?: number
}

interface ButtonNodeData {
  content: string
  buttons: { id: string; label: string }[]
}

interface ConditionNodeData {
  conditions: {
    variable: string
    operator: "equals" | "contains" | "starts_with"
    value: string
  }[]
  logic: "OR" | "AND"
}

interface GeminiNodeData {
  temperature: number           // 0.0 – 1.0
  maxTokens: number
  additionalInstructions?: string
  structuredOutput: JsonSchema  // schema Zod serializado
}
```

---

## Códigos de erro

| Código | Significado |
|--------|-------------|
| 400 | Validação falhou (body inválido) |
| 401 | Token ausente ou expirado |
| 403 | Sem permissão para o recurso |
| 404 | Recurso não encontrado |
| 409 | Conflito (ex: fluxo já publicado) |
| 429 | Rate limit atingido |
| 500 | Erro interno — ver logs |
