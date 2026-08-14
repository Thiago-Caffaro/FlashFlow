/**
 * Testes para lib/whatsapp-cloud-credentials.ts — CRUD criptografado das
 * credenciais por conta, mesmo padrão de lib/shopify-integration-store.ts.
 */
export {}

const mockEncryptSecret = jest.fn()
const mockDecryptSecret = jest.fn()
jest.mock('@/lib/ai-crypto', () => ({
  encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
  decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
}))

const supabaseMock = { from: jest.fn() }
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => supabaseMock),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  loadCloudCredentials,
  loadCloudCredentialsByPhoneNumberId,
  storeCloudCredentials,
  decodeCloudAccessToken,
  recordCloudSendError,
} = require('@/lib/whatsapp-cloud-credentials')

describe('whatsapp-cloud-credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('loadCloudCredentials', () => {
    it('queries by instance_name and returns the row', async () => {
      const row = { instance_name: 'wa-1', phone_number_id: '123' }
      supabaseMock.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
          }),
        }),
      })
      const result = await loadCloudCredentials('wa-1')
      expect(supabaseMock.from).toHaveBeenCalledWith('whatsapp_cloud_credentials')
      expect(result).toEqual(row)
    })

    it('throws a readable error on a DB failure', async () => {
      supabaseMock.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: 'conexão perdida' } }),
          }),
        }),
      })
      await expect(loadCloudCredentials('wa-1')).rejects.toThrow('conexão perdida')
    })

    it('returns null when no row matches (conta não é cloud_api ou não existe)', async () => {
      supabaseMock.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })
      expect(await loadCloudCredentials('wa-1')).toBeNull()
    })
  })

  describe('loadCloudCredentialsByPhoneNumberId', () => {
    it('queries by phone_number_id — o campo que o webhook usa para resolver a conta', async () => {
      const eqMock = jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data: { instance_name: 'wa-1' }, error: null }),
      })
      supabaseMock.from.mockReturnValue({ select: jest.fn().mockReturnValue({ eq: eqMock }) })

      await loadCloudCredentialsByPhoneNumberId('999888')
      expect(eqMock).toHaveBeenCalledWith('phone_number_id', '999888')
    })
  })

  describe('storeCloudCredentials', () => {
    it('encrypts the access token and inserts the encrypted trio, never the plain token', async () => {
      mockEncryptSecret.mockReturnValue({ encrypted_key: 'enc', iv: 'iv-val', auth_tag: 'tag-val' })
      const insertMock = jest.fn().mockResolvedValue({ error: null })
      supabaseMock.from.mockReturnValue({ insert: insertMock })

      await storeCloudCredentials({
        instanceName: 'wa-1',
        wabaId: 'waba-1',
        phoneNumberId: '123',
        accessToken: 'my-secret-token',
      })

      expect(mockEncryptSecret).toHaveBeenCalledWith('my-secret-token')
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        instance_name: 'wa-1',
        waba_id: 'waba-1',
        phone_number_id: '123',
        encrypted_access_token: 'enc',
        access_token_iv: 'iv-val',
        access_token_auth_tag: 'tag-val',
      }))
      const insertedPayload = insertMock.mock.calls[0][0]
      expect(JSON.stringify(insertedPayload)).not.toContain('my-secret-token')
    })

    it('throws a readable error on insert failure', async () => {
      mockEncryptSecret.mockReturnValue({ encrypted_key: 'enc', iv: 'iv', auth_tag: 'tag' })
      supabaseMock.from.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: { message: 'duplicate key' } }),
      })
      await expect(storeCloudCredentials({
        instanceName: 'wa-1', wabaId: 'w', phoneNumberId: '1', accessToken: 't',
      })).rejects.toThrow('duplicate key')
    })
  })

  describe('decodeCloudAccessToken', () => {
    it('decrypts using the encrypted trio of columns from the row', () => {
      mockDecryptSecret.mockReturnValue('plain-token')
      const row = { encrypted_access_token: 'enc', access_token_iv: 'iv', access_token_auth_tag: 'tag' }
      expect(decodeCloudAccessToken(row)).toBe('plain-token')
      expect(mockDecryptSecret).toHaveBeenCalledWith('enc', 'iv', 'tag')
    })
  })

  describe('recordCloudSendError', () => {
    it('updates last_error truncated to 500 chars for the right instance', async () => {
      const eqMock = jest.fn().mockResolvedValue({ error: null })
      const updateMock = jest.fn().mockReturnValue({ eq: eqMock })
      supabaseMock.from.mockReturnValue({ update: updateMock })

      const longMessage = 'x'.repeat(600)
      await recordCloudSendError('wa-1', longMessage)

      const updateArg = updateMock.mock.calls[0][0]
      expect(updateArg.last_error).toHaveLength(500)
      expect(eqMock).toHaveBeenCalledWith('instance_name', 'wa-1')
    })

    it('swallows a DB failure instead of throwing — best-effort, must not break the send path', async () => {
      supabaseMock.from.mockReturnValue({
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'boom' } }) }),
      })
      await expect(recordCloudSendError('wa-1', 'algum erro')).resolves.toBeUndefined()
    })
  })
})
