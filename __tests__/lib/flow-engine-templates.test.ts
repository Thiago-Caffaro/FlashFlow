/**
 * Testes para lib/flow-engine.ts — Fase 4: modo Template no node sendMessage
 * (sendWhatsAppTemplate + bifurcação no topo do node) e a checagem da janela
 * de 24h antes de texto livre/botões numa conta cloud_api.
 *
 * Mocka lib/whatsapp-dispatch, lib/whatsapp-account-provider e
 * lib/messaging-window diretamente — essas camadas já têm suíte própria
 * (whatsapp-dispatch.test.ts, whatsapp-cloud-adapter.test.ts,
 * messaging-window.test.ts); aqui o foco é só a lógica do flow-engine em
 * cima delas (bifurcação, notificação, resume job).
 */
export {}

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

jest.mock('@/lib/ai-crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))

const mockDispatchSendTemplate = jest.fn()
const mockDispatchSendText = jest.fn()
jest.mock('@/lib/whatsapp-dispatch', () => ({
  dispatchSendTemplate: (...args: unknown[]) => mockDispatchSendTemplate(...args),
  dispatchSendText: (...args: unknown[]) => mockDispatchSendText(...args),
  dispatchSendImage: jest.fn(),
  dispatchSendButtons: jest.fn(),
  supportsNativeButtons: jest.fn().mockResolvedValue(false),
}))

const mockGetAccountProvider = jest.fn()
jest.mock('@/lib/whatsapp-account-provider', () => ({
  getAccountProvider: (...args: unknown[]) => mockGetAccountProvider(...args),
}))

const mockIsWithinMessagingWindow = jest.fn()
jest.mock('@/lib/messaging-window', () => {
  const actual = jest.requireActual('@/lib/messaging-window')
  return {
    isWithinMessagingWindow: (...args: unknown[]) => mockIsWithinMessagingWindow(...args),
    OutsideMessagingWindowError: actual.OutsideMessagingWindowError,
  }
})

const mockLoadWhatsAppTemplateById = jest.fn()
jest.mock('@/lib/whatsapp-templates', () => ({
  loadWhatsAppTemplateById: (...args: unknown[]) => mockLoadWhatsAppTemplateById(...args),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result = { data: null, error: null }) {
  const calls = { inserted: [] as unknown[], updated: [] as unknown[], upserted: [] as unknown[], deleted: false }
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'is']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.insert = jest.fn((value: unknown) => { calls.inserted.push(value); return chain })
  chain.update = jest.fn((value: unknown) => { calls.updated.push(value); return chain })
  chain.upsert = jest.fn((value: unknown) => { calls.upserted.push(value); return chain })
  chain.delete = jest.fn(() => { calls.deleted = true; return chain })
  chain.then = (resolve: (v: Result) => unknown, reject?: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { chain, calls }
}

function setQueues(queues: Record<string, ReturnType<typeof builder>[]>) {
  const pending = new Map(Object.entries(queues))
  supabaseMock.from.mockImplementation((table: string) => {
    const queue = pending.get(table)
    if (!queue?.length) throw new Error(`Unexpected table ${table}`)
    return queue.shift()!.chain
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeFlow } = require('@/lib/flow-engine')

function templateFlow(templateId: string, templateVariableMap: Record<string, string>) {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'message', type: 'sendMessage', position: { x: 0, y: 0 }, data: { templateId, templateVariableMap } },
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'message' },
      { id: 'e2', source: 'message', target: 'end' },
    ],
  }
}

function textFlow() {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'message', type: 'sendMessage', position: { x: 0, y: 0 }, data: { message: 'Seu pedido foi confirmado!' } },
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'message' },
      { id: 'e2', source: 'message', target: 'end' },
    ],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sendMessage node — modo Template (Fase 4)', () => {
  it('sends an approved template with literal (non-variable) values and persists the rendered body', async () => {
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-1', variable_count: 2, body_text: 'Olá {{1}}, pedido {{2}} confirmado.',
      meta_template_name: 'order_confirmation', language: 'pt_BR',
    })
    mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl', raw: {} })

    const flows = builder({ data: { json: templateFlow('tpl-1', { '1': 'João', '2': '#123' }), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    })

    expect(mockLoadWhatsAppTemplateById).toHaveBeenCalledWith('tpl-1')
    expect(mockDispatchSendTemplate).toHaveBeenCalledWith(
      'wa-1', '34600000000@s.whatsapp.net', 'order_confirmation', 'pt_BR', ['João', '#123']
    )
    expect(messages.calls.inserted[0]).toMatchObject({
      content: 'Olá João, pedido #123 confirmado.',
      type: 'text',
      wa_message_id: 'wamid.tpl',
      direction: 'outbound',
    })
    expect(mockDispatchSendText).not.toHaveBeenCalled()
  })

  it('resolves {{variavel}} FlashFlow references inside the variable map through the normal rendering engine', async () => {
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-1', variable_count: 1, body_text: 'Seu numero e {{1}}.',
      meta_template_name: 'confirm_number', language: 'pt_BR',
    })
    mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.tpl2', raw: {} })

    const flows = builder({ data: { json: templateFlow('tpl-1', { '1': '{{contato.numero}}' }), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const conversation = builder({
      data: { id: 'conv-1', instance_name: 'wa-1', contact_name: 'Maria', contact_phone: '34600000000' },
      error: null,
    })
    const customVars = builder({ data: [], error: null })
    const messages = builder()
    const conversationsUpdate = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      conversations: [conversation, conversationsUpdate],
      message_variables: [customVars],
      messages: [messages],
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    })

    expect(mockDispatchSendTemplate).toHaveBeenCalledWith(
      'wa-1', '34600000000@s.whatsapp.net', 'confirm_number', 'pt_BR', ['34600000000']
    )
  })

  it('renders and persists the template locally without sending when there is no real-send target (sandbox)', async () => {
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-1', variable_count: 0, body_text: 'Oi, tudo bem?',
      meta_template_name: 'greeting', language: 'pt_BR',
    })

    const flows = builder({ data: { json: templateFlow('tpl-1', {}), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', {
      instanceName: '__sandbox__',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
      isSandbox: true,
    })

    expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
    expect(messages.calls.inserted[0]).toMatchObject({ content: 'Oi, tudo bem?', wa_message_id: null })
  })

  it('throws when the referenced template no longer exists', async () => {
    mockLoadWhatsAppTemplateById.mockResolvedValue(null)
    const flows = builder({ data: { json: templateFlow('tpl-deleted', {}), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    setQueues({ flows: [flows], instance_ai_config: [config] })

    await expect(executeFlow('flow-1', {
      instanceName: 'wa-1', remoteJid: '346@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: '',
    })).rejects.toThrow('não encontrado')
  })
})

describe('sendMessage node — janela de 24h para texto livre (Fase 4)', () => {
  it('creates a notification instead of sending when the cloud_api destination is outside the 24h window', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(false)

    const flows = builder({ data: { json: textFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const notifications = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], notifications: [notifications] })

    await executeFlow('flow-1', {
      instanceName: 'wa-1', remoteJid: '346@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: '',
    })

    expect(mockDispatchSendText).not.toHaveBeenCalled()
    expect(notifications.calls.inserted[0]).toMatchObject({
      instance_name: 'wa-1',
      type: 'flow',
      title: 'Fora da janela de 24h',
      conversation_id: 'conv-1',
      flow_id: 'flow-1',
      flow_node_id: 'message',
    })
  })

  it('sends normally on an evolution account, never even checking the messaging window', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockDispatchSendText.mockResolvedValue({ waMessageId: 'msg-1', raw: {} })

    const flows = builder({ data: { json: textFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', {
      instanceName: 'wa-1', remoteJid: '346@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: '',
    })

    expect(mockIsWithinMessagingWindow).not.toHaveBeenCalled()
    expect(mockDispatchSendText).toHaveBeenCalled()
  })

  it('sends normally on a cloud_api account when within the 24h window', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(true)
    mockDispatchSendText.mockResolvedValue({ waMessageId: 'msg-1', raw: {} })

    const flows = builder({ data: { json: textFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', {
      instanceName: 'wa-1', remoteJid: '346@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: '',
    })

    expect(mockDispatchSendText).toHaveBeenCalled()
  })

  it('skips the messaging-window check entirely for a sandbox conversation without a real-send target', async () => {
    const flows = builder({ data: { json: textFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', {
      instanceName: '__sandbox__', remoteJid: '346@s.whatsapp.net', conversationId: 'conv-1', incomingMessage: '',
      isSandbox: true,
    })

    expect(mockGetAccountProvider).not.toHaveBeenCalled()
    expect(mockIsWithinMessagingWindow).not.toHaveBeenCalled()
  })
})

function fallbackFlow(nodeData: Record<string, unknown>, options: { withFollowUp?: boolean } = {}) {
  const followUp = options.withFollowUp !== false
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'message', type: 'sendMessage', position: { x: 0, y: 0 }, data: nodeData },
      ...(followUp
        ? [{ id: 'next', type: 'sendMessage', position: { x: 0, y: 0 }, data: { message: 'Obrigado pela confirmação!' } }]
        : []),
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'message' },
      { id: 'e2', source: 'message', target: followUp ? 'next' : 'end' },
      ...(followUp ? [{ id: 'e3', source: 'next', target: 'end' }] : []),
    ],
  }
}

