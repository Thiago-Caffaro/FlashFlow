import { NextRequest, NextResponse } from 'next/server'
import { upsertLightfunnelsOrder } from '@/lib/lightfunnels-order-service'
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

// Pedido Lightfunnels simulado: monta o payload no formato do webhook
// order/confirmed ({ node: Order }) e roda o mesmo mapeamento/upsert do
// webhook real, sem chamar a API do Lightfunnels. O pedido vai para a conta
// Sandbox, marcado is_simulation (nunca chega ao FenixCOD), e dispara o
// gatilho "Pedido Lightfunnels criado" da conta Sandbox.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const text = (value: unknown) => String(value ?? '').trim()
    const customerName = text(body.customerName)
    const phone = text(body.phone)
    const country = text(body.country).toUpperCase()
    const items = Array.isArray(body.items) ? body.items as SandboxOrderItem[] : []
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined

    if (!customerName || !phone || !text(body.address) || !text(body.city) || !text(body.province) || !text(body.zipcode) || !country) {
      return NextResponse.json({ ok: false, error: 'Preencha todos os campos do cliente/endereço' }, { status: 400 })
    }
    if (!items.length) return NextResponse.json({ ok: false, error: 'Selecione ao menos um produto' }, { status: 400 })

    const [firstName, ...rest] = customerName.split(/\s+/)
    const stamp = String(Date.now())
    // Snapshots: um por unidade vendida, como o Lightfunnels manda.
    const snapshots = items.flatMap((item, index) => Array.from(
      { length: Math.max(1, Math.trunc(item.quantity || 1)) },
      () => ({
        __typename: 'VariantSnapshot',
        title: item.name,
        sku: item.sku,
        price: item.price,
        variant_id: `sandbox-variant-${index + 1}`,
      }),
    ))
    const address = {
      first_name: firstName,
      last_name: rest.join(' '),
      line1: text(body.address),
      city: text(body.city),
      state: text(body.province),
      zip: text(body.zipcode),
      country,
      phone,
      email: text(body.email),
    }
    const payload = {
      node: {
        id: `sandbox-${stamp}`,
        name: `#LFSANDBOX${stamp.slice(-6)}`,
        email: text(body.email) || undefined,
        phone,
        customer_full_name: customerName,
        financial_status: body.paymentType === 'PREPAID' ? 'paid' : 'pending',
        fulfillment_status: 'unfulfilled',
        currency: 'EUR',
        total: snapshots.reduce((sum, item) => sum + Number(item.price || 0), 0),
        created_at: new Date().toISOString(),
        funnel_id: 'sandbox-funnel',
        shipping_address: address,
        billing_address: address,
        items: snapshots,
      },
    }

    const { data: realIntegration } = await supabaseAdmin
      .from('lightfunnels_integrations')
      .select('id, lf_account_id, default_country')
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const order = await upsertLightfunnelsOrder(
      realIntegration
        ? { id: realIntegration.id, lf_account_id: realIntegration.lf_account_id, default_country: country || realIntegration.default_country }
        : { id: null, lf_account_id: 'sandbox', default_country: country },
      payload,
      {
        sendConfirmation: true,
        isSimulation: true,
        forceInstanceName: SANDBOX_INSTANCE_NAME,
        forceConversationId: conversationId,
      },
    )
    return NextResponse.json({ ok: true, order })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
