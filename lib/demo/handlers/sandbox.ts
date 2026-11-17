import type { FulfillmentOrder, SandboxContact, Trigger } from '@/types'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import { handleSandboxInbound, sandboxFlowsFor, startSandboxFlow } from '../flow-runner'
import { bodyOf, fail, ok, route } from '../router'
import { buildCheckout, buildOrder } from '../seed/orders'
import { nextId, type DemoStore } from '../store'

// Atraso do gatilho de carrinho quando não é "disparar agora". Na aplicação
// real é o delay configurado no gatilho; na demo são poucos segundos.
const SCHEDULED_CHECKOUT_DELAY_MS = 4000

function resolveContact(store: DemoStore, conversationId: unknown): SandboxContact | undefined {
  return typeof conversationId === 'string' && conversationId
    ? store.sandboxContacts.find((c) => c.id === conversationId)
    : store.sandboxContacts[0]
}

interface SimulatedItem { sku?: string; name?: string; title?: string; price?: number; quantity?: number }

function simulateOrder(source: 'shopify' | 'lightfunnels', triggerSource: Trigger['source']) {
  return (req: Parameters<Parameters<typeof route>[2]>[0], store: DemoStore) => {
    const body = bodyOf(req)
    const customerName = String(body.customerName ?? '').trim()
    const items = Array.isArray(body.items) ? (body.items as SimulatedItem[]) : []
    if (!customerName) return fail('Nome do cliente é obrigatório')
    if (items.length === 0) return fail('Adicione pelo menos um produto')

    const contact = resolveContact(store, body.conversationId)
    const number = `SANDBOX${String(Date.now()).slice(-6)}`
    const order: FulfillmentOrder = buildOrder({
      id: nextId(store, 'order'),
      orderNumber: number,
      instance: SANDBOX_INSTANCE_NAME,
      country: String(body.country ?? 'PT').trim().toUpperCase() || 'PT',
      customerName,
      phone: String(body.phone ?? '').trim() || contact?.contact_phone || '351900000000',
      email: String(body.email ?? '').trim() || null,
      address: String(body.address ?? '').trim(),
      city: String(body.city ?? '').trim(),
      province: String(body.province ?? '').trim(),
      zipcode: String(body.zipcode ?? '').trim(),
      paymentType: body.paymentType === 'PREPAID' ? 'PREPAID' : 'COD',
      items: items.map((item) => {
        const quantity = Number(item.quantity) || 1
        const price = Number(item.price) || 0
        return {
          product_id: '', sku: String(item.sku ?? ''), name: String(item.name ?? item.title ?? 'Produto'),
          quantity, unit_price: price, total: Math.round(price * quantity * 100) / 100,
        }
      }),
      placedAt: new Date().toISOString(),
      conversationId: contact?.id ?? null,
      source,
      simulation: true,
    })
    store.orders.push(order)

    if (contact) {
      const [flow] = sandboxFlowsFor(store, SANDBOX_INSTANCE_NAME, triggerSource)
      if (flow) {
        startSandboxFlow(store, contact.id, flow, { orderId: order.id })
        order.confirmation_message_sent_at = new Date().toISOString()
      }
    }
    return ok({ order })
  }
}

