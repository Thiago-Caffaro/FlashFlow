# Contexto do Projeto — FlashFlow

> Complemento manual em 2026-11-11 (branch `feat/product-lines`,
> `APP_VERSION` 1.21.0): automações simples e linhas de produto — fluxo 7,
> regras e armadilhas marcadas com "Automações". Guia: `docs/AUTOMATIONS.md`.
>
> Atualizado por `explore-project` em 2026-10-19, sobre o commit `f09c11a`
> **mais a árvore de trabalho não commitada da branch
> `feat/lightfunnels-integration`** (integração Lightfunnels, migration 027,
> `APP_VERSION` 1.19.0). As referências `arquivo:linha` dos arquivos dessa
> branch apontam para a versão não commitada; se a branch mudar antes do
> merge, elas podem andar. Geração anterior: 2026-09-08, commit `732e187`.
> Este documento é conhecimento sintetizado sobre o projeto — não é fonte de
> verdade. Onde ele divergir do código atual, o código vence. Rode a skill
> `explore-project` de novo depois de mudanças estruturais para atualizar.

## Visão geral

FlashFlow é um SaaS de atendimento e automação de WhatsApp para um
operador de e-commerce com fulfillment contra-reembolso (COD) na Europa.
Além do chat manual, o produto oferece: um construtor visual de fluxos de
conversa (com blocos de IA, condições e captura de dados de pedido),
integração com **duas plataformas de e-commerce lado a lado — Shopify e
Lightfunnels** (pedidos, catálogo; carrinho abandonado só na Shopify) — e
integração com um fulfillment externo (FenixCOD/European Fulfillment) para
envio físico dos produtos e cobrança na entrega. O uso real de WhatsApp é
dual: número(s) via Evolution API (self-hosted) e via WhatsApp Cloud API
(oficial, Meta), operando lado a lado por conta.

O ciclo de pedido é o mesmo para as duas plataformas: o pedido entra em
`fulfillment_orders` como `pending_operator`, é roteado para uma conta
WhatsApp (vínculo loja/funil → conta padrão → país), o gatilho "Pedido
criado" da plataforma roda o fluxo de confirmação nessa conta, e a
confirmação comercial envia o pedido ao FenixCOD. Ver fluxo 4.

## Stack técnica

| Camada | Tecnologia real | Onde |
|---|---|---|
| Framework | Next.js **16.2.12** (App Router), React 19.2.4 | `package.json` |
| Linguagem | TypeScript, sem `any` (regra do `CLAUDE.md`) | — |
| Estilo | Tailwind v4 + `shadcn`/`radix-ui` | `package.json`, `components/ui/` |
| Banco | Supabase (Postgres + Realtime), sem ORM, `@supabase/supabase-js` direto | `lib/supabase.ts`, `lib/supabase-admin.ts` |
| Flow builder | `@xyflow/react` v12 | `components/flows/` |
| WhatsApp | **Evolution API** (self-hosted) **e** **WhatsApp Cloud API** (Meta) simultaneamente, por conta (`accounts.provider`) | `lib/whatsapp-dispatch.ts:63-66`, `lib/whatsapp-account-provider.ts:15-23` |
| IA | Multi-provider: Gemini, OpenAI, OpenRouter | `lib/flow-engine.ts:467`, `lib/flow-engine.ts:770` |
| Fulfillment externo | European Fulfillment / FenixCOD (COD) | `lib/fulfillment-client.ts`, contrato em `docs/FULFILLMENT_API.md` |
| E-commerce 1 | Shopify (webhooks REST + OAuth; várias lojas, app próprio opcional por loja — migration 026) | `lib/shopify-*.ts` |
| E-commerce 2 | **Lightfunnels** (GraphQL `services.lightfunnels.com/api/v2`, OAuth com app de Partners global, webhooks via `createWebhook`) | `lib/lightfunnels-*.ts`, `lib/lightfunnels-client.ts:9`, guia em `docs/LIGHTFUNNELS.md` |
| Camada comum de pedido | Roteamento de conta e leitura de pedido independentes da plataforma | `lib/order-account-routing.ts`, `lib/order-platform.ts`, `lib/store-account-links.ts` |
| Auth | Sessão administrativa única via cookie HMAC (não é Supabase Auth) | `lib/server-auth.ts`, `proxy.ts` |
| Testes | Jest, ~120 arquivos em `__tests__/` | `package.json` (`test`, `test:watch`) |
| Deploy | Docker → GHCR, branch `main` publica `latest`+`test`, outras branches só `test` | `.github/workflows/*.yml` |
| Gate global de request | `proxy.ts` (não `middleware.ts` — nome do Next 16 para o mesmo mecanismo) | `proxy.ts:10-20` |

## Estrutura de pastas

```
app/
  api/            Toda lógica de banco/integração vive aqui (regra do CLAUDE.md, seguida)
    webhook/      Rotas públicas server-a-servidor (Evolution, WhatsApp Cloud, Shopify orders/abandoned-checkouts/draft-orders, Lightfunnels, interatividade do Slack)
    flows/        CRUD de fluxos
    accounts/     Gestão de contas/instâncias WhatsApp (QR, pairing, reconexão; apagar conta remove os vínculos loja/funil dela)
    shopify/      OAuth + callback + produtos
    lightfunnels/ OAuth (auth + callback) do app de Partners Lightfunnels
    fulfillment/  Pedidos, envio/cancelamento ao FenixCOD, sync de entrega; fulfillment/lightfunnels/ = integrações (vínculos de conta, funis, sync, webhooks) e catálogo LF; fulfillment/sandbox/ = simuladores (inclui lightfunnels-order)
    settings/     Configurações globais em app_settings (conta padrão de pedidos, pausa de gatilhos Shopify/Lightfunnels, credenciais do app Lightfunnels)
    integrations/ Slack
    automations/  Automações simples (CRUD; PATCH liga/desliga) — docs/AUTOMATIONS.md
    product-lines/ Linhas de produto, produtos, catálogo das lojas e vínculos
    ai-keys/, ai-sessions/, instance-ai-config/, memory-blocks/   Config e estado de IA
  fulfillment/, order-preview/, catalog-preview/, diagnostics/   Rotas de UI fora do chat principal
components/
  ui/             shadcn — não editar (regra do CLAUDE.md)
  chat/, chats/   Interface de atendimento
  flows/, flows/nodes/   Editor visual de fluxo (um arquivo por tipo de node)
  fulfillment/    UI de pedidos/checkouts abandonados/entrega + config das plataformas (lightfunnels-config, lightfunnels-store-accounts-editor, lightfunnels-products-panel, lightfunnels-order-status-badges)
  sandbox/        Simulador de pedidos (Shopify ou Lightfunnels) e carrinhos
  auth/           Formulário de login único (não há cadastro/multi-usuário)
  automations/    Aba Automações: cards com filtro por país/linha, assistente (modelo → público → lembretes), linhas e produtos
  sidebar-right/  Gatilhos (triggers) por instância — inclui "Pedido Shopify criado" e "Pedido Lightfunnels criado"
  memory/, gallery/, notifications/, ai-sessions/, nav/   Painéis secundários
contexts/         account-context, auth-context, theme-context (estado client-side global)
lib/              Um módulo por domínio/integração (prefixos shopify-*, lightfunnels-*, fulfillment-*, whatsapp-cloud-*, flow-*), mais a camada comum de pedido (order-*.ts, store-account-links.ts)
types/index.ts     Único arquivo de tipos do projeto — fonte de verdade do modelo de dados
migrations/       SQL numerado 001→030, mas **não é o schema completo** (ver Armadilhas)
docs/             Documentação de referência; LIGHTFUNNELS.md, SLACK.md, FULFILLMENT_API.md são guias específicos
__tests__/        api/ (rotas), lib/ (unidade), components/ — inclui testes de "isolation" e de roteamento por loja/funil
```

