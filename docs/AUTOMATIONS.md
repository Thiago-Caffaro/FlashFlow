# Automações simples

Automações prontas e **lineares** (esperar → enviar mensagem), criadas por
um assistente na aba **Automações**, sem montar fluxo. Para atendimento com
caminhos diferentes (menu de botões, IA, condições), o caminho continua
sendo o Flow Builder.

Há um modelo para cada gatilho do sistema (`lib/automation-presets.ts`):

| Modelo | Plataformas | Casa por | Envio |
|---|---|---|---|
| Carrinho abandonado | Shopify | país + linha | até 3 lembretes, espera desde a última atividade |
| Pedido criado | Shopify, Lightfunnels | país + linha | 1 mensagem, na hora |
| Status de entrega | Shopify, Lightfunnels | país + linha + estados escolhidos | 1 mensagem, na hora |
| Resposta por palavra-chave | — | número + palavras | 1 mensagem, na hora |

Cada automação envia pelo **número escolhido nela**, não pelo roteamento de
conta do pedido/carrinho, e **tem precedência** sobre o gatilho equivalente
da conta. Países: os 17 do FenixCOD mais a **Colômbia** (`CO`, que casa com
pedido em `CO` ou `COLOMBIA` — `AUTOMATION_COUNTRY_ALIASES`).

## Peças

| Peça | Onde |
|---|---|
| Linhas de produto (EMA, MEMO, REJU, VISTA…), produtos e vínculo com o catálogo das lojas | migration `029_product_lines.sql`, `lib/product-lines.ts`, `lib/product-line-match.ts`, `app/api/product-lines/**`, aba Automações → "Linhas e produtos" |
| Automações e lembretes | migration `030_automations.sql` (`automations`, `automation_steps`, `flows.managed_by_automation_id`) |
| Modelos prontos | `lib/automation-presets.ts` (`AUTOMATION_PRESETS`) |
| Validação da entrada e escolha da automação (puro) | `lib/automation-rules.ts` |
| CRUD com validação no banco | `lib/automations.ts`, `app/api/automations/**` |
| Execução no carrinho | `lib/automation-runtime.ts`, `scheduleAbandonedCheckoutTriggers` / `runAbandonedCheckoutTrigger` em `lib/shopify-confirmation-service.ts` |
| UI | `components/automations/` (cards, filtros, assistente) |

## Linhas de produto

- Uma **linha** (`product_lines`: código, nome, prioridade) agrupa
  **produtos** (`line_products`), e cada produto é **vinculado** a produtos
  do catálogo de uma ou mais lojas (`product_catalog_links`: plataforma,
  integração, id do produto externo). Um produto externo pertence a no
  máximo um produto de linha — vincular de novo move o vínculo.
- O diálogo de vínculo sugere produtos do catálogo pelo nome (palavra
  inteira, nome mais longo vence) — `suggestLineProduct`.
- **Carrinho com produtos de linhas diferentes:** vence a linha de **menor
  prioridade** (desempate pelo código) e o carrinho recebe um envio só —
  `pickProductLine`.
- Uma linha usada por automação não pode ser apagada (FK `RESTRICT` → 409).

## Modelo de dados

- `automations`: nome, `kind` (`abandoned_cart`), plataforma, país (ISO,
  ex.: `ES`), `product_line_id` (`null` = qualquer linha), `instance_name`,
  `enabled` (**nasce `false`**: envio automático para fora só depois de
  ligar no card).
- Única por `kind + plataforma + país + linha` (`automations_scope_key`).
- `automation_steps`: até 3 lembretes, cada um com `delay_minutes`
  (1 min a 7 dias, **estritamente crescente**), mensagem, template de
  fallback e o `flow_id` gerado.
- **Cada lembrete gera um fluxo** `início → enviar mensagem → fim`
  (`buildAutomationStepFlowJson`), marcado com
  `flows.managed_by_automation_id`. Assim a execução reaproveita o motor de
  fluxo, as variáveis e a fila `flow_jobs` (que exige `flow_id`).
  - Esses fluxos **não aparecem** em `GET /api/flows` (nem no seletor de
    fluxo dos Gatilhos) e `PUT`/`DELETE /api/flows/{id}` respondem 409 —
    só a automação os altera.
  - Apagar a automação apaga lembretes, fluxos gerados e, por cascata em
    `flow_jobs.flow_id`, os lembretes pendentes.

## Validação ao salvar (`lib/automations.ts`)

- Linha existente; número existente e fora do sandbox.
- Variáveis `{{...}}` da mensagem conhecidas (as automáticas mais as
  personalizadas do número) — mesma checagem do editor de fluxo.
- Número **Cloud API**: todo lembrete precisa de template **aprovado e do
  próprio número** (carrinho é sempre a empresa iniciando a conversa).
  Número Evolution: o template é descartado.
- **Ligar** revalida tudo (um template pode ter sido rejeitado depois).
- Criação sem transação: se gerar os fluxos falhar, a automação é apagada.

