/**
 * Testes para lib/whatsapp-cloud-client.ts — o único ponto que fala HTTP de
 * verdade com a Graph API da Meta. Como ainda não há um App Meta configurado
 * pra testar contra a API real, a URL/headers/corpo exatos importam mais
 * aqui do que em qualquer outro lugar da Fase 1.
 */
export {}

const fetchMock = jest.fn()
global.fetch = fetchMock

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendCloudText, sendCloudImage, sendCloudButtons, sendCloudTemplate, verifyCloudCredentials } = require('@/lib/whatsapp-cloud-client')

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('sendCloudText', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.WHATSAPP_CLOUD_API_VERSION
  })

  it('posts to the Graph API messages endpoint with the right auth header and body shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.ABC' }] }))

    const result = await sendCloudText('123456', 'token-abc', '5511999999999', 'olá mundo')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer token-abc')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'text',
      text: { body: 'olá mundo' },
    })
    expect(result).toEqual({ waMessageId: 'wamid.ABC', raw: { messages: [{ id: 'wamid.ABC' }] } })
  })

  it('uses WHATSAPP_CLOUD_API_VERSION when set, instead of the default', async () => {
    process.env.WHATSAPP_CLOUD_API_VERSION = 'v99.0'
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.X' }] }))

    await sendCloudText('123456', 'token', '5511999999999', 'oi')

    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v99.0/123456/messages')
  })

  it('throws with the readable Meta error message on failure, not the raw body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {
      error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 },
    }))

    await expect(sendCloudText('123456', 'bad-token', '5511999999999', 'oi'))
      .rejects.toThrow('Invalid OAuth access token')
  })

  it('propagates a network-level failure (e.g. timeout) instead of swallowing it', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValue(abortError)

    await expect(sendCloudText('123456', 'token', '5511999999999', 'oi')).rejects.toThrow('aborted')
  })
})

describe('sendCloudImage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts to the Graph API messages endpoint with image type and link', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.IMG' }] }))

    const result = await sendCloudImage('123456', 'token-abc', '5511999999999', 'https://cdn.example/img.jpg', 'legenda')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'image',
      image: { link: 'https://cdn.example/img.jpg', caption: 'legenda' },
    })
    expect(result).toEqual({ waMessageId: 'wamid.IMG', raw: { messages: [{ id: 'wamid.IMG' }] } })
  })

  it('omits caption from the payload when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.IMG2' }] }))

    await sendCloudImage('123456', 'token-abc', '5511999999999', 'https://cdn.example/img.jpg')

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'image',
      image: { link: 'https://cdn.example/img.jpg' },
    })
  })

  it('throws with the readable Meta error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: { message: 'Invalid image URL', type: 'OAuthException', code: 100 },
    }))

    await expect(sendCloudImage('123456', 'token', '5511999999999', 'https://cdn.example/bad.jpg'))
      .rejects.toThrow('Invalid image URL')
  })
})

describe('sendCloudButtons', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts an interactive button message with text header, body, footer and buttons', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.BTN' }] }))

    const result = await sendCloudButtons('123456', 'token-abc', '5511999999999', {
      headerText: 'Confirme',
      bodyText: 'Pedido correto?',
      footerText: 'Selecione uma opcao',
      buttons: [{ id: 'confirm', title: 'CONFIRMAR' }, { id: 'change', title: 'MODIFICAR' }],
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'text', text: 'Confirme' },
        body: { text: 'Pedido correto?' },
        footer: { text: 'Selecione uma opcao' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'confirm', title: 'CONFIRMAR' } },
            { type: 'reply', reply: { id: 'change', title: 'MODIFICAR' } },
          ],
        },
      },
    })
    expect(result).toEqual({ waMessageId: 'wamid.BTN', raw: { messages: [{ id: 'wamid.BTN' }] } })
  })

  it('uses an image header instead of text when headerImageUrl is provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.BTN2' }] }))

    await sendCloudButtons('123456', 'token', '5511999999999', {
      headerText: 'ignorado quando ha imagem',
      headerImageUrl: 'https://cdn.example/thumb.jpg',
      bodyText: 'oi',
      buttons: [{ id: 'a', title: 'A' }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.interactive.header).toEqual({ type: 'image', image: { link: 'https://cdn.example/thumb.jpg' } })
  })

  it('omits header and footer when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.BTN3' }] }))

    await sendCloudButtons('123456', 'token', '5511999999999', {
      bodyText: 'oi',
      buttons: [{ id: 'a', title: 'A' }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.interactive).not.toHaveProperty('header')
    expect(body.interactive).not.toHaveProperty('footer')
  })

  it('throws with the readable Meta error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: { message: 'Body text cannot be empty', type: 'OAuthException', code: 100 },
    }))

    await expect(sendCloudButtons('123456', 'token', '5511999999999', { bodyText: '', buttons: [] }))
      .rejects.toThrow('Body text cannot be empty')
  })
})

describe('sendCloudTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('posts a template message with body parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.TPL' }] }))

    const result = await sendCloudTemplate('123456', 'token-abc', '5511999999999', 'order_confirmation', 'pt_BR', ['João', '#123'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'template',
      template: {
        name: 'order_confirmation',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: '#123' }] }],
      },
    })
    expect(result).toEqual({ waMessageId: 'wamid.TPL', raw: { messages: [{ id: 'wamid.TPL' }] } })
  })

  it('omits components entirely when the template has no variables', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [{ id: 'wamid.TPL2' }] }))

    await sendCloudTemplate('123456', 'token', '5511999999999', 'welcome', 'pt_BR', [])

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.template).not.toHaveProperty('components')
  })

  it('throws with the readable Meta error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: { message: 'Template name does not exist', type: 'OAuthException', code: 132001 },
    }))

    await expect(sendCloudTemplate('123456', 'token', '5511999999999', 'inexistente', 'pt_BR', []))
      .rejects.toThrow('Template name does not exist')
  })
})

describe('verifyCloudCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('queries verified_name and display_phone_number with the bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      verified_name: 'Minha Loja',
      display_phone_number: '+55 11 99999-9999',
    }))

    const result = await verifyCloudCredentials('123456', 'token-abc')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/123456?fields=verified_name,display_phone_number')
    expect(init.headers.Authorization).toBe('Bearer token-abc')
    expect(result).toEqual({ verifiedName: 'Minha Loja', displayPhoneNumber: '+55 11 99999-9999' })
  })

  it('throws a readable error for invalid credentials instead of returning a falsy result', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: { message: 'Unsupported get request.', type: 'GraphMethodException', code: 100 },
    }))

    await expect(verifyCloudCredentials('wrong-id', 'token')).rejects.toThrow('Unsupported get request.')
  })
})
