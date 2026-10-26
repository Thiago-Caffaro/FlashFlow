import { NextRequest, NextResponse } from 'next/server'
import { verifyLightfunnelsWebhookHmac } from '@/lib/lightfunnels-client'
import { getLightfunnelsAppCredentials, loadLightfunnelsIntegration } from '@/lib/lightfunnels-integration-store'
import { unwrapLightfunnelsNode, upsertLightfunnelsOrder } from '@/lib/lightfunnels-order-service'
import { deleteLightfunnelsProductByLfId, syncLightfunnelsProductById } from '@/lib/lightfunnels-products-service'
import { getLightfunnelsTriggersEnabled } from '@/lib/lightfunnels-trigger-settings'
import { isLightfunnelsWebhookEvent } from '@/lib/lightfunnels-webhook-setup'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const log = createLogger('lightfunnels-webhook')

// POST /api/webhook/lightfunnels?integration={id}&event={type}
// Rota pública (proxy.ts); a autenticação é o HMAC lightfunnels-hmac com o
// client secret do app. Integração e evento vêm na query porque o payload
// do Lightfunnels só traz { node }.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const integrationId = req.nextUrl.searchParams.get('integration') ?? ''
  const event = req.nextUrl.searchParams.get('event') ?? ''

  if (!/^[0-9a-f-]{36}$/i.test(integrationId)) {
    return NextResponse.json({ ok: false, error: 'Integração inválida' }, { status: 400 })
  }

  let integration
  try {
    integration = await loadLightfunnelsIntegration(integrationId)
  } catch (error) {
    log.error('integration load failed', { integrationId, error })
    return NextResponse.json({ ok: false, error: 'Falha ao carregar integração' }, { status: 500 })
  }
  if (!integration || !integration.active) {
    return NextResponse.json({ ok: false, error: 'Integração não encontrada' }, { status: 404 })
  }

  const { clientSecret } = await getLightfunnelsAppCredentials()
  if (!verifyLightfunnelsWebhookHmac(rawBody, req.headers.get('lightfunnels-hmac'), clientSecret)) {
    log.warn('invalid hmac', { integrationId, event }, { throttleKey: `hmac:${integrationId}` })
    return NextResponse.json({ ok: false, error: 'Invalid webhook' }, { status: 401 })
  }

  if (!isLightfunnelsWebhookEvent(event)) {
    return NextResponse.json({ ok: false, error: 'Evento não suportado' }, { status: 400 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }
  const node = unwrapLightfunnelsNode(payload)

  try {
    await supabaseAdmin
      .from('lightfunnels_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integration.id)

    switch (event) {
      case 'order/confirmed': {
        const sendConfirmation = await getLightfunnelsTriggersEnabled()
        await upsertLightfunnelsOrder(integration, node, { sendConfirmation })
        break
      }
      case 'order/updated':
      case 'order/cancelled':
      case 'order/uncancelled':
      case 'order/refunded':
      case 'order/fulfilled':
        await upsertLightfunnelsOrder(integration, node, { sendConfirmation: false })
        break
      case 'payment/paid':
        // O payload de pagamento não traz o pedido completo; o order/updated
        // que acompanha a mudança de financial_status atualiza o pedido.
        log.debug('payment paid', { integrationId, paymentId: node.id })
        break
      case 'product/created':
      case 'product/updated':
        if (typeof node.id === 'string' || typeof node.id === 'number') {
          await syncLightfunnelsProductById(integration, String(node.id))
        }
        break
      case 'product/deleted':
        if (typeof node.id === 'string' || typeof node.id === 'number') {
          await deleteLightfunnelsProductByLfId(integration.id, String(node.id))
        }
        break
      case 'app/uninstalled':
        await supabaseAdmin
          .from('lightfunnels_integrations')
          .update({
            active: false,
            oauth_connected: false,
            last_error: 'App desinstalado no Lightfunnels',
            webhook_ids: {},
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id)
        break
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    // 500 faz o Lightfunnels reenviar (quando houver retry do lado dele).
    log.error('webhook processing failed', { integrationId, event, error })
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao processar webhook',
    }, { status: 500 })
  }
}
