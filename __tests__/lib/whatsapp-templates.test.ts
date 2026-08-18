/**
 * Testes para lib/whatsapp-templates.ts — sincronização de templates
 * aprovados do WhatsApp Manager (Fase 4) e leitura local.
 */
export {}

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

const mockFetchCloudApi = jest.fn()
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  fetchCloudApi: (...args: unknown[]) => mockFetchCloudApi(...args),
}))

const mockLoadCloudCredentials = jest.fn()
const mockDecodeCloudAccessToken = jest.fn()
jest.mock('@/lib/whatsapp-cloud-credentials', () => ({
  loadCloudCredentials: (...args: unknown[]) => mockLoadCloudCredentials(...args),
  decodeCloudAccessToken: (...args: unknown[]) => mockDecodeCloudAccessToken(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  syncWhatsAppTemplates,
  loadWhatsAppTemplates,
  loadWhatsAppTemplateById,
} = require('@/lib/whatsapp-templates')

describe('syncWhatsAppTemplates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('throws when the account has no cloud_api credentials configured', async () => {
    mockLoadCloudCredentials.mockResolvedValue(null)
    await expect(syncWhatsAppTemplates('wa-1')).rejects.toThrow('não tem credenciais')
    expect(mockFetchCloudApi).not.toHaveBeenCalled()
  })

  it('fetches templates from the WABA and upserts each one, extracting components', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ instance_name: 'wa-1', waba_id: 'waba-1' })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      text: '{}',
      body: {
        data: [{
          id: 'tpl-meta-1',
          name: 'order_confirmation',
          language: 'pt_BR',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Pedido confirmado' },
            { type: 'BODY', text: 'Olá {{1}}, seu pedido {{2}} foi confirmado.' },
            { type: 'FOOTER', text: 'FlashFlow' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver pedido' }] },
          ],
        }],
      },
    })
    const upsertMock = jest.fn().mockResolvedValue({ error: null })
    supabaseMock.from.mockReturnValue({ upsert: upsertMock })

    const result = await syncWhatsAppTemplates('wa-1')

    expect(mockFetchCloudApi).toHaveBeenCalledWith(
      expect.stringContaining('/waba-1/message_templates'),
      'plain-token',
      { method: 'GET' },
      15_000
    )
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instance_name: 'wa-1',
        meta_template_id: 'tpl-meta-1',
        meta_template_name: 'order_confirmation',
        language: 'pt_BR',
        status: 'approved',
        body_text: 'Olá {{1}}, seu pedido {{2}} foi confirmado.',
        variable_count: 2,
        header_type: 'TEXT',
        footer_text: 'FlashFlow',
      }),
      { onConflict: 'instance_name,meta_template_name,language' }
    )
    expect(result).toEqual({ synced: 1, total: 1 })
  })

  it('normalizes an unknown status to pending instead of failing the constraint', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ instance_name: 'wa-1', waba_id: 'waba-1' })
    mockDecodeCloudAccessToken.mockReturnValue('token')
    mockFetchCloudApi.mockResolvedValue({
      ok: true, status: 200, text: '{}',
      body: { data: [{ name: 'tpl', language: 'pt_BR', status: 'ALGO_INESPERADO', components: [{ type: 'BODY', text: 'oi' }] }] },
    })
    const upsertMock = jest.fn().mockResolvedValue({ error: null })
    supabaseMock.from.mockReturnValue({ upsert: upsertMock })

    await syncWhatsAppTemplates('wa-1')

    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }), expect.anything())
  })

  it('skips entries without a name or language instead of upserting malformed rows', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ instance_name: 'wa-1', waba_id: 'waba-1' })
    mockDecodeCloudAccessToken.mockReturnValue('token')
    mockFetchCloudApi.mockResolvedValue({
      ok: true, status: 200, text: '{}',
      body: { data: [{ language: 'pt_BR', components: [] }] }, // sem name
    })
    const upsertMock = jest.fn().mockResolvedValue({ error: null })
    supabaseMock.from.mockReturnValue({ upsert: upsertMock })

    const result = await syncWhatsAppTemplates('wa-1')

    expect(upsertMock).not.toHaveBeenCalled()
    expect(result).toEqual({ synced: 0, total: 1 })
  })

  it('throws with a readable message when the Graph API call fails', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ instance_name: 'wa-1', waba_id: 'waba-1' })
    mockDecodeCloudAccessToken.mockReturnValue('token')
    mockFetchCloudApi.mockResolvedValue({ ok: false, status: 401, text: 'Invalid token', body: null })

    await expect(syncWhatsAppTemplates('wa-1')).rejects.toThrow('Falha ao sincronizar templates')
  })
})

describe('loadWhatsAppTemplates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('queries templates by instance_name ordered by name', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [{ id: 't1' }], error: null })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    supabaseMock.from.mockReturnValue({ select: selectMock })

    const result = await loadWhatsAppTemplates('wa-1')

    expect(eqMock).toHaveBeenCalledWith('instance_name', 'wa-1')
    expect(orderMock).toHaveBeenCalledWith('meta_template_name', { ascending: true })
    expect(result).toEqual([{ id: 't1' }])
  })
})

describe('loadWhatsAppTemplateById', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when the template does not exist', async () => {
    supabaseMock.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      }),
    })
    expect(await loadWhatsAppTemplateById('missing')).toBeNull()
  })
})
