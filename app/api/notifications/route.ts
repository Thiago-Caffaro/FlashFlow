import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function syncEscalationNotifications(instanceName: string) {
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('ai_sessions')
    .select('id, remote_jid, flow_id, last_message_at')
    .eq('instance_name', instanceName)
    .eq('requires_human', true)

  if (sessionError) throw new Error(sessionError.message)
  if (!sessions?.length) return

  const remoteJids = [...new Set(sessions.map((session) => String(session.remote_jid)))]
  const { data: conversations, error: conversationError } = await supabaseAdmin
    .from('conversations')
    .select('id, wa_id, contact_name, contact_phone')
    .eq('instance_name', instanceName)
    .in('wa_id', remoteJids)

  if (conversationError) throw new Error(conversationError.message)
  const conversationByWaId = new Map((conversations ?? []).map((conversation) => [conversation.wa_id, conversation]))

  const rows = sessions.map((session) => {
    const conversation = conversationByWaId.get(session.remote_jid)
    const contact = conversation?.contact_name?.trim()
      || conversation?.contact_phone?.trim()
      || String(session.remote_jid).replace(/@.+$/, '')
    return {
      instance_name: instanceName,
      type: 'escalation',
      title: 'Chat escalado',
      message: `${contact} precisa de atendimento humano.`,
      conversation_id: conversation?.id ?? null,
      flow_id: session.flow_id,
      source_key: `escalation:${session.id}`,
      metadata: { remoteJid: session.remote_jid, sessionId: session.id },
      created_at: session.last_message_at ?? new Date().toISOString(),
    }
  })

  const { error } = await supabaseAdmin
    .from('notifications')
    .upsert(rows, { onConflict: 'instance_name,source_key', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const instanceName = req.nextUrl.searchParams.get('instance')?.trim()
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }

  try {
    await syncEscalationNotifications(instanceName)
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('instance_name', instanceName)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw new Error(error.message)
    const notifications = data ?? []
    const unreadCount = notifications.filter((notification) => !notification.read_at).length
    return NextResponse.json({ ok: true, notifications, unreadCount })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao carregar notificacoes',
    }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const instanceName = req.nextUrl.searchParams.get('instance')?.trim()
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }

  try {
    let query = supabaseAdmin
      .from('notifications')
      .update({
        dismissed_at: new Date().toISOString(),
        read_at: new Date().toISOString(),
      })
      .eq('instance_name', instanceName)
      .is('dismissed_at', null)
    if (id) query = query.eq('id', id)
    const { error } = await query
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao excluir notificacoes',
    }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json() as { instance?: unknown; id?: unknown }
    const instanceName = typeof body.instance === 'string' ? body.instance.trim() : ''
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!instanceName) {
      return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
    }

    let query = supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('instance_name', instanceName)
      .is('read_at', null)
    if (id) query = query.eq('id', id)
    const { error } = await query
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Corpo da requisicao invalido',
    }, { status: 400 })
  }
}