describe('sendMessage node — template de fallback fora da janela de 24h', () => {
  const ctx = { instanceName: 'wa-1', remoteJid: '5511999999999', conversationId: 'conv-1', incomingMessage: '' }

  it('sends the fallback template instead of notifying, and pauses the flow until the customer replies', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(false)
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-1', variable_count: 1, body_text: 'Olá {{1}}, confirma seu pedido?',
      meta_template_name: 'order_confirmation', language: 'pt_BR', buttons: [],
    })
    mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.fb', raw: {} })

    const flow = fallbackFlow({
      message: 'Seu pedido foi confirmado!',
      fallbackTemplateId: 'tpl-1',
      fallbackTemplateVariableMap: { '1': 'Maria' },
    })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    const flowRuns = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations], flow_runs: [flowRuns] })

    await executeFlow('flow-1', ctx)

    expect(mockDispatchSendText).not.toHaveBeenCalled()
    expect(mockDispatchSendTemplate).toHaveBeenCalledWith('wa-1', '5511999999999', 'order_confirmation', 'pt_BR', ['Maria'])
    expect(messages.calls.inserted[0]).toMatchObject({ content: 'Olá Maria, confirma seu pedido?', wa_message_id: 'wamid.fb' })
    expect(flowRuns.calls.upserted[0]).toMatchObject({
      flow_id: 'flow-1',
      node_id: 'next',
      status: 'waiting_confirmation',
      variables: { replyButtons: [] },
    })
  })

  it('maps template quick-reply buttons to the node reply buttons by position, using the button id as payload', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(false)
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-2', variable_count: 0, body_text: 'Confirma seu pedido?',
      meta_template_name: 'confirm_buttons', language: 'es',
      // O botão de URL ocupa o índice 1: o payload do segundo quick reply
      // tem que usar o índice real (2), não a posição entre os quick replies.
      buttons: [
        { type: 'QUICK_REPLY', text: 'Sí, confirmo' },
        { type: 'URL', text: 'Ver pedido', url: 'https://example.com' },
        { type: 'QUICK_REPLY', text: 'No, cancelar' },
      ],
    })
    mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.btn', raw: {} })

    const flow = fallbackFlow({
      message: 'Confirma seu pedido?',
      replyButtons: [{ id: 'btn-yes', label: 'Confirmar' }, { id: 'btn-no', label: 'Cancelar' }],
      fallbackTemplateId: 'tpl-2',
    })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    const flowRuns = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations], flow_runs: [flowRuns] })

    await executeFlow('flow-1', ctx)

    expect(mockDispatchSendTemplate).toHaveBeenCalledWith(
      'wa-1', '5511999999999', 'confirm_buttons', 'es', [],
      { quickReplyPayloads: [{ index: 0, payload: 'btn-yes' }, { index: 2, payload: 'btn-no' }] }
    )
    // O run pausado guarda os botões do node (id + label), que é o que
    // normalizeReplyWithPayload usa para traduzir o toque no label esperado
    // pelos nós seguintes.
    expect(flowRuns.calls.upserted[0]).toMatchObject({
      node_id: 'next',
      variables: { replyButtons: [{ id: 'btn-yes', label: 'Confirmar' }, { id: 'btn-no', label: 'Cancelar' }] },
    })
  })

  it('does not pause when the fallback message is the last step of the flow', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(false)
    mockLoadWhatsAppTemplateById.mockResolvedValue({
      id: 'tpl-1', variable_count: 0, body_text: 'Seu pedido saiu para entrega.',
      meta_template_name: 'shipped', language: 'pt_BR', buttons: [],
    })
    mockDispatchSendTemplate.mockResolvedValue({ waMessageId: 'wamid.last', raw: {} })

    const flow = fallbackFlow({ message: 'Seu pedido saiu!', fallbackTemplateId: 'tpl-1' }, { withFollowUp: false })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    // Sem fila para flow_runs: qualquer tentativa de pausar lançaria
    // "Unexpected table flow_runs" e falharia o teste.
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', ctx)

    expect(mockDispatchSendTemplate).toHaveBeenCalled()
  })

  it('keeps sending free text inside the 24h window even when a fallback template is configured', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(true)
    mockDispatchSendText.mockResolvedValue({ waMessageId: 'msg-1', raw: {} })

    const flow = fallbackFlow({ message: 'Seu pedido foi confirmado!', fallbackTemplateId: 'tpl-1' }, { withFollowUp: false })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', ctx)

    expect(mockDispatchSendText).toHaveBeenCalledWith('wa-1', '5511999999999', 'Seu pedido foi confirmado!')
    expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
  })

  it('ignores the fallback template on an evolution account', async () => {
    mockGetAccountProvider.mockResolvedValue('evolution')
    mockDispatchSendText.mockResolvedValue({ waMessageId: 'msg-1', raw: {} })

    const flow = fallbackFlow({ message: 'Seu pedido foi confirmado!', fallbackTemplateId: 'tpl-1' }, { withFollowUp: false })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({ flows: [flows], instance_ai_config: [config], messages: [messages], conversations: [conversations] })

    await executeFlow('flow-1', ctx)

    expect(mockIsWithinMessagingWindow).not.toHaveBeenCalled()
    expect(mockDispatchSendText).toHaveBeenCalled()
    expect(mockDispatchSendTemplate).not.toHaveBeenCalled()
  })

  it('fails loudly when the configured fallback template no longer exists', async () => {
    mockGetAccountProvider.mockResolvedValue('cloud_api')
    mockIsWithinMessagingWindow.mockResolvedValue(false)
    mockLoadWhatsAppTemplateById.mockResolvedValue(null)

    const flow = fallbackFlow({ message: 'Oi', fallbackTemplateId: 'tpl-deleted' })
    const flows = builder({ data: { json: flow, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    setQueues({ flows: [flows], instance_ai_config: [config] })

    await expect(executeFlow('flow-1', ctx)).rejects.toThrow('não encontrado')
  })
})
