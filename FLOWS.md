# Flow Builder & Executor

## Tipos de blocos (MVP)

| Bloco | Função | Inputs | Outputs |
|-------|--------|--------|---------|
| **Start** | Ponto de entrada do fluxo | — | 1 edge |
| **Message** | Envia texto ao lead | `content`, `delayMs` | 1 edge |
| **Button** | Envia mensagem com botões | `content`, `buttons[]` | 1 edge por botão |
| **Condition** | Bifurca baseado em variável | `conditions[]`, `logic` | `true` / `false` edges |
| **GeminiAssistant** | Bloco de IA conversacional | `temperature`, `instructions` | 1 edge |
| **End** | Encerra o fluxo | — | — |

---

## Exemplo de fluxo JSON (salvo no Postgres)

```json
{
  "nodes": [
    {
      "id": "start-1",
      "type": "start",
      "position": { "x": 100, "y": 100 },
      "data": {}
    },
    {
      "id": "msg-1",
      "type": "message",
      "position": { "x": 100, "y": 250 },
      "data": {
        "content": "Olá! Seja bem-vindo ao Vistaplus. Como posso te ajudar?",
        "delayMs": 500
      }
    },
    {
      "id": "btn-1",
      "type": "button",
      "position": { "x": 100, "y": 400 },
      "data": {
        "content": "Escolha uma opção:",
        "buttons": [
          { "id": "btn-preco", "label": "Ver preços" },
          { "id": "btn-duvidas", "label": "Tirar dúvidas" }
        ]
      }
    },
    {
      "id": "gemini-1",
      "type": "gemini",
      "position": { "x": 100, "y": 600 },
      "data": {
        "temperature": 0.7,
        "maxTokens": 500,
        "additionalInstructions": "Responda dúvidas sobre o produto Vistaplus apenas."
      }
    },
    {
      "id": "end-1",
      "type": "end",
      "position": { "x": 100, "y": 800 },
      "data": {}
    }
  ],
  "edges": [
    { "id": "e1", "source": "start-1", "target": "msg-1" },
    { "id": "e2", "source": "msg-1", "target": "btn-1" },
    { "id": "e3", "source": "btn-1", "target": "gemini-1", "sourceHandle": "btn-duvidas" },
    { "id": "e4", "source": "gemini-1", "target": "end-1" }
  ],
  "variables": []
}
```

---

## Flow Executor — State Machine

### Estados possíveis de uma conversa

```
IDLE → RUNNING → WAITING_INPUT → RUNNING → COMPLETED
                              ↘ HUMAN_TAKEOVER
                              ↘ ABANDONED (timeout)
```

### Algoritmo do executor

```typescript
async function executeNextBlock(conversationId: string, input?: string) {
  // 1. Recupera estado do Redis
  const state = await redis.get(`conv:state:${conversationId}`)
  
  // 2. Se está com humano, não faz nada
  if (state.isHuman) return
  
  // 3. Busca o node atual
  const node = getNodeById(state.currentNodeId, state.flow)
  
  // 4. Executa o bloco
  switch (node.type) {
    case "message":
      await sendWhatsAppMessage(state.contactNumber, node.data.content)
      await advanceToNextNode(state)
      break
      
    case "button":
      await sendWhatsAppButtons(state.contactNumber, node.data)
      await setStateWaiting(state)   // aguarda input do lead
      break
      
    case "condition":
      const result = evaluateConditions(node.data.conditions, state.variables)
      await advanceToNodeByHandle(state, result ? "true" : "false")
      break
      
    case "gemini":
      const response = await geminiService.chat(state, node.data, input)
      await sendWhatsAppMessage(state.contactNumber, response.message)
      // Gemini fica em loop até o lead parar de responder
      // ou até atingir maxTurns (configurável)
      break
      
    case "end":
      await closeExecution(state)
      break
  }
  
  // 5. Persiste novo estado no Redis
  await redis.set(`conv:state:${conversationId}`, state, { ttl: 86400 })
  
  // 6. Emite evento Socket.io pro frontend
  await socketGateway.emit("conversation:updated", { conversationId })
}
```

---

## Bloco Gemini — Montagem do Prompt

```
[SYSTEM]
{product.geminiPrompt}          ← prompt base do produto (cacheado)
{node.additionalInstructions}   ← instrução específica do bloco

[HISTORY]
{state.geminiHistory}           ← histórico da conversa com a IA

[USER]
{input}                         ← mensagem atual do lead
```

### Structured Output obrigatório

```typescript
// Toda resposta do Gemini DEVE seguir este schema
const GeminiResponseSchema = z.object({
  message: z.string(),          // o que enviar ao lead
  action: z.enum([
    "continue",                 // continua no bloco Gemini
    "advance",                  // avança pro próximo node
    "request_human",            // pede para passar para humano
  ]),
  variablesToSet: z.record(z.string()).optional(),  // variáveis a salvar
})
```

---

## Gatilho Inicial

Quando chega mensagem de número desconhecido:

```typescript
async function handleIncomingMessage(from: string, text: string) {
  // 1. Normaliza texto
  const normalized = text.trim().toLowerCase()
  
  // 2. Busca produto pelo trigger keyword
  const product = await db.product.findFirst({
    where: {
      organizationId,
      isActive: true,
      triggerKeyword: { equals: normalized, mode: "insensitive" }
    }
  })
  
  if (!product) {
    // Mensagem não reconhecida — ignorar ou resposta padrão
    return
  }
  
  // 3. Busca fluxo ativo do produto
  const flow = await db.flow.findFirst({
    where: { productId: product.id, isActive: true }
  })
  
  // 4. Cria conversa + execução no banco
  // 5. Inicializa estado no Redis
  // 6. Executa primeiro bloco
  await executeNextBlock(newConversationId)
}
```
