import type { Flow, FlowMedia, Trigger } from '@/types'
import { nowIso } from '../clock'
import { blocked, bodyOf, fail, ok, route } from '../router'
import { nextId } from '../store'

type FlowJson = Flow['json']

// Versão mínima de validateFlowJson (lib/flow-validation.ts é server-only):
// só garante a forma que o editor precisa para voltar a abrir o fluxo.
function isFlowJson(value: unknown): value is FlowJson {
  if (typeof value !== 'object' || value === null) return false
  const { nodes, edges } = value as { nodes?: unknown; edges?: unknown }
  return Array.isArray(nodes) && Array.isArray(edges)
}

export function registerFlowHandlers(): void {
  // ── Fluxos ─────────────────────────────────────────────────────────────
  route('GET', '/api/flows', (req, store) => {
    const instance = req.query.get('instance')
    return ok({ flows: store.flows.filter((f) => f.instance_name === instance && !f.managed_by_automation_id) })
  })

  route('POST', '/api/flows', (req, store) => {
    const body = bodyOf(req)
    if (typeof body.instance_name !== 'string' || !body.instance_name) return fail('instance_name required')
    const json = body.json ?? { nodes: [], edges: [] }
    if (!isFlowJson(json)) return fail('nodes e edges devem ser arrays', 422)
    const timestamp = nowIso()
    const flow: Flow = {
      id: nextId(store, 'flow'),
      instance_name: body.instance_name,
      name: typeof body.name === 'string' && body.name ? body.name : 'Novo Fluxo',
      json,
      ativo: body.ativo === true,
      managed_by_automation_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.flows.push(flow)
    return ok({ flow })
  })

  route('GET', '/api/flows/:id', (req, store) => {
    const flow = store.flows.find((f) => f.id === req.params.id)
    return flow ? ok({ flow }) : fail('Fluxo não encontrado', 404)
  })

  route('PUT', '/api/flows/:id', (req, store) => {
    const flow = store.flows.find((f) => f.id === req.params.id)
    if (!flow) return fail('Fluxo não encontrado', 404)
    const body = bodyOf(req)
    if (body.json !== undefined) {
      if (!isFlowJson(body.json)) return fail('nodes e edges devem ser arrays', 422)
      flow.json = body.json
    }
    if (typeof body.name === 'string') flow.name = body.name
    if (typeof body.ativo === 'boolean') flow.ativo = body.ativo
    flow.updated_at = nowIso()
    return ok({ flow })
  })

  route('DELETE', '/api/flows/:id', (req, store) => {
    store.flows = store.flows.filter((f) => f.id !== req.params.id)
    return ok()
  })

  // ── Gatilhos ───────────────────────────────────────────────────────────
  route('GET', '/api/triggers', (req, store) =>
    ok({ triggers: store.triggers.filter((t) => t.instance_name === req.query.get('instance')) }))

  route('POST', '/api/triggers', (req, store) => {
    const body = bodyOf(req)
    if (typeof body.instance_name !== 'string' || !body.instance_name) return fail('instance_name required')
    const timestamp = nowIso()
    const trigger: Trigger = {
      id: nextId(store, 'trg'),
      instance_name: body.instance_name,
      alias: typeof body.alias === 'string' ? body.alias : '',
      tipo: body.tipo === 'exact' ? 'exact' : 'contains',
      valor: typeof body.valor === 'string' ? body.valor : '',
      delay_ms: typeof body.delay_ms === 'number' ? body.delay_ms : 0,
      action: body.action === 'flow' ? 'flow' : 'send_message',
      action_payload: (body.action_payload ?? {}) as Trigger['action_payload'],
      source: (typeof body.source === 'string' ? body.source : 'message') as Trigger['source'],
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.triggers.push(trigger)
    return ok({ trigger })
  })

  route('PUT', '/api/triggers/:id', (req, store) => {
    const trigger = store.triggers.find((t) => t.id === req.params.id)
    if (!trigger) return fail('Gatilho não encontrado', 404)
    const { id: _id, instance_name: _instance, created_at: _created, ...changes } = bodyOf(req)
    Object.assign(trigger, changes, { updated_at: nowIso() })
    return ok({ trigger })
  })

  route('DELETE', '/api/triggers/:id', (req, store) => {
    store.triggers = store.triggers.filter((t) => t.id !== req.params.id)
    return ok()
  })

  // ── Galeria de mídia dos fluxos ────────────────────────────────────────
  // A rota real responde sem `ok` no GET (app/api/flow-media/route.ts).
  route('GET', '/api/flow-media', (req, store) =>
    ({ json: { data: store.flowMedia.filter((m) => m.instance_name === req.query.get('instance')) } }))

  route('POST', '/api/flow-media', (req, store) => {
    if (!(req.body instanceof FormData)) return fail('file e instanceName são obrigatórios')
    const file = req.body.get('file')
    const instanceName = req.body.get('instanceName')
    if (!(file instanceof Blob) || typeof instanceName !== 'string') return fail('file e instanceName são obrigatórios')
    const filename = file instanceof File ? file.name : 'imagem'
    const data: FlowMedia = {
      id: nextId(store, 'media'),
      instance_name: instanceName,
      filename,
      storage_path: `demo/${filename}`,
      // A imagem fica só neste separador, como URL local.
      url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : 'blob:demo',
      size_bytes: file.size,
      created_at: nowIso(),
    }
    store.flowMedia.unshift(data)
    return ok({ data })
  })

  route('PATCH', '/api/flow-media/:id', (req, store) => {
    const data = store.flowMedia.find((m) => m.id === req.params.id)
    if (!data) return fail('Imagem não encontrada', 404)
    const filename = bodyOf(req).filename
    if (typeof filename === 'string' && filename.trim()) data.filename = filename.trim()
    return ok({ data })
  })

  route('DELETE', '/api/flow-media/:id', (req, store) => {
    store.flowMedia = store.flowMedia.filter((m) => m.id !== req.params.id)
    return ok()
  })

  // ── Templates da WhatsApp Cloud API ────────────────────────────────────
  route('GET', '/api/whatsapp-cloud/templates', (req, store) =>
    ok({ templates: store.templates.filter((t) => t.instance_name === req.query.get('instance')) }))

  // Criar ou sincronizar templates exige a Meta.
  route('POST', '/api/whatsapp-cloud/templates', () => blocked())
  route('POST', '/api/whatsapp-cloud/templates/sync', (req, store) => {
    const instance = bodyOf(req).instance_name ?? bodyOf(req).instance
    return ok({ synced: store.templates.filter((t) => t.instance_name === instance).length })
  })
}
