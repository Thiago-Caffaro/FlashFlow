import { validateFlowJson, validateFlowMessagePlaceholders } from '@/lib/flow-validation'

function node(id: string, type = 'sendMessage', data: unknown = {}) {
  return { id, type, position: { x: 0, y: 0 }, data }
}

function edge(id: string, source: string, target: string) {
  return { id, source, target }
}

describe('validateFlowJson', () => {
  it('aceita um fluxo vazio (estado inicial de um fluxo recém-criado)', () => {
    expect(validateFlowJson({ nodes: [], edges: [] })).toEqual({ ok: true })
  })

  it('aceita um grafo válido simples', () => {
    const result = validateFlowJson({
      nodes: [node('n1', 'start'), node('n2', 'sendMessage'), node('n3', 'end')],
      edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejeita quando json não é um objeto', () => {
    expect(validateFlowJson(null).ok).toBe(false)
    expect(validateFlowJson('string').ok).toBe(false)
    expect(validateFlowJson(42).ok).toBe(false)
  })

  it('rejeita quando nodes ou edges não são arrays', () => {
    expect(validateFlowJson({ nodes: 'x', edges: [] }).ok).toBe(false)
    expect(validateFlowJson({ nodes: [], edges: 'x' }).ok).toBe(false)
  })

  it('rejeita tipo de nó desconhecido', () => {
    const result = validateFlowJson({ nodes: [node('n1', 'scriptInjection')], edges: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/tipo de nó desconhecido/)
  })

  it('rejeita id de nó duplicado', () => {
    const result = validateFlowJson({ nodes: [node('n1'), node('n1')], edges: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/duplicado/)
  })

  it('rejeita aresta referenciando nó de origem inexistente', () => {
    const result = validateFlowJson({ nodes: [node('n1')], edges: [edge('e1', 'nao-existe', 'n1')] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/origem inexistente/)
  })

  it('rejeita aresta referenciando nó de destino inexistente', () => {
    const result = validateFlowJson({ nodes: [node('n1')], edges: [edge('e1', 'n1', 'nao-existe')] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/destino inexistente/)
  })

  it('rejeita mais de um nó de início', () => {
    const result = validateFlowJson({
      nodes: [node('n1', 'start'), node('n2', 'start')],
      edges: [],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/mais de um nó de início/)
  })

  it('rejeita fluxo com número de nós acima do limite', () => {
    const nodes = Array.from({ length: 201 }, (_, i) => node(`n${i}`))
    const result = validateFlowJson({ nodes, edges: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/limite de/)
  })

  it('rejeita dados de nó excessivamente grandes', () => {
    const result = validateFlowJson({
      nodes: [node('n1', 'aiAssistant', { systemPrompt: 'x'.repeat(30000) })],
      edges: [],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/excedem o tamanho/)
  })

  it('rejeita nó sem id válido', () => {
    const result = validateFlowJson({ nodes: [{ type: 'sendMessage' }], edges: [] })
    expect(result.ok).toBe(false)
  })

  it('aceita até três opções conectadas diretamente a um Switch Case', () => {
    const result = validateFlowJson({
      nodes: [
        node('start', 'start'),
        node('message', 'sendMessage', {
          message: 'Escolha',
          replyButtons: [
            { id: 'confirm', label: 'CONFIRMAR' },
            { id: 'change', label: 'MODIFICAR' },
          ],
        }),
        node('switch', 'switchCase'),
      ],
      edges: [edge('e1', 'start', 'message'), edge('e2', 'message', 'switch')],
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejeita opções sem uma única conexão para Switch Case', () => {
    const result = validateFlowJson({
      nodes: [
        node('message', 'sendMessage', {
          message: 'Escolha',
          replyButtons: [{ id: 'confirm', label: 'CONFIRMAR' }],
        }),
        node('end', 'end'),
      ],
      edges: [edge('e1', 'message', 'end')],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Switch Case/)
  })

  it('rejeita mais de três opções', () => {
    const result = validateFlowJson({
      nodes: [node('message', 'sendMessage', {
        replyButtons: [1, 2, 3, 4].map((value) => ({ id: String(value), label: String(value) })),
      })],
      edges: [],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/3 respostas/)
  })

  it('rejeita configuração inválida para combinar imagem e mensagem', () => {
    const result = validateFlowJson({
      nodes: [node('message', 'sendMessage', {
        combineImageAndMessage: 'sim',
      })],
      edges: [],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/imagem/)
  })

  it('valida variáveis automáticas e personalizadas existentes', () => {
    const json = {
      nodes: [node('message', 'sendMessage', {
        message: 'Oi {{contato.primeiro_nome}}, {{personalizada.nome_loja}}',
      })],
      edges: [],
    }
    expect(validateFlowMessagePlaceholders(json, ['nome_loja'])).toEqual({ ok: true })
    expect(validateFlowMessagePlaceholders(json, [])).toMatchObject({ ok: false })
  })
})
