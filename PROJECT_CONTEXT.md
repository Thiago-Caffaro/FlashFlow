# Contexto do Projeto — FlashFlow

> Gerado por `explore-project` em 2026-09-08, commit `732e187`. Este
> documento é conhecimento sintetizado sobre o projeto — não é fonte de
> verdade. Onde ele divergir do código atual, o código vence. Rode a
> skill `explore-project` de novo depois de mudanças estruturais para
> atualizar.

## Visão geral

FlashFlow é um SaaS de atendimento e automação de WhatsApp para um
operador de e-commerce com fulfillment contra-reembolso (COD) na Europa.
Além do chat manual, o produto oferece: um construtor visual de fluxos de
conversa (com blocos de IA, condições e captura de dados de pedido),
integração com Shopify (pedidos, catálogo, checkout abandonado) e
integração com um fulfillment externo (FenixCOD/European Fulfillment)
para envio físico dos produtos e cobrança na entrega. O uso real de
WhatsApp já é dual: número(s) via Evolution API (self-hosted) e via
WhatsApp Cloud API (oficial, Meta), operando lado a lado por conta.

**Divergência importante**: o `CLAUDE.md` e todo o diretório `docs/`
(exceto `FULFILLMENT_API.md`) descrevem o projeto no estágio "MVP semana
1" — sem auth, sem flow builder, sem IA. O código real está na versão
`1.11.0` (`lib/version.ts`) com todas essas features implementadas e
testadas há muito tempo. Veja a seção **Divergências** no final.

## Stack técnica

| Camada | Tecnologia real | Onde |
|---|---|---|
| Framework | Next.js **16.2.12** (App Router), React 19.2.4 | `package.json` |
| Linguagem | TypeScript, sem `any` (regra do `CLAUDE.md`, ainda válida) | — |
| Estilo | Tailwind v4 + `shadcn`/`radix-ui` | `package.json`, `components/ui/` |
| Banco | Supabase (Postgres + Realtime), sem ORM, `@supabase/supabase-js` direto | `lib/supabase.ts`, `lib/supabase-admin.ts` |
| Flow builder | `@xyflow/react` v12 | `components/flows/` |
| WhatsApp | **Evolution API** (self-hosted) **e** **WhatsApp Cloud API** (Meta) simultaneamente, por conta (`accounts.provider`) | `lib/whatsapp-dispatch.ts`, `lib/whatsapp-account-provider.ts` |
| IA | Multi-provider: Gemini, OpenAI, OpenRouter (não só Gemini) | `lib/flow-engine.ts:951-955` |
| Fulfillment externo | European Fulfillment / FenixCOD (COD) | `lib/fulfillment-client.ts`, contrato em `docs/FULFILLMENT_API.md` (este doc está atualizado) |
| E-commerce | Shopify (webhooks + OAuth) | `lib/shopify-*.ts` |
| Auth | Sessão administrativa única via cookie HMAC (não é Supabase Auth) | `lib/server-auth.ts`, `proxy.ts` |
| Testes | Jest, ~85 arquivos em `__tests__/` | `package.json` (`test`, `test:watch`) |
| Deploy | Docker → GHCR (`ghcr.io/<repo>`), branch `main` publica `latest`+`test`, outras branches só `test` | `.github/workflows/*.yml` |
| Gate global de request | `proxy.ts` (não `middleware.ts` — nome do Next 16 para o mesmo mecanismo) | `proxy.ts` |

## Estrutura de pastas