## Padrões e convenções

- **Um módulo `lib/` por domínio/integração**, nomeado pelo prefixo: `shopify-*.ts`, `lightfunnels-*.ts` (11 arquivos), `fulfillment-*.ts`, `whatsapp-cloud-*.ts`, `flow-*.ts`. Não há pasta `services/` — o nome do arquivo já é a "camada".
- **Plataformas de e-commerce lado a lado, sem tabela genérica.** A Lightfunnels ganhou tabelas/colunas próprias no mesmo padrão das da Shopify (`lightfunnels_integrations`, `lightfunnels_integration_accounts`, `lightfunnels_products`, colunas `lightfunnels_*` em `fulfillment_orders`), sem tocar nas `shopify_*` de produção — `migrations/027_lightfunnels_integration.sql:1-16`. `fulfillment_orders.source` é `'manual' | 'shopify' | 'lightfunnels'` (`migrations/027_lightfunnels_integration.sql:110-114`, `types/index.ts:228`).
- **Quem lê `fulfillment_orders` usa `lib/order-platform.ts`, não as colunas `shopify_*`/`lightfunnels_*` direto**: número exibido ao cliente (`getOrderDisplayNumber`, `lib/order-platform.ts:38-42`), removido/cancelado (`:45-51`), pago (`:55-58`), gatilho da plataforma (`orderTriggerSourceFor`, `:32-34`). O arquivo não é `server-only` — roda também nos componentes.
- **Roteamento de conta é um módulo só para as duas plataformas** (`assignConfirmationAccount`, `lib/order-account-routing.ts:18-52`); `lib/shopify-confirmation-service.ts:251` só reexporta para chamadas antigas.
- **`instance_name` é a chave de particionamento/tenant em quase toda tabela** (`conversations`, `triggers`, `flows`, `flow_media`, `agent_memory_blocks`, `message_variables`, `notifications`, `fulfillment_orders`) — multi-instância por *número de WhatsApp* sob um único admin. Rotas que recebem `id` validam posse via `lib/instance-guard.ts` (`belongsToInstance`), reforçado por `__tests__/api/*-isolation.test.ts`.
- **`proxy.ts` é o único gate de autenticação** para `/api/:path*`, por allowlist de pathname **exato** (`proxy.ts:10-20`): login/verify/logout e 6 webhooks (Evolution, WhatsApp Cloud, Shopify orders, Shopify abandoned-checkouts, Lightfunnels, interatividade do Slack). Cada webhook tem autenticação própria (HMAC/secret). Rota nova de webhook precisa entrar nessa lista — ver Armadilhas. O callback OAuth do Lightfunnels **não** está na lista — exige o cookie de admin do navegador que iniciou o OAuth.
- **Rate limiting e dedup são in-memory (`Map`)** — `lib/rate-limit.ts` e `lib/login-rate-limit.ts` documentam que só é seguro com réplica única.
- **Segredos são cifrados em repouso** com AES-256-GCM (`lib/ai-crypto.ts`): chaves de IA, credenciais Shopify/WhatsApp Cloud, access/refresh token do Lightfunnels (`migrations/027_lightfunnels_integration.sql:6-9`).
- **Fetches de saída para URLs de terceiros passam por SSRF guard** (`lib/ssrf-guard.ts`).
- **Feature flags via env var** (`lib/features.ts`): `gallery`, `aiSessions`, `switchCase`.
- **`APP_VERSION` (`lib/version.ts`) é incrementado a cada update relevante** e exibido em Configurações Gerais.
- **Automações simples são globais, não por instância**: cada uma escolhe o próprio número (`automations.instance_name`), por isso `/api/automations` não filtra por instância. Cada lembrete é executado por um fluxo gerado e escondido (`flows.managed_by_automation_id`) — `lib/automations.ts`, `lib/automation-rules.ts`.
- **Integrações que escrevem para fora nascem desligadas** (encaminhamento ao Slack, write-back no Lightfunnels — `writeback_enabled DEFAULT false`, `migrations/027_lightfunnels_integration.sql:33-34`).

## Fluxos críticos

### 1. Mensagem WhatsApp recebida (inbound) — dual provider

**Evolution API** — `app/api/webhook/evolution/route.ts`
1. Content-Type deve ser `application/json` — `app/api/webhook/evolution/route.ts:124`
2. Limite de tamanho do body (15 MB) — `lib/evolution-api.ts:8-13`
3. Header `x-webhook-secret` comparado em tempo constante; falha fechado sem `EVOLUTION_WEBHOOK_SECRET` — `lib/evolution-api.ts:94-99`
4. Só `event === 'messages.upsert'` persiste mensagem — `app/api/webhook/evolution/route.ts:250`
5. `instanceName` vem de `body.instance`; ausente → evento descartado — `app/api/webhook/evolution/route.ts:153,261`
6. Dedup por `wa_message_id` antes de inserir (o índice único é a garantia final, 23505 tratado) — `app/api/webhook/evolution/route.ts:24,287-292`
7. Resolução de `@lid`→`@s.whatsapp.net` (lógica diferente para inbound vs outbound) — `app/api/webhook/evolution/route.ts:305-352`
8. Upsert em `conversations` (`onConflict: wa_id, instance_name`) e insert em `messages` — `app/api/webhook/evolution/route.ts:459,482`
9. Cascata fire-and-forget após a resposta HTTP: flow pausado → sandbox com envio real → sessão de IA ativa → triggers por keyword — `app/api/webhook/evolution/route.ts:541-590`

