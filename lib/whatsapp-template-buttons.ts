// Funções puras (sem 'server-only') — usadas tanto pelo motor de fluxos quanto
// pela UI do editor para ler os botões de um template sincronizado da Meta.

export interface TemplateQuickReplyButton {
  // Posição do botão na lista completa de botões do template (não só entre
  // os quick replies): é o "index" que a Meta exige ao enviar o payload.
  index: number
  text: string
}

export function getTemplateQuickReplyButtons(buttons: unknown): TemplateQuickReplyButton[] {
  if (!Array.isArray(buttons)) return []
  const result: TemplateQuickReplyButton[] = []
  buttons.forEach((raw, index) => {
    const button = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    if (!button) return
    if (typeof button.type !== 'string' || button.type.toUpperCase() !== 'QUICK_REPLY') return
    result.push({ index, text: typeof button.text === 'string' ? button.text : '' })
  })
  return result
}
