export const MESSAGE_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,47}$/

export interface MessageVariableInput {
  instance_name: string
  key: string
  label: string
  value: string
}

export function validateMessageVariableInput(
  input: Partial<MessageVariableInput>,
  requireAll = true
): { ok: true; value: Partial<MessageVariableInput> } | { ok: false; error: string } {
  const value: Partial<MessageVariableInput> = {}

  if (requireAll || input.instance_name !== undefined) {
    if (typeof input.instance_name !== 'string' || !input.instance_name.trim()) {
      return { ok: false, error: 'instance_name obrigatorio' }
    }
    value.instance_name = input.instance_name.trim()
  }
  if (requireAll || input.key !== undefined) {
    if (typeof input.key !== 'string' || !MESSAGE_VARIABLE_KEY_PATTERN.test(input.key.trim())) {
      return { ok: false, error: 'Chave invalida. Use letras minusculas, numeros e sublinhado.' }
    }
    value.key = input.key.trim()
  }
  if (requireAll || input.label !== undefined) {
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 80) {
      return { ok: false, error: 'Nome deve ter entre 1 e 80 caracteres.' }
    }
    value.label = input.label.trim()
  }
  if (requireAll || input.value !== undefined) {
    if (typeof input.value !== 'string' || input.value.length > 2000) {
      return { ok: false, error: 'Valor deve ter no maximo 2000 caracteres.' }
    }
    value.value = input.value
  }

  return { ok: true, value }
}
