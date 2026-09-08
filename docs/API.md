# API Reference

**Base URL**: `/api`
**Content-Type**: `application/json`

> Atualizado em 2026-09-08. Este documento cobre o **modelo de
> autenticação** e os **webhooks públicos** em detalhe — esses contratos
> mudam pouco e vale a pena documentá-los por extenso. Ele **não**
> tenta listar exaustivamente todas as rotas: há dezenas sob `app/api/`
> (uma pasta por domínio — `flows/`, `accounts/`, `shopify/`,
> `fulfillment/`, `ai-keys/`, `ai-sessions/`...) e mantê-las
> sincronizadas aqui manualmente é exatamente o tipo de doc que fica
> desatualizado sozinho. Para descobrir uma rota específica, veja o
> código em `app/api/<domínio>/` — a estrutura de pastas já documenta o
> domínio.

## Autenticação

Não é "nenhuma" (como versões antigas deste doc diziam) nem por
usuário/token do cliente — é uma sessão administrativa única.

- `proxy.ts` é o gate global de `/api/:path*`: exige cookie `ff_auth`
  válido (HMAC assinado, `lib/server-auth.ts`) em toda rota, **exceto**
  uma allowlist fixa por pathname exato:
  - `/api/auth/login`, `/api/auth/verify`, `/api/auth/logout`
  - `/api/webhook/evolution`
  - `/api/webhook/whatsapp-cloud`
  - `/api/webhook/shopify/orders`
  - `/api/webhook/shopify/abandoned-checkouts`
- Cada webhook acima tem sua **própria** autenticação interna (secret,
  HMAC do corpo, handshake), independente do cookie — são chamadas
  servidor-a-servidor de terceiros, nunca teriam o cookie de sessão.
- Login: `POST /api/auth/login` com rate limit duplo (por IP e por
  IP+usuário, `lib/login-rate-limit.ts`) — 20/5min por IP, 5/min por
  IP+usuário.

## Webhook Evolution API

```
POST /api/webhook/evolution
```

Rota pública — recebe eventos da instância Evolution conectada.

**Autenticação**: header `x-webhook-secret` comparado em tempo
constante contra `EVOLUTION_WEBHOOK_SECRET` — falha fechado se a env
var não estiver configurada.

**Payload (evento relevante: `messages.upsert`)**:
```typescript
{
  event: "messages.upsert" | "connection.update" | ...
  instance: string   // = instance_name no FlashFlow
  data: {
    key: {
      remoteJid: string   // ex: "5511999999999@s.whatsapp.net" (ou "...@lid")
      fromMe: boolean
      id: string
    }
    message: {
      conversation?: string
      extendedTextMessage?: { text: string }
    }
    pushName?: string
  }
}
```

**Lógica interna** (resumo — detalhe com arquivo:linha em
`PROJECT_CONTEXT.md`):
1. Valida `Content-Type`, tamanho do body e o `x-webhook-secret`
2. Só `messages.upsert` persiste mensagem
3. Deduplica por `wa_message_id` (inbound e outbound)
4. Resolve `@lid` → JID real quando aplicável
5. Upsert em `conversations` (`onConflict: wa_id, instance_name`)
6. Insert em `messages` (`direction: inbound`)
7. Dispara cascata: `flow_runs` pausado → sandbox → `ai_sessions` → `triggers`

## Webhook WhatsApp Cloud API

```
GET  /api/webhook/whatsapp-cloud   ← handshake de verificação da Meta
POST /api/webhook/whatsapp-cloud   ← eventos
```

**Autenticação**:
- `GET`: valida `hub.verify_token` contra `WHATSAPP_CLOUD_VERIFY_TOKEN`
- `POST`: valida HMAC-SHA256 do corpo cru no header
  `X-Hub-Signature-256` contra `WHATSAPP_CLOUD_APP_SECRET`, comparado em
  tempo constante. **A requisição é logada incondicionalmente antes da
  verificação** — decisão deliberada (commit `9f6465f`) para não perder
  rastro de tentativas rejeitadas.

Conta identificada por `metadata.phone_number_id` do payload (não por
`instance`, diferente da Evolution). Mesma dedup e cascata pós-save da
Evolution.

## Webhooks Shopify

```
POST /api/webhook/shopify/orders                 ← orders/create|updated|paid|cancelled|delete
POST /api/webhook/shopify/abandoned-checkouts     ← checkout abandonado
```

**Autenticação**: HMAC-SHA256 do corpo cru, comparado em tempo
constante (`lib/shopify-client.ts`). Segredo é o `client_secret` do app
OAuth (integrações conectadas via OAuth) ou o segredo específico da loja
cifrado no banco (integrações legadas). HMAC inválido → HTTP 401.

Registrados automaticamente na loja via `lib/shopify-webhook-setup.ts`
no callback OAuth (ou por botão manual em Configurações → Shopify).

`orders/delete` tem tratamento próprio: arquiva o pedido local
(`shopify_deleted_at`, `commercial_status='Desistiu'`) e cancela se
ainda não tinha `lead_number` no FenixCOD.

## Enviar mensagem (operador)

```
POST /api/messages
```

```typescript
// body
{
  conversationId: string
  content: string
}
```

**Lógica interna**:
1. Busca `wa_id`/`instance_name` da conversa **no servidor** — nunca
   confia em destino vindo do body, para um `waId` adulterado no
   client não poder redirecionar o envio para outro contato
2. Insere a mensagem com `status: 'sending'` **antes** de chamar a
   Evolution/Cloud API — se a chamada expira (timeout do FlashFlow, não
   necessariamente rejeição do provedor), o status **fica em
   `sending`** em vez de `failed`, para não induzir um reenvio que
   duplicaria a mensagem se ela tiver sido aceita
3. Chama o provedor certo via `lib/whatsapp-dispatch.ts`
4. **Não verifica a janela de 24h da Cloud API** — só os caminhos
   automatizados (flow engine, recuperação de carrinho) verificam

## Listar mensagens de uma conversa

```
GET /api/messages?conversationId=<uuid>&instance=<instance_name>
```

Valida que a conversa pertence ao `instance` informado antes de
retornar (404 caso contrário).

## Listar conversas

```
GET /api/conversations
```

## Evolution API (referência interna — não é rota do FlashFlow)

Endereço/instância/chave reais ficam em `.env.local`, não aqui.

```
GET  /instance/fetchInstances              → status das instâncias
GET  /instance/connect/<instance>          → QR code
POST /message/sendText/<instance>          → enviar mensagem
POST /webhook/set/<instance>               → configurar webhook
```