export function registerSandboxHandlers(): void {
  // ── Contactos de teste ─────────────────────────────────────────────────
  route('GET', '/api/fulfillment/sandbox/contacts', (_req, store) => ok({ contacts: store.sandboxContacts }))

  route('POST', '/api/fulfillment/sandbox/contacts', (req, store) => {
    const body = bodyOf(req)
    const name = String(body.contactName ?? '').trim()
    const phone = String(body.contactPhone ?? '').replace(/\D/g, '')
    if (!name && !phone) return fail('Nome ou telefone são obrigatórios')
    const contact: SandboxContact = {
      id: nextId(store, 'sbx-contact'),
      wa_id: `${phone || 'sandbox'}@s.whatsapp.net`,
      contact_name: name || null,
      contact_phone: phone || null,
      sandbox_source_instance: typeof body.sourceInstanceName === 'string' ? body.sourceInstanceName : null,
      sandbox_real_send_enabled: false,
    }
    store.sandboxContacts.push(contact)
    return ok({ contact })
  })

  // Importar um contacto real: procura nas conversas de exemplo.
  route('GET', '/api/fulfillment/sandbox/contacts/search', (req, store) => {
    const query = (req.query.get('q') ?? '').trim().toLowerCase()
    if (query.length < 2) return ok({ contacts: [] })
    const contacts = store.conversations
      .filter((c) => (c.contact_name ?? '').toLowerCase().includes(query) || c.contact_phone.includes(query))
      .slice(0, 8)
      .map((c) => ({
        id: c.id, wa_id: c.wa_id, instance_name: c.instance_name, contact_name: c.contact_name, contact_phone: c.contact_phone,
        accountLabel: store.accounts.find((a) => a.instanceName === c.instance_name)?.label ?? c.instance_name,
      }))
    return ok({ contacts })
  })

  route('PATCH', '/api/fulfillment/sandbox/contacts/:id', (req, store) => {
    const contact = store.sandboxContacts.find((c) => c.id === req.params.id)
    if (!contact) return fail('Contato não encontrado', 404)
    // "Envio real" mandaria as mensagens para um WhatsApp verdadeiro.
    if (bodyOf(req).realSendEnabled === true) return fail('Envio real não está disponível na demonstração')
    contact.sandbox_real_send_enabled = false
    return ok({ contact })
  })

  route('DELETE', '/api/fulfillment/sandbox/contacts/:id', (req, store) => {
    store.sandboxContacts = store.sandboxContacts.filter((c) => c.id !== req.params.id)
    store.sandboxMessages = store.sandboxMessages.filter((m) => m.conversation_id !== req.params.id)
    delete store.sandboxRuns[req.params.id]
    return ok()
  })

  // ── Chat de teste ──────────────────────────────────────────────────────
  route('GET', '/api/fulfillment/sandbox/message', (req, store) => {
    const contact = resolveContact(store, req.query.get('conversationId'))
    if (!contact) return ok({ conversationId: null, messages: [], replyButtons: [] })
    return ok({
      conversationId: contact.id,
      messages: store.sandboxMessages.filter((m) => m.conversation_id === contact.id),
      replyButtons: store.sandboxRuns[contact.id]?.buttons ?? [],
    })
  })

  route('POST', '/api/fulfillment/sandbox/message', (req, store) => {
    const body = bodyOf(req)
    const text = String(body.text ?? '').trim()
    const contact = resolveContact(store, body.conversationId)
    if (!text) return fail('Mensagem vazia')
    if (!contact) return fail('Adicione um contato de teste primeiro')
    handleSandboxInbound(store, contact.id, SANDBOX_INSTANCE_NAME, text)
    return ok({ conversationId: contact.id })
  })

  route('POST', '/api/fulfillment/sandbox/reset', (req, store) => {
    const contact = resolveContact(store, bodyOf(req).conversationId)
    if (contact) {
      store.sandboxMessages = store.sandboxMessages.filter((m) => m.conversation_id !== contact.id)
      delete store.sandboxRuns[contact.id]
    }
    return ok()
  })

  // ── Simuladores ────────────────────────────────────────────────────────
  route('POST', '/api/fulfillment/sandbox/shopify-order', simulateOrder('shopify', 'shopify_order'))
  route('POST', '/api/fulfillment/sandbox/lightfunnels-order', simulateOrder('lightfunnels', 'lightfunnels_order'))

  route('POST', '/api/fulfillment/sandbox/abandoned-checkout', (req, store) => {
    const body = bodyOf(req)
    const contact = resolveContact(store, body.conversationId)
    const items = (Array.isArray(body.items) ? (body.items as SimulatedItem[]) : []).map((item) => ({
      title: String(item.title ?? item.name ?? 'Produto'), quantity: Number(item.quantity) || 1, price: Number(item.price) || 0,
    }))
    if (items.length === 0) return fail('Adicione pelo menos um produto')
    const checkout = buildCheckout({
      id: nextId(store, 'cart'),
      integrationId: null,
      instance: SANDBOX_INSTANCE_NAME,
      country: String(body.country ?? 'PT').trim().toUpperCase() || 'PT',
      customerName: String(body.customerName ?? '').trim() || contact?.contact_name || 'Cliente de teste',
      phone: contact?.contact_phone ?? null,
      email: String(body.email ?? '').trim() || null,
      items,
      minutes: 0,
      source: body.source === 'draft_order' ? 'draft_order' : 'checkout',
      url: String(body.checkoutUrl ?? '').trim() || null,
      simulation: true,
    })
    store.abandonedCheckouts.push(checkout)

    const flows = contact ? sandboxFlowsFor(store, SANDBOX_INSTANCE_NAME, 'shopify_abandoned_checkout') : []
    const run = () => {
      if (!contact || flows.length === 0) return
      startSandboxFlow(store, contact.id, flows[0], { checkoutId: checkout.id })
      checkout.recovery_status = 'Enviado'
      checkout.whatsapp_sent_at = new Date().toISOString()
    }
    if (body.immediate === true) run()
    else setTimeout(run, SCHEDULED_CHECKOUT_DELAY_MS)
    return ok({ checkout, scheduled: flows.length })
  })
}
