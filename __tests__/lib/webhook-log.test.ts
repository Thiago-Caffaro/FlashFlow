import { getWebhookLogs, logWebhookEvent } from '@/lib/webhook-log'

describe('logWebhookEvent', () => {
  it('mascara campos sensíveis conhecidos (remoteJid, conversation, pushName) antes de guardar', () => {
    logWebhookEvent('messages.upsert', 'inst-a', {
      key: { remoteJid: '5521999998888@s.whatsapp.net', id: 'msg-1' },
      message: { conversation: 'meu cartão é 1234 5678 9999 0000' },
      pushName: 'João da Silva',
    })

    const [entry] = getWebhookLogs()
    expect(entry.data).not.toContain('5521999998888')
    expect(entry.data).not.toContain('meu cartão')
    expect(entry.data).not.toContain('João da Silva')
    expect(entry.data).toContain('[redacted]')
    // Estrutura/metadados não sensíveis continuam visíveis para diagnóstico
    expect(entry.data).toContain('msg-1')
  })

  it('mantém no máximo 30 entradas (mais recente primeiro)', () => {
    for (let i = 0; i < 35; i++) {
      logWebhookEvent('connection.update', 'inst-a', { seq: i })
    }
    const logs = getWebhookLogs()
    expect(logs.length).toBe(30)
    expect(logs[0].data).toContain('"seq":34')
  })
})
