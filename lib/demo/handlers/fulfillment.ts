import {
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  SEND_STATUSES,
  type CommercialStatus,
  type DeliveryStatus,
  type FulfillmentOrder,
  type FulfillmentProduct,
  type SendStatus,
  type ShopifyProduct,
} from '@/types'
import { nowIso } from '../clock'
import { bodyOf, fail, ok, route } from '../router'
import { nextId, type DemoStore } from '../store'

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

const byNewest = (a: FulfillmentOrder, b: FulfillmentOrder) => Date.parse(b.order_placed_at) - Date.parse(a.order_placed_at)

function setCommercialStatus(order: FulfillmentOrder, status: CommercialStatus): void {
  const timestamp = nowIso()
  order.commercial_status = status
  order.confirmation_status_updated_at = timestamp
  order.confirmed_at = status.startsWith('Confirmado') ? order.confirmed_at ?? timestamp : null
  order.updated_at = timestamp
}

function patchOrder(order: FulfillmentOrder, body: Record<string, unknown>): string | null {
  if (body.commercial_status !== undefined) {
    if (!isOneOf(COMMERCIAL_STATUSES, body.commercial_status)) return 'Status comercial inválido'
    setCommercialStatus(order, body.commercial_status)
  }
  if (body.send_status !== undefined) {
    if (!isOneOf<SendStatus>(SEND_STATUSES, body.send_status)) return 'Status de envio inválido'
    order.send_status = body.send_status
  }
  if (body.delivery_status !== undefined) {
    if (!isOneOf<DeliveryStatus>(DELIVERY_STATUSES, body.delivery_status)) return 'Status de entrega inválido'
    order.delivery_status = body.delivery_status
    order.delivery_status_source = 'manual'
    order.delivery_status_changed_at = nowIso()
  }
  if (typeof body.assigned_instance_name === 'string') order.assigned_instance_name = body.assigned_instance_name || null
  if (Array.isArray(body.items)) {
    order.items = body.items as FulfillmentOrder['items']
    order.total = Math.round(order.items.reduce((sum, item) => sum + Number(item.total ?? 0), 0) * 100) / 100
  }
  for (const key of ['customer_name', 'contact_phone', 'email', 'address', 'city', 'province', 'zipcode'] as const) {
    const value = body[key]
    if (typeof value === 'string') Object.assign(order, { [key]: value })
  }
  order.updated_at = nowIso()
  return null
}

function findOrder(store: DemoStore, id: string): FulfillmentOrder | undefined {
  return store.orders.find((order) => order.id === id)
}