## Execução no carrinho abandonado

1. `checkouts/create|update` ou `draft_orders/create|update` →
   `scheduleAbandonedCheckoutTriggers`. Antes de olhar os gatilhos da
   conta, para carrinho real (não sandbox/simulação):
   - `findShopifyCartAutomation` busca as automações ligadas; só se houver
     alguma resolve a linha do carrinho pelos `line_items[].product_id`
     vinculados à loja;
   - `pickCartAutomation`: mesma plataforma e país (o país do carrinho está
     no formato do fulfillment, `SPAIN`; a automação guarda `ES` —
     `automationMatchesCountry`) e linha igual ou "qualquer linha". **A da
     linha vence a de qualquer linha.**
2. Com automação: um `abandoned_checkout_flow` por lembrete, no número da
   automação, em `última atividade + delay_minutes` (mesma regra de 6h de
   atraso máximo). Dedupe `abandoned-checkout:{checkout}:automation:{id}:{posição}`
   — cada `update` empurra o lembrete pendente para frente. O job leva
   `payload.automationId`.
   - **A automação tem precedência sobre os gatilhos "Carrinho abandonado"
     da conta**: os jobs pendentes desse carrinho que não são dela são
     cancelados (`cancelStaleAbandonedCheckoutJobs`). Não depende de o
     carrinho ter conta atribuída.
3. Sem automação: segue o caminho antigo (gatilhos da conta atribuída), e
   lembretes pendentes de uma automação que deixou de valer (desligada, ou
   o carrinho mudou de país/produto) são cancelados.
4. Na hora do envio (`runAbandonedCheckoutTrigger` com `automationId`):
   automação desligada/apagada → não envia; senão usa o **número atual** da
   automação (trocar o número leva os pendentes junto). As conferências de
   conversão, "Não enviar" e compra pelo mesmo telefone são as mesmas.
5. O interruptor global de gatilhos Shopify (`shopify_triggers_enabled`)
   também pausa as automações, no agendamento e no worker.

## Pedido criado, status de entrega e palavra-chave (migration 031)

- **Pedido criado**: em `upsertShopifyOrder` (pedido novo) e no
  `enqueueOrderTrigger` do Lightfunnels, `findOrderAutomation('order_created', pedido)`
  roda antes do gatilho "Pedido criado" da conta; com match, o
  `shopify_order_flow`/`lightfunnels_order_flow` leva o fluxo e o
  `automationId` da automação e o gatilho não é consultado. A linha vem dos
  `line_items[].product_id` (Shopify) ou de `items[].lightfunnels_product_id`.
  Pedido manual nunca casa. A conversa do pedido passa a ser a do número da
  automação.
- **Status de entrega**: a RPC `apply_fulfillment_delivery_status` continua
  enfileirando os gatilhos da conta; quando ela devolve `changed` e
  `event_id`, `scheduleDeliveryStatusAutomation` (`lib/fulfillment-delivery-sync.ts`)
  procura a automação do novo status e enfileira
  `delivery-status:{evento}:automation:{id}`, cancelando os jobs
  `delivery-status:{evento}:*` dos gatilhos. Falha aqui não desfaz o status.
- **Palavra-chave**: em `executeTriggers` (`lib/message-triggers.ts`), antes
  dos gatilhos de mensagem do número; mesma regra de comparação (vírgula,
  `*`, contém/exato — `messageMatchesKeywords`). Não exige template em
  número oficial (o cliente acabou de escrever).
- No worker, `payload.automationId` → `runShopifyOrderTrigger`/`runOrderFlow`
  com `{ automationId }`: automação desligada → não envia; senão usa o
  número atual dela.
- 031: `platform`/`country` opcionais, coluna `config` (estados de entrega,
  palavras-chave), espera 0 permitida, e a chave única de escopo vale só
  para carrinho e pedido criado.

## API

| Rota | O quê |
|---|---|
| `GET /api/automations` | Lista com lembretes (globais — sem filtro de instância) |
| `POST /api/automations` | Cria (`AutomationInput`; 400 validação, 409 duplicada) |
| `GET/PUT/DELETE /api/automations/{id}` | Lê, edita por completo (o modelo não muda), apaga |
| `PATCH /api/automations/{id}` | `{ enabled }` — liga (revalida) ou desliga |
| `/api/product-lines/**` | Linhas, produtos, catálogo e vínculos |

## Deploy

Aplicar **`029`, `030` e `031`, nessa ordem,** no Supabase **antes** de subir a versão:
`GET /api/flows` passa a filtrar por `managed_by_automation_id` e quebra
sem a coluna.

## Fora do escopo atual

- Carrinho abandonado Lightfunnels (o serviço de carrinho LF não existe).
- Modelo novo: entra como nova entrada em `AUTOMATION_PRESETS` mais o ponto
  de disparo em `lib/automation-runtime.ts`.
- "Testar no sandbox" e "Transformar em fluxo avançado" na UI.
- Migrar os gatilhos de carrinho existentes para automações.
