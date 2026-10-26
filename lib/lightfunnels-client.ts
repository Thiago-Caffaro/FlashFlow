import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Cliente da API GraphQL do Lightfunnels (https://developer.lightfunnels.com).
// Endpoint único, POST com { query, variables } e Authorization: Bearer.
// O token é passado pronto — quem renova (2h de validade, refresh rotativo)
// é lib/lightfunnels-token.ts.

export const LIGHTFUNNELS_GRAPHQL_URL = 'https://services.lightfunnels.com/api/v2'
export const LIGHTFUNNELS_OAUTH_URL = 'https://app.lightfunnels.com/admin/oauth'
export const LIGHTFUNNELS_TOKEN_URL = 'https://api.lightfunnels.com/api/v3/access_token'
export const LIGHTFUNNELS_DEFAULT_SCOPES = 'orders,products,funnels'

export class LightfunnelsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: Array<{ message?: string; key?: string }> = []
  ) {
    super(message)
    this.name = 'LightfunnelsApiError'
  }
}

// Webhooks do Lightfunnels: HMAC-SHA256 do corpo com o client secret do app,
// em base64, no header lightfunnels-hmac. A documentação assina
// JSON.stringify(req.body) — que coincide com o corpo cru quando o LF manda
// JSON compacto. Conferimos as duas formas para não depender disso.
export function verifyLightfunnelsWebhookHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false
  const candidates = [rawBody]
  try {
    const reserialized = JSON.stringify(JSON.parse(rawBody))
    if (reserialized !== rawBody) candidates.push(reserialized)
  } catch {
    return false
  }
  const received = Buffer.from(hmacHeader.trim())
  return candidates.some((body) => {
    const expected = Buffer.from(createHmac('sha256', secret).update(body, 'utf8').digest('base64'))
    return expected.length === received.length && timingSafeEqual(expected, received)
  })
}

export interface LightfunnelsPage<T> {
  nodes: T[]
  endCursor: string | null
  hasNextPage: boolean
}

interface Connection<T> {
  edges?: Array<{ node: T }>
  pageInfo?: { endCursor?: string | null; hasNextPage?: boolean }
}

function toPage<T>(connection: Connection<T> | null | undefined): LightfunnelsPage<T> {
  return {
    nodes: (connection?.edges ?? []).map((edge) => edge.node),
    endCursor: connection?.pageInfo?.endCursor ?? null,
    hasNextPage: connection?.pageInfo?.hasNextPage === true,
  }
}

// Campos do pedido que o FlashFlow usa — só os documentados no tipo Order
// (um campo inexistente derruba a query inteira). O webhook order/* entrega
// mais coisa em `node` (funnel_id, store_id); o mapeamento
// (lib/lightfunnels-order-service.ts) aceita os dois formatos.
export const LIGHTFUNNELS_ORDER_FIELDS = `
  id _id name account_id email phone customer_full_name
  financial_status fulfillment_status test
  total subtotal shipping currency paid_by_customer refunded_amount
  notes tags created_at updated_at cancelled_at archived_at
  shipping_address { first_name last_name line1 line2 city area state zip country phone email }
  billing_address { first_name last_name line1 line2 city area state zip country phone email }
  customer { id email phone first_name last_name full_name }
  items {
    ... on VariantSnapshot { __typename title sku price variant_id fulfillment_status financial_status removed_at tracking_number tracking_link carrier }
    ... on OrderBumpSnapshot { __typename title sku price product_id fulfillment_status financial_status removed_at tracking_number tracking_link carrier }
  }
  payments { id total paid financial_status paymentMethodLabel }
`

export const LIGHTFUNNELS_PRODUCT_FIELDS = `
  id _id title sku price
  thumbnail { path }
  variants { id _id title sku price }
`