```
app/
  api/            Toda lógica de banco/integração vive aqui (regra do CLAUDE.md, ainda seguida)
    webhook/      Rotas públicas server-a-servidor (Evolution, WhatsApp Cloud, Shopify)
    flows/        CRUD de fluxos
    accounts/     Gestão de contas/instâncias WhatsApp (QR, pairing, reconexão)
    shopify/      OAuth + callback + produtos
    fulfillment/  Pedidos, sandbox, envio/cancelamento ao FenixCOD, sync de entrega
    ai-keys/, ai-sessions/, instance-ai-config/, memory-blocks/   Config e estado de IA
  fulfillment/, order-preview/, catalog-preview/, diagnostics/   Rotas de UI fora do chat principal
components/
  ui/             shadcn — não editar (regra do CLAUDE.md)
  chat/, chats/   Interface de atendimento
  flows/, flows/nodes/   Editor visual de fluxo (um arquivo por tipo de node)
  fulfillment/    UI de pedidos/checkouts abandonados/entrega
  auth/           Formulário de login único (não há cadastro/multi-usuário)
  sidebar-right/  Gatilhos (triggers) por instância
  memory/, gallery/, notifications/, ai-sessions/, nav/   Painéis secundários
contexts/         account-context, auth-context, theme-context (estado client-side global)
lib/              ~65 arquivos — cada integração/domínio tem seu módulo dedicado (ver tabela abaixo)
types/index.ts     Único arquivo de tipos do projeto (451 linhas) — fonte de verdade do modelo de dados
migrations/       SQL numerado 001→020, mas **não é o schema completo** (ver Gotchas)
docs/             Documentação de projeto pré-existente — parcialmente desatualizada (ver Divergências)
__tests__/        api/ (rotas), lib/ (unidade), components/ — inclui testes de "isolation" (ver Regras de negócio)
```

## Padrões e convenções

- **Um módulo `lib/` por domínio/integração**, nomeado pelo prefixo do domínio: `shopify-*.ts` (11 arquivos), `fulfillment-*.ts` (9 arquivos), `whatsapp-cloud-*.ts` (6 arquivos), `flow-*.ts` (7 arquivos). Não há uma pasta `services/` genérica — o nome do arquivo já é a "camada".
- **`instance_name` é a chave de particionamento/tenant em quase toda tabela** (`conversations`, `triggers`, `flows`, `flow_media`, `agent_memory_blocks`, `message_variables`, `notifications`, `fulfillment_orders`) — o projeto não é multi-tenant por *cliente final*, é multi-instância por *número de WhatsApp* sob um único admin. Toda rota que recebe um `id` de recurso deve validar posse via `lib/instance-guard.ts` (`belongsToInstance`), nunca confiar em `instance_name` vindo do client — reforçado por uma bateria própria de testes `__tests__/api/*-isolation.test.ts`.
- **`proxy.ts` é o único gate de autenticação** para `/api/:path*`, por allowlist de pathname exato (nunca prefixo) para rotas públicas: login/verify/logout e os 4 webhooks server-a-servidor (Evolution, WhatsApp Cloud, Shopify orders, Shopify abandoned-checkouts). Cada webhook tem sua própria autenticação interna (HMAC/secret), independente do cookie `ff_auth`.
- **Rate limiting e dedup são in-memory (`Map`), não Redis/Postgres** — `lib/rate-limit.ts` e `lib/login-rate-limit.ts` documentam explicitamente que isso só é seguro enquanto o deploy for de réplica única.
- **Segredos sensíveis (chaves de IA, credenciais Shopify/WhatsApp Cloud) são criptografados em repouso** com AES-256-GCM (`lib/ai-crypto.ts`), nunca salvos em texto plano no Supabase.
- **Fetches de saída para URLs de terceiros (imagens) passam por SSRF guard** (`lib/ssrf-guard.ts`): bloqueia IPs privados/loopback/link-local, exige HTTPS, faz pin de DNS contra a resposta, e valida o conteúdo por sniff de bytes, não pelo header `Content-Type` declarado.
- **Feature flags via env var** (`lib/features.ts`) controlam recursos já implementados mas não necessariamente GA por padrão: `gallery`, `aiSessions`, `switchCase`.
- **`APP_VERSION` (`lib/version.ts`) é incrementado a cada update relevante** e exibido em Configurações Gerais — convenção intencional para identificar builds deployadas.

## Fluxos críticos

### 1. Mensagem WhatsApp recebida (inbound) — dual provider

