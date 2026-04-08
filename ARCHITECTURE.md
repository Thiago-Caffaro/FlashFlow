# Arquitetura do Sistema

## Diagrama de componentes

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENTE FINAL                       │
│                  (WhatsApp no celular)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ mensagem
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Evolution API (self-hosted)                  │
│         Docker container — porta 8080                    │
└──────────────────────┬──────────────────────────────────┘
                       │ webhook HTTP POST
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  NestJS API (Backend)                    │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │  WhatsApp    │  │ Flow Executor │  │   Gemini     │ │
│  │  Controller  │─▶│  (State Mach) │─▶│   Service    │ │
│  └──────────────┘  └───────┬───────┘  └──────────────┘ │
│                             │                            │
│  ┌──────────────┐  ┌────────▼──────┐                   │
│  │  Socket.io   │  │  Redis        │                   │
│  │  Gateway     │  │  (state conv) │                   │
│  └──────┬───────┘  └───────────────┘                   │
└─────────┼───────────────────────────────────────────────┘
          │ WebSocket
          ▼
┌─────────────────────────────────────────────────────────┐
│               Next.js Frontend                           │
│                                                          │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Flow Builder  │  │  Chat UI     │  │  Dashboard  │ │
│  │  (xyflow)      │  │  (WA Web)    │  │  (Recharts) │ │
│  └────────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│              PostgreSQL 16 + Redis                       │
└─────────────────────────────────────────────────────────┘
```

---

## Fluxo de uma conversa (passo a passo)

```
1. Lead clica no link externo (ex: "wa.me/...?text=Quero+o+Vistaplus")
2. WhatsApp abre com mensagem pré-preenchida
3. Lead envia a mensagem
4. Evolution API recebe e faz POST no webhook do NestJS
5. WhatsApp Controller valida o payload
6. Busca no Redis: já existe sessão para esse número?
   └─ NÃO → identifica gatilho → carrega fluxo do produto → cria sessão no Redis
   └─ SIM → recupera estado atual da sessão
7. Flow Executor processa o próximo bloco
8. Se bloco = GeminiAssistant:
   a. Monta prompt (base + produto + histórico)
   b. Chama Gemini API (Flash-Lite primeiro)
   c. Recebe structured output
   d. Formata resposta
9. Envia resposta via Evolution API
10. Atualiza estado no Redis
11. Persiste mensagem no PostgreSQL
12. Emite evento via Socket.io para o frontend
```

---

## Estado de uma conversa (Redis)

```typescript
interface ConversationState {
  conversationId: string
  organizationId: string
  whatsappNumber: string
  currentNodeId: string
  flowId: string
  productId: string
  variables: Record<string, string>  // variáveis coletadas no fluxo
  isHuman: boolean                    // atendente assumiu?
  isAiEnabled: boolean
  lastActivityAt: number              // timestamp para timeout
  geminiHistory: GeminiMessage[]      // contexto para o bloco IA
}
```

TTL no Redis: 24 horas (renovado a cada mensagem)

---

## Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| ORM | Prisma | type-safe, migrations simples |
| State da conversa | Redis (não Postgres) | latência < 5ms, TTL nativo |
| Real-time | Socket.io | simples, battle-tested |
| Auth | Clerk | multi-tenant pronto, sem boilerplate |
| Monorepo | pnpm workspaces | compartilhar types facilmente |
| WhatsApp | Evolution API | gratuito, multi-device, QR code |
