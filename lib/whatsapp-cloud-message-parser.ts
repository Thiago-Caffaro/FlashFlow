// Equivalente Cloud API de lib/evolution-message.ts — extrai o texto de uma
// resposta a botão interativo. Diferente da Evolution (JSON aninhado dentro
// de vários formatos de payload legados), a Meta tem só dois formatos:
// interactive.button_reply (atual) e button (legado, "quick reply" antigo).
// Alimenta o mesmo normalizeReplyInput já agnóstico de provedor — nenhuma
// mudança no motor de resumo de fluxo.
export function extractCloudInteractiveReplyText(message: unknown): string | null {
  const root = message && typeof message === 'object' ? message as Record<string, unknown> : {}
  const msgType = typeof root.type === 'string' ? root.type : ''

  if (msgType === 'interactive') {
    const interactive = root.interactive as Record<string, unknown> | undefined
    const buttonReply = interactive?.button_reply as Record<string, unknown> | undefined
    const title = typeof buttonReply?.title === 'string' ? buttonReply.title.trim() : ''
    const id = typeof buttonReply?.id === 'string' ? buttonReply.id.trim() : ''
    return title || id || null
  }

  if (msgType === 'button') {
    const button = root.button as Record<string, unknown> | undefined
    const text = typeof button?.text === 'string' ? button.text.trim() : ''
    const payload = typeof button?.payload === 'string' ? button.payload.trim() : ''
    return text || payload || null
  }

  return null
}
