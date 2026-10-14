# Flow Builder & Executor

> Atualizado em 2026-09-08 a partir do código real (`lib/flow-engine.ts`,
> `types/index.ts`). Implementado e em produção — não é mais item de
> roadmap. Para a sequência exata de gatilho→execução com citação
> `arquivo:linha`, veja a seção "Fluxos críticos" de `PROJECT_CONTEXT.md`.

## Tipos de blocos (reais)

Definidos em `FlowNodeType` (`types/index.ts:67-78`):

| Bloco | Função |
|---|---|
| `start` | Ponto de entrada — único node permanente do fluxo, com gatilhos vinculados |
| `sendMessage` | Envia texto/imagem/botões; pode usar template aprovado (WhatsApp Cloud API) via `templateId` |
| `notify` | Cria uma notificação interna para o operador (opcionalmente encaminhada ao Slack — ver `docs/SLACK.md`) |
| `slackNotify` | Avisa no Slack que a conversa precisa de humano (botão "Assumir atendimento") + notificação interna; com "Transferir para humano" pausa a IA e encerra o fluxo — `docs/SLACK.md` |
| `condition` | Bifurca em dois handles: `true`/`false` |
| `switchCase` | Bifurca em N casos configuráveis (`contains`/`exact`) + um handle `default` implícito |
| `aiAssistant` | Chama IA (Gemini, OpenAI ou OpenRouter), turno único ou sessão contínua |
| `captureOrderData` | Grava/atualiza campos de estado de pedido (`commercial_status`, `send_status`, `delivery_status`) |
| `end` | Encerra o fluxo |
| `fulfillmentStock`, `fulfillmentStatus` | **Legado** — mantidos só para fluxos salvos antigos continuarem carregando/executando; não oferecer em fluxos novos |

## Estrutura real do JSON do fluxo

```typescript
interface Flow {
  id: string
  instance_name: string
  name: string
  json: { nodes: FlowNode[]; edges: FlowEdge[] }
  ativo: boolean
  created_at: string
  updated_at: string
}

interface FlowNode {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: FlowNodeData   // campos variam por tipo — ver types/index.ts:124-168
}

interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null   // usado por condition/switchCase/replyButtons
  targetHandle?: string | null
}
```

Salvo como `json` (JSONB) na tabela `flows`, particionada por
`instance_name`.

## Gatilho real (não é keyword-por-produto nem link)

Prioridade avaliada a cada mensagem inbound (`app/api/webhook/evolution/route.ts:452-502`,
mesma ordem na Cloud API):

```
1. flow_runs pausado para esse remote_jid? → retoma no node salvo
2. sandbox com envio real ativo? → trata como fallback do fluxo real
3. ai_sessions ativa? → passa a mensagem pra sessão de IA
4. senão: executeTriggers — compara o texto da mensagem contra
   triggers.valor (lista separada por vírgula, suporta *), tipo
   'exact' ou 'contains'; primeiro match dispara e para
```

`triggers.source` pode ser `'message'` (texto do lead), `'shopify_order'`
(pedido criado), `'delivery_status'` (mudança de status de entrega) ou
`'shopify_abandoned_checkout'` (carrinho abandonado) — os três últimos não
vêm de mensagem, vêm de eventos internos enfileirados.

### Carrinho abandonado (`shopify_abandoned_checkout`)

- Webhooks `checkouts/create` e `checkouts/update` (registrados
  automaticamente junto dos de pedido, `lib/shopify-webhook-setup.ts`)
  gravam o checkout e agendam um `abandoned_checkout_flow` por gatilho, com
  `next_attempt_at = updated_at do checkout na Shopify + triggers.delay_ms`
  (padrão 60 min). Cada `checkouts/update` empurra o job pendente para
  frente — o delay conta a partir da última atividade do cliente.
- Dedupe `abandoned-checkout:{checkout}:{trigger}`: vários gatilhos com
  delays diferentes formam uma sequência de lembretes.
- Não agenda: carrinho sem telefone, simulação, status diferente de
  `Pendente`, gatilhos Shopify pausados (`shopify_triggers_enabled`), ou
  checkout cuja hora ideal de envio passou há mais de 6h. O sync manual só
  agenda quando pedido com disparos.
- Conversão: pedido com `checkout_token`/`checkout_id`, ou checkout com
  `completed_at`, marca `Convertido` e cancela jobs pendentes. Na hora de
  rodar, o worker ainda confere pedido pelo token e pedido do mesmo telefone
  feito depois do checkout — se houver, marca `Convertido` e não envia.
- O fluxo recebe `checkoutId` no contexto: variáveis `{{carrinho.link}}`,
  `{{carrinho.total}}`, `{{carrinho.produtos}}`, `{{carrinho.itens}}` etc.
  Em conta Cloud API a primeira mensagem precisa de template (ou template
  de fallback) — o carrinho é sempre contato iniciado pela empresa.
- O botão manual "recuperar" em `/fulfillment` continua existindo lado a
  lado (texto fixo da integração, não é fluxo).

## Execução

