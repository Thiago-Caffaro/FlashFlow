import 'server-only'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

export interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
  error?: { message?: string; param?: string | null }
}

// Parâmetro de limite de saída da Chat Completions da OpenAI. `max_tokens`
// foi descontinuado e os modelos novos (série o*, gpt-5+) o rejeitam com
// 400; `max_completion_tokens` é aceito por todos os modelos atuais.
export function openAITokenLimit(maxTokens: number | undefined): Record<string, number> {
  return maxTokens ? { max_completion_tokens: maxTokens } : {}
}

function rejectsTemperature(status: number, body: OpenAIChatResponse): boolean {
  if (status !== 400) return false
  const error = body.error
  return error?.param === 'temperature'
    || (typeof error?.message === 'string' && error.message.includes('temperature'))
}

// POST na Chat Completions da OpenAI. Modelos de raciocínio só aceitam a
// temperatura padrão: se a API recusar `temperature`, repete uma vez sem ela.
export async function postOpenAIChat(
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: OpenAIChatResponse }> {
  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({})) as OpenAIChatResponse
    return { ok: res.ok, status: res.status, data }
  }

  const first = await send(body)
  if (!first.ok && 'temperature' in body && rejectsTemperature(first.status, first.data)) {
    const withoutTemperature = { ...body }
    delete withoutTemperature.temperature
    return send(withoutTemperature)
  }
  return first
}
