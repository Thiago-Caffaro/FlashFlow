import { NextRequest, NextResponse } from 'next/server'
import { upsertShopifyOrder, type ShopifyIntegrationCredentialRow } from '@/lib/shopify-confirmation-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

interface SandboxOrderItem {
  sku: string
  name: string
  price: number
  quantity: number
}

// Builds a synthetic payload in the real Shopify webhook shape and runs it
// through the same mapping/upsert code the real webhook uses, so the test
// exercises real parsing logic without ever calling the Shopify API. The
// resulting order is forced onto the sandbox WhatsApp account and flagged
// is_simulation=true, so it can never be submitted to the real FenixCOD API.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const customerName = String(body.customerName ?? '').trim()
    const phone = String(body.phone ?? '').trim()
    const email = String(body.email ?? '').trim()
    const address = String(body.address ?? '').trim()
    const city = String(body.city ?? '').trim()
    const province = String(body.province ?? '').trim()
    const zipcode = String(body.zipcode ?? '').trim()
    const country = String(body.country ?? '').trim().toUpperCase()
    const paymentType = body.paymentType === 'PREPAID' ? 'PREPAID' : 'COD'
    const items = Array.isArray(body.items) ? body.items as SandboxOrderItem[] : []
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined

    if (!customerName || !phone || !address || !city || !province || !zipcode || !country) {
      return NextResponse.json({ ok: false, error: 'Preencha todos os campos do cliente/endereço' }, { status: 400 })
    }
    if (!items.length) {
      return NextResponse.json({ ok: false, error: 'Selecione ao menos um produto' }, { status: 400 })
    }

    const lineItems = items.map((item) => ({
      sku: item.sku,
      name: item.name,
      price: item.price,
      quantity: Math.max(1, Math.trunc(item.quantity || 1)),
    }))

    const payload = {
      id: `sandbox-${Date.now()}`,
      name: `#SANDBOX${String(Date.now()).slice(-6)}`,
      order_number: `SANDBOX${String(Date.now()).slice(-6)}`,
      financial_status: paymentType === 'PREPAID' ? 'paid' : 'pending',
      currency: 'EUR',
      phone,
      email: email || undefined,
      shipping_address: {
        address1: address,
        city,
        province,
        zip: zipcode,
        country_code: country,
        phone,
        name: customerName,
      },
      line_items: lineItems,
    }

    const { data: realIntegration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, default_country')
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const integrationRow: ShopifyIntegrationCredentialRow = realIntegration
      ? {
        id: realIntegration.id,
        shop_name: realIntegration.shop_domain,
        shop_domain: realIntegration.shop_domain,
        default_country: country || realIntegration.default_country,
        active: true,
        oauth_connected: true,
        confirmation_message_template: null,
        recovery_message_template: null,
        encrypted_admin_token: '',
        admin_token_iv: '',
        admin_token_auth_tag: '',
        encrypted_webhook_secret: null,
        webhook_secret_iv: null,
        webhook_secret_auth_tag: null,
      }
      : {
        id: 'sandbox',
        shop_name: 'sandbox.local',
        shop_domain: 'sandbox.local',
        default_country: country,
        active: true,
        oauth_connected: false,
        confirmation_message_template: null,
        recovery_message_template: null,
        encrypted_admin_token: '',
        admin_token_iv: '',
        admin_token_auth_tag: '',
        encrypted_webhook_secret: null,
        webhook_secret_iv: null,
        webhook_secret_auth_tag: null,
      }

    const order = await upsertShopifyOrder(integrationRow, payload, {
      isSimulation: true,
      forceInstanceName: SANDBOX_INSTANCE_NAME,
      forceConversationId: conversationId,
    })

    return NextResponse.json({ ok: true, order })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
