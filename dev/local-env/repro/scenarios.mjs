// Reprodução A/B do ciclo de vida da mensagem.
//
// Roda os mesmos cenários contra duas versões do FlashFlow que compartilham
// o mesmo Supabase local e a mesma Evolution simulada, e compara o que ficou
// gravado no banco:
//   old → http://localhost:3101  (imagem construída da branch main)
//   new → http://localhost:3100  (código desta branch)
//
// Uso:  node dev/local-env/repro/scenarios.mjs [old|new ...]
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local-env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
)

const SUPABASE = 'http://127.0.0.1:54321'
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const MOCK = 'http://localhost:8090'
const TARGETS = {
  old: { url: 'http://localhost:3101', container: 'flashflow-main-ref', internal: 'http://flashflow-main-ref:3000' },
  new: { url: 'http://localhost:3100', container: 'flashflow-local', internal: 'http://flashflow-local:3000' },
}
const RUN = Date.now().toString(36)
// Sufixo por versão: wa_message_id é único no banco inteiro e as duas
// versões compartilham o mesmo Supabase.
const tag = (instance) => (instance.startsWith('repro-old') ? 'O' : 'N')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

async function mock(config) {
  await fetch(`${MOCK}/__reset`, { method: 'POST' })
  await fetch(`${MOCK}/__config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
}

async function webhook(target, instance, data, event = 'messages.upsert') {
  const response = await fetch(`${target.url}/api/webhook/evolution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': env.EVOLUTION_WEBHOOK_SECRET },
    body: JSON.stringify({ event, instance, data }),
  })
  return response.status
}

