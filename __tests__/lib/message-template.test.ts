import type { FulfillmentOrder, ShopifyAbandonedCheckout, ShopifyProduct } from '@/types'
import {
  buildMessageTemplateValues,
  formatTextReplyMessage,
  messageUsesCheckoutVariables,
  MessageTemplateError,
  normalizeReplyInput,
  normalizeReplyWithPayload,
  renderMessageContent,
  renderMessageTemplate,
  validateMessagePlaceholders,
} from '@/lib/message-template'

function order(overrides: Partial<FulfillmentOrder> = {}): FulfillmentOrder {
  return {
    id: 'order-1',
    order_number: 'shopify-store-1001',
    lead_number: null,
    instance_name: 'wa-1',
    country: 'ESPANHA',
    conversation_id: 'conv-1',
    contact_phone: '34600000000',
    customer_name: 'Maria Silva',
    email: 'maria@example.com',
    address: 'Calle Mayor 10',
    city: 'Madrid',
    province: 'Madrid',
    zipcode: '28001',
    payment_type: 'COD',
    items: [{
      product_id: 'product-1',
      shopify_variant_id: 'variant-1',
      sku: 'SKU-1',
      name: 'Produto original',
      quantity: 1,
      unit_price: 29.9,
      total: 29.9,
    }],
    total: 29.9,
    currency: 'EUR',
    status: 'pending_operator',
    external_snapshot: null,
    last_error: null,
    submitted_at: null,
    source: 'shopify',
    shopify_integration_id: 'integration-1',
    shopify_order_id: '1001',
    shopify_order_name: '#1001',
    shopify_order_number: '1001',
    raw_shopify_payload: null,
    commercial_status: 'Não responde',
    send_status: 'Pendente',
    delivery_status: 'Não enviado',
    confirmed_at: null,
    confirmation_status_updated_at: null,
    assigned_instance_name: 'wa-1',
    confirmation_message_sent_at: null,
    confirmation_message_error: null,
    is_simulation: false,
    simulation_marker: null,
    order_placed_at: '2026-07-30T10:00:00.000Z',
    created_at: '2026-07-30T10:00:00.000Z',
    updated_at: '2026-07-30T10:00:00.000Z',
    ...overrides,
  }
}

function checkout(overrides: Partial<ShopifyAbandonedCheckout> = {}): ShopifyAbandonedCheckout {
  return {
    id: 'checkout-1',
    shopify_integration_id: 'integration-1',
    shopify_checkout_id: '987',
    source: 'checkout',
    shopify_name: null,
    checkout_token: 'cart-token',
    shop_domain: 'loja.myshopify.com',
    assigned_instance_name: 'wa-1',
    country: 'SPAIN',
    contact_phone: '34600000000',
    customer_name: 'Maria Silva',
    email: 'maria@example.com',
    abandoned_checkout_url: 'https://loja.example/checkouts/cart-token/recover',
    total: 59.8,
    currency: 'EUR',
    recovery_status: 'Pendente',
    raw_shopify_payload: {
      line_items: [
        { title: 'Lipogan', variant_title: '3 Frascos', quantity: 1, price: '49.90' },
        { title: 'Brinde', variant_title: null, quantity: 2, price: '4.95' },
      ],
    },
    whatsapp_sent_at: null,
    recovered_at: null,
    shopify_completed_at: null,
    last_error: null,
    is_simulation: false,
    simulation_marker: null,
    created_at: '2026-09-30T10:00:00.000Z',
    updated_at: '2026-09-30T10:00:00.000Z',
    ...overrides,
  }
}

