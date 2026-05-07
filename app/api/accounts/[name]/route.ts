import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// DELETE /api/accounts/[name] — remove conta + todos os dados relacionados
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  console.log(`[DELETE accounts] iniciando remoção de "${name}"`)

  try {
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

    // ── 2. ai_sessions ──────────────────────────────────────────────────────────
    const { error: sessErr } = await supabaseAdmin.from('ai_sessions').delete().eq('instance_name', name)
    if (sessErr) console.error('[DELETE accounts] ai_sessions:', sessErr.message)
    else console.log('[DELETE accounts] ai_sessions removidos')

    // ── 3. agent_memory_blocks ──────────────────────────────────────────────────
    const { error: memErr } = await supabaseAdmin.from('agent_memory_blocks').delete().eq('instance_name', name)
    if (memErr) console.error('[DELETE accounts] agent_memory_blocks:', memErr.message)
    else console.log('[DELETE accounts] agent_memory_blocks removidos')

    // ── 4. triggers ────────────────────────────────────────────────────────────
    const { error: trigErr } = await supabaseAdmin.from('triggers').delete().eq('instance_name', name)
    if (trigErr) console.error('[DELETE accounts] triggers:', trigErr.message)
    else console.log('[DELETE accounts] triggers removidos')

    // ── 5. flows ───────────────────────────────────────────────────────────────
    const { error: flowErr } = await supabaseAdmin.from('flows').delete().eq('instance_name', name)
    if (flowErr) console.error('[DELETE accounts] flows:', flowErr.message)
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
        if (storageErr) console.error('[DELETE accounts] storage remove:', storageErr.message)
        else console.log(`[DELETE accounts] ${paths.length} arquivo(s) de storage removidos`)
      }
    }
    const { error: fmErr } = await supabaseAdmin.from('flow_media').delete().eq('instance_name', name)
    if (fmErr) console.error('[DELETE accounts] flow_media:', fmErr.message)
    else console.log('[DELETE accounts] flow_media removidos')

    // ── 7. instance_ai_config ──────────────────────────────────────────────────
    const { error: cfgErr } = await supabaseAdmin.from('instance_ai_config').delete().eq('instance_name', name)
    if (cfgErr) console.error('[DELETE accounts] instance_ai_config:', cfgErr.message)
    else console.log('[DELETE accounts] instance_ai_config removido')

    // ── 8. messages + conversations ────────────────────────────────────────────
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('instance_name', name)
    if (conversations?.length) {
      const ids = conversations.map((c) => c.id)
      await supabaseAdmin.from('messages').delete().in('conversation_id', ids)
      await supabaseAdmin.from('conversations').delete().eq('instance_name', name)
      console.log(`[DELETE accounts] ${conversations.length} conversa(s) e mensagens removidos`)
    }

    // ── 9. ai_provider_keys (somente se for a última conta) ────────────────────
    const { count: remainingAccounts } = await supabaseAdmin
      .from('accounts')
      .select('*', { count: 'exact', head: true })
      .neq('instance_name', name)
    if (remainingAccounts === 0) {
      const { error: keysErr } = await supabaseAdmin.from('ai_provider_keys').delete().neq('provider', '')
      if (keysErr) console.error('[DELETE accounts] ai_provider_keys:', keysErr.message)
      else console.log('[DELETE accounts] ai_provider_keys removidas (última conta)')
    } else {
      console.log(`[DELETE accounts] ai_provider_keys mantidas (${remainingAccounts} conta(s) restante(s))`)
    }

    // ── 10. accounts ───────────────────────────────────────────────────────────
    const { error: accErr } = await supabaseAdmin.from('accounts').delete().eq('instance_name', name)
    if (accErr) console.error('[DELETE accounts] accounts:', accErr.message)
    else console.log(`[DELETE accounts] conta "${name}" removida com sucesso`)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/accounts/[name] erro inesperado:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