async function login(target) {
  const response = await fetch(`${target.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error(`login falhou em ${target.url} (${response.status})`)
  return cookie.split(';')[0]
}

async function conversationsOf(instance) {
  const conversations = await rest(`conversations?instance_name=eq.${encodeURIComponent(instance)}&select=id,wa_id,last_message`)
  for (const conversation of conversations) {
    conversation.messages = await rest(`messages?conversation_id=eq.${conversation.id}&select=type,content,status,direction,sender_type,wa_message_id&order=created_at`)
  }
  return conversations
}

// console.warn/error do app vão para o stderr do container — juntar os dois.
function logsSince(target, sinceIso) {
  const result = spawnSync('docker', ['logs', '--since', sinceIso, target.container], { encoding: 'utf8' })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

const scenarios = {
  // Duas entregas do MESMO evento (mesmo key.id), uma endereçada pelo número
  // e outra por @lid sem número alternativo, chegando juntas enquanto o
  // download da imagem demora — o caso "prévia [imagem] sem mensagem".
  async raceSameMessageTwoJids(target, instance) {
    await mock({ getBase64FromMediaMessage: { mode: 'delay', ms: 1500 } })
    const id = `IMG${RUN}${tag(instance)}${instance.length}`
    const base = { pushName: 'Ana Repro', message: { imageMessage: { mimetype: 'image/png' } } }
    const statuses = await Promise.all([
      webhook(target, instance, { ...base, key: { id, remoteJid: '34611110001@s.whatsapp.net', fromMe: false } }),
      webhook(target, instance, { ...base, key: { id, remoteJid: `${RUN}${tag(instance)}77@lid`, fromMe: false } }),
    ])
    const conversations = await conversationsOf(instance)
    return {
      httpStatuses: statuses.join(','),
      conversations: conversations.length,
      previewWithoutMessage: conversations.filter((c) => c.last_message && c.messages.length === 0).length,
      emptyGhostConversations: conversations.filter((c) => !c.last_message && c.messages.length === 0).length,
      messagesSaved: conversations.reduce((sum, c) => sum + c.messages.length, 0),
    }
  },

  async mediaDownloadFails(target, instance) {
    await mock({ getBase64FromMediaMessage: { mode: 'error', status: 404 } })
    const since = new Date().toISOString()
    const status = await webhook(target, instance, {
      key: { id: `IMG404${RUN}${tag(instance)}`, remoteJid: '34611110002@s.whatsapp.net', fromMe: false },
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto do pedido' } },
    })
    await sleep(300)
    const [conversation] = await conversationsOf(instance)
    const logs = logsSince(target, since)
    return {
      http: status,
      saved: conversation?.messages[0] ? `${conversation.messages[0].type}:${conversation.messages[0].content}` : '-',
      loggedTheFailure: /download de m[ií]dia falhou|getBase64/i.test(logs),
    }
  },

  async disappearingText(target, instance) {
    await webhook(target, instance, {
      key: { id: `EPH${RUN}${tag(instance)}`, remoteJid: '34611110003@s.whatsapp.net', fromMe: false },
      message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'quero comprar 2 frascos' } } } },
    })
    const [conversation] = await conversationsOf(instance)
    return { saved: conversation?.messages.map((m) => `${m.type}:${m.content}`).join(' | ') ?? '-', preview: conversation?.last_message ?? '-' }
  },

  async reaction(target, instance) {
    await webhook(target, instance, {
      key: { id: `TXT${RUN}${tag(instance)}`, remoteJid: '34611110004@s.whatsapp.net', fromMe: false },
      message: { conversation: 'olá' },
    })
    await webhook(target, instance, {
      key: { id: `REACT${RUN}${tag(instance)}`, remoteJid: '34611110004@s.whatsapp.net', fromMe: false },
      message: { reactionMessage: { text: '👍', key: { id: `TXT${RUN}${tag(instance)}` } } },
    })
    const [conversation] = await conversationsOf(instance)
    return { messages: conversation?.messages.map((m) => m.content).join(' | ') ?? '-', preview: conversation?.last_message ?? '-' }
  },

  async albumPhoto(target, instance) {
    await mock({})
    await webhook(target, instance, {
      key: { id: `ALB${RUN}${tag(instance)}`, remoteJid: '34611110005@s.whatsapp.net', fromMe: false },
      message: { associatedChildMessage: { message: { imageMessage: { mimetype: 'image/png' } } } },
    })
    const [conversation] = await conversationsOf(instance)
    const message = conversation?.messages[0]
    return { saved: message ? `${message.type}:${message.content.slice(0, 40)}` : '-' }
  },

  // Histórico gravado pela Evolution com o contato endereçado por LID
  // (key.remoteJid=@lid, número em key.remoteJidAlt), conversa aberta pelo número.
  async syncLidHistory(target, instance) {
    const instanceId = `inst-${instance}`
    await rest('Instance', { method: 'POST', body: { id: instanceId, name: instance }, prefer: 'resolution=ignore-duplicates' })
    const phoneJid = '34611110006@s.whatsapp.net'
    const rows = [1, 2, 3].map((n) => ({
      id: `evo-${instance}-${n}`,
      key: { id: `HIST${RUN}${tag(instance)}${n}`, remoteJid: `${RUN}${tag(instance)}66@lid`, remoteJidAlt: phoneJid, fromMe: false },
      messageType: 'conversation',
      message: { conversation: `mensagem antiga ${n}` },
      source: 'android',
      messageTimestamp: Math.floor(Date.now() / 1000) - 3600 + n,
      instanceId,
    }))
    await rest('Message', { method: 'POST', body: rows })
    const [conversation] = await rest('conversations', {
      method: 'POST',
      body: { wa_id: phoneJid, instance_name: instance, contact_phone: '34611110006' },
      prefer: 'return=representation',
    })
    const cookie = await login(target)
    const response = await fetch(`${target.url}/api/messages/sync/${conversation.id}?instance=${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { cookie },
    })
    const body = await response.json()
    const saved = await rest(`messages?conversation_id=eq.${conversation.id}&select=id`)
    return { reportedAdded: body.added, actuallySaved: saved.length }
  },

  // O WhatsApp ecoa a mensagem enviada pelo webhook ANTES da Evolution
  // devolver a resposta HTTP do envio.
  async outboundEchoRace(target, instance) {
    await mock({ sendText: { echoBeforeResponse: true }, webhookUrl: `${target.internal}/api/webhook/evolution` })
    const [conversation] = await rest('conversations', {
      method: 'POST',
      body: { wa_id: '34611110007@s.whatsapp.net', instance_name: instance, contact_phone: '34611110007' },
      prefer: 'return=representation',
    })
    const cookie = await login(target)
    const response = await fetch(`${target.url}/api/messages`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversation.id, content: 'Seu pedido foi confirmado' }),
    })
    await sleep(500)
    const messages = await rest(`messages?conversation_id=eq.${conversation.id}&select=status,sender_type,wa_message_id`)
    return {
      http: response.status,
      rows: messages.length,
      statuses: messages.map((m) => `${m.status}${m.wa_message_id ? '' : '(sem id)'}`).join(','),
    }
  },
}

const requested = process.argv.slice(2).filter((arg) => arg in TARGETS)
const targets = requested.length > 0 ? requested : ['old', 'new']
const results = {}
for (const [name, scenario] of Object.entries(scenarios)) {
  results[name] = {}
  for (const targetName of targets) {
    const instance = `repro-${targetName}-${name}-${RUN}`
    try {
      results[name][targetName] = await scenario(TARGETS[targetName], instance)
    } catch (error) {
      results[name][targetName] = { error: error.message.slice(0, 200) }
    }
  }
}
await mock({})
console.log(JSON.stringify(results, null, 2))
