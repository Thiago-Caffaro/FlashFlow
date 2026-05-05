const PING_TOOL_GEMINI = {
  functionDeclarations: [{
    name: 'ping',
    description: 'Connectivity and tool support test',
    parameters: { type: 'OBJECT', properties: {} },
  }],
}

const PING_TOOL_OPENAI = {
  type: 'function',
  function: {
    name: 'ping',
    description: 'Connectivity and tool support test',
    parameters: { type: 'object', properties: {} },
  },
}

export async function checkToolSupport(provider: string, apiKey: string, model: string): Promise<boolean> {
  try {
    if (provider === 'gemini') {
      const apiVersion = model.startsWith('gemini-2.5') ? 'v1beta' : 'v1'
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            tools: [PING_TOOL_GEMINI],
            tool_config: { function_calling_config: { mode: 'ANY' } },
            generationConfig: { maxOutputTokens: 10 },
          }),
        }
      )
      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      type GeminiPart = { functionCall?: unknown }
      const parts: GeminiPart[] = data.candidates?.[0]?.content?.parts ?? []
      return parts.some((p) => p.functionCall)
    }

    if (provider === 'openai' || provider === 'openrouter') {
      const url = provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions'

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://flashflow.app'
        headers['X-Title'] = 'FlashFlow'
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          tools: [PING_TOOL_OPENAI],
          tool_choice: 'required',
          max_tokens: 10,
        }),
      })
      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      return (data.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0
    }

    return false
  } catch {
    return false
  }
}
