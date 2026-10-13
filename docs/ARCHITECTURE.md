# Arquitetura do Sistema

> Atualizado em 2026-09-08 a partir do código real (commit `732e187`,
> `APP_VERSION` 1.11.0). Para os fluxos críticos com citação
> `arquivo:linha`, veja `PROJECT_CONTEXT.md` na raiz do repo — este
> documento fica no nível de diagrama/visão geral.

## Diagrama atual

```
┌──────────────────────────┐        ┌──────────────────────────┐
│   LEAD (WhatsApp app)    │        │   Shopify (loja)         │
└─────────────┬────────────┘        └─────────────┬────────────┘
              │ mensagem                            │ webhook (pedido,
              ▼                                      │ checkout abandonado)
┌──────────────────────────┐                        │
│  Evolution API            │                        │
│  (self-hosted, TrueNAS)   │                        │
│  ── ou ──                 │                        │
│  WhatsApp Cloud API       │                        │
│  (oficial, Meta)          │                        │
│  escolhido por conta      │                        │
└─────────────┬──────────────────────────────────────┘
              │ webhook POST                          │
              ▼                                        ▼
┌───────────────────────────────────────────────────────────────┐
│                    Next.js 16 (App Router)                     │
│                                                                  │
│  proxy.ts — gate global de auth em /api/:path*                 │
│  (allowlist por pathname exato p/ os 4 webhooks públicos        │
│  + login/verify/logout; cada webhook valida seu próprio         │
│  segredo/HMAC internamente)                                     │
│                                                                  │
│  POST /api/webhook/evolution         ← inbound Evolution        │
│  POST /api/webhook/whatsapp-cloud    ← inbound Cloud API        │
│  POST /api/webhook/shopify/orders             ← pedidos         │
│  POST /api/webhook/shopify/abandoned-checkouts ← carrinho       │
│  POST /api/messages                  ← envio manual (operador)  │
│  GET  /api/conversations             ← lista conversas          │
│                                                                  │
│  lib/whatsapp-dispatch.ts — escolhe adapter (Evolution/Cloud)   │
│  por conta (accounts.provider)                                  │
│                                                                  │
│  lib/flow-engine.ts — motor de execução de fluxos (síncrono     │
│  no próprio webhook, fire-and-forget; fila flow_jobs só para    │
│  casos que dependem de sync externo — poll adaptativo 1s→15s)   │
│                                                                  │
│  lib/fulfillment-service.ts — submissão de pedidos ao            │
│  FenixCOD; lib/fulfillment-delivery-worker.ts — poll 30s de     │
│  status de entrega                                               │
└───────────────────────┬──────────────────────────────────────┘
                        │ @supabase/supabase-js (sem ORM)
                        ▼
┌───────────────────────────────────────────────────────────────┐
│                          Supabase                               │
│               PostgreSQL + Realtime                             │
│  conversations, messages, flows, flow_runs, flow_jobs,          │
│  triggers, accounts, ai_sessions, agent_memory_blocks,          │
│  ai_provider_keys, fulfillment_orders, shopify_integrations,    │
│  shopify_abandoned_checkouts, notifications, app_settings...    │
└───────────────────────┬──────────────────────────────────────┘
                        │ Supabase Realtime
                        ▼
┌───────────────────────────────────────────────────────────────┐
│             Interface (Next.js, mesmo app)                     │
│   Chat/Chats · Flows (editor xyflow) · Fulfillment · IA        │
│   Sessões · Configurações · Diagnostics                         │
└───────────────────────────────────────────────────────────────┘
```

---

## Fluxo de uma mensagem recebida (visão geral)

```
1. Lead envia mensagem no WhatsApp (Evolution ou Cloud API, por conta)
2. Webhook correspondente autentica (secret/HMAC próprio) e valida payload
3. Deduplica por wa_message_id, resolve @lid → JID real, upsert em conversations
4. Insere mensagem em messages (direction: inbound)
5. Cascata fire-and-forget, nesta ordem de prioridade:
   flow_runs pausado → sandbox com envio real → ai_sessions ativa → triggers por keyword
6. Supabase Realtime notifica o frontend — interface atualiza sem reload
```

Detalhes com citação de arquivo:linha (autenticação de cada webhook,
resolução de @lid, dedup) estão em `PROJECT_CONTEXT.md`.

## Fluxo de envio de mensagem

```
1. Operador digita e envia (manual) OU flow-engine/trigger decide enviar (automático)
2. lib/whatsapp-dispatch.ts escolhe o adapter certo (Evolution/Cloud) pela conta
3. Se Cloud API e fora da janela de 24h: aborta com notificação (envio manual/
   flow) ou tenta template aprovado (recuperação de carrinho Shopify)
4. Adapter chama a API real → salva mensagem no Supabase (direction: outbound)
5. Supabase Realtime atualiza a interface
```

## O que já foi construído (histórico real, não roadmap)

Todo o roadmap que este documento descrevia como "futuro" (Fase 2 a 6) já
foi entregue — cronologia real, por commit:

| Marco | Quando | Commit |
|---|---|---|
| Chat MVP (Evolution API, conversas, mensagens) | 2026-04 | `29fa5a0` em diante |
| Multi-conta WhatsApp (QR code) | 2026-04 | `9db73c6` |
| Editor de fluxos (xyflow) | ~meados 2026-05 | `d649283` |
| Painel de IA multi-provider (Gemini/OpenAI/OpenRouter) | ~meados 2026-05 | `e088e15` |
| Motor de execução de fluxos | ~meados 2026-05 | `f335795` |
| Auth administrativa + gestão de contas | 2026-06-26 | `3361b5e` |
| Integração FenixCOD + Shopify (fila de confirmação) | 2026-06-26 | `eec744e` |
| Shopify OAuth 2.0 | 2026-06-29 | `9bc156e` |
| Sandbox de testes (Pedidos & Fulfillment; view própria no app principal desde v1.15.0) | ~jul/2026 | `f29d366` |
| Timeline e estados de pedido Shopify/FenixCOD | ~ago/2026 | `ded3e84`, `196fe6b` |
| Suporte dual WhatsApp (Cloud API), 4 fases | 2026-08-12 a 2026-08-27 | `3afe3bc` … `3665692` |
| Template aprovado p/ recuperação de carrinho (Cloud API) | 2026-08-27 | `972956c` |

Não há mais um roadmap de fases fixo daqui para frente — features são
adicionadas conforme necessidade do negócio. Para o que falta ou está em
aberto agora, veja a seção "Perguntas em aberto" do `PROJECT_CONTEXT.md`.

## Infraestrutura

| Serviço | Onde roda | Observação |
|---|---|---|
| Next.js | Docker, deploy via GHCR | `main` publica `:latest`+`:test`; outras branches só `:test` |
| Evolution API | TrueNAS Scale (Docker), acesso via Tailscale | endereço real em `.env.local`, não versionado |
| WhatsApp Cloud API | Meta (oficial) | credenciais por conta, cifradas no Supabase |
| Supabase | Cloud | Postgres + Realtime, sem ORM |
| FenixCOD / European Fulfillment | Serviço externo (europeu) | contrato em `docs/FULFILLMENT_API.md` |
| Shopify | Loja do cliente (OAuth) | webhooks HMAC-verificados |