**Evolution API** — `app/api/webhook/evolution/route.ts`
1. Content-Type deve ser `application/json` — `app/api/webhook/evolution/route.ts:112-115`
2. Limite de tamanho do body — `lib/evolution-api.ts:10-14`
3. Header `x-webhook-secret` comparado em tempo constante (falha fechado se `EVOLUTION_WEBHOOK_SECRET` não configurado) — `lib/evolution-api.ts:94-100`
4. Só `event === 'messages.upsert'` persiste mensagem — `app/api/webhook/evolution/route.ts:224-231`
5. Dedup por `wa_message_id` antes de inserir (inbound e outbound) — `app/api/webhook/evolution/route.ts:245-254`
6. `instanceName` vem de `body.instance`; ausente → evento descartado — `app/api/webhook/evolution/route.ts:142,233-237`
7. Resolução de `@lid`→`@s.whatsapp.net` (lógica diferente para inbound vs outbound) — `app/api/webhook/evolution/route.ts:262-292`
8. Upsert em `conversations` (`onConflict: wa_id, instance_name`) e insert em `messages` — `app/api/webhook/evolution/route.ts:398-450`
9. Cascata fire-and-forget: flow pausado → sandbox fallback → sessão de IA ativa → triggers por keyword — `app/api/webhook/evolution/route.ts:452-502`

**WhatsApp Cloud API** — `app/api/webhook/whatsapp-cloud/route.ts`
1. GET faz handshake `hub.verify_token` da Meta — `lib/whatsapp-cloud-webhook-auth.ts:10-16`
2. POST valida HMAC-SHA256 do corpo cru (`X-Hub-Signature-256`), logado incondicionalmente antes da verificação — `app/api/webhook/whatsapp-cloud/route.ts:256-264`
3. Conta identificada por `metadata.phone_number_id` → `lib/whatsapp-cloud-credentials.ts:37-47`
4. Mesma dedup e mesma cascata pós-save que a Evolution, deliberadamente "agnóstica de provedor" — `app/api/webhook/whatsapp-cloud/route.ts:145-149`

### 2. Envio de mensagem (outbound) — dispatcher + janela de 24h

1. `lib/whatsapp-dispatch.ts:36-39` resolve o adapter (`evolution` ou `cloud_api`) por `accounts.provider`, default `evolution` se coluna ausente — `lib/whatsapp-account-provider.ts:11-23`
2. `app/api/messages/route.ts` (envio manual do operador) → `lib/whatsapp-text.ts:70` → `dispatchSendText`. **Não checa a janela de 24h.**
3. Janela de 24h calculada a partir de `conversations.last_inbound_at` (não `last_message_at`) — `lib/messaging-window.ts:13-28`
4. Só é verificada em dois lugares: `lib/flow-engine.ts:1509-1512` (apenas quando `provider==='cloud_api'`) e `lib/shopify-confirmation-service.ts:964-965`
5. Fora da janela: `flow-engine` cria notificação para o operador e aborta o node (não tenta template) — `lib/flow-engine.ts:1515-1527`; `shopify-confirmation-service` tenta o template de recuperação configurado antes de desistir — `lib/shopify-confirmation-service.ts:973-988`

### 3. Gatilho e execução de fluxo (Flow Engine)

1. Prioridade de resposta a uma mensagem inbound (`app/api/webhook/evolution/route.ts:452-502`, mesma cascata na Cloud API):
   `flow_runs` pausado → sandbox com envio real → `ai_sessions` ativa → `executeTriggers`
2. `executeTriggers` (`lib/message-triggers.ts:6-87`) compara texto normalizado contra `triggers.valor` (lista por vírgula, suporta `*`), `tipo` = `exact`/`contains`; primeiro match dispara e `break` — **não é gatilho por link/produto, é regra de texto por instância**
3. `executeFlow` (`lib/flow-engine.ts:1323`) roda **síncrono dentro do próprio webhook**, fire-and-forget (`void (async () => {...})()`), com detecção de loop (`visited.size < 50`) — `lib/flow-engine.ts:1390`
4. Fila (`flow_jobs` + `lib/flow-job-worker.ts`) só entra para: pedido Shopify ainda não sincronizado (`OrderContextPendingError` → `flow_message_resume`) e disparos originados de eventos Shopify (`shopify_order_flow`, `delivery_status_flow`)
5. Worker é **poll in-process a cada 1s** (não cron), via RPC `claim_flow_jobs` com `FOR UPDATE SKIP LOCKED` — `lib/flow-job-worker.ts:119-141`, `migrations/009_message_variables_and_flow_jobs.sql:55-107`
6. Estado de fluxo pausado (esperando botão) vive em `flow_runs` (`UNIQUE(instance_name, remote_jid)`); deletado ao concluir — `lib/flow-engine.ts:1556-1574,1850-1852`
7. Bloco de IA (`aiAssistant`) suporta Gemini/OpenAI/OpenRouter, credenciais em `ai_provider_keys` cifradas AES-256-GCM — `lib/flow-engine.ts:1748-1844`, `lib/ai-crypto.ts:1-19`

