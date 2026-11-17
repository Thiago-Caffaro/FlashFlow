import type {
  CommercialStatus,
  DeliveryStatus,
  ExternalFulfillmentLead,
  FulfillmentOrder,
  FulfillmentProduct,
  LightfunnelsIntegration,
  LightfunnelsProduct,
  SendStatus,
  ShopifyAbandonedCheckout,
  ShopifyIntegration,
  ShopifyProduct,
} from '@/types'
import type { DeliveryStatusMapping } from '@/lib/fulfillment-delivery-status'
import { minutesAgo } from '../clock'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from './accounts'
import { LIGHTFUNNELS_ID, SHOPIFY_ES_ID, SHOPIFY_PT_ID } from './automations'
import { demoImage } from './images'

const stamp = (minutes = 40_000) => ({ created_at: minutesAgo(minutes), updated_at: minutesAgo(minutes) })

// Integração com o fulfillment externo (FenixCOD), como o painel a mostra.
export interface DemoFenixIntegration {
  id: string
  country: string
  environment: 'test' | 'production'
  active: boolean
  token_expires_at: string | null
  delivery_sync_enabled: boolean
  delivery_sync_interval_minutes: 5 | 10 | 15 | 30
  delivery_sync_next_at: string | null
  delivery_sync_last_started_at: string | null
  delivery_sync_last_completed_at: string | null
  delivery_sync_last_error: string | null
  delivery_sync_last_stats: { updated?: number; unchanged?: number } | null
}

export function seedFenixIntegrations(): DemoFenixIntegration[] {
  const base = {
    environment: 'production' as const, active: true, delivery_sync_enabled: true, delivery_sync_interval_minutes: 15 as const,
    token_expires_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
    delivery_sync_next_at: new Date(Date.now() + 9 * 60_000).toISOString(),
    delivery_sync_last_started_at: minutesAgo(6), delivery_sync_last_completed_at: minutesAgo(6),
    delivery_sync_last_error: null, delivery_sync_last_stats: { updated: 2, unchanged: 9 },
  }
  return [{ ...base, id: 'fenix-es', country: 'ES' }, { ...base, id: 'fenix-pt', country: 'PT' }]
}

export function seedShopifyIntegrations(): ShopifyIntegration[] {
  const base = { active: true, oauth_connected: true, recovery_template_id: null, recovery_template_variable_map: null, app_client_id: null }
  return [
    {
      ...stamp(), ...base, id: SHOPIFY_ES_ID, shop_name: 'Casa Brisa España', shop_domain: 'casa-brisa-es.example', default_country: 'ES',
      confirmation_message_template: 'Hola {{contato.primeiro_nome}}, hemos recibido tu pedido {{pedido.numero}}. ¿Confirmas el envío?',
      recovery_message_template: 'Hola {{contato.primeiro_nome}}, tu carrito sigue guardado: {{carrinho.link}}',
    },
    {
      ...stamp(), ...base, id: SHOPIFY_PT_ID, shop_name: 'Casa Brisa Portugal', shop_domain: 'casa-brisa-pt.example', default_country: 'PT',
      confirmation_message_template: 'Olá {{contato.primeiro_nome}}, recebemos a sua encomenda {{pedido.numero}}. Confirma o envio?',
      recovery_message_template: 'Olá {{contato.primeiro_nome}}, o seu carrinho continua guardado: {{carrinho.link}}',
    },
  ]
}

export function seedLightfunnelsIntegrations(): LightfunnelsIntegration[] {
  return [{
    ...stamp(), id: LIGHTFUNNELS_ID, name: 'Funis Brisa', lf_account_id: 'acc-demo', scopes: 'orders,products,funnels',
    default_country: 'ES', active: true, oauth_connected: true, writeback_enabled: false,
    access_token_expires_at: new Date(Date.now() + 50 * 60_000).toISOString(),
    last_webhook_at: minutesAgo(75), last_error: null,
  }]
}

interface CatalogRow { id: string; integration: string; productId: string; sku: string; title: string; price: number; color: string }