**WhatsApp Cloud API** — `app/api/webhook/whatsapp-cloud/route.ts`
1. GET faz handshake `hub.verify_token` da Meta — `lib/whatsapp-cloud-webhook-auth.ts:10`
2. POST valida HMAC-SHA256 do corpo cru (`X-Hub-Signature-256`) — `app/api/webhook/whatsapp-cloud/route.ts:376`, `lib/whatsapp-cloud-webhook-auth.ts:21`
3. Conta identificada por `metadata.phone_number_id` — `app/api/webhook/whatsapp-cloud/route.ts:266`, `lib/whatsapp-cloud-credentials.ts:43`
4. Mesma dedup e mesma cascata pós-save que a Evolution — `app/api/webhook/whatsapp-cloud/route.ts:211`

### 2. Envio de mensagem (outbound) — dispatcher + janela de 24h

1. `lib/whatsapp-dispatch.ts:63-66` resolve o adapter por `accounts.provider`; qualquer valor que não seja `cloud_api` vira `evolution` — `lib/whatsapp-account-provider.ts:15-23`
2. Envio manual do operador: `app/api/messages/route.ts` → `lib/whatsapp-text.ts:60-71` → `dispatchSendText`. **Não checa a janela de 24h.**
3. Janela de 24h calculada de `conversations.last_inbound_at` (não `last_message_at`) — `lib/messaging-window.ts:18-28`
4. Verificada no node `sendMessage` do flow engine só quando `provider==='cloud_api'` — `lib/flow-engine.ts:1620-1627` — e na recuperação manual de carrinho — `lib/shopify-confirmation-service.ts:1269`
5. Fora da janela no flow engine: se o node tem `fallbackTemplateId`, envia o template aprovado no lugar do node inteiro e o fluxo pausa até o cliente responder — `lib/flow-engine.ts:1629-1672`; sem template, cria notificação `outside_window` para o operador (encaminhada ao Slack se ligado) e não envia — `lib/flow-engine.ts:1674-1688`. Na recuperação de carrinho, usa o template de recuperação da integração — `lib/shopify-confirmation-service.ts:1274-1290`

### 3. Gatilho e execução de fluxo (Flow Engine)

1. Prioridade de resposta a uma mensagem inbound: `flow_runs` pausado → sandbox com envio real → `ai_sessions` ativa → `executeTriggers` (fluxo 1, passo 9)
2. `executeTriggers` (`lib/message-triggers.ts:6-87`) compara texto normalizado contra `triggers.valor` (lista por vírgula, suporta `*`), `exact`/`contains`; primeiro match dispara e `break` (`:87`)
3. Origens de gatilho (`triggers.source`): `message` (texto), e as disparadas por evento — `shopify_order`, `lightfunnels_order`, `delivery_status`, `shopify_abandoned_checkout` — `types/index.ts:47`, `lib/trigger-input.ts:4`. As de evento só fazem sentido com `action='flow'`.
4. `executeFlow` (`lib/flow-engine.ts:1433`) roda síncrono dentro do webhook, fire-and-forget, com limite de loop (`visited.size < 50`) — `lib/flow-engine.ts:1501`
5. Fila (`flow_jobs` + `lib/flow-job-worker.ts`) para: pedido ainda não sincronizado (`OrderContextPendingError` → `flow_message_resume`) e disparos por evento (`shopify_order_flow`, `lightfunnels_order_flow`, `delivery_status_flow`, `abandoned_checkout_flow`) — `lib/flow-jobs.ts:6-11`, constraint em `migrations/027_lightfunnels_integration.sql:120-130`
6. Worker é **poll in-process adaptativo** (1s com trabalho, dobrando até 15s ocioso; acordado na hora por `lib/flow-job-signal.ts`), via RPC `claim_flow_jobs` com `FOR UPDATE SKIP LOCKED` — `lib/flow-job-worker.ts:18-23,131`, `migrations/009_message_variables_and_flow_jobs.sql:55-107`
7. Estado de fluxo pausado vive em `flow_runs` (`UNIQUE(instance_name, remote_jid)`); apagado ao concluir — `lib/flow-engine.ts:341,2102`
8. Bloco de IA (`aiAssistant`) — `lib/flow-engine.ts:1995`; credenciais em `ai_provider_keys` cifradas — `lib/flow-engine.ts:1053`, `lib/ai-crypto.ts`

### 4. Pedido (Shopify ou Lightfunnels) → conta WhatsApp → confirmação → FenixCOD → entrega

**Entrada — Shopify**
1. Webhook `orders/create|updated|paid|cancelled|delete` → `POST /api/webhook/shopify/orders`; loja identificada por `x-shopify-shop-domain`, HMAC com o secret do app próprio da loja ou do app global — `app/api/webhook/shopify/orders/route.ts:14-34`, `lib/shopify-client.ts:37-43`
2. `orders/delete` → `archiveShopifyOrder` (Desistiu, sai da fila se sem `lead_number`, cancela job pendente) — `lib/shopify-confirmation-service.ts:421-470`
3. Demais tópicos → `upsertShopifyOrder`; o gatilho só é pedido em `orders/create` e com os gatilhos Shopify ativos — `app/api/webhook/shopify/orders/route.ts:47-49`