export function registerFulfillmentHandlers(): void {
  // ── Pedidos ────────────────────────────────────────────────────────────
  route('GET', '/api/fulfillment/orders', (_req, store) => ok({ orders: [...store.orders].sort(byNewest) }))

  route('GET', '/api/fulfillment/orders/:id', (req, store) => {
    const order = findOrder(store, req.params.id)
    return order ? ok({ order, events: [] }) : fail('Pedido não encontrado', 404)
  })

  route('PATCH', '/api/fulfillment/orders/:id', (req, store) => {
    const order = findOrder(store, req.params.id)
    if (!order) return fail('Pedido não encontrado', 404)
    const error = patchOrder(order, bodyOf(req))
    return error ? fail(error) : ok({ order })
  })

  route('PATCH', '/api/fulfillment/orders/bulk-status', (req, store) => {
    const { ids, commercial_status: status } = bodyOf(req)
    if (!Array.isArray(ids) || !isOneOf(COMMERCIAL_STATUSES, status)) return fail('ids e commercial_status são obrigatórios')
    const errors: Array<{ id: string; error: string }> = []
    let succeeded = 0
    for (const id of ids.map(String)) {
      const order = findOrder(store, id)
      if (!order) {
        errors.push({ id, error: 'Pedido não encontrado' })
        continue
      }
      setCommercialStatus(order, status)
      succeeded += 1
    }
    return ok({ succeeded, failed: errors.length, errors })
  })

  // Ações sobre o fulfillment externo (FenixCOD), simuladas localmente.
  const action = (name: string, apply: (order: FulfillmentOrder) => void) =>
    route('POST', `/api/fulfillment/orders/:id/${name}`, (req, store) => {
      const order = findOrder(store, req.params.id)
      if (!order) return fail('Pedido não encontrado', 404)
      apply(order)
      order.updated_at = nowIso()
      return ok({ order })
    })

  action('submit', (order) => {
    order.send_status = 'Enviado'
    order.delivery_status = 'Enviado'
    order.status = 'submitted'
    order.lead_number = order.lead_number ?? `FX-${order.order_number}`
    order.submitted_at = nowIso()
  })
  action('refresh', () => {})
  action('cancel', (order) => {
    order.send_status = 'Não enviar'
    order.status = 'cancelled'
  })
  action('cancel-local', (order) => {
    order.send_status = 'Não enviar'
    order.status = 'cancelled'
  })
  action('confirmation-message', (order) => {
    order.confirmation_message_sent_at = nowIso()
    order.confirmation_message_error = null
  })

  route('GET', '/api/fulfillment/orders/:id/shopify-timeline', () => ok({ events: [] }))

  // ── Integrações (só leitura; ligar/desligar lojas exige OAuth real) ────
  route('GET', '/api/fulfillment/integrations', (_req, store) => ok({ integrations: store.fenixIntegrations }))
  route('GET', '/api/fulfillment/shopify/integrations', (_req, store) => ok({ integrations: store.shopifyIntegrations }))
  route('GET', '/api/fulfillment/lightfunnels/integrations', (_req, store) => ok({ integrations: store.lightfunnelsIntegrations }))

  const storeAccounts = (_req: unknown, store: DemoStore) =>
    ok({
      accounts: store.accounts
        .filter((account) => !account.isSandbox)
        .map((account, index) => ({ instance_name: account.instanceName, priority: index + 1, enabled: true, funnel_ids: [] })),
    })
  route('GET', '/api/fulfillment/shopify/integrations/:id/accounts', storeAccounts)
  route('GET', '/api/fulfillment/lightfunnels/integrations/:id/accounts', storeAccounts)
  route('GET', '/api/fulfillment/lightfunnels/integrations/:id/funnels', () =>
    ok({ funnels: [{ id: 'funnel-1', name: 'Masajeador · Oferta principal', published: true }, { id: 'funnel-2', name: 'Masajeador · Upsell', published: false }] }))

  // Verificações e sincronizações com as lojas: nada a fazer na demo.
  route('POST', '/api/fulfillment/shopify/webhooks/ensure', () => ok({ ensured: 0 }))
  route('POST', '/api/fulfillment/lightfunnels/webhooks/ensure', () => ok({ ensured: 0 }))
  route('POST', '/api/fulfillment/shopify/sync', () => ok({ imported: 0, updated: 0 }))
  route('POST', '/api/fulfillment/shopify/products/sync', () => ok({ synced: 0 }))

  // ── Definições das lojas ───────────────────────────────────────────────
  route('GET', '/api/settings/shopify-triggers', (_req, store) => ok({ enabled: store.settings.shopifyTriggersEnabled }))
  route('PUT', '/api/settings/shopify-triggers', (req, store) => {
    store.settings.shopifyTriggersEnabled = bodyOf(req).enabled !== false
    return ok({ enabled: store.settings.shopifyTriggersEnabled })
  })
  route('GET', '/api/settings/lightfunnels-triggers', (_req, store) => ok({ enabled: store.settings.lightfunnelsTriggersEnabled }))
  route('PUT', '/api/settings/lightfunnels-triggers', (req, store) => {
    store.settings.lightfunnelsTriggersEnabled = bodyOf(req).enabled !== false
    return ok({ enabled: store.settings.lightfunnelsTriggersEnabled })
  })
  route('GET', '/api/settings/shopify-order-account', (_req, store) => ok({ instanceName: store.settings.shopifyOrderInstanceName }))
  route('PUT', '/api/settings/shopify-order-account', (req, store) => {
    const instanceName = bodyOf(req).instanceName
    store.settings.shopifyOrderInstanceName = typeof instanceName === 'string' && instanceName ? instanceName : null
    return ok({ instanceName: store.settings.shopifyOrderInstanceName })
  })

  // ── Carrinhos abandonados ──────────────────────────────────────────────
  route('GET', '/api/fulfillment/shopify/abandoned-checkouts', (_req, store) =>
    ok({ checkouts: [...store.abandonedCheckouts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) }))

  route('PATCH', '/api/fulfillment/shopify/abandoned-checkouts', (req, store) => {
    const body = bodyOf(req)
    const checkout = store.abandonedCheckouts.find((c) => c.id === body.id)
    if (!checkout) return fail('Carrinho não encontrado', 404)
    if (typeof body.recovery_status === 'string') checkout.recovery_status = body.recovery_status as typeof checkout.recovery_status
    if (typeof body.assigned_instance_name === 'string') checkout.assigned_instance_name = body.assigned_instance_name || null
    checkout.updated_at = nowIso()
    return ok({ checkout })
  })

  route('POST', '/api/fulfillment/shopify/abandoned-checkouts/:id/recover', (req, store) => {
    const checkout = store.abandonedCheckouts.find((c) => c.id === req.params.id)
    if (!checkout) return fail('Carrinho não encontrado', 404)
    checkout.recovery_status = 'Enviado'
    checkout.whatsapp_sent_at = nowIso()
    checkout.updated_at = checkout.whatsapp_sent_at
    return ok({ checkout })
  })

  // ── Produtos ───────────────────────────────────────────────────────────
  route('GET', '/api/fulfillment/shopify/products', (_req, store) => ok({ products: store.shopifyProducts }))

  route('PUT', '/api/fulfillment/shopify/products', (req, store) => {
    const { id, ids, ...changes } = bodyOf(req)
    const targets = Array.isArray(ids) ? ids.map(String) : typeof id === 'string' ? [id] : []
    let updated = 0
    for (const product of store.shopifyProducts) {
      if (!targets.includes(product.id)) continue
      Object.assign(product, changes, { updated_at: nowIso() })
      updated += 1
    }
    return updated > 0 ? ok({ updated, product: store.shopifyProducts.find((p) => p.id === targets[0]) }) : fail('Produto não encontrado', 404)
  })

  route('POST', '/api/fulfillment/shopify/products', (req, store) => {
    const body = bodyOf(req)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return fail('Título é obrigatório')
    const timestamp = nowIso()
    const product: ShopifyProduct = {
      id: nextId(store, 'spv'),
      shopify_integration_id: typeof body.shopify_integration_id === 'string' ? body.shopify_integration_id : null,
      shopify_product_id: null,
      shopify_variant_id: null,
      sku: typeof body.sku === 'string' ? body.sku : null,
      title,
      variant_title: typeof body.variant_title === 'string' ? body.variant_title : null,
      units_per_pack: Number(body.units_per_pack) || 1,
      price: Number(body.price) || 0,
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'EUR',
      image_url: null,
      source: 'manual',
      hidden: false,
      keep_local_copy: false,
      local_product_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.shopifyProducts.push(product)
    return ok({ product })
  })

  route('DELETE', '/api/fulfillment/shopify/products', (req, store) => {
    store.shopifyProducts = store.shopifyProducts.filter((p) => p.id !== req.query.get('id'))
    return ok()
  })

  route('GET', '/api/fulfillment/lightfunnels/products', (_req, store) => ok({ products: store.lightfunnelsProducts }))
  route('PATCH', '/api/fulfillment/lightfunnels/products', (req, store) => {
    const { id, ids, ...changes } = bodyOf(req)
    const targets = Array.isArray(ids) ? ids.map(String) : typeof id === 'string' ? [id] : []
    let updated = 0
    for (const product of store.lightfunnelsProducts) {
      if (!targets.includes(product.id)) continue
      Object.assign(product, changes, { updated_at: nowIso() })
      updated += 1
    }
    return ok({ updated })
  })

  route('GET', '/api/fulfillment/products', (req, store) => {
    const country = req.query.get('country')
    return ok({ products: country ? store.fulfillmentProducts.filter((p) => p.country === country) : store.fulfillmentProducts })
  })

  route('POST', '/api/fulfillment/products', (req, store) => {
    const body = bodyOf(req)
    const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!sku || !name) return fail('SKU e nome são obrigatórios')
    const timestamp = nowIso()
    const product: FulfillmentProduct = {
      id: nextId(store, 'fp'),
      country: typeof body.country === 'string' && body.country ? body.country.toUpperCase() : 'PT',
      sku,
      name,
      units_per_pack: Number(body.units_per_pack) || 1,
      price: Number(body.price) || 0,
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'EUR',
      active: body.active !== false,
      created_at: timestamp,
      updated_at: timestamp,
    }
    store.fulfillmentProducts.push(product)
    return ok({ product })
  })

  route('PUT', '/api/fulfillment/products', (req, store) => {
    const { id, ...changes } = bodyOf(req)
    const product = store.fulfillmentProducts.find((p) => p.id === id)
    if (!product) return fail('Produto não encontrado', 404)
    Object.assign(product, changes, { updated_at: nowIso() })
    return ok({ product })
  })

  route('DELETE', '/api/fulfillment/products', (req, store) => {
    const product = store.fulfillmentProducts.find((p) => p.id === req.query.get('id'))
    // A rota real desativa em vez de apagar, para não partir pedidos antigos.
    if (product) product.active = false
    return ok()
  })

  // ── Estados de entrega do fulfillment externo ──────────────────────────
  route('GET', '/api/fulfillment/delivery-status-mappings', (_req, store) => ok({ mappings: store.deliveryMappings }))
  route('PUT', '/api/fulfillment/delivery-status-mappings', (req, store) => {
    const body = bodyOf(req)
    const mapping = store.deliveryMappings.find((m) => m.external_status_key === body.external_status_key)
    if (!mapping) return fail('Estado não encontrado', 404)
    mapping.delivery_status = isOneOf<DeliveryStatus>(DELIVERY_STATUSES, body.delivery_status) ? body.delivery_status : null
    mapping.updated_at = nowIso()
    return ok({ mapping })
  })

  route('GET', '/api/fulfillment/external-leads', (req, store) => {
    const country = req.query.get('country') ?? ''
    return ok({ country, leads: store.externalLeads.filter((lead) => !country || lead.country === country) })
  })
}
