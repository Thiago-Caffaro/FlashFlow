import type { FlowReplyButton, FulfillmentOrder, ShopifyProduct } from '@/types'

export interface AutomaticMessageVariable {
  key: string
  label: string
  group: 'Contato' | 'Pedido'
  description: string
}

export interface MessageTemplateContext {
  contact: {
    name: string | null
    number: string
  }
  order?: FulfillmentOrder | null
  productsByVariantId?: Map<string, ShopifyProduct>
  customVariables?: Record<string, string>
}

export interface RenderedMessageContent {
  title: string
  message: string
  footer: string
  replyButtons: FlowReplyButton[]
}

export class MessageTemplateError extends Error {
  constructor(
    public readonly code: 'unknown_variable' | 'missing_value',
    public readonly variable: string,
    message: string
  ) {
    super(message)
    this.name = 'MessageTemplateError'
  }
}

export const AUTOMATIC_MESSAGE_VARIABLES: AutomaticMessageVariable[] = [
  { key: 'contato.primeiro_nome', label: 'Primeiro nome', group: 'Contato', description: 'Primeiro nome do contato' },
  { key: 'contato.nome_completo', label: 'Nome completo', group: 'Contato', description: 'Nome completo do contato' },
  { key: 'contato.numero', label: 'Numero', group: 'Contato', description: 'Numero do WhatsApp do contato' },
  { key: 'pedido.numero', label: 'Numero do pedido', group: 'Pedido', description: 'Numero legivel do pedido' },
  { key: 'pedido.cliente', label: 'Cliente', group: 'Pedido', description: 'Nome do cliente no pedido' },
  { key: 'pedido.email', label: 'E-mail', group: 'Pedido', description: 'E-mail do cliente' },
  { key: 'pedido.endereco', label: 'Endereco', group: 'Pedido', description: 'Rua e numero do endereco' },
  { key: 'pedido.endereco_completo', label: 'Endereco completo', group: 'Pedido', description: 'Endereco, cidade, provincia, CEP e pais' },
  { key: 'pedido.cidade', label: 'Cidade', group: 'Pedido', description: 'Cidade de entrega' },
  { key: 'pedido.provincia', label: 'Provincia', group: 'Pedido', description: 'Provincia ou estado de entrega' },
  { key: 'pedido.cep', label: 'CEP', group: 'Pedido', description: 'Codigo postal de entrega' },
  { key: 'pedido.pais', label: 'Pais', group: 'Pedido', description: 'Pais de entrega' },
  { key: 'pedido.pagamento', label: 'Pagamento', group: 'Pedido', description: 'Forma de pagamento' },
  { key: 'pedido.total', label: 'Total', group: 'Pedido', description: 'Total formatado com moeda' },
  { key: 'pedido.moeda', label: 'Moeda', group: 'Pedido', description: 'Codigo da moeda' },
  { key: 'pedido.status', label: 'Status', group: 'Pedido', description: 'Status geral do pedido' },
  { key: 'pedido.status_comercial', label: 'Status comercial', group: 'Pedido', description: 'Status de confirmacao comercial' },
  { key: 'pedido.status_envio', label: 'Status de envio', group: 'Pedido', description: 'Status de envio ao fulfillment' },
  { key: 'pedido.status_entrega', label: 'Status de entrega', group: 'Pedido', description: 'Status da entrega' },
  { key: 'pedido.data', label: 'Data', group: 'Pedido', description: 'Data de criacao do pedido' },
  { key: 'pedido.produtos', label: 'Produtos', group: 'Pedido', description: 'Nomes dos produtos, um por linha' },
  { key: 'pedido.itens', label: 'Itens detalhados', group: 'Pedido', description: 'Produtos com quantidade, SKU e valores' },
]

const AUTOMATIC_KEYS = new Set(AUTOMATIC_MESSAGE_VARIABLES.map((variable) => variable.key))
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

