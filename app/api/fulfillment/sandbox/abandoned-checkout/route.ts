import { NextRequest, NextResponse } from 'next/server'
import { createSandboxAbandonedCheckout } from '@/lib/shopify-confirmation-service'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

interface SandboxCheckoutItem {
  sku: string
  name: string
  price: number
  quantity: number
}

// Simula um carrinho abandonado no formato real do webhook checkouts/create
// e agenda os gatilhos "Carrinho abandonado" da conta sandbox — na hora
// (`immediate`) ou respeitando o delay de cada gatilho. Nunca chama a Shopify.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    const customerName = String(body.customerName ?? '').trim()
    const email = String(body.email ?? '').trim()
    const country = String(body.country ?? '').trim().toUpperCase()
    const checkoutUrl = String(body.checkoutUrl ?? '').trim()
    const immediate = body.immediate !== false
    // Rascunho (draft order) = o carrinho abandonado das lojas com formulário COD.
    const source = body.source === 'draft_order' ? 'draft_order' : 'checkout'
    const items = Array.isArray(body.items) ? body.items as SandboxCheckoutItem[] : []

    if (!conversationId) {
      return NextResponse.json({ ok: false, error: 'Escolha o contato de teste do carrinho' }, { status: 400 })
    }
    if (!country) return NextResponse.json({ ok: false, error: 'Informe o país' }, { status: 400 })
    if (!items.length) return NextResponse.json({ ok: false, error: 'Selecione ao menos um produto' }, { status: 400 })

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('conversations')
      .select('id, contact_name, contact_phone')
      .eq('id', conversationId)
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .maybeSingle()
    if (contactError) throw new Error(contactError.message)
    if (!contact) return NextResponse.json({ ok: false, error: 'Contato de teste não encontrado' }, { status: 404 })
    const contactPhone = String(contact.contact_phone ?? '').trim()
    if (!contactPhone) {
      return NextResponse.json({ ok: false, error: 'O contato de teste não tem telefone — carrinho sem telefone é ignorado pelos gatilhos' }, { status: 400 })
    }

    const lineItems = items.map((item) => ({
      sku: item.sku,
      title: item.name,
      price: Number(item.price),
      quantity: Math.max(1, Math.trunc(item.quantity || 1)),
    }))
    const total = lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const stamp = Date.now()
    const name = customerName || String(contact.contact_name ?? '')
    const nowIso = new Date(stamp).toISOString()

    const { data: realIntegration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, default_country')
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const shopDomain = realIntegration?.shop_domain ?? 'sandbox.local'

    const isDraft = source === 'draft_order'
    const payload = {
      id: isDraft ? `sandbox-${stamp}` : `sandbox-checkout-${stamp}`,
      ...(isDraft
        ? { name: `#DSANDBOX${String(stamp).slice(-4)}`, status: 'open', invoice_url: checkoutUrl || `https://${shopDomain}/invoices/sandbox-${stamp}` }
        : { token: `sandbox-${stamp}` }),
      created_at: nowIso,
      updated_at: nowIso,
      currency: 'EUR',
      total_price: total.toFixed(2),
      email: email || undefined,
      phone: contactPhone,
      ...(isDraft ? {} : { abandoned_checkout_url: checkoutUrl || `https://${shopDomain}/checkouts/sandbox-${stamp}` }),
      shipping_address: { name, phone: contactPhone, country_code: country },
      line_items: lineItems,
    }

    const result = await createSandboxAbandonedCheckout({
      integrationId: realIntegration?.id ?? null,
      shopDomain,
      defaultCountry: country,
      payload,
      contactPhone,
      immediate,
      source,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao simular carrinho',
    }, { status: 500 })
  }
}