### 4. Pedido Shopify → FenixCOD → status de entrega

1. Webhook `orders/create|updated|paid|cancelled|delete` → `POST /api/webhook/shopify/orders`, HMAC verificado via `timingSafeEqual` — `lib/shopify-client.ts:37-43`
2. `upsertShopifyOrder` insere em `fulfillment_orders` com `status='pending_operator'` — `lib/shopify-confirmation-service.ts:342-353`
3. Operador muda `commercial_status` para "Confirmado*" → `maybeAutoSubmitConfirmedOrder` decide se auto-envia (`shouldSubmitToFenix`: confirmado + `send_status='Pendente'` + sem `lead_number` + não é simulação) — `lib/fulfillment-order-state.ts:20-48`, `lib/order-state.ts:43-53`
4. `submitFulfillmentOrder` trava a linha, resolve SKUs reais, monta payload e chama `FulfillmentClient.createLead` — `lib/fulfillment-service.ts:255-341`
5. `fulfillment-delivery-worker.ts` faz poll a cada 30s, uma integração por vez (lease via RPC), busca leads paginadas e aplica status via RPC `apply_fulfillment_delivery_status` — `lib/fulfillment-delivery-sync.ts:285-387`
6. UI operador em `/fulfillment` (`components/fulfillment/fulfillment-page.tsx`)

### 5. Recuperação de carrinho abandonado (Shopify)

1. Webhook `abandoned-checkouts` grava `shopify_abandoned_checkouts` com `recovery_status='Pendente'` — **nenhum envio automático aqui** — `lib/shopify-confirmation-service.ts:506-565`
2. Disparo é **manual**: operador clica "recuperar" → `POST /api/fulfillment/shopify/abandoned-checkouts/{id}/recover` → `sendAbandonedCheckoutRecovery` — `lib/shopify-confirmation-service.ts:921`
3. Dentro da janela de 24h: texto livre interpolado do template configurado. Fora da janela (Cloud API): usa o template aprovado da Meta (`recovery_template_id`, migration 020) — decisão de negócio explícita: recuperação é sempre iniciada pela empresa, texto livre fora da janela seria rejeitado pela Meta — `lib/shopify-confirmation-service.ts:915-988`

## Regras de negócio

- **Regra:** A janela de resposta de 24h só existe para contas WhatsApp Cloud API — contas Evolution (self-hosted) nunca são bloqueadas por ela.
  **Onde:** `lib/flow-engine.ts:1509`
  **Por quê:** é uma restrição imposta pela Meta na API oficial, não uma regra de produto.

- **Regra:** O envio manual de texto livre pelo operador (`app/api/messages/route.ts`) não verifica a janela de 24h nem oferece fallback de template.
  **Onde:** `app/api/messages/route.ts`, `lib/whatsapp-text.ts:70`
  **Contexto:** só os caminhos automatizados (flow engine, recuperação Shopify) checam a janela; um operador humano só descobre a falha pelo erro de retorno da chamada.

- **Regra:** Timeout no envio manual não marca a mensagem como `failed`, fica em `sending`.
  **Onde:** `app/api/messages/route.ts:100-109`
  **Por quê:** a Evolution pode ter aceitado o envio mesmo com o timeout do FlashFlow; um retry automático duplicaria a mensagem.

- **Regra:** Se o `node_id` salvo em um `flow_runs` pausado não existe mais no fluxo atual (fluxo editado enquanto a conversa esperava resposta), o sistema apaga o `flow_runs` órfão e reinicia do node `start`, em vez de travar.
  **Onde:** `lib/flow-engine.ts:1376-1386`
  **Contexto:** corrigido pelo commit `00a67fa` — antes disso a conversa travava silenciosamente.