function normalizePhone(value: string): string {
  return value.replace(/@.+$/, '').replace(/\D/g, '')
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`.trim()
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function itemName(
  item: FulfillmentOrder['items'][number],
  productsByVariantId?: Map<string, ShopifyProduct>
): string {
  const localProduct = item.shopify_variant_id
    ? productsByVariantId?.get(item.shopify_variant_id)
    : undefined
  return localProduct?.title?.trim() || item.name?.trim()
}

function orderValues(
  order: FulfillmentOrder,
  productsByVariantId?: Map<string, ShopifyProduct>
): Record<string, string> {
  const productNames = order.items.map((item) => itemName(item, productsByVariantId))
  const products = productNames.length === 1
    ? productNames[0]
    : productNames.map((name) => `- ${name}`).join('\n')
  const items = order.items.map((item, index) => {
    const name = productNames[index]
    const sku = item.sku ? ` | SKU: ${item.sku}` : ''
    return `${name} | Qtd: ${item.quantity}${sku} | ${formatMoney(item.total, order.currency)}`
  }).join('\n')
  const fullAddress = [
    order.address,
    order.city,
    order.province,
    order.zipcode,
    order.country,
  ].map((part) => part?.trim()).filter(Boolean).join(', ')

  return {
    'pedido.numero': order.shopify_order_name || order.order_number,
    'pedido.cliente': order.customer_name,
    'pedido.email': order.email || '',
    'pedido.endereco': order.address,
    'pedido.endereco_completo': fullAddress,
    'pedido.cidade': order.city,
    'pedido.provincia': order.province,
    'pedido.cep': order.zipcode,
    'pedido.pais': order.country,
    'pedido.pagamento': order.payment_type,
    'pedido.total': formatMoney(order.total, order.currency),
    'pedido.moeda': order.currency,
    'pedido.status': order.status,
    'pedido.status_comercial': order.commercial_status,
    'pedido.status_envio': order.send_status,
    'pedido.status_entrega': order.delivery_status,
    'pedido.data': formatDate(order.created_at),
    'pedido.produtos': products,
    'pedido.itens': items,
  }
}

export function getMessagePlaceholders(...templates: Array<string | null | undefined>): string[] {
  const placeholders = new Set<string>()
  for (const template of templates) {
    if (!template) continue
    for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
      placeholders.add(match[1].trim())
    }
  }
  return [...placeholders]
}

export function messageUsesOrderVariables(...templates: Array<string | null | undefined>): boolean {
  return getMessagePlaceholders(...templates).some((key) => key.startsWith('pedido.'))
}

export function messageUsesProductVariables(...templates: Array<string | null | undefined>): boolean {
  return getMessagePlaceholders(...templates).some((key) => (
    key === 'pedido.produtos' || key === 'pedido.itens'
  ))
}

export function validateMessagePlaceholders(
  templates: Array<string | null | undefined>,
  customKeys: Iterable<string>
): { ok: true } | { ok: false; error: string } {
  const knownCustomKeys = new Set([...customKeys].map((key) => `personalizada.${key}`))
  for (const key of getMessagePlaceholders(...templates)) {
    if (!AUTOMATIC_KEYS.has(key) && !knownCustomKeys.has(key)) {
      return { ok: false, error: `Variavel desconhecida: {{${key}}}` }
    }
  }
  return { ok: true }
}

export function buildMessageTemplateValues(context: MessageTemplateContext): Record<string, string> {
  const fullName = context.contact.name?.trim() || ''
  const values: Record<string, string> = {
    'contato.primeiro_nome': fullName.split(/\s+/)[0] || '',
    'contato.nome_completo': fullName,
    'contato.numero': normalizePhone(context.contact.number),
  }

  if (context.order) {
    Object.assign(values, orderValues(context.order, context.productsByVariantId))
  }
  for (const [key, value] of Object.entries(context.customVariables ?? {})) {
    values[`personalizada.${key}`] = value
  }
  return values
}

export function renderMessageTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (!(key in values)) {
      throw new MessageTemplateError(
        'unknown_variable',
        key,
        `Variavel desconhecida: {{${key}}}`
      )
    }
    const value = values[key]
    if (!value?.trim()) {
      throw new MessageTemplateError(
        'missing_value',
        key,
        `Nao foi possivel resolver {{${key}}}`
      )
    }
    return value
  })
}

export function renderMessageContent(
  content: {
    title?: string
    message?: string
    footer?: string
    replyButtons?: FlowReplyButton[]
  },
  context: MessageTemplateContext
): RenderedMessageContent {
  const values = buildMessageTemplateValues(context)
  return {
    title: renderMessageTemplate(content.title ?? '', values),
    message: renderMessageTemplate(content.message ?? '', values),
    footer: renderMessageTemplate(content.footer ?? '', values),
    replyButtons: (content.replyButtons ?? []).map((button) => ({
      id: button.id,
      label: renderMessageTemplate(button.label, values),
    })),
  }
}

export function formatTextReplyMessage(content: RenderedMessageContent): string {
  const sections: string[] = []
  if (content.title.trim()) sections.push(`*${content.title.trim()}*`)
  if (content.message.trim()) sections.push(content.message.trim())
  if (content.footer.trim()) sections.push(content.footer.trim())
  if (content.replyButtons.length > 0) {
    sections.push(content.replyButtons.map((button, index) => `${index + 1}. ${button.label}`).join('\n'))
  }
  return sections.join('\n\n')
}

export function normalizeReplyInput(
  input: string,
  buttons: FlowReplyButton[]
): string {
  const trimmed = input.trim()
  const option = Number.parseInt(trimmed, 10)
  if (/^\d+$/.test(trimmed) && option >= 1 && option <= buttons.length) {
    return buttons[option - 1].label
  }
  const matching = buttons.find((button) => (
    button.id.toLocaleLowerCase() === trimmed.toLocaleLowerCase()
    || button.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase()
  ))
  return matching?.label ?? trimmed
}

// Resposta a botão vinda da Cloud API: o id que enviamos (payload) é o dado
// confiável para achar o botão do fluxo; o texto exibido só serve de
// fallback (digitado à mão, ou payload que não é nosso).
export function normalizeReplyWithPayload(
  content: string,
  payload: string | null,
  buttons: FlowReplyButton[]
): string {
  const normalizedPayload = payload?.trim().toLocaleLowerCase()
  const byPayload = normalizedPayload
    ? buttons.find((button) => button.id.toLocaleLowerCase() === normalizedPayload)
    : undefined
  return byPayload?.label ?? normalizeReplyInput(content, buttons)
}