const SHOPIFY_CATALOG: CatalogRow[] = [
  { id: 'spv-1001', integration: SHOPIFY_ES_ID, productId: 'sp-1001', sku: 'COJ-01', title: 'Cojín Ortopédico Brisa', price: 39.9, color: '#00a884' },
  { id: 'spv-1002', integration: SHOPIFY_ES_ID, productId: 'sp-1002', sku: 'MAS-01', title: 'Masajeador Cervical Brisa', price: 49.9, color: '#7c5cbf' },
  { id: 'spv-1003', integration: SHOPIFY_ES_ID, productId: 'sp-1003', sku: 'ALM-01', title: 'Almohada Viscoelástica Brisa', price: 29.9, color: '#3b82a6' },
  { id: 'spv-1004', integration: SHOPIFY_ES_ID, productId: 'sp-1004', sku: 'POS-01', title: 'Corrector de Postura Brisa', price: 24.9, color: '#c2703d' },
  { id: 'spv-2001', integration: SHOPIFY_PT_ID, productId: 'sp-2001', sku: 'ALF-01', title: 'Almofada Ortopédica Brisa', price: 39.9, color: '#00a884' },
  { id: 'spv-2002', integration: SHOPIFY_PT_ID, productId: 'sp-2002', sku: 'MSS-01', title: 'Massajador Cervical Brisa', price: 49.9, color: '#7c5cbf' },
]

export function seedShopifyProducts(): ShopifyProduct[] {
  return SHOPIFY_CATALOG.map((row) => ({
    ...stamp(), id: row.id, shopify_integration_id: row.integration, shopify_product_id: row.productId,
    shopify_variant_id: `${row.productId}-v1`, sku: row.sku, title: row.title, variant_title: null, units_per_pack: 1,
    price: row.price, currency: 'EUR', image_url: demoImage(row.title.split(' ')[0], row.color), source: 'shopify',
    hidden: false, keep_local_copy: true, local_product_id: `fp-${row.sku.toLowerCase()}`,
  }))
}

export function seedLightfunnelsProducts(): LightfunnelsProduct[] {
  return [{
    ...stamp(), id: 'lfv-3001', lightfunnels_integration_id: LIGHTFUNNELS_ID, lf_product_id: 'lf-3001', lf_variant_id: 'lf-3001-v1',
    sku: 'MAS-01', title: 'Masajeador Cervical Brisa (funil)', variant_title: 'Pack 1', units_per_pack: 1, price: 49.9, currency: 'EUR',
    image_url: demoImage('Masajeador', '#7c5cbf'), hidden: false, keep_local_copy: true, local_product_id: 'fp-mas-01',
  }]
}

export function seedFulfillmentProducts(): FulfillmentProduct[] {
  return SHOPIFY_CATALOG.map((row) => ({
    ...stamp(), id: `fp-${row.sku.toLowerCase()}`, country: row.integration === SHOPIFY_PT_ID ? 'PT' : 'ES',
    sku: row.sku, name: row.title, units_per_pack: 1, price: row.price, currency: 'EUR', active: true,
  }))
}

interface OrderDraft {
  n: string
  instance: string
  name: string
  phone: string
  address: string
  city: string
  province: string
  zip: string
  items: Array<[sku: string, quantity: number]>
  commercial: CommercialStatus
  send: SendStatus
  delivery: DeliveryStatus
  minutes: number
  conversation?: string
  source?: 'shopify' | 'lightfunnels'
  confirmationSent?: boolean
}

