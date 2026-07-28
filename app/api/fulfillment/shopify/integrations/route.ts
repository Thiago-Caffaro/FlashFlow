import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/ai-crypto'
import { SHOPIFY_INTEGRATION_PUBLIC_SELECT } from '@/lib/shopify-confirmation-service'
import { normalizeShopDomain } from '@/lib/shopify-client'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function encryptedSecretPatch(prefix: 'admin_token' | 'webhook_secret', value: string) {
  const encrypted = encryptSecret(value)
  return {
    [`encrypted_${prefix}`]: encrypted.encrypted_key,
    [`${prefix}_iv`]: encrypted.iv,
    [`${prefix}_auth_tag`]: encrypted.auth_tag,
  }
}

function validText(value: unknown): string {
  return String(value ?? '').trim()
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select(SHOPIFY_INTEGRATION_PUBLIC_SELECT)
    .order('shop_domain')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, integrations: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json()
    const shopName = validText(body.shop_name || body.shopName)
    const shopDomain = normalizeShopDomain(validText(body.shop_domain || body.shopDomain))
    const adminToken = validText(body.admin_token || body.adminToken)
    const webhookSecret = validText(body.webhook_secret || body.webhookSecret)
    const defaultCountry = validText(body.default_country || body.defaultCountry).toUpperCase()

    if (!shopName || !shopDomain || !adminToken || !webhookSecret || !defaultCountry) {
      return NextResponse.json({ ok: false, error: 'Campos inválidos' }, { status: 400 })
    }

    const confirmationTemplate = body.confirmation_message_template !== undefined
      ? (validText(body.confirmation_message_template) || null)
      : null
    const recoveryTemplate = body.recovery_message_template !== undefined
      ? (validText(body.recovery_message_template) || null)
      : null

    const { data, error } = await supabaseAdmin
      .from('shopify_integrations')
      .insert({
        shop_name: shopName,
        shop_domain: shopDomain,
        default_country: defaultCountry,
        ...encryptedSecretPatch('admin_token', adminToken),
        ...encryptedSecretPatch('webhook_secret', webhookSecret),
        active: typeof body.active === 'boolean' ? body.active : true,
        confirmation_message_template: confirmationTemplate,
        recovery_message_template: recoveryTemplate,
      })
      .select(SHOPIFY_INTEGRATION_PUBLIC_SELECT)
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, integration: data })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json()
    const id = validText(body.id)
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    // Confirma que a integração existe antes de aplicar qualquer alteração —
    // mesma cautela usada em app/api/fulfillment/integrations/route.ts.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain')
      .eq('id', id)
      .single()
    if (existingError || !existing) {
      return NextResponse.json({ ok: false, error: existingError?.message ?? 'Integração não encontrada' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.shop_name !== undefined || body.shopName !== undefined) {
      const shopName = validText(body.shop_name || body.shopName)
      if (!shopName) return NextResponse.json({ ok: false, error: 'Nome da loja inválido' }, { status: 400 })
      patch.shop_name = shopName
    }
    if (body.shop_domain !== undefined || body.shopDomain !== undefined) {
      const shopDomain = normalizeShopDomain(validText(body.shop_domain || body.shopDomain))
      // O domínio da loja identifica a integração (webhooks HMAC, pedidos já
      // associados etc.) — trocá-lo silenciosamente misturaria dados de duas
      // lojas Shopify diferentes sob o mesmo registro.
      if (!shopDomain || shopDomain !== existing.shop_domain) {
        return NextResponse.json({ ok: false, error: 'O domínio da loja não pode ser alterado; crie uma nova integração.' }, { status: 400 })
      }
    }
    if (body.default_country !== undefined || body.defaultCountry !== undefined) {
      const defaultCountry = validText(body.default_country || body.defaultCountry).toUpperCase()
      if (!defaultCountry) return NextResponse.json({ ok: false, error: 'País padrão inválido' }, { status: 400 })
      patch.default_country = defaultCountry
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return NextResponse.json({ ok: false, error: 'Status ativo inválido' }, { status: 400 })
      patch.active = body.active
    }
    const adminToken = validText(body.admin_token || body.adminToken)
    if (adminToken) Object.assign(patch, encryptedSecretPatch('admin_token', adminToken))
    const webhookSecret = validText(body.webhook_secret || body.webhookSecret)
    if (webhookSecret) Object.assign(patch, encryptedSecretPatch('webhook_secret', webhookSecret))
    if (body.confirmation_message_template !== undefined) {
      patch.confirmation_message_template = validText(body.confirmation_message_template) || null
    }
    if (body.recovery_message_template !== undefined) {
      patch.recovery_message_template = validText(body.recovery_message_template) || null
    }

    const { data, error } = await supabaseAdmin
      .from('shopify_integrations')
      .update(patch)
      .eq('id', id)
      .select(SHOPIFY_INTEGRATION_PUBLIC_SELECT)
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, integration: data })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const id = validText(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SHOPIFY_INTEGRATION_PUBLIC_SELECT)
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, integration: data })
}