- **Regra:** Um node `sendMessage` com `replyButtons` só pode se conectar diretamente a um node `switchCase`; qualquer outra conexão é bloqueada no save do fluxo.
  **Onde:** `lib/flow-connection-validation.ts:14-24`, `lib/flow-validation.ts:194-200`

- **Regra:** Se a IA está processando uma resposta e um humano assume a conversa nesse meio-tempo (`requires_human`), a resposta da IA já em andamento é descartada ao voltar.
  **Onde:** `lib/flow-engine.ts:1192-1201`

- **Regra:** O valor cobrado pelo FenixCOD na entrega (`total` do payload) é zerado quando o pedido já foi pago no Shopify (`financial_status='paid'`).
  **Onde:** `lib/fulfillment-service.ts:301-310`, `lib/shopify-order-status.ts:76-78`
  **Por quê:** o FenixCOD é fulfillment contra-reembolso (COD) — cobrar de novo na entrega de um pedido já pago duplicaria a cobrança ao cliente. O valor real do pedido permanece intacto na UI/banco; só o payload externo é zerado.

- **Regra:** Um pedido só pode ser cancelado localmente sem contato com o FenixCOD se ainda não tiver `lead_number`; depois disso, cancelamento exige chamada real `deleteLead`. País e itens ficam travados para edição assim que `lead_number` existe.
  **Onde:** `lib/fulfillment-service.ts:350-391`, `lib/shopify-confirmation-service.ts:788,847`

- **Regra:** Quantidade "pacote" do Shopify (SKU com sufixo `, N` ou título com padrão tipo "3 frascos"/"3 bottles") é multiplicada para a quantidade física real antes de enviar ao FenixCOD.
  **Onde:** `lib/shopify-pack-quantity.ts:32-101`
  **Contexto:** corrigido pelo commit `4bbc2cc` — pedidos antigos exibiam a quantidade de pacotes como se fosse unidade física.

- **Regra:** Apenas 17 países têm mapeamento Shopify→FenixCOD (ES, PT, IT, PL, SK, CZ, RO, BG, GR, HU, SI, HR, AT, DE, FR, BE, NL). Pedido de país fora dessa lista fica preso sem integração de fulfillment correspondente.
  **Onde:** `lib/fulfillment-countries.ts:9-27`

- **Regra:** Um produto Shopify ocultado localmente (`hidden=true`) nunca é reexibido automaticamente por sincronizações futuras.
  **Onde:** `migrations/006_shopify_products_catalog.sql:8-10`
  **Por quê:** o FlashFlow só tem escopo OAuth `read_products` — não pode alterar a loja real, então a ocultação é puramente local e não há como uma sync "corrigir" isso na direção contrária.

## Coisas não óbvias / armadilhas

- **`proxy.ts` não é `middleware.ts`** — no Next.js 16 o mecanismo de gate global de request foi renomeado; procurar por `middleware.ts` neste projeto não encontra nada.
- **Migrations `001`-`020` não são o schema completo.** A migration `001` já trata de OAuth/Shopify — as tabelas fundacionais (`conversations`, `messages`, `accounts`, `flows`, `triggers`) foram criadas antes do diretório `migrations/` existir e não têm `CREATE TABLE` versionado neste repositório. O mesmo vale para `ai_sessions`, `agent_memory_blocks`, `ai_provider_keys`, `instance_ai_config` — só há `ALTER TABLE`s incrementais, não os `CREATE TABLE` originais.
- **`lib/sandbox.ts` é só duas constantes** (`SANDBOX_INSTANCE_NAME`, `SANDBOX_REMOTE_JID`) — a lógica real do modo sandbox (nunca enviar WhatsApp de verdade, a menos que um contato de teste tenha `sandbox_real_send_enabled`) está centralizada em `resolveRealSendTarget` (`lib/flow-engine.ts:72-77`), não em `sandbox.ts`.
- **`lib/flow-transfer.ts` não tem relação com sandbox** apesar do nome sugerir teste — é o parser/serializador de export/import de fluxos entre contas.
- **Resolução de `@lid` (WhatsApp) é assimétrica por direção**: inbound busca a conversa por `contact_name`, outbound busca por `contact_phone` — não há um campo comum reaproveitável, e essa assimetria já causou dois bugs de conversa duplicada (commits `d6a2343`, `579edf1`).
- **Node types legados no flow builder** (`fulfillmentStock`, `fulfillmentStatus` em `FlowNodeType`, `types/index.ts:74-77`) existem só para fluxos salvos antigos continuarem carregando/executando — não devem ser oferecidos para novos fluxos.
- **`switchCase` tem um handle `default` implícito**, mas `condition` só tem `true`/`false` — os dois blocos de bifurcação do flow builder não seguem a mesma convenção de handles.