describe('message templates', () => {
  it('resolves abandoned checkout variables from the checkout row and its Shopify line items', () => {
    const values = buildMessageTemplateValues({
      contact: { name: 'Maria Silva', number: '34600000000' },
      checkout: checkout(),
    })

    expect(values['carrinho.link']).toBe('https://loja.example/checkouts/cart-token/recover')
    expect(values['carrinho.cliente']).toBe('Maria Silva')
    expect(values['carrinho.total']).toContain('59,80')
    expect(values['carrinho.produtos']).toBe('- Lipogan - 3 Frascos\n- Brinde')
    expect(values['carrinho.itens']).toContain('Brinde | Qtd: 2 | 9,90')
    expect(messageUsesCheckoutVariables('Volte: {{carrinho.link}}')).toBe(true)
    expect(messageUsesCheckoutVariables('{{pedido.total}}')).toBe(false)
    expect(validateMessagePlaceholders(['{{carrinho.link}} {{carrinho.itens}}'], [])).toEqual({ ok: true })
  })

  it('refuses to send a checkout message without a recovery link instead of sending an empty placeholder', () => {
    const values = buildMessageTemplateValues({
      contact: { name: 'Maria', number: '34600000000' },
      checkout: checkout({ abandoned_checkout_url: null }),
    })

    expect(() => renderMessageTemplate('{{carrinho.link}}', values)).toThrow(MessageTemplateError)
  })

  it('resolves readable contact, order and custom variables', () => {
    const values = buildMessageTemplateValues({
      contact: { name: 'Maria Silva', number: '34600000000@s.whatsapp.net' },
      order: order(),
      customVariables: { nome_loja: 'Loja Exemplo' },
    })

    expect(values['contato.primeiro_nome']).toBe('Maria')
    expect(values['contato.nome_completo']).toBe('Maria Silva')
    expect(values['contato.numero']).toBe('34600000000')
    expect(values['pedido.numero']).toBe('#1001')
    expect(values['pedido.endereco_completo']).toContain('Calle Mayor 10, Madrid')
    expect(values['pedido.produtos']).toBe('Produto original')
    expect(values['personalizada.nome_loja']).toBe('Loja Exemplo')
  })

  it('uses local catalog names and formats multiple products as an unnumbered list', () => {
    const secondItem = {
      ...order().items[0],
      product_id: 'product-2',
      shopify_variant_id: 'variant-2',
      sku: 'SKU-2',
      name: 'Segundo original',
    }
    const catalogProduct = {
      title: 'Nome sincronizado',
      shopify_variant_id: 'variant-1',
    } as ShopifyProduct
    const values = buildMessageTemplateValues({
      contact: { name: 'Maria', number: '34600000000' },
      order: order({ items: [order().items[0], secondItem] }),
      productsByVariantId: new Map([['variant-1', catalogProduct]]),
    })

    expect(values['pedido.produtos']).toBe('- Nome sincronizado\n- Segundo original')
    expect(values['pedido.itens']).toContain('Nome sincronizado | Qtd: 1 | SKU: SKU-1')
  })

  it('falls back to the order item snapshot when the local catalog has no row', () => {
    const values = buildMessageTemplateValues({
      contact: { name: 'Maria', number: '34600000000' },
      order: order(),
      productsByVariantId: new Map(),
    })
    expect(values['pedido.produtos']).toBe('Produto original')
  })

  it('rejects unknown placeholders and missing values instead of sending empty text', () => {
    expect(validateMessagePlaceholders(['Oi {{pedido.inexistente}}'], [])).toEqual({
      ok: false,
      error: 'Variavel desconhecida: {{pedido.inexistente}}',
    })
    expect(validateMessagePlaceholders(['Oi {{1}}'], [])).toMatchObject({ ok: false })
    expect(() => renderMessageTemplate('{{pedido.email}}', { 'pedido.email': '' }))
      .toThrow(MessageTemplateError)
  })

  it('renders title, footer, buttons and textual fallback', () => {
    const rendered = renderMessageContent({
      title: 'Pedido {{pedido.numero}}',
      message: 'Hola {{contato.primeiro_nome}}',
      footer: 'Selecione',
      replyButtons: [{ id: 'confirm', label: 'CONFIRMAR PEDIDO' }],
    }, {
      contact: { name: 'Maria Silva', number: '34600000000' },
      order: order(),
    })

    expect(formatTextReplyMessage(rendered)).toBe(
      '*Pedido #1001*\n\nHola Maria\n\nSelecione\n\n1. CONFIRMAR PEDIDO'
    )
  })

  it('normalizes both numeric and native replies to the visible button label', () => {
    const buttons = [
      { id: 'confirm', label: 'CONFIRMAR PEDIDO' },
      { id: 'change', label: 'MODIFICAR DADOS' },
    ]
    expect(normalizeReplyInput('1', buttons)).toBe('CONFIRMAR PEDIDO')
    expect(normalizeReplyInput('change', buttons)).toBe('MODIFICAR DADOS')
    expect(normalizeReplyInput('modificar dados', buttons)).toBe('MODIFICAR DADOS')
  })

  it('resolves a tapped button by its payload id even when the displayed text differs from the flow label', () => {
    const buttons = [
      { id: 'btn-yes', label: 'CONFIRMAR PEDIDO' },
      { id: 'btn-no', label: 'MODIFICAR DADOS' },
    ]
    // Botão de template escrito em outro idioma na Meta: o texto não bate
    // com o label do fluxo, mas o payload é o id do botão do fluxo.
    expect(normalizeReplyWithPayload('Sí, confirmo', 'btn-yes', buttons)).toBe('CONFIRMAR PEDIDO')
    expect(normalizeReplyWithPayload('No, cambiar', 'BTN-NO', buttons)).toBe('MODIFICAR DADOS')
  })

  it('falls back to the text-based normalization when the payload is missing or not one of the flow buttons', () => {
    const buttons = [{ id: 'btn-yes', label: 'CONFIRMAR PEDIDO' }]
    expect(normalizeReplyWithPayload('confirmar pedido', null, buttons)).toBe('CONFIRMAR PEDIDO')
    expect(normalizeReplyWithPayload('confirmar pedido', 'payload-de-outra-integracao', buttons)).toBe('CONFIRMAR PEDIDO')
    expect(normalizeReplyWithPayload('quero falar com alguém', 'x', buttons)).toBe('quero falar com alguém')
  })
})
