import 'server-only'
import type { AnalysisResult, MemoryBlockType, MemorySuggestion } from '@/types'

const MAX_SUGGESTIONS = 15
const MAX_ANALYSIS_LENGTH = 5000
const MAX_NAME_LENGTH = 200
const MAX_CONTENT_LENGTH = 4000
const MAX_KEYWORDS = 30
const MAX_KEYWORD_LENGTH = 100
const VALID_TYPES: MemoryBlockType[] = ['always', 'contextual']

export interface AnalysisValidationResult {
  ok: boolean
  error?: string
  data?: AnalysisResult
}

/**
 * Valida integralmente a saída JSON de um provedor de IA antes de expor o
 * resultado ao operador (que pode aprovar os blocos sugeridos para memória
 * do agente). Reconstrói um objeto limpo só com os campos esperados — nunca
 * repassa campos extras que o modelo possa ter incluído.
 */
export function validateAnalysisResult(parsed: unknown): AnalysisValidationResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Resposta da IA não é um objeto JSON.' }
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.analysis !== 'string' || !obj.analysis.trim()) {
    return { ok: false, error: 'Resposta da IA sem campo "analysis" válido.' }
  }
  if (obj.analysis.length > MAX_ANALYSIS_LENGTH) {
    return { ok: false, error: 'Campo "analysis" excede o tamanho máximo permitido.' }
  }

  if (!Array.isArray(obj.suggestions)) {
    return { ok: false, error: 'Resposta da IA sem campo "suggestions" válido.' }
  }
  // Um array vazio é uma resposta válida (a IA pode concluir que não há
  // sugestão acionável) — só limitamos o teto, não o piso.
  if (obj.suggestions.length > MAX_SUGGESTIONS) {
    return { ok: false, error: `Número de sugestões (${obj.suggestions.length}) excede o limite de ${MAX_SUGGESTIONS}.` }
  }

  const suggestions: MemorySuggestion[] = []
  for (let i = 0; i < obj.suggestions.length; i++) {
    const raw = obj.suggestions[i]
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `Sugestão ${i}: formato inválido.` }
    }
    const s = raw as Record<string, unknown>

    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `Sugestão ${i}: campo "name" inválido.` }
    }
    if (typeof s.content !== 'string' || !s.content.trim() || s.content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `Sugestão ${i}: campo "content" inválido.` }
    }
    if (typeof s.type !== 'string' || !VALID_TYPES.includes(s.type as MemoryBlockType)) {
      return { ok: false, error: `Sugestão ${i}: campo "type" inválido.` }
    }
    if (!Array.isArray(s.keywords)) {
      return { ok: false, error: `Sugestão ${i}: campo "keywords" inválido.` }
    }
    if (s.keywords.length > MAX_KEYWORDS) {
      return { ok: false, error: `Sugestão ${i}: excesso de keywords.` }
    }

    const keywords: string[] = []
    for (const kw of s.keywords) {
      if (typeof kw !== 'string' || kw.length > MAX_KEYWORD_LENGTH) {
        return { ok: false, error: `Sugestão ${i}: keyword inválida.` }
      }
      keywords.push(kw)
    }

    suggestions.push({
      name: s.name.trim(),
      content: s.content.trim(),
      type: s.type as MemoryBlockType,
      keywords,
    })
  }

  return { ok: true, data: { analysis: obj.analysis.trim(), suggestions } }
}
