/**
 * Testes para lib/flow-engine.ts — resolveRealSendTarget (P15 da varredura
 * de segurança): a barreira que impede o sandbox de enviar mensagens reais
 * fica amarrada ao instanceName, não só à flag isSandbox.
 */

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
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
const { resolveRealSendTarget } = require('@/lib/flow-engine')

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
