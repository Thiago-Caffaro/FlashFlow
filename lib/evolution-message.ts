type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function parseNativeFlowParams(value: unknown): UnknownRecord {
  if (typeof value !== 'string') return asRecord(value)
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

export function extractInteractiveReplyText(message: unknown): string | null {
  const root = asRecord(message)
  const buttons = asRecord(root.buttonsResponseMessage)
  const template = asRecord(root.templateButtonReplyMessage)
  const list = asRecord(root.listResponseMessage)
  const singleSelect = asRecord(list.singleSelectReply)
  const interactive = asRecord(root.interactiveResponseMessage)
  const nativeFlow = asRecord(interactive.nativeFlowResponseMessage)
  const params = parseNativeFlowParams(nativeFlow.paramsJson)
  const buttonReply = asRecord(params.button_reply ?? params.buttonReply)
  const listReply = asRecord(params.list_reply ?? params.listReply)

  return firstString(
    buttons.selectedDisplayText,
    buttons.selectedButtonId,
    template.selectedDisplayText,
    template.selectedId,
    list.title,
    singleSelect.selectedRowId,
    buttonReply.display_text,
    buttonReply.displayText,
    buttonReply.title,
    buttonReply.id,
    listReply.title,
    listReply.id,
    params.display_text,
    params.displayText,
    params.title,
    params.id
  )
}
