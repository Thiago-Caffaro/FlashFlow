// Evolution API simulada para reproduzir falhas de forma determinística.
//
// Implementa só as rotas que o FlashFlow chama e permite injetar falhas por
// rota via POST /__config, por exemplo:
//   { "getBase64FromMediaMessage": { "mode": "error", "status": 404 } }
//   { "getBase64FromMediaMessage": { "mode": "delay", "ms": 5000 } }
//   { "getBase64FromMediaMessage": { "mode": "hang" } }
//   { "sendText": { "echoBeforeResponse": true } }  // eco do webhook antes da resposta
//   { "webhookUrl": "http://outro-flashflow:3000/api/webhook/evolution" }  // destino do eco
// GET /__calls lista as chamadas recebidas; POST /__reset limpa tudo.

import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 8080)
const API_KEY = process.env.EVOLUTION_API_KEY ?? ''
const WEBHOOK_URL = process.env.FLASHFLOW_WEBHOOK_URL ?? 'http://flashflow:3000/api/webhook/evolution'
const WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET ?? ''

// PNG 1x1 — mídia "baixada" com sucesso
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let config = {}
let calls = []

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({ raw }) }
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function applyFault(route, res) {
  const fault = config[route] ?? {}
  if (fault.mode === 'hang') return true // nunca responde
  if (fault.mode === 'delay') await sleep(Number(fault.ms ?? 3000))
  if (fault.mode === 'error') {
    send(res, Number(fault.status ?? 500), fault.body ?? { status: fault.status ?? 500, error: 'Injected', response: { message: ['injected failure'] } })
    return true
  }
  return false
}

async function postWebhook(event, instance, data) {
  const response = await fetch(config.webhookUrl ?? WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
    body: JSON.stringify({ event, instance, data }),
  })
  return response.status
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock')
  const body = req.method === 'POST' ? await readBody(req) : {}

  if (url.pathname === '/__config' && req.method === 'POST') { config = { ...config, ...body }; return send(res, 200, config) }
  if (url.pathname === '/__reset') { config = {}; calls = []; return send(res, 200, { ok: true }) }
  if (url.pathname === '/__calls') return send(res, 200, calls)
  if (url.pathname === '/health') return send(res, 200, { ok: true })

  calls.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, body })
  if (API_KEY && req.headers.apikey !== API_KEY) return send(res, 401, { status: 401, error: 'Unauthorized' })

  const [, group, action, instance] = url.pathname.split('/')
  const route = action

  if (await applyFault(route, res)) return

  if (group === 'chat' && action === 'getBase64FromMediaMessage') {
    return send(res, 200, { mediaType: 'imageMessage', fileName: 'x.png', mimetype: 'image/png', base64: PIXEL_PNG })
  }
  if (group === 'chat' && action === 'fetchProfilePictureUrl') {
    return send(res, 200, { wuid: `${body.number}@s.whatsapp.net`, profilePictureUrl: config.profilePictureUrl ?? null })
  }
  if (group === 'webhook' && action === 'set') return send(res, 201, { webhook: { instanceName: instance, enabled: true } })
  if (group === 'instance' && action === 'connectionState') {
    return send(res, 200, { instance: { instanceName: instance, state: config.state ?? 'open' } })
  }
  if (group === 'message' && (action === 'sendText' || action === 'sendMedia' || action === 'sendButtons')) {
    const id = `MOCK${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
    const remoteJid = String(body.number ?? '').includes('@') ? body.number : `${body.number}@s.whatsapp.net`
    // Reproduz a corrida: o WhatsApp ecoa a mensagem enviada (fromMe) pelo
    // webhook ANTES da Evolution devolver a resposta HTTP do envio.
    if (config[route]?.echoBeforeResponse) {
      const status = await postWebhook('messages.upsert', instance, {
        key: { id, remoteJid, fromMe: true },
        message: { conversation: body.text ?? '' },
        messageType: 'conversation',
      })
      calls.push({ at: new Date().toISOString(), echo: id, webhookStatus: status })
    }
    return send(res, 201, { key: { id, remoteJid, fromMe: true }, status: 'PENDING' })
  }
  return send(res, 404, { status: 404, error: 'Not Found', response: { message: [`mock: rota não implementada ${url.pathname}`] } })
})

server.listen(PORT, () => console.log(`[mock-evolution] ouvindo em :${PORT} → webhook ${WEBHOOK_URL}`))