**Entrada — Lightfunnels** (detalhes em `docs/LIGHTFUNNELS.md`)
1. Conexão: app de Partners global (Client ID/Secret em `app_settings`) → OAuth → callback troca `code` por token, identifica a conta por `account { id }` e faz upsert por `lf_account_id` — `app/api/lightfunnels/callback/route.ts:40-74`; registra os webhooks na hora — `app/api/lightfunnels/callback/route.ts:85`
2. Webhooks criados via `createWebhook` com URL `/api/webhook/lightfunnels?integration={id}&event={tipo}`, IDs guardados em `webhook_ids` (não há listagem na API) — `lib/lightfunnels-webhook-setup.ts:11-23,33-36,49-96`
3. Recepção: id da integração validado como UUID → integração ativa (404 senão) → HMAC `lightfunnels-hmac` com o client secret do app → evento suportado — `app/api/webhook/lightfunnels/route.ts:24-47`. O HMAC é aceito sobre o corpo cru **ou** sobre o `JSON.stringify` do corpo parseado, sempre em tempo constante — `lib/lightfunnels-client.ts:29-43`
4. Eventos: `order/confirmed` → `upsertLightfunnelsOrder` pedindo gatilho se os gatilhos LF estiverem ativos; `order/updated|cancelled|uncancelled|refunded|fulfilled` → upsert sem gatilho; `payment/paid` é ignorado (o `order/updated` que acompanha atualiza); `product/*` sincroniza o catálogo; `app/uninstalled` desativa a integração — `app/api/webhook/lightfunnels/route.ts:63-104`. Falha de processamento → 500 para permitir reenvio — `:106-112`
5. Mapeamento: itens são snapshots sem quantidade (cada snapshot = 1 unidade, agrupados por variante+preço, `removed_at` ignorado, pacote `,N` expandido) — `lib/lightfunnels-order-service.ts:129-167`; `payment_type` = `PREPAID` só se `financial_status='paid'` — `:213`; chave interna `order_number = lightfunnels-{lfAccountId}-{orderId}` — `:202`
6. Gravação: insere como `pending_operator` / "Não responde" / `Pendente` / "Não enviado"; corrida de dois webhooks (23505) relê e atualiza — `lib/lightfunnels-order-service.ts:268-295`. `funnel_id`/`store_id` só vêm no webhook e nunca são apagados por uma leitura da API — `:261-264`
7. Cancelamento/arquivamento no LF → Desistiu, sai da fila se ainda sem `lead_number`, job `lightfunnels_order_flow` pendente vira `failed` — `lib/lightfunnels-order-service.ts:308-313,385-404`
8. Enfileira o gatilho se `sendConfirmation` e o pedido ainda não teve `confirmation_message_sent_at` — `lib/lightfunnels-order-service.ts:315-318`; busca o gatilho `source='lightfunnels_order'` da conta e cria job com `dedupe_key lightfunnels-order:{id}`, TTL 24h — `:356-380`, `lib/flow-jobs.ts:73-91`. Sem gatilho/sem conta, grava o motivo em `confirmation_message_error` — `lib/lightfunnels-order-service.ts:371-379`
9. "Sincronizar" faz backfill (até 4 páginas) sem disparar gatilho — `lib/lightfunnels-order-service.ts:408-425`

**Roteamento para a conta WhatsApp (comum às duas plataformas)** — `assignConfirmationAccount`, `lib/order-account-routing.ts:18-52`
1. Vínculos da loja/conta da plataforma: Shopify → `pickShopifyStoreAccount` (`lib/shopify-store-accounts.ts:55-57`); Lightfunnels → `pickLightfunnelsStoreAccount` com o `funnel_id` do pedido (`lib/order-account-routing.ts:26-33`)
   - Lightfunnels: primeiro os vínculos **dedicados ao funil** (`funnel_ids` contém o funil), depois os **genéricos** (`funnel_ids` vazio); pedido sem funil conhecido só casa com genéricos — `lib/lightfunnels-store-accounts.ts:63-82`
   - Dentro de cada grupo (`pickLinkedAccount`): só vínculos `enabled` de contas que ainda existem e não são sandbox; a conta do país do pedido vem primeiro, senão a de menor `priority` — `lib/store-account-links.ts:17-39`
2. Conta padrão global de pedidos (`app_settings.shopify_default_order_instance`, a mesma para as duas plataformas; ignorada se virou sandbox ou não existe) — `lib/order-account-routing.ts:35-36`, `lib/shopify-order-settings.ts:7-20`
3. País + `confirmation_priority` entre contas com `confirmation_enabled` — `lib/order-account-routing.ts:38-51`
4. Conta já atribuída **não muda** em webhooks seguintes (o operador pode ter movido o pedido à mão) — `lib/lightfunnels-order-service.ts:252-254`, `lib/shopify-confirmation-service.ts:340-342`

**Confirmação e envio (comum)**
1. Worker processa `shopify_order_flow` / `lightfunnels_order_flow`, cada um respeitando a **sua** pausa global (`shopify_triggers_enabled` / `lightfunnels_triggers_enabled`) — `lib/flow-job-worker.ts:76-92`, `lib/lightfunnels-trigger-settings.ts:10-21`
2. Os dois tipos rodam `runShopifyOrderTrigger` (alias neutro `runOrderTrigger`), que escolhe o gatilho por `orderTriggerSourceFor(order.source)` — `lib/shopify-confirmation-service.ts:969-1004,1033`; bloqueia pedido cancelado/removido em qualquer plataforma — `:918-919`
3. Operador (ou node de fluxo) muda `commercial_status` para "Confirmado*" → `maybeAutoSubmitConfirmedOrder` → `shouldSubmitToFenix` (confirmado + `send_status='Pendente'` + sem `lead_number` + não simulação) — `lib/fulfillment-order-state.ts:20-49`, `lib/order-state.ts:43-53`
4. `submitFulfillmentOrder` trava a linha, resolve SKUs reais (LF: pelo catálogo `lightfunnels_products` da integração; SKU placeholder `LIGHTFUNNELS-n` não serve) e chama `createLead`; pedido pago na plataforma vai com COD 0 — `lib/fulfillment-service.ts:273-352,504-544`
5. `fulfillment-delivery-worker.ts` faz poll a cada 30s (`lib/fulfillment-delivery-worker.ts:8`), uma integração por vez, e aplica status via RPC `apply_fulfillment_delivery_status` — `lib/fulfillment-delivery-sync.ts:132,292`
6. UI em `/fulfillment` (`components/fulfillment/fulfillment-page.tsx`); simulação sem conta real em Sandbox → Simular pedido → Plataforma Lightfunnels (`app/api/fulfillment/sandbox/lightfunnels-order/route.ts:80-99`)

**Write-back no Lightfunnels (opt-in)** — `lib/lightfunnels-writeback.ts`
1. Disparado sem bloquear, só para `source='lightfunnels'`, depois de: mudança de estado do pedido (`lib/fulfillment-order-state.ts:90`, `lib/shopify-confirmation-service.ts:1194`), envio ao FenixCOD (`lib/fulfillment-service.ts:352`) e mudança de status de entrega (`lib/fulfillment-delivery-sync.ts:199`) — `scheduleLightfunnelsWriteback`, `lib/lightfunnels-writeback.ts:104-110`
2. Pula simulação, integração inativa/desconectada ou com `writeback_enabled=false` — `lib/lightfunnels-writeback.ts:71-75`
3. Tags desejadas calculadas do estado atual: `ff:confirmado`/`ff:desistiu`, `ff:enviado-fenixcod`, `ff:a-caminho`/`ff:novidade`/`ff:rejeitado`/`ff:entregue` — `lib/lightfunnels-writeback.ts:34-50`; só chama a API se mudaram em relação a `lightfunnels_writeback_tags` — `:77-78`
4. Lê as tags atuais do pedido na API, preserva as que não começam com `ff:` e grava via `updateOrder` só com `tags` — `lib/lightfunnels-writeback.ts:56-61,81-85`, `lib/lightfunnels-client.ts:148-150`; erro vai para `lightfunnels_writeback_error` e é refeito na próxima mudança — `lib/lightfunnels-writeback.ts:91-97`

