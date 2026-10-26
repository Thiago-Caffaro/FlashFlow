# Integração com o Lightfunnels

Pedidos dos funis do Lightfunnels entram na mesma fila de confirmação dos
pedidos Shopify. Cada conta Lightfunnels conectada é vinculada a contas
WhatsApp, opcionalmente **por funil**, e cada conta WhatsApp escolhe o que
recebe ativando o gatilho **Pedido Lightfunnels criado**. Fonte da API:
<https://developer.lightfunnels.com>.

## Como funciona

| Peça | Onde |
|---|---|
| App de Partners (um para todas as contas): Client ID/Secret/scopes em `app_settings` | `app/api/settings/lightfunnels/route.ts`, `lib/lightfunnels-integration-store.ts` |
| OAuth (consentimento → `code` → token) | `app/api/lightfunnels/auth`, `app/api/lightfunnels/callback`, `lib/lightfunnels-oauth-state.ts` |
| Token de 2h + refresh rotativo, renovação com lock otimista | `lib/lightfunnels-token.ts` |
| Cliente GraphQL (`services.lightfunnels.com/api/v2`) | `lib/lightfunnels-client.ts` |
| Webhooks registrados via `createWebhook`, IDs em `lightfunnels_integrations.webhook_ids` | `lib/lightfunnels-webhook-setup.ts` |
| Recepção dos webhooks (pública em `proxy.ts`, autenticada por HMAC) | `app/api/webhook/lightfunnels/route.ts` |
| Pedido → `fulfillment_orders` (`source='lightfunnels'`) | `lib/lightfunnels-order-service.ts` |
| Vínculos conta LF → contas WhatsApp, com filtro de funil | tabela `lightfunnels_integration_accounts`, `lib/lightfunnels-store-accounts.ts` |
| Escolha da conta (comum às plataformas) | `lib/order-account-routing.ts` |
| Leitura de pedido independente da plataforma | `lib/order-platform.ts` |
| Catálogo (`lightfunnels_products`) e cópia local em `fulfillment_products` | `lib/lightfunnels-products-service.ts` |
| Escrita de volta (tags `ff:*`), opt-in | `lib/lightfunnels-writeback.ts` |
| UI | `/fulfillment` → Configurações (`lightfunnels-config.tsx`), Produtos (`lightfunnels-products-panel.tsx`) |

Schema: `migrations/027_lightfunnels_integration.sql`.

## Ciclo de um pedido

1. O cliente compra no funil. O Lightfunnels dispara `order/created` **antes**
   dos upsells/downsells (pode faltar item) — por isso não assinamos esse
   evento. O pedido entra no `order/confirmed`, já completo.
2. `upsertLightfunnelsOrder` grava o pedido como `pending_operator` e escolhe a
   conta WhatsApp:
   1. vínculos da conta LF **dedicados ao funil do pedido** (`funnel_ids`
      contém o `funnel_id`), preferindo a conta do país do pedido e depois a
      menor prioridade;
   2. vínculos **genéricos** (sem funil marcado), com o mesmo critério;
   3. conta padrão de pedidos (a mesma da Shopify);
   4. país + `confirmation_priority` entre todas as contas.
3. Se os gatilhos Lightfunnels estão ativos, enfileira `lightfunnels_order_flow`
   para o gatilho **Pedido Lightfunnels criado** da conta escolhida. Sem
   gatilho na conta, o erro fica em `confirmation_message_error`.
4. O fluxo de confirmação roda no WhatsApp; a confirmação comercial envia ao
   FenixCOD como nos pedidos Shopify. Pedido já pago (`financial_status=paid`)
   vai com COD 0.
5. `order/updated|refunded|fulfilled|uncancelled` e `payment/paid` só
   atualizam. `order/cancelled` (ou pedido arquivado) marca **Desistiu**, tira
   da fila se ainda não foi ao FenixCOD e cancela o fluxo pendente.
6. Com o write-back ligado, cada mudança de estado grava tags no pedido LF:
   `ff:confirmado` / `ff:desistiu`, `ff:enviado-fenixcod`, `ff:a-caminho`,
   `ff:novidade`, `ff:rejeitado`, `ff:entregue`. Tags do lojista são
   preservadas; falhas ficam em `lightfunnels_writeback_error`.

## Webhooks

URL registrada: `/api/webhook/lightfunnels?integration={id}&event={tipo}` —
o payload do Lightfunnels só traz `{ node }`, sem o tipo do evento, e o
`proxy.ts` libera apenas caminhos exatos.

Assinatura: header `lightfunnels-hmac` = base64(HMAC-SHA256(corpo, client
secret do app)). Conferimos o corpo cru e o `JSON.stringify` do corpo
parseado (forma do exemplo da documentação), com comparação em tempo
constante.

Eventos: `order/confirmed`, `order/updated`, `order/cancelled`,
`order/uncancelled`, `order/refunded`, `order/fulfilled`, `payment/paid`,
`product/created|updated|deleted`, `app/uninstalled`.

## Configurar

1. Crie um app em <https://partners.lightfunnels.com> e cadastre a Redirect
   URI exibida em **/fulfillment → Configurações → Lightfunnels**
   (`{APP_BASE_URL}/api/lightfunnels/callback`).
2. Salve Client ID e Client Secret em **Credenciais do App Lightfunnels**.
3. **Conectar**: escolha o país padrão e autorize no Lightfunnels.
4. **Configurar** a conta conectada: marque as contas WhatsApp e, se quiser,
   os funis de cada uma.
5. Em cada conta WhatsApp, crie um gatilho **Pedido Lightfunnels criado**
   apontando para o fluxo de confirmação.
6. **Sincronizar** importa pedidos recentes e o catálogo (sem disparar
   gatilhos). Ligue a **cópia local** dos produtos que o FenixCOD deve
   conhecer (SKU igual ao do FenixCOD; sufixo `,N` = pacote de N unidades).

Teste sem conta real: **Sandbox → Simular pedido → Plataforma Lightfunnels**.

## Pendências a validar com um app real

A documentação pública não cobre estes pontos; o código assume o que está
abaixo e falha de forma visível se estiver errado:

- **Pedido COD** dispara `order/confirmed`? Se não disparar, os pedidos ainda
  entram por `order/updated`, mas sem gatilho — trocar o evento que dispara o
  fluxo em `app/api/webhook/lightfunnels/route.ts`.
- **`paymentMethodLabel`/`financial_status` de COD**: assumimos `pending` → COD
  e `paid` → PREPAID.
- **HMAC**: conferido nas duas formas acima.
- **Listagem de webhooks**: não documentada; guardamos os IDs criados.
  "Webhooks" na UI apaga os guardados e recria.
- **`updateOrder` só com `tags`**: a documentação marca `items` como
  obrigatório. Se a API recusar, o erro aparece no pedido (badge "Falha ao
  gravar tags") e o write-back pode ser desligado sem afetar o resto.
- **`account { id }`**: usado no callback para identificar a conta.
- **Snapshots de item sem quantidade**: cada snapshot é tratado como uma
  unidade e agrupado por variante; se vier `quantity`, ela é respeitada.
- **Rate limit e retries**: não documentados. O webhook responde 500 em falha
  de processamento para permitir reenvio.

## Fora do escopo atual

Carrinho abandonado do Lightfunnels (`checkout/created|updated`, payload só
com `id`) — o schema e o roteamento já comportam; falta o serviço e a fonte de
gatilho `lightfunnels_abandoned_checkout`.
