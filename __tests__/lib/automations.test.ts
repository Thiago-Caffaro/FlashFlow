// Testes de lib/automations.ts contra um Supabase em memória: validação de
// conta/template e sincronização dos fluxos gerados por etapa.

type Row = Record<string, unknown>
type Db = Record<string, Row[]>

let db: Db
let idCounter = 0
let failInsertOn: string | null = null

function nextId(table: string) {
  idCounter += 1
  return `${table}-${idCounter}`
}

function createBuilder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  let payload: Row | Row[] | null = null
  let conflictKeys: string[] = []

  const rows = () => (db[table] ??= [])
  const matches = (row: Row) => filters.every((filter) => filter(row))

  function execute(): { data: Row[]; error: { message: string; code?: string } | null } {
    if (action === 'insert' || action === 'upsert') {
      if (failInsertOn === table) return { data: [], error: { message: `falha simulada em ${table}` } }
      const list = Array.isArray(payload) ? payload : [payload as Row]
      const result: Row[] = []
      for (const item of list) {
        const existing = action === 'upsert'
          ? rows().find((row) => conflictKeys.every((key) => row[key] === item[key]))
          : undefined
        if (existing) {
          Object.assign(existing, item)
          result.push(existing)
        } else {
          const row = { id: nextId(table), ...item }
          rows().push(row)
          result.push(row)
        }
      }
      return { data: result, error: null }
    }
    const matched = rows().filter(matches)
    if (action === 'update') matched.forEach((row) => Object.assign(row, payload))
    if (action === 'delete') {
      db[table] = rows().filter((row) => !matches(row))
      // Cascatas usadas pelo código.
      if (table === 'automations') {
        const ids = new Set(matched.map((row) => row.id))
        db.automation_steps = (db.automation_steps ?? []).filter((row) => !ids.has(row.automation_id))
        db.flows = (db.flows ?? []).filter((row) => !ids.has(row.managed_by_automation_id))
      }
    }
    return { data: matched, error: null }
  }

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder },
    in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder },
    is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder },
    insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder },
    update: (value: Row) => { action = 'update'; payload = value; return builder },
    upsert: (value: Row, options?: { onConflict?: string }) => {
      action = 'upsert'
      payload = value
      conflictKeys = (options?.onConflict ?? 'id').split(',')
      return builder
    },
    delete: () => { action = 'delete'; return builder },
    single: async () => {
      const result = execute()
      return result.error ? { data: null, error: result.error } : { data: result.data[0] ?? null, error: result.data[0] ? null : { message: 'no rows' } }
    },
    maybeSingle: async () => {
      const result = execute()
      return { data: result.error ? null : result.data[0] ?? null, error: result.error }
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  }
  return builder
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => createBuilder(table) },
}))

import { AutomationError, createAutomation, deleteAutomation, setAutomationEnabled, updateAutomation } from '@/lib/automations'
import type { AutomationInput } from '@/types'

function input(overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    name: 'Carrinho ES',
    kind: 'abandoned_cart',
    platform: 'shopify',
    country: 'ES',
    product_line_id: 'line-ema',
    instance_name: 'conta-evo',
    enabled: false,
    steps: [
      { delay_minutes: 60, message: 'Oi {{carrinho.link}}', fallback_template_id: 'tpl-ok', fallback_template_variable_map: { 1: 'x' } },
      { delay_minutes: 1440, message: 'Último aviso', fallback_template_id: null, fallback_template_variable_map: {} },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  idCounter = 0
  failInsertOn = null
  db = {
    product_lines: [{ id: 'line-ema', code: 'EMA', priority: 10 }],
    accounts: [
      { instance_name: 'conta-evo', provider: 'evolution', is_sandbox: false },
      { instance_name: 'conta-cloud', provider: 'cloud_api', is_sandbox: false },
      { instance_name: '__sandbox__', provider: 'evolution', is_sandbox: true },
    ],
    whatsapp_message_templates: [
      { id: 'tpl-ok', instance_name: 'conta-cloud', status: 'approved' },
      { id: 'tpl-pending', instance_name: 'conta-cloud', status: 'pending' },
      { id: 'tpl-outra', instance_name: 'outra-conta', status: 'approved' },
    ],
    message_variables: [],
    automations: [],
    automation_steps: [],
    flows: [],
  }
})