### 5. Recuperação de carrinho abandonado (só Shopify)

> Detalhes em `docs/FLOWS.md` → "Carrinho abandonado". O schema e o
> roteamento já comportam carrinho Lightfunnels, mas o serviço e a origem
> `lightfunnels_abandoned_checkout` não existem (`docs/LIGHTFUNNELS.md`,
> "Fora do escopo atual").

1. Webhooks `checkouts/create|update` → `upsertShopifyAbandonedCheckout`, roteado pela mesma `assignConfirmationAccount` (`lib/shopify-confirmation-service.ts:658`), agenda um `flow_job` `abandoned_checkout_flow` por gatilho `source='shopify_abandoned_checkout'` da conta (última atividade + `delay_ms`, padrão 60 min). Carrinho sem telefone é ignorado; respeita `shopify_triggers_enabled` (também no worker — `lib/flow-job-worker.ts:120-122`).
2. Conversão: pedido com `checkout_token`/`checkout_id` (`markAbandonedCheckoutsConvertedByOrder`) ou checkout com `completed_at` → `Convertido` + cancela jobs. O worker reconfere token e telefone antes de executar o fluxo (variáveis `{{carrinho.*}}`).
   - O delay conta da **última atividade do cliente segundo a Shopify** (`updated_at`/`created_at` do payload), não da chegada do webhook — `lib/shopify-confirmation-service.ts:560-564`. Cada `checkouts/update` reagenda o job pendente para frente (dedupe `abandoned-checkout:{checkoutId}:{triggerId}`), e vários gatilhos com delays diferentes viram uma sequência de lembretes — `lib/flow-jobs.ts:97-138`.
   - Não agenda (cada motivo vai para o log): sem telefone, sem conta, gatilhos pausados, conta sem gatilho, ou hora ideal vencida há mais de 6h (webhook reentregue tarde) — `lib/shopify-confirmation-service.ts:540-616`. Job expira 6h depois do horário previsto — `lib/flow-jobs.ts:95`.
2. Conversão: pedido com `checkout_token`/`checkout_id` (`markAbandonedCheckoutsConvertedByOrder`, chamado em todo `upsertShopifyOrder` — `lib/shopify-confirmation-service.ts:395,636-658`) ou checkout com `completed_at` → `Convertido` + cancela jobs. Na hora do envio, `runAbandonedCheckoutTrigger` reconfere status, `completed_at`, pedido com o mesmo token e, como rede de segurança, **qualquer pedido do mesmo telefone feito depois do checkout** — sem filtrar por integração/conta (`lib/shopify-confirmation-service.ts:845-897`). Enviado → `recovery_status='Enviado'` (variáveis `{{carrinho.*}}`).
3. **Rascunhos (draft orders)** — o "carrinho abandonado" de lojas com app de formulário COD em vez do checkout Shopify (migration `028_shopify_draft_orders.sql`):
   - Webhooks `draft_orders/create|update|delete` → `POST /api/webhook/shopify/draft-orders` (mesma validação de loja/HMAC das outras rotas Shopify) — `app/api/webhook/shopify/draft-orders/route.ts`
   - `normalizeDraftOrderPayload` converte o rascunho para o formato de checkout: id `draft:{id}`, link = `invoice_url`, `status='completed'` ou `order_id` preenchido = concluído — `lib/shopify-confirmation-service.ts:736-752`. Grava na **mesma** `shopify_abandoned_checkouts` com `source='draft_order'` e `shopify_name`, e usa o **mesmo** gatilho "Carrinho abandonado" e delay — `:756-768`
   - `draft_orders/delete` → "Não enviar" + cancela lembretes (rascunho já convertido fica como está) — `:773-797`
   - Exige o escopo `read_draft_orders`; loja conectada antes dele precisa reconectar (o registro avisa por tópico — `lib/shopify-webhook-setup.ts:96-112`)
4. Registro dos webhooks: `ensureOrderCreateWebhookRegistered` cria via Admin REST (`POST /webhooks.json`) os 10 tópicos de pedido/checkout/rascunho, sem depender da aba Notificações → Webhooks do admin (onde eles não aparecem) — `lib/shopify-webhook-setup.ts:6-22,37-69`. Roda após o OAuth e a cada abertura de `/fulfillment` (`components/fulfillment/fulfillment-page.tsx:105-134`); só cria o que falta.
5. "Sincronizar" (`syncShopifyData`) importa até 50 pedidos, checkouts e rascunhos abertos; só agenda gatilhos se `sendConfirmation` for pedido explicitamente — `lib/shopify-confirmation-service.ts:1426-1480`.
6. **Automação simples tem precedência** (ver fluxo 7): carrinho real com automação ligada para o país e a linha não usa os gatilhos da conta.
7. Disparo **manual** lado a lado: `POST /api/fulfillment/shopify/abandoned-checkouts/{id}/recover` → `sendAbandonedCheckoutRecovery`; dentro da janela, texto livre; fora (Cloud API), template aprovado (`recovery_template_id`, migration 020).

### 6. Atendimento humano via Slack

> Guia completo e setup em `docs/SLACK.md`.

1. Conexão única (bot token `xoxb-` + Signing Secret) cifrada em `app_settings`, validada com `auth.test` — `app/api/integrations/slack/route.ts`
2. Node `slackNotify` cria notificação `escalation` e posta no canal; com "Transferir para humano" marca `ai_sessions.requires_human` e encerra o fluxo — `lib/flow-engine.ts:1792`, `lib/slack-notifications.ts`
3. Encaminhamento opcional (desligado por padrão, por conta, `slack_notification_settings`) de escalonamento da IA, node "Notificar" e "fora da janela de 24h" — `forwardNotificationToSlack`, nunca lança
4. Botão "Assumir atendimento" → `POST /api/webhook/slack/interactivity` (assinatura `v0`, janela de 5 min) → claim atômico em `slack_messages` → notificação lida + `requires_human` + `chat.update`

### 7. Automações simples (carrinho, pedido criado, entrega e palavra-chave sem fluxo)