`executeFlow` roda **síncrono dentro da própria invocação do webhook**
(fire-and-forget, não bloqueia a resposta HTTP), com detecção de loop
(máximo 50 nodes visitados por execução). Não há uma "fila" para
execução normal — a fila (`flow_jobs` + worker com poll adaptativo de 1s a 15s
in-process, não cron) só entra quando:

- o node depende de um pedido Shopify ainda não sincronizado localmente
  (`OrderContextPendingError` → reagenda como `flow_message_resume`);
- o disparo vem de um evento Shopify assíncrono (`shopify_order_flow`,
  `delivery_status_flow`, `abandoned_checkout_flow`).

## Estados de uma conversa (real)

Não é uma state machine única e nomeada — o estado vive em duas tabelas
conforme o tipo de espera:

- **`flow_runs`** (`UNIQUE(instance_name, remote_jid)`) — só existe
  enquanto o fluxo está pausado esperando resposta a um `sendMessage`
  com botões (`status='waiting_confirmation'`). Guarda `node_id` (onde
  retomar) e `variables`. Deletado ao concluir o fluxo.
- **`ai_sessions`** — estado de conversas contínuas com IA
  (`message_count`, `max_messages`, `history`, `requires_human`...).

Se o `node_id` salvo não existir mais no JSON atual do fluxo (editado
enquanto a conversa estava pausada), o engine apaga o `flow_runs` órfão
e reinicia do node `start` em vez de travar a conversa.

## Bloco de IA

```typescript
// campos relevantes em FlowNodeData (types/index.ts:139-153)
{
  provider?: 'gemini' | 'openai' | 'openrouter'
  model?: string
  customModel?: string
  useDefaultModel?: boolean
  systemPrompt?: string
  historyLimit?: number
  temperature?: number
  maxTokens?: number
  continueConversation?: boolean   // false = turno único (max_messages: 1)
  timeoutType?: 'minutes' | 'messages'
  timeoutValue?: number
  responseDelayMs?: number
  memoryBlockIds?: string[]
}
```

Credenciais por provedor ficam cifradas (AES-256-GCM) em
`ai_provider_keys`, nunca em texto plano. `lib/ai-tool-check.ts` testa
se o provedor/modelo suporta tool-calling nativo — se não suportar, a
escalação para humano cai para um sinal de texto (`[[ATENDIMENTO_HUMANO]]`)
em vez de function-calling.

**Memory blocks** (`agent_memory_blocks`): blocos `type: 'always'` são
sempre injetados no prompt; blocos com `keywords` só entram se alguma
keyword aparecer na mensagem do lead. É memória compartilhada por
instância (conta WhatsApp), não uma memória isolada por conversa.

## Sandbox

A UI é a view **Sandbox** do app principal (`components/sandbox/`, abaixo
de Memória no menu): conversa de teste fixa à esquerda e, à direita, sub-abas
Visão geral (mini janelas de gatilhos, fluxos e memória da conta sandbox),
Gatilhos, Fluxos, Memória, Simular pedido, Carrinho abandonado e Produtos
fictícios. O carrinho simulado (`createSandboxAbandonedCheckout`) é gravado
com `is_simulation=true` na conta sandbox e agenda os gatilhos "Carrinho
abandonado" dela — na hora ou respeitando o delay —, mesmo com os gatilhos
Shopify pausados, como os pedidos simulados.
No chat de teste, os botões de resposta do fluxo pausado aparecem clicáveis
(vêm de `flow_runs.variables.replyButtons`); a retomada passa `flowRunId`,
`orderId`/`checkoutId` e `normalizeReplyInput` como o webhook real. Gatilhos,
Fluxos e Memória são as mesmas abas das contas reais, montadas com
`__sandbox__`; uma edição salva vale já na próxima mensagem de teste. O chat
só consulta o servidor com a view aberta e a janela visível. Ver
`docs/DECISIONS.md` [012].

`lib/sandbox.ts` só define as constantes da conta especial
`__sandbox__`. A barreira real de "nunca manda WhatsApp de verdade"
está em `resolveRealSendTarget` (`lib/flow-engine.ts`): mensagens de
fluxo rodando na conta sandbox só saem de verdade se o contato de teste
tiver `sandbox_real_send_enabled=true` (importado de uma conta real) —
caso contrário, tudo é só persistido em `messages`, nunca enviado.

`lib/flow-transfer.ts` não é sandbox, apesar do nome sugerir — é o
parser/serializador de export/import de fluxos (JSON) entre contas.

## Validação de fluxo (bloqueia o save)

- `sendMessage` com `replyButtons` só pode se conectar diretamente a um
  `switchCase` (`lib/flow-connection-validation.ts`, `lib/flow-validation.ts`).
- Loops sem saída e referências a node inexistente são rejeitados no
  save (ver testes em `__tests__/lib/flow-validation.test.ts`).

## Janela de 24h (WhatsApp Cloud API)

Só existe para contas com `provider==='cloud_api'` — contas Evolution
nunca são bloqueadas por isso (é restrição da Meta, não do produto). O
node `sendMessage` fora da janela **não tenta template automaticamente**:
cria uma notificação para o operador e aborta. Só o fluxo de recuperação
de carrinho abandonado (fora do flow builder, em
`lib/shopify-confirmation-service.ts`) tenta um template aprovado como
fallback.