describe('createAutomation', () => {
  it('cria a automação, uma etapa por lembrete e um fluxo gerado por etapa', async () => {
    const automation = await createAutomation(input())
    expect(automation.steps).toHaveLength(2)
    expect(db.flows).toHaveLength(2)
    for (const [index, step] of automation.steps.entries()) {
      const flow = db.flows.find((row) => row.id === step.flow_id)
      expect(flow).toMatchObject({
        instance_name: 'conta-evo',
        managed_by_automation_id: automation.id,
        ativo: true,
        name: `[Automação] Carrinho ES · lembrete ${index + 1}`,
      })
    }
  })

  it('em conta Evolution descarta o template de fallback', async () => {
    const automation = await createAutomation(input())
    expect(automation.steps[0].fallback_template_id).toBeNull()
    const flow = db.flows.find((row) => row.id === automation.steps[0].flow_id) as { json: { nodes: Array<{ type: string; data: Row }> } }
    expect(flow.json.nodes.find((node) => node.type === 'sendMessage')?.data).not.toHaveProperty('fallbackTemplateId')
  })

  it('em conta Cloud API exige template aprovado da própria conta em todo lembrete', async () => {
    await expect(createAutomation(input({ instance_name: 'conta-cloud' }))).rejects.toThrow(
      'Lembrete 2: escolha um template aprovado'
    )
    const withPending = input({
      instance_name: 'conta-cloud',
      steps: [{ delay_minutes: 60, message: 'x', fallback_template_id: 'tpl-pending', fallback_template_variable_map: {} }],
    })
    await expect(createAutomation(withPending)).rejects.toThrow('Lembrete 1: o template precisa ser aprovado e deste número')
    const fromOtherAccount = input({
      instance_name: 'conta-cloud',
      steps: [{ delay_minutes: 60, message: 'x', fallback_template_id: 'tpl-outra', fallback_template_variable_map: {} }],
    })
    await expect(createAutomation(fromOtherAccount)).rejects.toThrow('Lembrete 1: o template precisa ser aprovado e deste número')
    expect(db.automations).toHaveLength(0)
  })

  it('aceita conta Cloud API com templates aprovados', async () => {
    const automation = await createAutomation(input({
      instance_name: 'conta-cloud',
      steps: [{ delay_minutes: 60, message: 'x', fallback_template_id: 'tpl-ok', fallback_template_variable_map: { 1: '{{carrinho.link}}' } }],
    }))
    expect(automation.steps[0].fallback_template_id).toBe('tpl-ok')
  })

  it('recusa sandbox, conta inexistente e linha inexistente', async () => {
    await expect(createAutomation(input({ instance_name: '__sandbox__' }))).rejects.toBeInstanceOf(AutomationError)
    await expect(createAutomation(input({ instance_name: 'nao-existe' }))).rejects.toThrow('Número de WhatsApp inválido')
    await expect(createAutomation(input({ product_line_id: 'line-x' }))).rejects.toThrow('Linha de produto não encontrada')
  })

  it('recusa variável desconhecida na mensagem', async () => {
    await expect(createAutomation(input({
      steps: [{ delay_minutes: 60, message: 'Oi {{nao_existe}}', fallback_template_id: null, fallback_template_variable_map: {} }],
    }))).rejects.toThrow(/Lembrete 1/)
  })

  it('desfaz a automação se gerar os fluxos falhar', async () => {
    failInsertOn = 'flows'
    await expect(createAutomation(input())).rejects.toThrow('Falha ao criar fluxo da automação')
    expect(db.automations).toHaveLength(0)
  })
})

describe('updateAutomation', () => {
  it('atualiza os fluxos existentes e apaga etapa e fluxo que sobraram', async () => {
    const created = await createAutomation(input())
    const [first, second] = created.steps
    const updated = await updateAutomation(created.id, input({
      name: 'Carrinho ES novo',
      steps: [{ delay_minutes: 30, message: 'Novo texto', fallback_template_id: null, fallback_template_variable_map: {} }],
    }))
    expect(updated.steps).toHaveLength(1)
    expect(updated.steps[0].flow_id).toBe(first.flow_id)
    expect(db.flows.map((row) => row.id)).toEqual([first.flow_id])
    expect(db.flows[0].name).toBe('[Automação] Carrinho ES novo')
    expect(db.automation_steps.find((row) => row.id === second.id)).toBeUndefined()
  })

  it('troca de número leva os fluxos junto', async () => {
    db.accounts.push({ instance_name: 'conta-evo-2', provider: 'evolution', is_sandbox: false })
    const created = await createAutomation(input())
    await updateAutomation(created.id, input({ instance_name: 'conta-evo-2' }))
    expect(db.flows.every((row) => row.instance_name === 'conta-evo-2')).toBe(true)
  })

  it('recria o fluxo se o anterior não pertence mais à automação', async () => {
    const created = await createAutomation(input())
    const detached = db.flows.find((row) => row.id === created.steps[0].flow_id) as Row
    detached.managed_by_automation_id = null
    const updated = await updateAutomation(created.id, input())
    expect(updated.steps[0].flow_id).not.toBe(detached.id)
    expect(db.flows.find((row) => row.id === updated.steps[0].flow_id)?.managed_by_automation_id).toBe(created.id)
  })

  it('devolve 404 para automação inexistente', async () => {
    await expect(updateAutomation('nao-existe', input())).rejects.toMatchObject({ status: 404 })
  })
})

describe('setAutomationEnabled / deleteAutomation', () => {
  it('ligar revalida o template; desligar não', async () => {
    const created = await createAutomation(input({
      instance_name: 'conta-cloud',
      steps: [{ delay_minutes: 60, message: 'x', fallback_template_id: 'tpl-ok', fallback_template_variable_map: {} }],
    }))
    ;(db.whatsapp_message_templates[0] as Row).status = 'rejected'
    await expect(setAutomationEnabled(created.id, true)).rejects.toThrow('o template precisa ser aprovado')
    await expect(setAutomationEnabled(created.id, false)).resolves.toMatchObject({ enabled: false })
  })

  it('apagar leva etapas e fluxos gerados', async () => {
    const created = await createAutomation(input())
    expect(await deleteAutomation(created.id)).toBe(true)
    expect(db.automation_steps).toHaveLength(0)
    expect(db.flows).toHaveLength(0)
    expect(await deleteAutomation(created.id)).toBe(false)
  })
})
