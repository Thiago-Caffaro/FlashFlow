import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AISession, FlowNode } from '@/types'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// POST /api/ai-sessions/[id]/terminate
// Body: { message?: string; useFlowMessage?: boolean }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from('ai_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (sessionErr) return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const { message, useFlowMessage } = (await req.json()) as { message?: string; useFlowMessage?: boolean }

  let finalMessage = message?.trim() ?? ''

  if (useFlowMessage && !finalMessage) {
    const { data: flow } = await supabaseAdmin
      .from('flows')
      .select('json')
      .eq('id', (session as AISession).flow_id)
      .maybeSingle()

    if (flow) {
      const nodes: FlowNode[] = flow.json?.nodes ?? []
      const startNode = nodes.find((n) => n.type === 'start')
      const endMsg = startNode?.data.sessionEndMessage as { enabled: boolean; text: string } | undefined
      if (endMsg?.enabled && endMsg.text?.trim()) {
        finalMessage = endMsg.text.trim()
      }
    }
  }

  if (finalMessage) {
    const { remote_jid: remoteJid, instance_name: instanceName } = session as AISession

    try {
      const evoRes = await fetch(
        `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ number: remoteJid, text: finalMessage }),
        }
      )
      const evoJson = await evoRes.json()
      const waMessageId: string | null = evoJson?.key?.id ?? null

      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('instance_name', instanceName)
        .eq('wa_id', remoteJid)
        .maybeSingle()

      if (conv) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id,
          wa_message_id: waMessageId,
          content: finalMessage,
          type: 'text',
          direction: 'outbound',
          status: 'sent',
        })
        await supabaseAdmin
          .from('conversations')
          .update({ last_message: finalMessage, last_message_at: new Date().toISOString() })
          .eq('id', conv.id)
      }
    } catch {
      // Best-effort — proceed with session deletion even if send fails
    }
  }

  await supabaseAdmin.from('ai_sessions').delete().eq('id', id)

  return NextResponse.json({ ok: true })
}