// Pedidos, clientes e moradas inventados.
const ORDER_DRAFTS: OrderDraft[] = [
  { n: '1047', instance: DEMO_INSTANCE_ES, name: 'Javier Morales', phone: '34900555102', address: 'Avenida Inventada 45, 1ºA', city: 'Sevilla', province: 'Sevilla', zip: '41000', items: [['MAS-01', 1]], commercial: 'Confirmado WhatsApp', send: 'Pendente', delivery: 'Não enviado', minutes: 59, conversation: 'conv-es-2', confirmationSent: true },
  { n: '1046', instance: DEMO_INSTANCE_ES, name: 'Paula Giménez', phone: '34900555106', address: 'Calle Imaginaria 3', city: 'Zaragoza', province: 'Zaragoza', zip: '50000', items: [['COJ-01', 2]], commercial: 'Não responde', send: 'Pendente', delivery: 'Não enviado', minutes: 140, confirmationSent: true },
  { n: '1045', instance: DEMO_INSTANCE_ES, name: 'Sergio Navarro', phone: '34900555107', address: 'Plaza Ficticia 7, 4ºC', city: 'Bilbao', province: 'Bizkaia', zip: '48000', items: [['POS-01', 1], ['ALM-01', 1]], commercial: 'Não responde', send: 'Pendente', delivery: 'Não enviado', minutes: 260, confirmationSent: true },
  { n: '1042', instance: DEMO_INSTANCE_ES, name: 'Lucía Fernández', phone: '34900555101', address: 'Calle Ficticia 12, 2ºB', city: 'Valencia', province: 'Valencia', zip: '46000', items: [['COJ-01', 1]], commercial: 'Confirmado WhatsApp', send: 'Enviado', delivery: 'Enviado', minutes: 190, conversation: 'conv-es-1', confirmationSent: true },
  { n: '1039', instance: DEMO_INSTANCE_ES, name: 'Carmen Ruiz', phone: '34900555103', address: 'Camino Inventado 21', city: 'Málaga', province: 'Málaga', zip: '29000', items: [['ALM-01', 2]], commercial: 'Confirmado Call', send: 'Enviado', delivery: 'Entregue', minutes: 4_400, conversation: 'conv-es-3', confirmationSent: true },
  { n: '1031', instance: DEMO_INSTANCE_ES, name: 'Andrés Castillo', phone: '34900555104', address: 'Ronda Ficticia 9', city: 'Murcia', province: 'Murcia', zip: '30000', items: [['MAS-01', 1]], commercial: 'Confirmado WhatsApp', send: 'Enviado', delivery: 'Novidade', minutes: 5_900, conversation: 'conv-es-4', confirmationSent: true },
  { n: '1028', instance: DEMO_INSTANCE_ES, name: 'Marta Soler', phone: '34900555105', address: 'Calle Imaginaria 88', city: 'Alicante', province: 'Alicante', zip: '03000', items: [['ALM-01', 2]], commercial: 'Não responde', send: 'Pendente', delivery: 'Não enviado', minutes: 2_900, conversation: 'conv-es-5', confirmationSent: true },
  { n: '1024', instance: DEMO_INSTANCE_ES, name: 'Diego Paredes', phone: '34900555108', address: 'Paseo Inventado 5', city: 'Granada', province: 'Granada', zip: '18000', items: [['MAS-01', 1]], commercial: 'Desistiu', send: 'Não enviar', delivery: 'Não enviado', minutes: 7_300, source: 'lightfunnels', confirmationSent: true },
  { n: '2019', instance: DEMO_INSTANCE_PT, name: 'Rui Tavares', phone: '351900555202', address: 'Avenida Imaginária 14', city: 'Braga', province: 'Braga', zip: '4700-000', items: [['MSS-01', 1]], commercial: 'Confirmado', send: 'Pendente', delivery: 'Não enviado', minutes: 380, conversation: 'conv-pt-2' },
  { n: '2014', instance: DEMO_INSTANCE_PT, name: 'Beatriz Antunes', phone: '351900555201', address: 'Rua Inventada 8, 3.º Esq.', city: 'Porto', province: 'Porto', zip: '4000-000', items: [['ALF-01', 1]], commercial: 'Confirmado WhatsApp', send: 'Enviado', delivery: 'A caminho', minutes: 130, conversation: 'conv-pt-1', confirmationSent: true },
  { n: '2009', instance: DEMO_INSTANCE_PT, name: 'Tiago Sequeira', phone: '351900555204', address: 'Travessa Fictícia 2', city: 'Coimbra', province: 'Coimbra', zip: '3000-000', items: [['ALF-01', 1], ['MSS-01', 1]], commercial: 'Confirmado Upsell WhatsApp', send: 'Enviado', delivery: 'Rejeitado', minutes: 6_100, confirmationSent: true },
  { n: '2003', instance: DEMO_INSTANCE_PT, name: 'Helena Marques', phone: '351900555203', address: 'Largo Imaginário 30', city: 'Faro', province: 'Faro', zip: '8000-000', items: [['ALF-01', 1]], commercial: 'Confirmado WhatsApp', send: 'Enviado', delivery: 'Entregue', minutes: 8_700, conversation: 'conv-pt-3', confirmationSent: true },
]

const catalogBySku = new Map(SHOPIFY_CATALOG.map((row) => [row.sku, row]))