> Guia completo em `docs/AUTOMATIONS.md`.

1. Cadastro: aba Automações → assistente → `POST /api/automations`. `parseAutomationInput` (`lib/automation-rules.ts`) valida forma (país ISO, 1–3 lembretes com espera crescente); `validateReferences` (`lib/automations.ts`) valida linha, número (não sandbox), variáveis e, em Cloud API, template aprovado do próprio número em todo lembrete. Nasce `enabled=false`; ligar (`PATCH`) revalida.
2. Cada lembrete gera/atualiza um fluxo `início → enviar mensagem → fim` (`syncSteps`), só enquanto `managed_by_automation_id` ainda aponta para a automação.
3. Carrinho Shopify real → `findShopifyCartAutomation` (`lib/automation-runtime.ts`): automações ligadas → linha do carrinho por `line_items[].product_id` vinculados (`resolveShopifyCartProductLine`, menor prioridade vence) → `pickCartAutomation` (país e linha; a da linha vence a de "qualquer linha").
4. Match → `scheduleCartAutomationSteps` (`lib/shopify-confirmation-service.ts`): um job por lembrete no número da automação, dedupe `abandoned-checkout:{checkout}:automation:{id}:{posição}`, e cancela os outros jobs pendentes do carrinho (`cancelStaleAbandonedCheckoutJobs`, `lib/flow-jobs.ts`). Sem match: gatilhos da conta, cancelando lembretes de automação que deixou de valer.
5. Worker: `payload.automationId` → `runAbandonedCheckoutTrigger(..., { automationId })` só envia com a automação ligada e pelo número atual dela (`getEnabledAutomationInstance`).
6. Os outros modelos (migration 031) seguem o mesmo padrão — automação antes do gatilho da conta: pedido criado em `upsertShopifyOrder` e no `enqueueOrderTrigger` do Lightfunnels (`findOrderAutomation`), status de entrega depois da RPC `apply_fulfillment_delivery_status` (`scheduleDeliveryStatusAutomation`, cancela os jobs do mesmo evento) e palavra-chave no início de `executeTriggers` (`findMessageAutomation`).

## Regras de negócio

### Pedidos e plataformas

- **Regra:** Pedido Lightfunnels só entra (e só dispara o fluxo de confirmação) no `order/confirmed`, nunca no `order/created`.
  **Onde:** `lib/lightfunnels-webhook-setup.ts:8-23`, `app/api/webhook/lightfunnels/route.ts:64-67`
  **Por quê:** o `order/created` dispara antes dos upsells/downsells terminarem e pode chegar sem todos os itens.

- **Regra:** No Lightfunnels, o gatilho dispara para qualquer pedido que ainda não teve mensagem de confirmação, mesmo que ele já exista no banco (ex: entrou antes por `order/updated` ou pelo Sincronizar). Na Shopify, só para pedido **novo** em `orders/create`.
  **Onde:** `lib/lightfunnels-order-service.ts:315-318` vs `lib/shopify-confirmation-service.ts:389`, `app/api/webhook/shopify/orders/route.ts:49`
  **Contexto:** o job tem `dedupe_key` por pedido (`lib/flow-jobs.ts:80`), então dois `order/confirmed` não duplicam a mensagem.

- **Regra:** O roteamento de pedido para conta WhatsApp segue sempre esta ordem: vínculos da loja/conta da plataforma (no Lightfunnels: dedicados ao funil → genéricos) → conta padrão global → país + `confirmation_priority`. Um vínculo dedicado a um funil ganha de um genérico mesmo com prioridade pior.
  **Onde:** `lib/order-account-routing.ts:7-10,18-52`, `lib/lightfunnels-store-accounts.ts:63-82`
  **Contexto:** testes em `__tests__/lib/lightfunnels-store-accounts.test.ts` ("prefers an account dedicated to the order funnel over a generic one with higher priority").

- **Regra:** Dentro de um grupo de vínculos, a conta do mesmo país do pedido ganha; empate ou nenhuma do país decide pela menor `priority`. Vínculo de conta apagada ou que virou sandbox é ignorado (cai para o próximo grupo / regra geral), e sandbox não pode ser vinculada.
  **Onde:** `lib/store-account-links.ts:17-39,42-52`

- **Regra:** A conta escolhida na primeira gravação do pedido não é recalculada por webhooks seguintes.
  **Onde:** `lib/lightfunnels-order-service.ts:252-254`, `lib/shopify-confirmation-service.ts:340-342`
  **Por quê:** o operador pode ter movido o pedido de conta manualmente.

- **Regra:** Cada plataforma tem sua própria pausa global de gatilhos de pedido (`shopify_triggers_enabled`, `lightfunnels_triggers_enabled`), conferida no webhook **e** de novo no worker; ambas valem `true` quando não configuradas.
  **Onde:** `lib/lightfunnels-trigger-settings.ts:10-21`, `lib/shopify-trigger-settings.ts:6-9`, `lib/flow-job-worker.ts:78,87`, `lib/shopify-confirmation-service.ts:1002`

- **Regra:** Não há mensagem de confirmação estática: sem gatilho "Pedido {plataforma} criado" na conta, nada é enviado e o motivo fica em `confirmation_message_error`.
  **Onde:** `lib/lightfunnels-order-service.ts:371-379`, `lib/shopify-confirmation-service.ts:1000`

- **Regra:** Pedido cancelado ou excluído/arquivado na plataforma vira "Desistiu"; se ainda não foi ao FenixCOD (sem `lead_number`, `status` `pending_operator`/`failed`), sai da fila (`cancelled`, "Não enviar") e o job de confirmação pendente é cancelado. Fluxo e envio ao FenixCOD ficam bloqueados para ele.
  **Onde:** `lib/lightfunnels-order-service.ts:385-404`, `lib/shopify-confirmation-service.ts:421-470`, `lib/shopify-confirmation-service.ts:918-919`, `lib/fulfillment-service.ts:293-312`

- **Regra:** O valor cobrado pelo FenixCOD na entrega é zerado quando o pedido já foi pago na plataforma (`financial_status='paid'` — Shopify ou Lightfunnels).
  **Onde:** `lib/fulfillment-service.ts:321-333`, `lib/order-platform.ts:55-58`
  **Por quê:** COD de pedido já pago duplicaria a cobrança. O valor real continua no banco/UI; só o payload externo é zerado.

- **Regra:** Item Lightfunnels só vai ao FenixCOD com SKU real (o mesmo do FenixCOD) vindo do catálogo sincronizado ou do snapshot; o placeholder `LIGHTFUNNELS-n` é rejeitado com mensagem pedindo para cadastrar o SKU e sincronizar.
  **Onde:** `lib/fulfillment-service.ts:526-539`

