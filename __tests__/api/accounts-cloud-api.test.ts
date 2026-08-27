/**
 * Testes unitários para app/api/accounts/cloud-api/route.ts
 */

import { NextRequest } from 'next/server'

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

const mockVerifyCloudCredentials = jest.fn()
jest.mock('@/lib/whatsapp-cloud-client', () => ({
  verifyCloudCredentials: (...args: unknown[]) => mockVerifyCloudCredentials(...args),
}))

const mockStoreCloudCredentials = jest.fn()
jest.mock('@/lib/whatsapp-cloud-credentials', () => ({
  storeCloudCredentials: (...args: unknown[]) => mockStoreCloudCredentials(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('@/app/api/accounts/cloud-api/route')

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/accounts/cloud-api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const validBody = {
  label: 'Suporte',
  country: 'PORTUGAL',
  phoneNumberId: '123456',
  wabaId: 'waba-1',
  accessToken: 'token-secreto',
}

/** accounts: sem duplicidade de nome; whatsapp_cloud_credentials: sem duplicidade de phone_number_id. */
function mockNoDuplicates() {
  const accountsInsert = jest.fn().mockResolvedValue({ error: null })
  const accountsDelete = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) })
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'accounts') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
        insert: accountsInsert,
        delete: accountsDelete,
      }
    }
    if (table === 'whatsapp_cloud_credentials') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      }
    }
    return undefined
  })
  return { accountsInsert, accountsDelete }
}

describe('POST /api/accounts/cloud-api', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyCloudCredentials.mockResolvedValue({ verifiedName: 'Minha Loja', displayPhoneNumber: '+551199999999' })
    mockStoreCloudCredentials.mockResolvedValue(undefined)
  })

  // ── Validação de campos obrigatórios ──────────────────────────────────────

  it('returns 400 when a required field is missing', async () => {
    const res = await POST(buildRequest({ label: 'Suporte', country: 'PORTUGAL' }))
    expect(res.status).toBe(400)
    expect(mockVerifyCloudCredentials).not.toHaveBeenCalled()
  })

  // ── Duplicidade ────────────────────────────────────────────────────────────

  it('returns 409 when an account with the same name already exists', async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'accounts') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { instance_name: 'suporte' }, error: null }) }),
          }),
        }
      }
      return undefined
    })
    const res = await POST(buildRequest(validBody))
    expect(res.status).toBe(409)
    expect(mockVerifyCloudCredentials).not.toHaveBeenCalled()
  })

  it('returns 409 when the phone_number_id is already connected to another account', async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'accounts') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        }
      }
      if (table === 'whatsapp_cloud_credentials') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { instance_name: 'outra-conta' }, error: null }) }),
          }),
        }
      }
      return undefined
    })
    const res = await POST(buildRequest(validBody))
    expect(res.status).toBe(409)
    expect(mockVerifyCloudCredentials).not.toHaveBeenCalled()
  })

  // ── Validação das credenciais contra a Meta ───────────────────────────────

  it('returns 400 and never inserts the account when Meta rejects the credentials', async () => {
    const { accountsInsert } = mockNoDuplicates()
    mockVerifyCloudCredentials.mockRejectedValue(new Error('Invalid OAuth access token'))

    const res = await POST(buildRequest(validBody))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid OAuth access token')
    expect(accountsInsert).not.toHaveBeenCalled()
    expect(mockStoreCloudCredentials).not.toHaveBeenCalled()
  })

  // ── Caminho feliz ──────────────────────────────────────────────────────────

  it('creates the account with provider=cloud_api and stores the credentials on success', async () => {
    const { accountsInsert } = mockNoDuplicates()

    const res = await POST(buildRequest(validBody))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ instanceName: 'suporte' })
    expect(accountsInsert).toHaveBeenCalledWith(expect.objectContaining({
      instance_name: 'suporte',
      label: 'Suporte',
      country: 'PORTUGAL',
      provider: 'cloud_api',
    }))
    expect(mockStoreCloudCredentials).toHaveBeenCalledWith(expect.objectContaining({
      instanceName: 'suporte',
      wabaId: 'waba-1',
      phoneNumberId: '123456',
      accessToken: 'token-secreto',
      verifiedName: 'Minha Loja',
      displayPhoneNumber: '+551199999999',
    }))
  })

  // ── Rollback ───────────────────────────────────────────────────────────────

  it('rolls back the account row when storing credentials fails after the account was inserted', async () => {
    const { accountsInsert, accountsDelete } = mockNoDuplicates()
    mockStoreCloudCredentials.mockRejectedValue(new Error('Falha ao salvar credenciais da WhatsApp Cloud API: duplicate key'))

    const res = await POST(buildRequest(validBody))

    expect(res.status).toBe(500)
    expect(accountsInsert).toHaveBeenCalled()
    expect(accountsDelete).toHaveBeenCalled()
  })
})
