import {
  getReferencedCustomVariableKeys,
  parseFlowTransfer,
  selectTransferVariables,
} from '@/lib/flow-transfer'

const json = {
  nodes: [{
    id: 'message',
    type: 'sendMessage' as const,
    position: { x: 0, y: 0 },
    data: { message: 'Oi {{personalizada.loja}} - {{contato.primeiro_nome}}' },
  }],
  edges: [],
}

describe('flow transfer', () => {
  it('parses legacy version 1 exports without variables', () => {
    expect(parseFlowTransfer({ flashflow_export: 'flow', version: 1, name: 'Teste', json }))
      .toMatchObject({ flows: [{ name: 'Teste', json }], variables: [] })
  })

  it('parses version 2 exports with custom variables', () => {
    const result = parseFlowTransfer({
      flashflow_export: 'flows',
      version: 2,
      flows: [{ name: 'Teste', json }],
      variables: [{ key: 'loja', label: 'Nome da loja', value: 'Flash Store' }],
    })
    expect(result.variables).toEqual([{ key: 'loja', label: 'Nome da loja', value: 'Flash Store' }])
  })

  it('rejects malformed exports before contacting the API', () => {
    expect(() => parseFlowTransfer({ flashflow_export: 'flow', json: null })).toThrow(/fluxo valido/)
    expect(() => parseFlowTransfer({ flashflow_export: 'other' })).toThrow(/Arquivo invalido/)
  })

  it('collects and exports only referenced custom variables', () => {
    expect(getReferencedCustomVariableKeys([{ name: 'Teste', json }])).toEqual(['loja'])
    expect(selectTransferVariables([{ name: 'Teste', json }], [
      { id: '1', instance_name: 'wa-a', key: 'loja', label: 'Loja', value: 'Flash', created_at: '', updated_at: '' },
      { id: '2', instance_name: 'wa-a', key: 'nao_usada', label: 'Outra', value: 'X', created_at: '', updated_at: '' },
    ])).toEqual([{ key: 'loja', label: 'Loja', value: 'Flash' }])
  })
})
