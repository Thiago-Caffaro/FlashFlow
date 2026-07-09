import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkActiveFlowRun, checkActiveSession, handleActiveSession, executeFlow, type FlowContext } from '@/lib/flow-engine'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Fetches (creating if needed) a sandbox conversation and its history.
// `conversationId` selects one of possibly several test contacts; omitted,
// it falls back to the original fixed test conversation.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const conversationId = req.nextUrl.searchParams.get('conversationId') ?? undefined
    const conversation = await resolveSandboxConversation(conversationId)
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

// Resolves a specific test contact's conversation when `conversationId` is
// given (must belong to the sandbox instance); otherwise falls back to the
// original fixed test conversation, preserving pre-multi-contact behavior.
async function resolveSandboxConversation(conversationId?: string) {
  if (!conversationId) return ensureSandboxConversation()
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
    .maybeSingle()
  if (error || !data) throw new Error('Contato de teste não encontrado')
  return data
}

async function matchAndRunTrigger(ctx: FlowContext) {
  const { data: triggers } = await supabaseAdmin
    .from('triggers')
    .select('*')
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
    .eq('source', 'message')
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
// customer on WhatsApp, but bound to a sandbox test conversation. The
// only thing intercepted downstream is the real outbound WhatsApp send.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json() as Record<string, unknown>
    const text = String(body.text ?? '').trim()
    if (!text) return NextResponse.json({ ok: false, error: 'Mensagem vazia' }, { status: 400 })

    const conversation = await resolveSandboxConversation(
      typeof body.conversationId === 'string' ? body.conversationId : undefined
    )
    const remoteJid = String(conversation.wa_id)

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
      remoteJid,
      conversationId: conversation.id,
      incomingMessage: text,
      isSandbox: true,
    }

    const flowRun = await checkActiveFlowRun(SANDBOX_INSTANCE_NAME, remoteJid)
    if (flowRun) {
      await executeFlow(flowRun.flow_id, ctx, flowRun.node_id)
    } else {
      const session = await checkActiveSession(SANDBOX_INSTANCE_NAME, remoteJid)
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