export class LightfunnelsClient {
  constructor(private readonly accessToken: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(LIGHTFUNNELS_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    })
    const text = await res.text()
    let json: { data?: T; errors?: Array<{ message?: string; key?: string }> } = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new LightfunnelsApiError(`Lightfunnels respondeu ${res.status} sem JSON`, res.status)
    }
    if (!res.ok || (json.errors && json.errors.length > 0)) {
      const message = json.errors?.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${res.status}`
      throw new LightfunnelsApiError(`Lightfunnels: ${message}`, res.status, json.errors ?? [])
    }
    if (!json.data) throw new LightfunnelsApiError('Lightfunnels respondeu sem data', res.status)
    return json.data
  }

  async getAccountId(): Promise<string> {
    const data = await this.graphql<{ account?: { id?: string } }>('query AccountQuery { account { id } }')
    const id = data.account?.id
    if (!id) throw new LightfunnelsApiError('Lightfunnels não retornou o id da conta', 200)
    return String(id)
  }

  async getOrder(id: string): Promise<Record<string, unknown> | null> {
    const data = await this.graphql<{ node?: Record<string, unknown> | null }>(
      `query OrderQuery($id: ID!) { node(id: $id) { ... on Order { ${LIGHTFUNNELS_ORDER_FIELDS} } } }`,
      { id }
    )
    return data.node ?? null
  }

  async listOrdersPage(input: { query?: string; first?: number; after?: string | null } = {}): Promise<LightfunnelsPage<Record<string, unknown>>> {
    const data = await this.graphql<{ orders?: Connection<Record<string, unknown>> }>(
      `query OrdersQuery($query: String!, $first: Int, $after: String) {
        orders(query: $query, first: $first, after: $after) {
          edges { node { ${LIGHTFUNNELS_ORDER_FIELDS} } }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      { query: input.query ?? 'order_by:id order_dir:desc', first: input.first ?? 25, after: input.after ?? null }
    )
    return toPage(data.orders)
  }

  // Só tags/notes. A doc marca `items` como obrigatório no InputOrder ao
  // atualizar — se a API recusar, o erro volta para quem chamou (write-back
  // grava em lightfunnels_writeback_error) em vez de mexer nos itens.
  async updateOrderTags(id: string, input: { tags: string[]; notes?: string }): Promise<void> {
    await this.graphql(
      `mutation UpdateOrder($id: ID!, $node: InputOrder!) { updateOrder(id: $id, node: $node) { id } }`,
      { id, node: { tags: input.tags, ...(input.notes !== undefined ? { notes: input.notes } : {}) } }
    )
  }

  async listProductsPage(input: { first?: number; after?: string | null } = {}): Promise<LightfunnelsPage<Record<string, unknown>>> {
    const data = await this.graphql<{ products?: Connection<Record<string, unknown>> }>(
      `query ProductsQuery($query: String!, $first: Int, $after: String) {
        products(query: $query, first: $first, after: $after) {
          edges { node { ${LIGHTFUNNELS_PRODUCT_FIELDS} } }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      { query: 'order_by:id order_dir:asc', first: input.first ?? 50, after: input.after ?? null }
    )
    return toPage(data.products)
  }

  async getProduct(id: string): Promise<Record<string, unknown> | null> {
    const data = await this.graphql<{ node?: Record<string, unknown> | null }>(
      `query ProductQuery($id: ID!) { node(id: $id) { ... on Product { ${LIGHTFUNNELS_PRODUCT_FIELDS} } } }`,
      { id }
    )
    return data.node ?? null
  }

  async listFunnelsPage(input: { first?: number; after?: string | null } = {}): Promise<LightfunnelsPage<{ id: string; name: string; published: boolean }>> {
    const data = await this.graphql<{ funnels?: Connection<{ id: string; name: string; published: boolean }> }>(
      `query FunnelsQuery($query: String!, $first: Int, $after: String) {
        funnels(query: $query, first: $first, after: $after) {
          edges { node { id name published } }
          pageInfo { endCursor hasNextPage }
        }
      }`,
      { query: 'order_by:id order_dir:desc', first: input.first ?? 50, after: input.after ?? null }
    )
    return toPage(data.funnels)
  }

  async createWebhook(input: { type: string; url: string }): Promise<string> {
    const data = await this.graphql<{ createWebhook?: { id?: string } }>(
      `mutation CreateWebhook($node: WebhookInput!) { createWebhook(node: $node) { id type url } }`,
      { node: { type: input.type, url: input.url, settings: {} } }
    )
    const id = data.createWebhook?.id
    if (!id) throw new LightfunnelsApiError(`Webhook ${input.type} criado sem id`, 200)
    return String(id)
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.graphql(`mutation DeleteWebhook($id: ID!) { deleteWebhook(id: $id) }`, { id })
  }
}
