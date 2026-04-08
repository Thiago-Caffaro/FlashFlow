# Flow Builder & Executor

> ⚠️ Fase 2 — não implementado ainda. Arquivo de referência para planejamento.

---

## Tipos de blocos (planejados)

| Bloco | Função | Status |
|---|---|---|
| **Start** | Ponto de entrada | Fase 2 |
| **Message** | Envia texto | Fase 2 |
| **Button** | Envia botões | Fase 2 |
| **Condition** | Bifurca por variável | Fase 2 |
| **GeminiAssistant** | IA conversacional | Fase 3 |
| **End** | Encerra o fluxo | Fase 2 |

---

## Estrutura do JSON do fluxo (xyflow)

```typescript
interface FlowData {
  nodes: {
    id: string
    type: "start" | "message" | "button" | "condition" | "gemini" | "end"
    position: { x: number; y: number }
    data: NodeData
  }[]
  edges: {
    id: string
    source: string
    target: string
    sourceHandle?: string  // para condições e botões
  }[]
}
```

---

## Estados de uma conversa (Fase 2)

```
IDLE → RUNNING → WAITING_INPUT → RUNNING → COMPLETED
                              ↘ HUMAN_TAKEOVER
                              ↘ ABANDONED (timeout)
```

---

## Gatilho inicial (Fase 2)

```
1. Mensagem chega com texto "Quero o Vistaplus"
2. Normaliza e busca produto pelo triggerKeyword
3. Carrega fluxo ativo do produto
4. Cria flow_execution no banco
5. Executa primeiro bloco (Start → Message)
```

---

## Bloco Gemini — prompt structure (Fase 3)

```
[SYSTEM]
{product.geminiPrompt}           ← cacheado (context caching)
{node.additionalInstructions}    ← específico do bloco

[HISTORY]
{conversationHistory}

[USER]
{mensagem do lead}
```

**Structured output obrigatório:**
```typescript
const GeminiResponseSchema = z.object({
  message: z.string(),
  action: z.enum(["continue", "advance", "request_human"]),
  variablesToSet: z.record(z.string()).optional(),
})
```