- **Regra:** Quantidade "pacote" (SKU com sufixo `, N` ou título tipo "3 frascos"/"3 bottles") é multiplicada para a quantidade física antes de enviar ao FenixCOD — vale para as duas plataformas (`shopify_quantity` / `lightfunnels_quantity` guardam os pacotes vendidos).
  **Onde:** `lib/shopify-pack-quantity.ts:35,82`, `lib/lightfunnels-order-service.ts:147-166`, `lib/fulfillment-service.ts:540-543`
  **Contexto:** corrigido pelo commit `4bbc2cc` para a Shopify.

- **Regra:** Um pedido só pode ser cancelado localmente sem contato com o FenixCOD se ainda não tiver `lead_number`; depois disso, cancelamento exige `deleteLead`. País e itens ficam travados para edição assim que `lead_number` existe.
  **Onde:** `lib/fulfillment-service.ts:374-415`, `lib/shopify-confirmation-service.ts:1091,1150`

- **Regra:** Apenas 17 países têm mapeamento ISO→nome FenixCOD (ES, PT, IT, PL, SK, CZ, RO, BG, GR, HU, SI, HR, AT, DE, FR, BE, NL); `fulfillment_integrations`, `fulfillment_products` e `accounts.country` usam o **nome** FenixCOD (`SPAIN`), não o ISO.
  **Onde:** `lib/fulfillment-countries.ts:1-27`

### Write-back e catálogo

- **Regra:** O write-back no Lightfunnels é opt-in por integração e só mexe em tags com prefixo `ff:`; tags do lojista são preservadas, e falha no write-back nunca afeta o ciclo do pedido.
  **Onde:** `migrations/027_lightfunnels_integration.sql:33-34`, `lib/lightfunnels-writeback.ts:9-17,56-61,91-97`

- **Regra:** Um produto ocultado localmente (`hidden=true`) nunca é reexibido por sincronizações futuras; ocultar desliga a cópia local em `fulfillment_products`.
  **Onde:** `migrations/006_shopify_products_catalog.sql:8-10`, `lib/lightfunnels-products-service.ts:133,225`
  **Por quê (Shopify):** escopo OAuth `read_products` — a ocultação é puramente local.

### Mensageria e fluxos

- **Regra:** A janela de 24h só existe para contas WhatsApp Cloud API — contas Evolution nunca são bloqueadas por ela.
  **Onde:** `lib/flow-engine.ts:1624`
  **Por quê:** restrição da Meta na API oficial.

- **Regra:** O envio manual pelo operador (`app/api/messages/route.ts`) não verifica a janela de 24h nem oferece fallback de template.
  **Onde:** `app/api/messages/route.ts`, `lib/whatsapp-text.ts:71`

- **Regra:** Timeout no envio manual não marca a mensagem como `failed`; fica em `sending` (HTTP 504).
  **Onde:** `app/api/messages/route.ts:89-138`
  **Por quê:** a Evolution pode ter aceitado o envio; um retry automático duplicaria a mensagem.

- **Regra:** Se o `node_id` de um `flow_runs` pausado não existe mais (fluxo editado enquanto a conversa esperava), o `flow_runs` órfão é apagado e o fluxo reinicia do `start`.
  **Onde:** `lib/flow-engine.ts:1487-1497`
  **Contexto:** commit `00a67fa` — antes a conversa travava silenciosamente.

- **Regra (Automações):** Uma automação por modelo + plataforma + país + linha; no carrinho, a da linha vence a de "qualquer linha" e, com produtos de linhas diferentes, vence a linha de menor prioridade — um envio só.
  **Onde:** `migrations/030_automations.sql` (`automations_scope_key`), `lib/automation-rules.ts` (`pickCartAutomation`), `lib/product-line-match.ts` (`pickProductLine`)

- **Regra (Automações):** A automação que casa com o carrinho tem precedência sobre os gatilhos "Carrinho abandonado" da conta — os jobs pendentes deles são cancelados. Os gatilhos antigos continuam valendo para carrinhos sem automação.
  **Onde:** `scheduleAbandonedCheckoutTriggers` em `lib/shopify-confirmation-service.ts`

- **Regra:** Um node `sendMessage` com `replyButtons` só pode se conectar diretamente a um único node `switchCase`; o save do fluxo bloqueia o resto.
  **Onde:** `lib/flow-connection-validation.ts:15-19`, `lib/flow-validation.ts:227-231`

- **Regra:** Se um humano assume a conversa (`requires_human`) enquanto a IA gera uma resposta, a resposta é descartada.
  **Onde:** `lib/flow-engine.ts:1283-1298`

## Coisas não óbvias / armadilhas

