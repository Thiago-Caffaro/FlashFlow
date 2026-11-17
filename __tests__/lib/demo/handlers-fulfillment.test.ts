import { registerDemoHandlers } from '@/lib/demo/handlers'
import { dispatch } from '@/lib/demo/router'
import { resetStore } from '@/lib/demo/store'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'
import type { Flow, FlowReplyButton, FulfillmentOrder, Message, SandboxContact, ShopifyAbandonedCheckout } from '@/types'

const orders = async () => (await dispatch('GET', '/api/fulfillment/orders', undefined)).json.orders as FulfillmentOrder[]

const sandboxChat = async (conversationId: string) => {
  const { json } = await dispatch('GET', `/api/fulfillment/sandbox/message?conversationId=${conversationId}`, undefined)
  return { messages: json.messages as Message[], replyButtons: json.replyButtons as FlowReplyButton[] }
}

const say = (conversationId: string, text: string) =>
  dispatch('POST', '/api/fulfillment/sandbox/message', { text, conversationId })

describe('demo: fulfillment', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => resetStore())

  it('tem 12 pedidos de exemplo em vários estados', async () => {
    const list = await orders()
    expect(list).toHaveLength(12)
    expect(new Set(list.map((o) => o.commercial_status)).size).toBeGreaterThan(2)
    expect(new Set(list.map((o) => o.delivery_status)).size).toBeGreaterThan(2)
  })

  it('mudar o estado de um pedido reflete-se na listagem', async () => {
    const target = (await orders()).find((o) => o.commercial_status === 'Não responde')!
    const result = await dispatch('PATCH', `/api/fulfillment/orders/${target.id}`, { commercial_status: 'Confirmado Call' })
    expect(result.json.ok).toBe(true)
    const after = (await orders()).find((o) => o.id === target.id)!
    expect(after.commercial_status).toBe('Confirmado Call')
    expect(after.confirmed_at).not.toBeNull()
  })

  it('a atualização em massa altera vários pedidos e conta os que falham', async () => {
    const [a, b] = await orders()
    const result = await dispatch('PATCH', '/api/fulfillment/orders/bulk-status', { ids: [a.id, b.id, 'nao-existe'], commercial_status: 'Desistiu' })
    expect(result.json).toMatchObject({ ok: true, succeeded: 2, failed: 1 })
    const after = await orders()
    expect(after.filter((o) => [a.id, b.id].includes(o.id)).every((o) => o.commercial_status === 'Desistiu')).toBe(true)
  })

  it('enviar ao fulfillment marca o pedido como enviado', async () => {
    const target = (await orders()).find((o) => o.send_status === 'Pendente')!
    const result = await dispatch('POST', `/api/fulfillment/orders/${target.id}/submit`, undefined)
    expect((result.json.order as FulfillmentOrder).send_status).toBe('Enviado')
    expect((result.json.order as FulfillmentOrder).lead_number).toBeTruthy()
  })

  it('devolve o detalhe de um pedido com eventos', async () => {
    const [first] = await orders()
    const detail = await dispatch('GET', `/api/fulfillment/orders/${first.id}`, undefined)
    expect((detail.json.order as FulfillmentOrder).id).toBe(first.id)
    expect(Array.isArray(detail.json.events)).toBe(true)
  })

  it('carrinhos abandonados: lista e marca a recuperação como enviada', async () => {
    const list = (await dispatch('GET', '/api/fulfillment/shopify/abandoned-checkouts', undefined)).json.checkouts as ShopifyAbandonedCheckout[]
    const pending = list.find((c) => c.recovery_status === 'Pendente')!
    expect((await dispatch('POST', `/api/fulfillment/shopify/abandoned-checkouts/${pending.id}/recover`, undefined)).json.ok).toBe(true)
    const after = (await dispatch('GET', '/api/fulfillment/shopify/abandoned-checkouts', undefined)).json.checkouts as ShopifyAbandonedCheckout[]
    expect(after.find((c) => c.id === pending.id)!.recovery_status).toBe('Enviado')
  })

  it('o que a página carrega ao abrir responde ok', async () => {
    for (const path of [
      '/api/fulfillment/integrations', '/api/fulfillment/shopify/integrations', '/api/fulfillment/shopify/products',
      '/api/fulfillment/products', '/api/settings/shopify-triggers', '/api/settings/shopify-order-account',
      '/api/fulfillment/lightfunnels/integrations', '/api/fulfillment/lightfunnels/products',
    ]) {
      expect((await dispatch('GET', path, undefined)).json.ok).toBe(true)
    }
    expect((await dispatch('POST', '/api/fulfillment/shopify/webhooks/ensure', {})).json.ok).toBe(true)
  })
})

