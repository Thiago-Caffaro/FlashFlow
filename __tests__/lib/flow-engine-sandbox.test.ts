/**
 * Testes para lib/flow-engine.ts — resolveRealSendTarget (P15 da varredura
 * de segurança): a barreira que impede o sandbox de enviar mensagens reais
 * fica amarrada ao instanceName, não só à flag isSandbox.
 */

const supabaseMock = { from: jest.fn() }
const mockFetchEvolution = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

jest.mock('@/lib/evolution-api', () => ({
  fetchEvolution: mockFetchEvolution,
}))

jest.mock('@/lib/ai-crypto', () => ({
  decrypt: jest.fn(),
}))

jest.mock('@/lib/fulfillment-service', () => ({
  getCountryForInstance: jest.fn(),
  getFulfillmentClient: jest.fn(),
  refreshFulfillmentOrder: jest.fn(),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.EVOLUTION_API_URL = 'http://localhost:8080'
process.env.EVOLUTION_API_KEY = 'test-key'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveRealSendTarget, sendWhatsApp, checkActiveSandboxFlowRunForRealInstance } = require('@/lib/flow-engine')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SANDBOX_INSTANCE_NAME } = require('@/lib/sandbox')

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    instanceName: 'inst-a',
    remoteJid: '5521999999999@s.whatsapp.net',
    conversationId: 'conv-1',
    incomingMessage: 'oi',
    ...overrides,
  }
}

describe('resolveRealSendTarget', () => {
  it('envia normalmente para uma instância real', () => {
    expect(resolveRealSendTarget(ctx({ instanceName: 'inst-a' }))).toBe('inst-a')
  })

  it('nunca envia para a instância sandbox quando isSandbox não foi setado (esquecido pelo chamador)', () => {
    expect(resolveRealSendTarget(ctx({ instanceName: '__sandbox__' }))).toBeUndefined()
  })

  it('nunca envia para a instância sandbox quando isSandbox=true mas realSendInstanceName está ausente', () => {
    expect(
      resolveRealSendTarget(ctx({ instanceName: '__sandbox__', isSandbox: true }))
    ).toBeUndefined()
  })

  it('nunca envia quando isSandbox=false mesmo com realSendInstanceName presente', () => {
    expect(
      resolveRealSendTarget(ctx({ instanceName: '__sandbox__', isSandbox: false, realSendInstanceName: 'inst-real' }))
    ).toBeUndefined()
  })

  it('envia de verdade só quando isSandbox=true E realSendInstanceName foi resolvido pelo servidor', () => {
    expect(
      resolveRealSendTarget(ctx({ instanceName: '__sandbox__', isSandbox: true, realSendInstanceName: 'inst-real' }))
    ).toBe('inst-real')
  })

  it('isSandbox=true em uma instância que não é a sandbox não tem efeito — envia normalmente', () => {
    expect(resolveRealSendTarget(ctx({ instanceName: 'inst-a', isSandbox: true }))).toBe('inst-a')
  })
})

describe('flow WhatsApp delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not persist a flow message as sent when Evolution returns an HTTP error', async () => {
    mockFetchEvolution.mockResolvedValue({
      ok: false,
      status: 503,
      body: { error: 'unavailable' },
      text: 'unavailable',
    })
    // dispatchSendText resolve o provedor via lib/whatsapp-account-provider.ts
    // (SELECT em accounts) antes de tentar enviar — não envolve messages/conversations.
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'accounts') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    await expect(sendWhatsApp(ctx(), 'hello')).rejects.toThrow('503')

    expect(supabaseMock.from).not.toHaveBeenCalledWith('messages')
    expect(supabaseMock.from).not.toHaveBeenCalledWith('conversations')
  })
})

// Um flow pausado no Sandbox mas entregue de verdade pela instância real
// (via realSendInstanceName) grava seu flow_runs com instance_name
// "__sandbox__" — a resposta do cliente chega pelo webhook da instância
// real, então checkActiveFlowRun(instanceName real, remoteJid) nunca acha
// essa linha e o fluxo fica travado em "waiting_confirmation" pra sempre.
// checkActiveSandboxFlowRunForRealInstance cobre esse caso.
describe('checkActiveSandboxFlowRunForRealInstance', () => {
  const remoteJid = '5521999999999@s.whatsapp.net'

  function mockFlowRunsQuery(flowRun: Record<string, unknown> | null) {
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: flowRun }),
            }),
          }),
        }),
      }),
    }
  }

  function mockConversationsQuery(conversation: Record<string, unknown> | null) {
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: conversation }),
        }),
      }),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('nunca consulta nada quando o instanceName já é a própria sandbox', async () => {
    const result = await checkActiveSandboxFlowRunForRealInstance(SANDBOX_INSTANCE_NAME, remoteJid)
    expect(result).toBeNull()
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('retorna null quando não há flow_run de sandbox pausado para esse remoteJid', async () => {
    supabaseMock.from.mockImplementation((table: string) =>
      table === 'flow_runs' ? mockFlowRunsQuery(null) : mockConversationsQuery(null)
    )
    const result = await checkActiveSandboxFlowRunForRealInstance('thiago', remoteJid)
    expect(result).toBeNull()
  })

  it('retorna null quando a conversa da sandbox não tem envio real habilitado', async () => {
    const flowRun = { id: 'run-1', conversation_id: 'conv-sandbox-1', flow_id: 'flow-1' }
    supabaseMock.from.mockImplementation((table: string) =>
      table === 'flow_runs'
        ? mockFlowRunsQuery(flowRun)
        : mockConversationsQuery({ id: 'conv-sandbox-1', sandbox_real_send_enabled: false, sandbox_source_instance: 'thiago' })
    )
    const result = await checkActiveSandboxFlowRunForRealInstance('thiago', remoteJid)
    expect(result).toBeNull()
  })

  it('retorna null quando o envio real da conversa aponta para outra instância', async () => {
    const flowRun = { id: 'run-1', conversation_id: 'conv-sandbox-1', flow_id: 'flow-1' }
    supabaseMock.from.mockImplementation((table: string) =>
      table === 'flow_runs'
        ? mockFlowRunsQuery(flowRun)
        : mockConversationsQuery({ id: 'conv-sandbox-1', sandbox_real_send_enabled: true, sandbox_source_instance: 'outra-instancia' })
    )
    const result = await checkActiveSandboxFlowRunForRealInstance('thiago', remoteJid)
    expect(result).toBeNull()
  })

  it('retorna o flow_run de sandbox quando a conversa tem envio real habilitado apontando pra essa instância', async () => {
    const flowRun = { id: 'run-1', conversation_id: 'conv-sandbox-1', flow_id: 'flow-1', node_id: 'switchCase-1' }
    supabaseMock.from.mockImplementation((table: string) =>
      table === 'flow_runs'
        ? mockFlowRunsQuery(flowRun)
        : mockConversationsQuery({ id: 'conv-sandbox-1', sandbox_real_send_enabled: true, sandbox_source_instance: 'thiago' })
    )
    const result = await checkActiveSandboxFlowRunForRealInstance('thiago', remoteJid)
    expect(result).toEqual(flowRun)
  })
})