/** Preenche todos os campos de um pedido a partir do essencial. */
export function buildOrder(input: {
  id: string
  orderNumber: string
  instance: string
  country: string
  customerName: string
  phone: string
  email?: string | null
  address: string
  city: string
  province: string
  zipcode: string
  paymentType?: 'COD' | 'PREPAID'
  items: FulfillmentOrder['items']
  commercial?: CommercialStatus
  send?: SendStatus
  delivery?: DeliveryStatus
  placedAt: string
  conversationId?: string | null
  source?: FulfillmentOrder['source']
  integrationId?: string | null
  confirmationSentAt?: string | null
  simulation?: boolean
}): FulfillmentOrder {
  const commercial = input.commercial ?? 'Não responde'
  const send = input.send ?? 'Pendente'
  const source = input.source ?? 'shopify'
  const confirmed = commercial.startsWith('Confirmado')
  return {
    id: input.id,
    order_number: input.orderNumber,
    lead_number: send === 'Enviado' ? `FX-${input.orderNumber}` : null,
    instance_name: input.instance,
    country: input.country,
    conversation_id: input.conversationId ?? null,
    contact_phone: input.phone,
    customer_name: input.customerName,
    email: input.email ?? null,
    address: input.address,
    city: input.city,
    province: input.province,
    zipcode: input.zipcode,
    payment_type: input.paymentType ?? 'COD',
    items: input.items,
    total: Math.round(input.items.reduce((sum, item) => sum + item.total, 0) * 100) / 100,
    currency: 'EUR',
    status: send === 'Enviado' ? 'submitted' : 'draft',
    external_snapshot: null,
    last_error: null,
    submitted_at: send === 'Enviado' ? input.placedAt : null,
    source,
    shopify_integration_id: source === 'shopify' ? input.integrationId ?? null : null,
    shopify_order_id: source === 'shopify' ? `gid-${input.orderNumber}` : null,
    shopify_order_name: source === 'shopify' ? `#${input.orderNumber}` : null,
    shopify_order_number: source === 'shopify' ? input.orderNumber : null,
    shopify_deleted_at: null,
    shopify_financial_status: source === 'shopify' ? 'pending' : null,
    shopify_fulfillment_status: null,
    shopify_cancelled_at: null,
    shopify_cancel_reason: null,
    shopify_closed_at: null,
    raw_shopify_payload: null,
    lightfunnels_integration_id: source === 'lightfunnels' ? LIGHTFUNNELS_ID : null,
    lightfunnels_order_id: source === 'lightfunnels' ? `lf-${input.orderNumber}` : null,
    lightfunnels_order_name: source === 'lightfunnels' ? `#${input.orderNumber}` : null,
    commercial_status: commercial,
    send_status: send,
    delivery_status: input.delivery ?? 'Não enviado',
    delivery_status_source: 'local',
    confirmed_at: confirmed ? input.placedAt : null,
    confirmation_status_updated_at: confirmed ? input.placedAt : null,
    assigned_instance_name: input.instance,
    confirmation_message_sent_at: input.confirmationSentAt ?? null,
    confirmation_message_error: null,
    is_simulation: input.simulation ?? false,
    simulation_marker: input.simulation ? 'sandbox' : null,
    order_placed_at: input.placedAt,
    created_at: input.placedAt,
    updated_at: input.placedAt,
  }
}

export function seedOrders(): FulfillmentOrder[] {
  return ORDER_DRAFTS.map((draft) => {
    const isPt = draft.instance === DEMO_INSTANCE_PT
    const placedAt = minutesAgo(draft.minutes)
    return buildOrder({
      id: `order-${draft.n}`,
      orderNumber: draft.n,
      instance: draft.instance,
      country: isPt ? 'PT' : 'ES',
      customerName: draft.name,
      phone: draft.phone,
      address: draft.address,
      city: draft.city,
      province: draft.province,
      zipcode: draft.zip,
      items: draft.items.map(([sku, quantity]) => {
        const row = catalogBySku.get(sku)
        const price = row?.price ?? 0
        return {
          product_id: `fp-${sku.toLowerCase()}`, shopify_product_id: row?.productId, shopify_variant_id: row ? `${row.productId}-v1` : undefined,
          shopify_quantity: quantity, units_per_pack: 1, sku, name: row?.title ?? sku, quantity, unit_price: price,
          total: Math.round(price * quantity * 100) / 100,
        }
      }),
      commercial: draft.commercial,
      send: draft.send,
      delivery: draft.delivery,
      placedAt,
      conversationId: draft.conversation,
      source: draft.source,
      integrationId: isPt ? SHOPIFY_PT_ID : SHOPIFY_ES_ID,
      confirmationSentAt: draft.confirmationSent ? placedAt : null,
    })
  })
}

