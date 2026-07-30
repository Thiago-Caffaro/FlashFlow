export {}

const supabaseMock = { from: jest.fn() }
const mockFetchEvolution = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

jest.mock('@/lib/evolution-api', () => ({
  fetchEvolution: mockFetchEvolution,
}))

jest.mock('@/lib/ai-crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result = { data: null, error: null }) {
  const calls = {
    inserted: [] as unknown[],
    updated: [] as unknown[],
    upserted: [] as unknown[],
    deleted: false,
  }
  const chain: Record<string, jest.Mock | unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.single = jest.fn(async () => result)
  chain.maybeSingle = jest.fn(async () => result)
  chain.insert = jest.fn((value: unknown) => {
    calls.inserted.push(value)
    return chain
  })
  chain.update = jest.fn((value: unknown) => {
    calls.updated.push(value)
    return chain
  })
  chain.upsert = jest.fn((value: unknown) => {
    calls.upserted.push(value)
    return chain
  })
  chain.delete = jest.fn(() => {
    calls.deleted = true
    return chain
  })
  chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
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
const { executeFlow, sendWhatsAppReplyOptions } = require('@/lib/flow-engine')

const flowJson = {
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'message',
      type: 'sendMessage',
      position: { x: 0, y: 0 },
      data: {
        messageTitle: 'Confirme',
        message: 'Seu pedido esta correto?',
        footer: 'Selecione uma opcao',
        replyButtons: [
          { id: 'confirm', label: 'CONFIRMAR PEDIDO' },
          { id: 'change', label: 'MODIFICAR DADOS' },
        ],
      },
    },
    {
      id: 'switch',
      type: 'switchCase',
      position: { x: 0, y: 0 },
      data: {
        cases: [{ id: 'case-1', conditionType: 'exact', value: 'CONFIRMAR PEDIDO' }],
      },
    },
    { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'message' },
    { id: 'e2', source: 'message', target: 'switch' },
    { id: 'e3', source: 'switch', sourceHandle: 'case-0', target: 'end' },
  ],
}

function imageFlow(combineImageAndMessage?: boolean) {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'message',
        type: 'sendMessage',
        position: { x: 0, y: 0 },
        data: {
          message: 'Legenda da imagem',
          images: [{ id: 'image-1', url: 'https://example.com/image.jpg', filename: 'image.jpg' }],
          ...(combineImageAndMessage === undefined ? {} : { combineImageAndMessage }),
        },
      },
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'message' },
      { id: 'e2', source: 'message', target: 'end' },
    ],
  }
}

function imageReplyFlow() {
  const json = imageFlow()
  json.nodes[1].data = {
    ...json.nodes[1].data,
    messageTitle: 'Confirme',
    footer: 'Selecione',
    replyButtons: [{ id: 'confirm', label: 'CONFIRMAR' }],
  }
  json.nodes.splice(2, 0, {
    id: 'switch',
    type: 'switchCase',
    position: { x: 0, y: 0 },
    data: { cases: [{ id: 'case-1', conditionType: 'exact', value: 'CONFIRMAR' }] },
  })
  json.edges[1] = { id: 'e2', source: 'message', target: 'switch' }
  json.edges.push({ id: 'e3', source: 'switch', target: 'end' })
  return json
}