## Divergências entre documentação existente e o código

Toda a documentação de projeto pré-existente (`CLAUDE.md`, `README.md`,
`docs/ARCHITECTURE.md`, `docs/MVP.md`, `docs/FLOWS.md`,
`docs/DATABASE.md`, `docs/API.md`) descreve o estado do "MVP semana 1":
sem autenticação, só Evolution API, sem flow builder, sem IA, schema com
apenas `conversations`/`messages`. Nenhuma dessas afirmações reflete o
código atual (v1.11.0):

| Documento diz | Código real |
|---|---|
| `CLAUDE.md`: "Auth: Nenhuma no MVP" | Auth administrativa via cookie HMAC + rate limit de login (`lib/server-auth.ts`, `proxy.ts`) |
| `CLAUDE.md`/`docs/FLOWS.md`: "Flow Builder — Fase 3, não implementar agora" | Flow builder completo, com engine, validação, fila de jobs, IA e Shopify integrados |
| `CLAUDE.md`/`docs/DECISIONS.md` [007]: "Gemini — Fase 3, não implementado" | IA multi-provider (Gemini/OpenAI/OpenRouter) implementada, com sessões, memória e credenciais cifradas |
| `docs/API.md`: "Auth: nenhuma no MVP semana 1", só documenta 4 rotas | Dezenas de rotas sob `app/api/`, todas atrás do gate de `proxy.ts` exceto 4 webhooks públicos |
| `docs/DATABASE.md`: schema só com `conversations`+`messages`, RLS desabilitada | Dezenas de tabelas (`fulfillment_orders`, `flows`, `flow_runs`, `flow_jobs`, `shopify_integrations`, `ai_sessions` etc.); `migrations/008_lockdown_anon_rls.sql` sugere que RLS foi endurecida, não deixada desabilitada |
| `docs/MVP.md` "Fora do escopo (Fase 3+)": "WhatsApp Cloud API oficial" | Suporte dual Evolution + Cloud API implementado e em produção há várias fases (`Fase 1` a `Fase 4` do suporte dual, commits `4406a59`…`972956c`) |
| `README.md`: "Backend: Node.js (NestJS) ou Python" (ainda indeciso) | Tudo em Next.js App Router — decisão já tomada e registrada em `docs/DECISIONS.md` [001], mas o próprio README não foi atualizado |

**Exceção**: `docs/FULFILLMENT_API.md` está atualizado e consistente com
o código (inclusive com datas de verificação recentes) — foi a única
peça de documentação pré-existente tratada como confiável neste
levantamento, e mesmo assim as afirmações de contrato externo foram
conferidas contra `lib/fulfillment-client.ts`.

## Perguntas em aberto

- O `CLAUDE.md` e os docs desatualizados devem ser reescritos/arquivados
  agora que o projeto está em v1.11.0? Do jeito que estão, um agente ou
  desenvolvedor novo que confie neles vai operar com um modelo mental
  completamente errado do produto.
- As tabelas fundacionais sem migration versionada (`conversations`,
  `messages`, `accounts`, `flows`, `triggers`, `ai_sessions`,
  `agent_memory_blocks`, `ai_provider_keys`, `instance_ai_config`) —
  existe um dump de schema em algum lugar (Supabase dashboard/backup) que
  deveria ser versionado retroativamente como uma migration `000`?
- Regra de "17 países atendidos" (`lib/fulfillment-countries.ts`) é um
  limite de negócio real e estável, ou só reflete quem já foi configurado
  manualmente em `fulfillment_integrations` até agora?