describe('demo: sandbox', () => {
  beforeAll(() => registerDemoHandlers())
  beforeEach(() => resetStore())

  const firstContact = async () =>
    ((await dispatch('GET', '/api/fulfillment/sandbox/contacts', undefined)).json.contacts as SandboxContact[])[0]

  it('uma mensagem do cliente dispara o fluxo de mensagem da conta sandbox', async () => {
    const contact = await firstContact()
    await say(contact.id, 'Olá')
    const { messages } = await sandboxChat(contact.id)
    expect(messages[0]).toMatchObject({ direction: 'inbound', content: 'Olá' })
    expect(messages.some((m) => m.direction === 'outbound')).toBe(true)
  })

  it('um pedido simulado corre o fluxo de confirmação e os botões decidem o ramo', async () => {
    const contact = await firstContact()
    const created = await dispatch('POST', '/api/fulfillment/sandbox/shopify-order', {
      customerName: 'Ana Teste', phone: '351900000000', email: '', address: 'Rua Inventada 1', city: 'Lisboa', province: 'Lisboa',
      zipcode: '0000-000', country: 'PT', paymentType: 'COD',
      items: [{ sku: 'ALM-01', name: 'Almofada Ortopédica Brisa', price: 39.9, quantity: 1 }],
      conversationId: contact.id,
    })
    const order = created.json.order as FulfillmentOrder
    expect(order).toMatchObject({ is_simulation: true, customer_name: 'Ana Teste', total: 39.9 })
    expect((await orders()).some((o) => o.id === order.id)).toBe(true)

    const first = await sandboxChat(contact.id)
    const confirmation = first.messages[first.messages.length - 1]
    expect(confirmation.sender_type).toBe('flow')
    expect(confirmation.content).toContain('Ana')
    expect(confirmation.content).toContain('Almofada Ortopédica Brisa')
    expect(first.replyButtons.length).toBeGreaterThan(0)

    await say(contact.id, first.replyButtons[0].label)
    const second = await sandboxChat(contact.id)
    expect(second.replyButtons).toEqual([])
    expect(second.messages.length).toBeGreaterThan(first.messages.length + 1)
    expect((await orders()).find((o) => o.id === order.id)!.commercial_status).toBe('Confirmado WhatsApp')
  })

  it('o sandbox corre o fluxo tal como foi editado', async () => {
    const contact = await firstContact()
    const flows = (await dispatch('GET', `/api/flows?instance=${SANDBOX_INSTANCE_NAME}`, undefined)).json.flows as Flow[]
    const messageFlow = flows.find((f) => f.json.nodes.some((n) => n.type === 'condition'))!
    const json = {
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'm', type: 'sendMessage', position: { x: 0, y: 100 }, data: { message: 'Texto novo do editor' } },
        { id: 'e', type: 'end', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 's', target: 'm' }, { id: 'e2', source: 'm', target: 'e' }],
    }
    await dispatch('PUT', `/api/flows/${messageFlow.id}`, { json, instance_name: SANDBOX_INSTANCE_NAME })
    await say(contact.id, 'Olá')
    const { messages } = await sandboxChat(contact.id)
    expect(messages[messages.length - 1].content).toBe('Texto novo do editor')
  })

  it('reiniciar limpa a conversa de teste', async () => {
    const contact = await firstContact()
    await say(contact.id, 'Olá')
    await dispatch('POST', '/api/fulfillment/sandbox/reset', { conversationId: contact.id })
    const { messages, replyButtons } = await sandboxChat(contact.id)
    expect(messages).toEqual([])
    expect(replyButtons).toEqual([])
  })

  it('contactos de teste: adicionar e remover', async () => {
    const created = (await dispatch('POST', '/api/fulfillment/sandbox/contacts', { contactName: 'Novo', contactPhone: '351900000001' })).json.contact as SandboxContact
    expect(created.contact_name).toBe('Novo')
    await dispatch('DELETE', `/api/fulfillment/sandbox/contacts/${created.id}`, undefined)
    const list = (await dispatch('GET', '/api/fulfillment/sandbox/contacts', undefined)).json.contacts as SandboxContact[]
    expect(list.some((c) => c.id === created.id)).toBe(false)
  })
})
