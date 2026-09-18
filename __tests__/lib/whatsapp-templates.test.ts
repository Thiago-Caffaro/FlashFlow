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
  mapTemplateEventToStatus,
  applyTemplateStatusUpdate,
  syncTemplatesForWaba,
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

describe('syncWhatsAppTemplates — motivo de rejeição', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('stores the rejection reason from Meta and treats "NONE" as no reason', async () => {
    mockLoadCloudCredentials.mockResolvedValue({ instance_name: 'wa-1', waba_id: 'waba-1' })
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      text: '{}',
      body: {
        data: [
          { id: 'a', name: 'rejeitado', language: 'pt_BR', status: 'REJECTED', rejected_reason: 'INCORRECT_CATEGORY', components: [{ type: 'BODY', text: 'x' }] },
          { id: 'b', name: 'aprovado', language: 'pt_BR', status: 'APPROVED', rejected_reason: 'NONE', components: [{ type: 'BODY', text: 'y' }] },
        ],
      },
    })
    const upsertMock = jest.fn().mockResolvedValue({ error: null })
    supabaseMock.from.mockReturnValue({ upsert: upsertMock })

    await syncWhatsAppTemplates('wa-1')

    expect(mockFetchCloudApi).toHaveBeenCalledWith(
      expect.stringContaining('rejected_reason'),
      'plain-token',
      { method: 'GET' },
      15_000
    )
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ meta_template_name: 'rejeitado', status: 'rejected', status_reason: 'INCORRECT_CATEGORY' })
    expect(upsertMock.mock.calls[1][0]).toMatchObject({ meta_template_name: 'aprovado', status: 'approved', status_reason: null })
  })
})

describe('mapTemplateEventToStatus', () => {
  it('maps the webhook events that change whether a template can be sent', () => {
    expect(mapTemplateEventToStatus('APPROVED')).toBe('approved')
    expect(mapTemplateEventToStatus('reinstated')).toBe('approved')
    expect(mapTemplateEventToStatus('REJECTED')).toBe('rejected')
    expect(mapTemplateEventToStatus('PENDING')).toBe('pending')
    expect(mapTemplateEventToStatus('IN_APPEAL')).toBe('pending')
    expect(mapTemplateEventToStatus('PAUSED')).toBe('paused')
    expect(mapTemplateEventToStatus('DISABLED')).toBe('disabled')
    expect(mapTemplateEventToStatus('DELETED')).toBe('disabled')
  })

  it('returns null for events that do not affect sendability, so the current status is kept', () => {
    expect(mapTemplateEventToStatus('FLAGGED')).toBeNull()
    expect(mapTemplateEventToStatus('LIMIT_EXCEEDED')).toBeNull()
    expect(mapTemplateEventToStatus('PENDING_DELETION')).toBeNull()
    expect(mapTemplateEventToStatus('')).toBeNull()
  })
})

describe('applyTemplateStatusUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function mockUpdate(result: { data: unknown; error: { message: string } | null }) {
    const selectMock = jest.fn().mockResolvedValue(result)
    const eqMock = jest.fn().mockReturnValue({ select: selectMock })
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock })
    supabaseMock.from.mockReturnValue({ update: updateMock })
    return { updateMock, eqMock }
  }

  it('updates status, reason and timestamps by the Meta template id', async () => {
    const { updateMock, eqMock } = mockUpdate({ data: [{ id: 'row-1' }], error: null })

    const result = await applyTemplateStatusUpdate({ metaTemplateId: '12345', event: 'REJECTED', reason: 'INVALID_FORMAT' })

    expect(result).toBe('updated')
    expect(eqMock).toHaveBeenCalledWith('meta_template_id', '12345')
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'rejected', status_reason: 'INVALID_FORMAT' })
    expect(updateMock.mock.calls[0][0].status_updated_at).toEqual(expect.any(String))
  })

  it('clears the reason on approval ("NONE" from Meta)', async () => {
    const { updateMock } = mockUpdate({ data: [{ id: 'row-1' }], error: null })

    await applyTemplateStatusUpdate({ metaTemplateId: '12345', event: 'APPROVED', reason: 'NONE' })

    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'approved', status_reason: null })
  })

  it('reports "unknown" when no local template matches, so the caller can sync', async () => {
    mockUpdate({ data: [], error: null })
    expect(await applyTemplateStatusUpdate({ metaTemplateId: '999', event: 'APPROVED', reason: null })).toBe('unknown')
  })

  it('ignores events that do not change sendability without touching the database', async () => {
    const result = await applyTemplateStatusUpdate({ metaTemplateId: '12345', event: 'FLAGGED', reason: null })
    expect(result).toBe('ignored')
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('throws when the database update fails', async () => {
    mockUpdate({ data: null, error: { message: 'boom' } })
    await expect(applyTemplateStatusUpdate({ metaTemplateId: '1', event: 'APPROVED', reason: null }))
      .rejects.toThrow('boom')
  })
})

describe('syncTemplatesForWaba', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDecodeCloudAccessToken.mockReturnValue('plain-token')
    mockFetchCloudApi.mockResolvedValue({
      ok: true,
      status: 200,
      text: '{}',
      body: { data: [{ id: 'a', name: 't', language: 'pt_BR', status: 'APPROVED', components: [{ type: 'BODY', text: 'x' }] }] },
    })
  })

  function mockTables(matching: Array<{ instance_name: string }>, all: Array<{ instance_name: string }>) {
    const upsertMock = jest.fn().mockResolvedValue({ error: null })
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'whatsapp_message_templates') return { upsert: upsertMock }
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: matching, error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: all, error: null }).then(resolve),
        }),
      }
    })
    mockLoadCloudCredentials.mockImplementation(async (instance: string) => ({ instance_name: instance, waba_id: 'waba-x' }))
    return upsertMock
  }

  it('syncs only the accounts that own the WABA id from the webhook entry', async () => {
    const upsertMock = mockTables([{ instance_name: 'wa-1' }], [{ instance_name: 'wa-1' }, { instance_name: 'wa-2' }])

    const synced = await syncTemplatesForWaba('waba-x')

    expect(synced).toBe(1)
    expect(mockLoadCloudCredentials).toHaveBeenCalledTimes(1)
    expect(mockLoadCloudCredentials).toHaveBeenCalledWith('wa-1')
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to every cloud_api account when the entry id is an alias we never stored', async () => {
    mockTables([], [{ instance_name: 'wa-1' }, { instance_name: 'wa-2' }])

    await syncTemplatesForWaba('outro-id-da-mesma-waba')

    expect(mockLoadCloudCredentials).toHaveBeenCalledWith('wa-1')
    expect(mockLoadCloudCredentials).toHaveBeenCalledWith('wa-2')
  })

  it('keeps going when one account fails to sync', async () => {
    mockTables([], [{ instance_name: 'wa-quebrada' }, { instance_name: 'wa-2' }])
    mockLoadCloudCredentials.mockImplementation(async (instance: string) => (
      instance === 'wa-quebrada' ? null : { instance_name: instance, waba_id: 'waba-x' }
    ))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const synced = await syncTemplatesForWaba('alias')

    expect(synced).toBe(1)
    errorSpy.mockRestore()
  })
})
