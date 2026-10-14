# Database

**Engine**: PostgreSQL via Supabase
**Cliente**: `@supabase/supabase-js` (sem ORM)
**ID padrão**: UUID com `gen_random_uuid()`

> Atualizado em 2026-09-08. Este documento descreve a *forma* do banco
> em alto nível. A fonte de verdade linha-a-linha é `types/index.ts`
> (cada `interface` corresponde a uma tabela) — mantenha os dois em
> mente ao alterar schema, mas trate `types/index.ts` como autoritativo
> quando divergirem.

## Particionamento: por instância WhatsApp, não por usuário

Quase toda tabela de domínio carrega uma coluna `instance_name`
(`conversations`, `triggers`, `flows`, `flow_runs`, `flow_media`,
`agent_memory_blocks`, `message_variables`, `notifications`,
`fulfillment_orders`...). O produto não é multi-tenant por cliente final
— é um único operador administrando várias contas/números de WhatsApp.
**Nunca confie em `instance_name` vindo do client**: toda rota que
recebe um `id` de recurso deve validar posse via `lib/instance-guard.ts`
(`belongsToInstance`) antes de agir — reforçado por uma bateria de
testes dedicados em `__tests__/api/*-isolation.test.ts`.

## Tabelas principais (não exaustivo — ver `types/index.ts`)

| Domínio | Tabelas |
|---|---|
| Chat | `conversations`, `messages` |
| Contas WhatsApp | `accounts` (coluna `provider`: `evolution` \| `cloud_api`) |
| Automação | `triggers`, `flows`, `flow_runs`, `flow_jobs`, `flow_media`, `message_variables` |
| IA | `ai_sessions`, `agent_memory_blocks`, `ai_provider_keys`, `instance_ai_config` |
| Shopify | `shopify_integrations` (com app próprio opcional por loja, migration 026), `shopify_integration_accounts` (contas WhatsApp de cada loja, 026), `shopify_products`, `shopify_abandoned_checkouts` |
| Fulfillment | `fulfillment_orders`, `fulfillment_products`, `fulfillment_integrations`, `fulfillment_order_events`, `fulfillment_delivery_status_mappings` |
| Outros | `notifications`, `app_settings` (segredos cifrados em repouso) |

## `migrations/` não é o schema completo

`migrations/001_fulfillment_shopify_oauth.sql` até `020_shopify_recovery_template.sql`
existem no repo e são aplicadas manualmente no Supabase SQL Editor (não
há Supabase CLI/migration runner formal no projeto) — mas a numeração
começa depois que Shopify/fulfillment já existiam. As tabelas
fundacionais (`conversations`, `messages`, `accounts`, `flows`,
`triggers`) e várias tabelas de IA (`ai_sessions`, `agent_memory_blocks`,
`ai_provider_keys`, `instance_ai_config`) **não têm `CREATE TABLE`
versionado neste repositório** — só `ALTER TABLE`s incrementais depois
do fato. Se precisar reconstruir o schema do zero, isso precisa vir de
um dump real do Supabase de produção, não só de `migrations/`.

## Segredos em repouso

`app_settings` e `ai_provider_keys` guardam valores sensíveis
(credenciais de provedor de IA, segredos de integração) cifrados com
AES-256-GCM (`lib/ai-crypto.ts`), nunca em texto plano — chave de
cifragem vem de `AI_ENCRYPTION_KEY` (env var, nunca no banco).

## Clientes Supabase

```typescript
// lib/supabase.ts — client-side (anon key)
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// lib/supabase-admin.ts — server-only (service role, acesso total)
import { createClient } from '@supabase/supabase-js'
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

`SUPABASE_SERVICE_ROLE_KEY` nunca deve ser usado ou exposto em código
client-side.

## Realtime

```typescript
supabase
  .channel('messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`
  }, (payload) => {
    // nova mensagem chegou — atualiza UI
  })
  .subscribe()
```

## Filas e locks via RPC (Postgres functions)

Duas rotinas de background usam RPCs Postgres com `FOR UPDATE SKIP
LOCKED` em vez de um broker de fila externo:

- `claim_flow_jobs` — reivindica jobs pendentes de `flow_jobs` para o
  worker in-process de flow engine (`migrations/009_message_variables_and_flow_jobs.sql`)
- `claim_fulfillment_delivery_sync` / `apply_fulfillment_delivery_status`
  / `record_fulfillment_delivery_status` — lease de sincronização de
  entrega por integração, usado por `lib/fulfillment-delivery-worker.ts`
