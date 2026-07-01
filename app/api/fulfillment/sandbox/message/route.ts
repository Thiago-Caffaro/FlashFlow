import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkActiveFlowRun, checkActiveSession, handleActiveSession, executeFlow, type FlowContext } from '@/lib/flow-engine'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Fetches (creating if needed) the sandbox conversation and its history.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const conversation = await ensureSandboxConversation()
    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, conversationId: conversation.id, messages: messages ?? [] })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}

async function ensureSandboxConversation() {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        wa_id: SANDBOX_REMOTE_JID,
        instance_name: SANDBOX_INSTANCE_NAME,
        contact_name: 'Sandbox',
        contact_phone: '000000000',
      },
      { onConflict: 'wa_id, instance_name' }
    )
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Falha ao preparar conversa sandbox')
  return data
}

async function matchAndRunTrigger(ctx: FlowContext) {
  const { data: triggers } = await supabaseAdmin
    .from('triggers')
    .select('*')
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
  if (!triggers?.length) return

  const content = ctx.incomingMessage.toLowerCase()
  for (const trigger of triggers) {
    const valors = (trigger.valor ?? '')
      .split(',')
      .map((v: string) => v.trim().toLowerCase())
      .filter(Boolean)
    if (!valors.length) continue
    const matched = valors.includes('*') || valors.some((v: string) =>
      trigger.tipo === 'exact' ? content === v : content.includes(v))
    if (!matched) continue

    if (trigger.action === 'flow') {
      const flowId: string = trigger.action_payload?.flow_id ?? ''
      if (flowId) await executeFlow(flowId, ctx)
    }
    break
  }
}

// Feeds a message into the real trigger/flow/AI dispatch logic
// (same functions the real Evolution webhook uses) as if it came from a
// customer on WhatsApp, but bound to the fixed sandbox conversation. The
// only thing intercepted downstream is the real outbound WhatsApp send.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const text = String(body.text ?? '').trim()
    if (!text) return NextResponse.json({ ok: false, error: 'Mensagem vazia' }, { status: 400 })

    const conversation = await ensureSandboxConversation()

    const { error: insertError } = await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      wa_message_id: null,
      content: text,
      type: 'text',
      direction: 'inbound',
      status: 'delivered',
    })
    if (insertError) throw new Error(insertError.message)

    await supabaseAdmin.from('conversations').update({
      last_message: text,
      last_message_at: new Date().toISOString(),
      unread_count: 0,
    }).eq('id', conversation.id)

    const ctx: FlowContext = {
      instanceName: SANDBOX_INSTANCE_NAME,
      remoteJid: SANDBOX_REMOTE_JID,
      conversationId: conversation.id,
      incomingMessage: text,
      isSandbox: true,
    }

    const flowRun = await checkActiveFlowRun(SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID)
    if (flowRun) {
      await executeFlow(flowRun.flow_id, ctx, flowRun.node_id)
    } else {
      const session = await checkActiveSession(SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID)
      if (session) {
        await handleActiveSession(session, ctx)
      } else {
        await matchAndRunTrigger(ctx)
      }
    }

    return NextResponse.json({ ok: true, conversationId: conversation.id })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