- **Automações: país em dois formatos.** A automação guarda ISO (`ES`); o carrinho guarda o nome do FenixCOD (`SPAIN`) — a comparação passa por `automationMatchesCountry` (`lib/automation-rules.ts`). Comparar direto nunca casa.
- **Automações: aplicar `029`, `030` e `031` antes do deploy.** `GET /api/flows` filtra por `managed_by_automation_id`; sem a coluna, a lista de Fluxos quebra.
- **Fluxo gerado por automação não aparece nem é editável na aba Fluxos** (`PUT`/`DELETE` → 409, `app/api/flows/[id]/route.ts`): uma edição manual seria sobrescrita no próximo salvar da automação.
- **`proxy.ts` não é `middleware.ts`** — no Next.js 16 o mecanismo de gate global foi renomeado.
- **Rota nova de webhook precisa entrar em `PUBLIC_API_PATHS` (`proxy.ts`) e em `__tests__/proxy.test.ts`**: os testes de rota chamam o handler direto e não passam pelo proxy. Foi assim que `/api/webhook/shopify/draft-orders` ficou bloqueada (401 antes do HMAC) até a v1.20.1 — rascunhos só entravam pelo "Sincronizar". Depois de uma falha longa a Shopify pode remover a assinatura; abrir `/fulfillment` recria.
- **Pedido Shopify que chega com gatilhos pausados nunca recebe a confirmação automática depois**: o job só é criado em `orders/create` de pedido novo (`app/api/webhook/shopify/orders/route.ts:50`, `lib/shopify-confirmation-service.ts:408`); religar os gatilhos não reenvia.
- **Webhook Lightfunnels carrega integração e evento na query string**, porque o payload só traz `{ node }` e o `proxy.ts` libera só caminhos exatos (`lib/lightfunnels-webhook-setup.ts:31-36`). Mudar a URL pública do app exige recriar os webhooks ("Webhooks" na UI → `ensureLightfunnelsWebhooks` com `force`, `lib/lightfunnels-webhook-setup.ts:63-73`).
- **O HMAC do Lightfunnels usa o client secret do app global**, não um segredo por integração (`app/api/webhook/lightfunnels/route.ts:39-40`) — trocar as credenciais do app em `app_settings` invalida a verificação de todos os webhooks de uma vez.
- **Refresh token do Lightfunnels é rotativo** (cada refresh invalida o anterior): a renovação usa lock otimista em `refresh_token_iv`, e quem perde a corrida relê o token que o outro gravou. `invalid_grant` marca a integração como desconectada (`oauth_connected=false`) — `lib/lightfunnels-token.ts:12-17,77-124`.
- **`runShopifyOrderTrigger` também roda pedidos Lightfunnels** (o nome é histórico; `runOrderTrigger` é o alias neutro) e o parâmetro `respectShopifyTriggerSetting` na verdade respeita a pausa da plataforma do pedido — `lib/shopify-confirmation-service.ts:1002,1033`, `lib/flow-job-worker.ts:85-92`.
- **A "conta padrão de pedidos" mora numa chave com nome Shopify** (`shopify_default_order_instance`, `lib/shopify-order-settings.ts:5`) mas vale para as duas plataformas.
- **`order_number` é chave interna** (`shopify-loja-123`, `lightfunnels-conta-456`); o número que o cliente reconhece é `getOrderDisplayNumber` (`lib/order-platform.ts:38-42`), usado em `{{pedido.numero}}` e na ferramenta de IA de consulta de pedido.
- **País do Lightfunnels por nome em inglês nem sempre bate com o FenixCOD**: o mapeamento só converte ISO; um nome cai em `toUpperCase()` (`lib/lightfunnels-order-service.ts:109-112`). `Spain`/`France`/`Italy` batem, mas os nomes FenixCOD `HUNGRY`, `ESLOVAKIA`, `ESLOVENIA`, `CROACIA`, `CZECH REPUBLIC` (`lib/fulfillment-countries.ts`) não batem com `Hungary`/`Slovakia`/`Slovenia`/`Croatia`/`Czechia`. Nesses casos o pedido não casa conta por país nem integração FenixCOD.
- **Cancelamento no Lightfunnels não dispara write-back** — `applyLightfunnelsCancellation` não chama `scheduleLightfunnelsWriteback` (`lib/lightfunnels-order-service.ts:385-404`), então `ff:desistiu` só é gravado na próxima mudança de estado feita no FlashFlow.
- **Migrations `001`-`030` não são o schema completo.** As tabelas fundacionais (`conversations`, `messages`, `accounts`, `flows`, `triggers`, `ai_sessions`, `agent_memory_blocks`, `ai_provider_keys`, `instance_ai_config`) foram criadas antes do diretório `migrations/` e só têm `ALTER TABLE`s incrementais.
- **`lib/sandbox.ts` é só duas constantes** — a lógica de "nunca enviar de verdade no sandbox" está em `resolveRealSendTarget` (`lib/flow-engine.ts:102`). Pedido simulado Lightfunnels usa a primeira integração ativa ou uma integração fictícia `id: null` (`app/api/fulfillment/sandbox/lightfunnels-order/route.ts:80-92`), e nunca é escrito de volta (`lib/lightfunnels-writeback.ts:71`).
- **`lib/flow-transfer.ts` não tem relação com sandbox** — é o export/import de fluxos entre contas.
- **Resolução de `@lid` é assimétrica por direção**: inbound busca por `contact_name`, outbound por `contact_phone` — já causou dois bugs de conversa duplicada (commits `d6a2343`, `579edf1`).
- **Node types legados** (`fulfillmentStock`, `fulfillmentStatus`, `types/index.ts:77-78`) existem só para fluxos antigos continuarem carregando.
- **`switchCase` tem um handle `default` implícito**, mas `condition` só tem `true`/`false`.

## Divergências entre documentação existente e o código

O `CLAUDE.md` foi reescrito (commit `d0317e1`) e hoje bate com o código,
inclusive com a integração Lightfunnels. `docs/DECISIONS.md` marca as
decisões antigas do MVP como "SUPERADA". Divergências que restam nesta
branch:

| Documento diz | Código real |
|---|---|
| `docs/FLOWS.md:71-74`: `triggers.source` pode ser `message`, `shopify_order`, `delivery_status` ou `shopify_abandoned_checkout` | Também `lightfunnels_order` (`types/index.ts:47`, `lib/trigger-input.ts:4`) |
| `docs/DATABASE.md:33-34`: tabelas Shopify e Fulfillment, sem Lightfunnels | Migration 027 cria `lightfunnels_integrations`, `lightfunnels_integration_accounts`, `lightfunnels_products` e colunas `lightfunnels_*` em `fulfillment_orders` |
| `docs/LIGHTFUNNELS.md` "Ciclo de um pedido", passo 6: "cada mudança de estado grava tags" | Cancelamento/arquivamento vindo do próprio Lightfunnels não agenda write-back (ver Armadilhas) |

`docs/FULFILLMENT_API.md` e `docs/LIGHTFUNNELS.md` seguem como as peças de
documentação mais confiáveis; as afirmações deste documento foram
conferidas contra o código, não contra eles.

## Perguntas em aberto

- **Pendências do Lightfunnels que só um app real responde** (listadas em `docs/LIGHTFUNNELS.md`): pedido COD dispara `order/confirmed`? `financial_status` de COD é mesmo `pending`? `updateOrder` aceita só `tags` (a doc marca `items` como obrigatório)? Snapshots de item podem trazer `quantity`? Há retry/rate limit?
- **O Lightfunnels manda o país como ISO ou como nome?** Se for nome, os 5 países com grafia FenixCOD diferente (ver Armadilhas) não roteiam nem enviam.
- **Refresh concorrente com ambos bem-sucedidos** (`lib/lightfunnels-token.ts:120-122`): se a API aceitar o mesmo refresh token duas vezes e cada resposta invalidar a anterior, o refresh token que fica salvo pode já estar invalidado. Dá para confirmar com o Lightfunnels se refresh é estritamente de uso único?
- As tabelas fundacionais sem migration versionada — existe um dump de schema que deveria virar uma migration `000`?
- Os "17 países atendidos" (`lib/fulfillment-countries.ts`) são um limite estável ou só quem já foi configurado em `fulfillment_integrations`?