export function buildCheckout(input: {
  id: string
  integrationId: string | null
  instance: string
  country: string
  customerName: string
  phone: string | null
  email?: string | null
  items: Array<{ title: string; quantity: number; price: number }>
  minutes: number
  status?: ShopifyAbandonedCheckout['recovery_status']
  source?: ShopifyAbandonedCheckout['source']
  url?: string | null
  simulation?: boolean
}): ShopifyAbandonedCheckout {
  const createdAt = minutesAgo(input.minutes)
  const status = input.status ?? 'Pendente'
  return {
    id: input.id,
    shopify_integration_id: input.integrationId,
    shopify_checkout_id: `chk-${input.id}`,
    source: input.source ?? 'checkout',
    shopify_name: null,
    checkout_token: `tok-${input.id}`,
    shop_domain: input.country === 'PT' ? 'casa-brisa-pt.example' : 'casa-brisa-es.example',
    assigned_instance_name: input.instance,
    country: input.country,
    contact_phone: input.phone,
    customer_name: input.customerName,
    email: input.email ?? null,
    abandoned_checkout_url: input.url ?? `https://casa-brisa.example/checkout/${input.id}`,
    total: Math.round(input.items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100,
    currency: 'EUR',
    recovery_status: status,
    raw_shopify_payload: { line_items: input.items.map((item) => ({ ...item, name: item.title, price: String(item.price) })) },
    whatsapp_sent_at: status === 'Enviado' || status === 'Convertido' ? createdAt : null,
    recovered_at: status === 'Convertido' ? createdAt : null,
    shopify_completed_at: null,
    last_error: null,
    is_simulation: input.simulation ?? false,
    simulation_marker: input.simulation ? 'sandbox' : null,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export function seedAbandonedCheckouts(): ShopifyAbandonedCheckout[] {
  return [
    buildCheckout({ id: 'cart-1', integrationId: SHOPIFY_ES_ID, instance: DEMO_INSTANCE_ES, country: 'ES', customerName: 'Elena Prieto', phone: '34900555109', items: [{ title: 'Cojín Ortopédico Brisa', quantity: 1, price: 39.9 }], minutes: 35 }),
    buildCheckout({ id: 'cart-2', integrationId: SHOPIFY_ES_ID, instance: DEMO_INSTANCE_ES, country: 'ES', customerName: 'Javier Morales', phone: '34900555102', items: [{ title: 'Masajeador Cervical Brisa', quantity: 1, price: 49.9 }], minutes: 100, status: 'Convertido' }),
    buildCheckout({ id: 'cart-3', integrationId: SHOPIFY_PT_ID, instance: DEMO_INSTANCE_PT, country: 'PT', customerName: 'Inês Carvalho', phone: '351900555205', items: [{ title: 'Almofada Ortopédica Brisa', quantity: 2, price: 39.9 }], minutes: 220, status: 'Enviado', source: 'draft_order' }),
    buildCheckout({ id: 'cart-4', integrationId: SHOPIFY_PT_ID, instance: DEMO_INSTANCE_PT, country: 'PT', customerName: 'Nuno Bessa', phone: '351900555206', items: [{ title: 'Massajador Cervical Brisa', quantity: 1, price: 49.9 }], minutes: 1_300 }),
  ]
}

export function seedDeliveryMappings(): DeliveryStatusMapping[] {
  const rows: Array<[string, string, DeliveryStatus | null, number]> = [
    ['shipped', 'Shipped', 'Enviado', 41],
    ['out_for_delivery', 'Out for delivery', 'A caminho', 37],
    ['delivered', 'Delivered', 'Entregue', 29],
    ['incident', 'Incident', 'Novidade', 6],
    ['refused', 'Refused by customer', 'Rejeitado', 4],
    ['held_at_depot', 'Held at depot', null, 2],
  ]
  return rows.map(([external_status_key, external_label, delivery_status, seen_count]) => ({
    external_status_key, external_label, delivery_status, seen_count,
    first_seen_at: minutesAgo(30_000), last_seen_at: minutesAgo(400), updated_at: minutesAgo(400),
  }))
}

export function seedExternalLeads(): ExternalFulfillmentLead[] {
  const lead = (n: string, country: string, name: string, city: string, total: number, status: string, minutes: number): ExternalFulfillmentLead => ({
    source: 'fenixcod', lead_number: `FX-${n}`, order_number: n, country, customer_name: name, contact_phone: null, city,
    total, currency: 'EUR', status, created_at: minutesAgo(minutes), updated_at: minutesAgo(minutes - 60),
  })
  return [
    lead('1042', 'ES', 'Lucía Fernández', 'Valencia', 39.9, 'shipped', 190),
    lead('1039', 'ES', 'Carmen Ruiz', 'Málaga', 59.8, 'delivered', 4_400),
    lead('1031', 'ES', 'Andrés Castillo', 'Murcia', 49.9, 'incident', 5_900),
    lead('2014', 'PT', 'Beatriz Antunes', 'Porto', 39.9, 'out_for_delivery', 130),
    lead('2003', 'PT', 'Helena Marques', 'Faro', 39.9, 'delivered', 8_700),
  ]
}
