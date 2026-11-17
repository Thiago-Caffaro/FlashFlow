import type { AgentMemoryBlock, SlackNotificationSettings } from '@/types'
import { nowIso } from '../clock'
import { bodyOf, fail, ok, route } from '../router'
import { DEFAULT_AI_CONFIG } from '../seed/settings'
import { nextId } from '../store'

// Ecrãs de configuração. Tudo o que tocaria num serviço externo (guardar
// chaves de IA, ligar o Slack, OAuth das lojas, enviar mensagens de teste)
// não tem handler de escrita: o router recusa com a mensagem da demo.
export function registerSettingsHandlers(): void {
  // ── IA ─────────────────────────────────────────────────────────────────
  route('GET', '/api/ai-keys', (_req, store) => ok({ configured: store.aiKeys }))

  route('GET', '/api/instance-ai-config', (req, store) => {
    const instance = req.query.get('instance')
    if (!instance) return fail('instance required')
    return ok({ config: store.aiConfigs[instance] ?? DEFAULT_AI_CONFIG })
  })

  route('PUT', '/api/instance-ai-config', (req, store) => {
    const { instance_name: instanceName, instance, ...changes } = bodyOf(req)
    const target = typeof instanceName === 'string' ? instanceName : typeof instance === 'string' ? instance : ''
    if (!target) return fail('instance required')
    store.aiConfigs[target] = { ...(store.aiConfigs[target] ?? DEFAULT_AI_CONFIG), ...changes }
    return ok()
  })

  // ── Blocos de memória ──────────────────────────────────────────────────
  route('GET', '/api/memory-blocks', (req, store) =>
    ok({ blocks: store.memoryBlocks.filter((b) => b.instance_name === req.query.get('instance')) }))

  route('POST', '/api/memory-blocks', (req, store) => {
    const body = bodyOf(req)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (typeof body.instance_name !== 'string' || !body.instance_name || !name) return fail('Nome e conta são obrigatórios')
    const timestamp = nowIso()
    const block: AgentMemoryBlock = {
      id: nextId(store, 'mem'),
      instance_name: body.instance_name,
      name,
      content: typeof body.content === 'string' ? body.content : '',
      type: body.type === 'always' ? 'always' : 'contextual',
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.memoryBlocks.push(block)
    return ok({ block })
  })

  route('PUT', '/api/memory-blocks/:id', (req, store) => {
    const block = store.memoryBlocks.find((b) => b.id === req.params.id)
    if (!block) return fail('Bloco não encontrado', 404)
    const body = bodyOf(req)
    if (typeof body.name === 'string') block.name = body.name
    if (typeof body.content === 'string') block.content = body.content
    if (body.type === 'always' || body.type === 'contextual') block.type = body.type
    if (Array.isArray(body.keywords)) block.keywords = body.keywords.map(String)
    block.updated_at = nowIso()
    return ok({ block })
  })

  route('DELETE', '/api/memory-blocks/:id', (req, store) => {
    store.memoryBlocks = store.memoryBlocks.filter((b) => b.id !== req.params.id)
    return ok()
  })

  // ── Slack ──────────────────────────────────────────────────────────────
  route('GET', '/api/integrations/slack', (_req, store) => ok({ status: store.slack.status }))
  route('GET', '/api/integrations/slack/channels', (_req, store) => ok({ channels: store.slack.channels }))

  const emptySlackSettings = (instanceName: string): SlackNotificationSettings => ({
    instance_name: instanceName, channel_id: null, channel_name: null, mention: 'none',
    forward_ai_escalation: false, forward_flow_notify: false, forward_outside_window: false,
  })

  route('GET', '/api/integrations/slack/settings', (req, store) => {
    const instance = req.query.get('instance')
    if (!instance) return fail('instance required')
    return ok({ settings: store.slack.settings.find((s) => s.instance_name === instance) ?? emptySlackSettings(instance) })
  })

  route('PUT', '/api/integrations/slack/settings', (req, store) => {
    const { instance, instance_name: instanceName, ...patch } = bodyOf(req)
    const target = typeof instance === 'string' ? instance : typeof instanceName === 'string' ? instanceName : ''
    if (!target) return fail('instance required')
    let settings = store.slack.settings.find((s) => s.instance_name === target)
    if (!settings) {
      settings = emptySlackSettings(target)
      store.slack.settings.push(settings)
    }
    Object.assign(settings, patch, { instance_name: target })
    return ok({ settings })
  })

  // ── Apps das lojas (só leitura, sem segredos) ──────────────────────────
  route('GET', '/api/settings/shopify', () =>
    ok({ clientId: 'demo-shopify-client-id', clientSecretSet: true, scopes: 'read_orders,read_products,read_draft_orders', appBaseUrl: 'https://flashflow.example' }))

  route('GET', '/api/settings/lightfunnels', () =>
    ok({ clientId: 'demo-lightfunnels-client-id', clientSecretSet: true, scopes: 'orders,products,funnels', redirectUri: 'https://flashflow.example/api/lightfunnels/callback' }))

  // ── Diagnóstico ────────────────────────────────────────────────────────
  // Mesmo formato de app/api/diagnostics/route.ts (sem `ok`).
  route('GET', '/api/diagnostics', (_req, store) => {
    const accounts = store.accounts.filter((a) => !a.isSandbox)
    const instanceStates: Record<string, unknown> = {}
    for (const account of accounts) instanceStates[account.instanceName] = { instance: { state: account.state } }
    const recentMessages = [...store.messages]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 15)
      .map((m) => ({
        id: m.id, conversation_id: m.conversation_id, content: m.type === 'image' ? '[imagem]' : m.content,
        type: m.type, direction: m.direction, status: m.status, created_at: m.created_at, wa_message_id: m.wa_message_id ?? '',
      }))
    return {
      json: {
        ts: nowIso(),
        accounts: accounts.map((a) => ({ instance_name: a.instanceName, label: a.label })),
        instanceStates,
        qrCacheKeys: [],
        recentWebhooks: recentMessages
          .filter((m) => m.direction === 'inbound')
          .slice(0, 6)
          .map((m) => ({ ts: m.created_at, event: 'messages.upsert', instance: store.conversations.find((c) => c.id === m.conversation_id)?.instance_name ?? '', data: m.content.slice(0, 80) })),
        recentMessages,
        evoStatus: accounts
          .filter((a) => a.provider !== 'cloud_api')
          .map((a) => ({ name: a.instanceName, status: a.state, profileName: a.profileName ?? null })),
      },
    }
  })
}
