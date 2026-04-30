import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AISession, AISessionWithContext, Conversation } from '@/types'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/ai-sessions?instance=xxx
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { data: sessions, error } = await supabaseAdmin
    .from('ai_sessions')
    .select('*')
    .eq('instance_name', instance)
    .order('last_message_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!sessions || sessions.length === 0) return NextResponse.json({ ok: true, sessions: [] })

  const remoteJids = (sessions as AISession[]).map((s) => s.remote_jid)
  const flowIds = [...new Set((sessions as AISession[]).map((s) => s.flow_id))]

  const [{ data: conversations }, { data: flows }] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('instance_name', instance)
      .in('wa_id', remoteJids),
    supabaseAdmin
      .from('flows')
      .select('id, name')
      .in('id', flowIds),
  ])

  const convMap = new Map<string, Conversation>()
  for (const c of conversations ?? []) convMap.set(c.wa_id, c)

  const flowMap = new Map<string, string>()
  for (const f of flows ?? []) flowMap.set(f.id, f.name)

  const result: AISessionWithContext[] = []
  for (const session of sessions as AISession[]) {
    const conversation = convMap.get(session.remote_jid)
    if (!conversation) continue
    result.push({
      session,
      conversation,
      flow_name: flowMap.get(session.flow_id) ?? null,
    })
  }

  return NextResponse.json({ ok: true, sessions: result })
}