describe('interactive flow execution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EVOLUTION_REPLY_BUTTONS_ENABLED = 'false'
  })

  it('sends text fallback and pauses at the following Switch Case', async () => {
    const flows = builder({ data: { json: flowJson, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    const runs = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      messages: [messages],
      conversations: [conversations],
      flow_runs: [runs],
    })

    await executeFlow('flow-1', {
      instanceName: '__sandbox__',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
      isSandbox: true,
      orderId: 'order-1',
    })

    expect(mockFetchEvolution).not.toHaveBeenCalled()
    expect(messages.calls.inserted[0]).toMatchObject({
      content: '*Confirme*\n\nSeu pedido esta correto?\n\nSelecione uma opcao\n\n1. CONFIRMAR PEDIDO\n2. MODIFICAR DADOS',
    })
    expect(runs.calls.upserted[0]).toMatchObject({
      status: 'waiting_confirmation',
      node_id: 'switch',
      variables: {
        orderId: 'order-1',
        replyButtons: flowJson.nodes[1].data.replyButtons,
      },
    })
  })

  it('resumes the Switch Case and removes the completed flow run', async () => {
    const flows = builder({ data: { json: flowJson, ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const runs = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      flow_runs: [runs],
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: 'CONFIRMAR PEDIDO',
      flowRunId: 'run-1',
      orderId: 'order-1',
    }, 'switch')

    expect(runs.calls.deleted).toBe(true)
    expect(runs.chain.eq).toHaveBeenCalledWith('id', 'run-1')
  })

  it('sends the message as the first image caption by default', async () => {
    mockFetchEvolution.mockResolvedValue({
      ok: true,
      status: 201,
      body: { key: { id: 'media-1' } },
      text: '{}',
    })
    const flows = builder({ data: { json: imageFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      messages: [messages],
      conversations: [conversations],
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    })

    expect(mockFetchEvolution).toHaveBeenCalledTimes(1)
    expect(mockFetchEvolution.mock.calls[0][0]).toBe('/message/sendMedia/wa-1')
    expect(JSON.parse(mockFetchEvolution.mock.calls[0][1].body)).toMatchObject({
      media: 'https://example.com/image.jpg',
      caption: 'Legenda da imagem',
    })
    expect(messages.calls.inserted[0]).toMatchObject({
      content: 'https://example.com/image.jpg\nLegenda da imagem',
      type: 'image',
    })
  })

  it('sends image and message separately when the option is disabled', async () => {
    mockFetchEvolution.mockResolvedValue({
      ok: true,
      status: 201,
      body: { key: { id: 'message-1' } },
      text: '{}',
    })
    const flows = builder({ data: { json: imageFlow(false), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      messages: [builder(), builder()],
      conversations: [builder(), builder()],
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    })

    expect(mockFetchEvolution).toHaveBeenCalledTimes(2)
    expect(mockFetchEvolution.mock.calls[0][0]).toBe('/message/sendMedia/wa-1')
    expect(JSON.parse(mockFetchEvolution.mock.calls[0][1].body)).not.toHaveProperty('caption')
    expect(mockFetchEvolution.mock.calls[1][0]).toBe('/message/sendText/wa-1')
  })

  it('uses the image caption for textual reply options and still pauses the flow', async () => {
    const flows = builder({ data: { json: imageReplyFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    const runs = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      messages: [messages],
      conversations: [conversations],
      flow_runs: [runs],
    })

    await executeFlow('flow-1', {
      instanceName: '__sandbox__',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
      isSandbox: true,
    })

    expect(messages.calls.inserted).toHaveLength(1)
    expect(messages.calls.inserted[0]).toMatchObject({
      type: 'image',
      content: 'https://example.com/image.jpg\n*Confirme*\n\nLegenda da imagem\n\nSelecione\n\n1. CONFIRMAR',
    })
    expect(runs.calls.upserted[0]).toMatchObject({
      status: 'waiting_confirmation',
      node_id: 'switch',
    })
  })

  it('uses the first image as the native reply message thumbnail', async () => {
    process.env.EVOLUTION_REPLY_BUTTONS_ENABLED = 'true'
    mockFetchEvolution.mockResolvedValue({
      ok: true,
      status: 201,
      body: { key: { id: 'interactive-1' } },
      text: '{}',
    })
    const flows = builder({ data: { json: imageReplyFlow(), ativo: true }, error: null })
    const config = builder({ data: null, error: null })
    const messages = builder()
    const conversations = builder()
    const runs = builder()
    setQueues({
      flows: [flows],
      instance_ai_config: [config],
      messages: [messages],
      conversations: [conversations],
      flow_runs: [runs],
    })

    await executeFlow('flow-1', {
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    })

    expect(mockFetchEvolution).toHaveBeenCalledTimes(1)
    expect(mockFetchEvolution.mock.calls[0][0]).toBe('/message/sendButtons/wa-1')
    expect(JSON.parse(mockFetchEvolution.mock.calls[0][1].body)).toMatchObject({
      thumbnailUrl: 'https://example.com/image.jpg',
      buttons: [{ type: 'reply', displayText: 'CONFIRMAR', id: 'confirm' }],
    })
    expect(messages.calls.inserted[0]).toMatchObject({
      type: 'image',
      content: expect.stringContaining('https://example.com/image.jpg\n'),
    })
    expect(runs.calls.upserted[0]).toMatchObject({
      status: 'waiting_confirmation',
      node_id: 'switch',
    })
  })

  it('uses Evolution native buttons only when explicitly enabled', async () => {
    process.env.EVOLUTION_REPLY_BUTTONS_ENABLED = 'true'
    mockFetchEvolution.mockResolvedValue({
      ok: true,
      status: 201,
      body: { key: { id: 'wa-message-1' } },
      text: '{}',
    })
    const messages = builder()
    const conversations = builder()
    setQueues({ messages: [messages], conversations: [conversations] })

    await sendWhatsAppReplyOptions({
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    }, {
      title: 'Confirme',
      message: 'Pedido correto?',
      footer: 'Selecione',
      replyButtons: [{ id: 'confirm', label: 'CONFIRMAR' }],
    })

    expect(mockFetchEvolution).toHaveBeenCalledWith(
      '/message/sendButtons/wa-1',
      expect.objectContaining({ method: 'POST' }),
      15_000
    )
    const requestBody = JSON.parse(mockFetchEvolution.mock.calls[0][1].body)
    expect(requestBody.buttons).toEqual([
      { type: 'reply', displayText: 'CONFIRMAR', id: 'confirm' },
    ])
  })

  it('falls back to numbered text if Evolution rejects the native request', async () => {
    process.env.EVOLUTION_REPLY_BUTTONS_ENABLED = 'true'
    mockFetchEvolution
      .mockResolvedValueOnce({ ok: false, status: 500, body: null, text: 'failed' })
      .mockResolvedValueOnce({ ok: true, status: 201, body: { key: { id: 'text-1' } }, text: '{}' })
    const messages = builder()
    const conversations = builder()
    setQueues({ messages: [messages], conversations: [conversations] })

    await sendWhatsAppReplyOptions({
      instanceName: 'wa-1',
      remoteJid: '34600000000@s.whatsapp.net',
      conversationId: 'conv-1',
      incomingMessage: '',
    }, {
      title: '',
      message: 'Pedido correto?',
      footer: '',
      replyButtons: [{ id: 'confirm', label: 'CONFIRMAR' }],
    })

    expect(mockFetchEvolution.mock.calls[0][0]).toBe('/message/sendButtons/wa-1')
    expect(mockFetchEvolution.mock.calls[1][0]).toBe('/message/sendText/wa-1')
    expect(messages.calls.inserted[0]).toMatchObject({
      content: 'Pedido correto?\n\n1. CONFIRMAR',
    })
  })
})
