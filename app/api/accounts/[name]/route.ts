import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}
  if (body.country !== undefined) {
    const country = String(body.country ?? '').trim().toUpperCase()
    if (!country) return NextResponse.json({ ok: false, error: 'country required' }, { status: 400 })
    patch.country = country
  }
  if (body.confirmationEnabled !== undefined || body.confirmation_enabled !== undefined) {
    const value = body.confirmationEnabled ?? body.confirmation_enabled
    if (typeof value !== 'boolean') return NextResponse.json({ ok: false, error: 'confirmationEnabled invalid' }, { status: 400 })
    patch.confirmation_enabled = value
  }
  if (body.confirmationPriority !== undefined || body.confirmation_priority !== undefined) {
    const value = Number(body.confirmationPriority ?? body.confirmation_priority)
    if (!Number.isInteger(value) || value < 0) return NextResponse.json({ ok: false, error: 'confirmationPriority invalid' }, { status: 400 })
    patch.confirmation_priority = value
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Nenhuma alteração informada' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('accounts')
    .update(patch)
    .eq('instance_name', name)
    .select('instance_name, label, country, confirmation_enabled, confirmation_priority')
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, account: data })
}

// DELETE /api/accounts/[name] — remove conta + todos os dados relacionados
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  if (name === SANDBOX_INSTANCE_NAME) {
    return NextResponse.json({ ok: false, error: 'A conta de sandbox não pode ser removida' }, { status: 403 })
  }
  console.log(`[DELETE accounts] iniciando remoção de "${name}"`)

  const { data: accountRow } = await supabaseAdmin
    .from('accounts')
    .select('provider')
    .eq('instance_name', name)
    .maybeSingle()
  const isEvolutionAccount = (accountRow as { provider?: string } | null)?.provider !== 'cloud_api'

  // Rastreia falhas por etapa em vez de assumir sucesso silenciosamente.
  // Nenhuma etapa individual usa transação (são tabelas/serviços
  // independentes), mas o retry é seguro: apagar linhas já apagadas não é
  // erro, então rodar este endpoint de novo após uma falha parcial completa
  // só o que faltou — não recria nem duplica nada.
  const failedSteps: string[] = []

  try {
    // ── 0/1. Evolution API — só para contas desse provedor. Contas Cloud API
    // não têm instância na Evolution; whatsapp_cloud_credentials é limpa via
    // ON DELETE CASCADE quando a linha de accounts (etapa 11) for removida. ──
    if (isEvolutionAccount) {
      // Log diagnóstico: verificar IsOnWhatsapp da Evolution API antes de deletar
      const { data: evoInstance } = await supabaseAdmin
        .from('Instance')
        .select('id')
        .eq('name', name)
        .maybeSingle()
      const evoInstanceId = (evoInstance as { id?: string } | null)?.id ?? null
      if (evoInstanceId) {
        const { count: isOnWaCount } = await supabaseAdmin
          .from('IsOnWhatsapp')
          .select('*', { count: 'exact', head: true })
          .eq('instanceId', evoInstanceId)
        console.log(`[DELETE accounts] IsOnWhatsapp count para instanceId="${evoInstanceId}": ${isOnWaCount}`)
      } else {
        console.log(`[DELETE accounts] Instance não encontrado no banco para name="${name}"`)
      }

      // ── 1. Evolution API PRIMEIRO (evita race condition com GET /api/accounts) ──
      console.log(`[DELETE accounts] removendo instância da Evolution API`)
      const evoRes = await fetch(`${EVOLUTION_API_URL}/instance/delete/${name}`, {
        method: 'DELETE',
        headers: { apikey: EVOLUTION_API_KEY },
      }).catch((err) => { console.error('[DELETE accounts] fetch Evolution API falhou:', err); return null })
      console.log(`[DELETE accounts] Evolution API status: ${evoRes?.status ?? 'erro de rede'}`)
    } else {
      console.log(`[DELETE accounts] conta "${name}" é Cloud API — pulando etapas da Evolution`)
    }

    // ── 2. ai_sessions ──────────────────────────────────────────────────────────
    const { error: sessErr } = await supabaseAdmin.from('ai_sessions').delete().eq('instance_name', name)
    if (sessErr) { console.error('[DELETE accounts] ai_sessions:', sessErr.message); failedSteps.push('ai_sessions') }
    else console.log('[DELETE accounts] ai_sessions removidos')

    const { error: runErr } = await supabaseAdmin.from('flow_runs').delete().eq('instance_name', name)
    if (runErr) { console.error('[DELETE accounts] flow_runs:', runErr.message); failedSteps.push('flow_runs') }

    const { error: jobErr } = await supabaseAdmin.from('flow_jobs').delete().eq('instance_name', name)
    if (jobErr) { console.error('[DELETE accounts] flow_jobs:', jobErr.message); failedSteps.push('flow_jobs') }

    const { error: variableErr } = await supabaseAdmin.from('message_variables').delete().eq('instance_name', name)
    if (variableErr) {
      console.error('[DELETE accounts] message_variables:', variableErr.message)
      failedSteps.push('message_variables')
    }

    // ── 3. agent_memory_blocks ──────────────────────────────────────────────────
    const { error: memErr } = await supabaseAdmin.from('agent_memory_blocks').delete().eq('instance_name', name)
    if (memErr) { console.error('[DELETE accounts] agent_memory_blocks:', memErr.message); failedSteps.push('agent_memory_blocks') }
    else console.log('[DELETE accounts] agent_memory_blocks removidos')

    // ── 4. triggers ────────────────────────────────────────────────────────────
    const { error: trigErr } = await supabaseAdmin.from('triggers').delete().eq('instance_name', name)
    if (trigErr) { console.error('[DELETE accounts] triggers:', trigErr.message); failedSteps.push('triggers') }
    else console.log('[DELETE accounts] triggers removidos')

    // ── 5. flows ───────────────────────────────────────────────────────────────
    const { error: flowErr } = await supabaseAdmin.from('flows').delete().eq('instance_name', name)
    if (flowErr) { console.error('[DELETE accounts] flows:', flowErr.message); failedSteps.push('flows') }
    else console.log('[DELETE accounts] flows removidos')

    // ── 6. flow_media + Supabase Storage ───────────────────────────────────────
    const { data: mediaRows } = await supabaseAdmin
      .from('flow_media')
      .select('storage_path')
      .eq('instance_name', name)
    if (mediaRows?.length) {
      const paths = mediaRows.map((r) => r.storage_path as string).filter(Boolean)
      if (paths.length) {
        const { error: storageErr } = await supabaseAdmin.storage.from('media').remove(paths)
        if (storageErr) { console.error('[DELETE accounts] storage remove:', storageErr.message); failedSteps.push('media_storage') }
        else console.log(`[DELETE accounts] ${paths.length} arquivo(s) de storage removidos`)
      }
    }
    const { error: fmErr } = await supabaseAdmin.from('flow_media').delete().eq('instance_name', name)
    if (fmErr) { console.error('[DELETE accounts] flow_media:', fmErr.message); failedSteps.push('flow_media') }
    else console.log('[DELETE accounts] flow_media removidos')

    // ── 7. instance_ai_config ──────────────────────────────────────────────────
    const { error: cfgErr } = await supabaseAdmin.from('instance_ai_config').delete().eq('instance_name', name)
    if (cfgErr) { console.error('[DELETE accounts] instance_ai_config:', cfgErr.message); failedSteps.push('instance_ai_config') }
    else console.log('[DELETE accounts] instance_ai_config removido')

    // ── 8. messages + conversations ────────────────────────────────────────────
    const { data: conversations, error: convSelectErr } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('instance_name', name)
    if (convSelectErr) {
      console.error('[DELETE accounts] conversations (select):', convSelectErr.message)
      failedSteps.push('conversations_select')
    } else if (conversations?.length) {
      const ids = conversations.map((c) => c.id)
      const { error: msgDelErr } = await supabaseAdmin.from('messages').delete().in('conversation_id', ids)
      if (msgDelErr) { console.error('[DELETE accounts] messages:', msgDelErr.message); failedSteps.push('messages') }
      const { error: convDelErr } = await supabaseAdmin.from('conversations').delete().eq('instance_name', name)
      if (convDelErr) { console.error('[DELETE accounts] conversations:', convDelErr.message); failedSteps.push('conversations') }
      if (!msgDelErr && !convDelErr) console.log(`[DELETE accounts] ${conversations.length} conversa(s) e mensagens removidos`)
    }

    // ── 9. fulfillment_orders / shopify_abandoned_checkouts ─────────────────────
    // These are Shopify/FenixCOD business records, not chat data — deleting the
    // account must not destroy order history. Just clear the routing so they
    // fall back to unassigned, same as conversation_id ON DELETE SET NULL above,
    // instead of being left pointing at an account that no longer exists.
    const { error: ordersInstanceErr } = await supabaseAdmin
      .from('fulfillment_orders')
      .update({ assigned_instance_name: null, instance_name: '' })
      .eq('instance_name', name)
    if (ordersInstanceErr) { console.error('[DELETE accounts] fulfillment_orders (instance_name):', ordersInstanceErr.message); failedSteps.push('fulfillment_orders_instance') }
    const { error: ordersAssignedErr } = await supabaseAdmin
      .from('fulfillment_orders')
      .update({ assigned_instance_name: null, instance_name: '' })
      .eq('assigned_instance_name', name)
    if (ordersAssignedErr) { console.error('[DELETE accounts] fulfillment_orders (assigned_instance_name):', ordersAssignedErr.message); failedSteps.push('fulfillment_orders_assigned') }
    if (!ordersInstanceErr && !ordersAssignedErr) console.log('[DELETE accounts] fulfillment_orders desvinculados')

    const { error: checkoutsErr } = await supabaseAdmin
      .from('shopify_abandoned_checkouts')
      .update({ assigned_instance_name: null })
      .eq('assigned_instance_name', name)
    if (checkoutsErr) { console.error('[DELETE accounts] shopify_abandoned_checkouts:', checkoutsErr.message); failedSteps.push('shopify_abandoned_checkouts') }
    else console.log('[DELETE accounts] shopify_abandoned_checkouts desvinculados')

    // ── 10. ai_provider_keys (somente se for a última conta real) ───────────────
    // Sandbox never counts here — it's a permanent fixture, not a real account,
    // so its presence must not block cleanup when the last real account goes.
    const { count: remainingAccounts } = await supabaseAdmin
      .from('accounts')
      .select('*', { count: 'exact', head: true })
      .neq('instance_name', name)
      .eq('is_sandbox', false)
    if (remainingAccounts === 0) {
      const { error: keysErr } = await supabaseAdmin.from('ai_provider_keys').delete().neq('provider', '')
      if (keysErr) { console.error('[DELETE accounts] ai_provider_keys:', keysErr.message); failedSteps.push('ai_provider_keys') }
      else console.log('[DELETE accounts] ai_provider_keys removidas (última conta)')
    } else {
      console.log(`[DELETE accounts] ai_provider_keys mantidas (${remainingAccounts} conta(s) restante(s))`)
    }

    // ── 11. accounts ───────────────────────────────────────────────────────────
    // Só remove a conta em si (o ponto sem volta — some da UI a partir daqui)
    // se todas as etapas de limpeza anteriores tiverem sucedido. Se alguma
    // falhou, a conta permanece e o endpoint pode ser chamado de novo com
    // segurança: apagar linhas já apagadas não é erro, então o retry só
    // termina o que faltou, sem duplicar nem recriar nada.
    if (failedSteps.length > 0) {
      console.error(`[DELETE accounts] exclusão parcial de "${name}" — etapas com falha: ${failedSteps.join(', ')}`)
      return NextResponse.json(
        { ok: false, error: 'Falha ao limpar dados relacionados — conta não removida. Tente novamente.', failedSteps },
        { status: 500 }
      )
    }

    const { error: accErr } = await supabaseAdmin.from('accounts').delete().eq('instance_name', name)
    if (accErr) {
      console.error('[DELETE accounts] accounts:', accErr.message)
      return NextResponse.json({ ok: false, error: accErr.message, failedSteps: ['accounts'] }, { status: 500 })
    }
    console.log(`[DELETE accounts] conta "${name}" removida com sucesso`)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/accounts/[name] erro inesperado:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
