/**
 * Testes unitários para app/api/whatsapp-cloud/templates/route.ts (GET) e
 * app/api/whatsapp-cloud/templates/sync/route.ts (POST).
 */

import { NextRequest } from 'next/server'

const mockLoadWhatsAppTemplates = jest.fn()
const mockSyncWhatsAppTemplates = jest.fn()
jest.mock('@/lib/whatsapp-templates', () => ({
  loadWhatsAppTemplates: (...args: unknown[]) => mockLoadWhatsAppTemplates(...args),
  syncWhatsAppTemplates: (...args: unknown[]) => mockSyncWhatsAppTemplates(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/whatsapp-cloud/templates/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/whatsapp-cloud/templates/sync/route')

describe('GET /api/whatsapp-cloud/templates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when instance query param is missing', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-cloud/templates')
    const res = await GET(req)
    expect(res.status).toBe(400)
    expect(mockLoadWhatsAppTemplates).not.toHaveBeenCalled()
  })

  it('loads templates for the given instance', async () => {
    mockLoadWhatsAppTemplates.mockResolvedValue([{ id: 't1', meta_template_name: 'order_confirmation' }])
    const req = new NextRequest('http://localhost/api/whatsapp-cloud/templates?instance=wa-1')
    const res = await GET(req)
    const json = await res.json()

    expect(mockLoadWhatsAppTemplates).toHaveBeenCalledWith('wa-1')
    expect(json).toEqual({ ok: true, templates: [{ id: 't1', meta_template_name: 'order_confirmation' }] })
  })

  it('returns 500 with the error message when loading fails', async () => {
    mockLoadWhatsAppTemplates.mockRejectedValue(new Error('Falha ao carregar templates: db down'))
    const req = new NextRequest('http://localhost/api/whatsapp-cloud/templates?instance=wa-1')
    const res = await GET(req)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('db down')
  })
})

describe('POST /api/whatsapp-cloud/templates/sync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function buildRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/whatsapp-cloud/templates/sync', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('returns 400 when instance is missing from the body', async () => {
    const res = await POST(buildRequest({}))
    expect(res.status).toBe(400)
    expect(mockSyncWhatsAppTemplates).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-cloud/templates/sync', {
      method: 'POST', body: '{invalid', headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('syncs templates for the given instance and returns the count', async () => {
    mockSyncWhatsAppTemplates.mockResolvedValue({ synced: 3, total: 3 })
    const res = await POST(buildRequest({ instance: 'wa-1' }))
    const json = await res.json()

    expect(mockSyncWhatsAppTemplates).toHaveBeenCalledWith('wa-1')
    expect(json).toEqual({ ok: true, synced: 3, total: 3 })
  })

  it('returns 500 with the error message when sync fails', async () => {
    mockSyncWhatsAppTemplates.mockRejectedValue(new Error('Falha ao sincronizar templates (401): Invalid token'))
    const res = await POST(buildRequest({ instance: 'wa-1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Invalid token')
  })
})
