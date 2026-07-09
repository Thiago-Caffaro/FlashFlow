import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Removes a test contact and everything tied to it (messages, in-progress
// flow state, AI session). Simulated orders are cleaned up separately by
// "Reiniciar teste", since they aren't scoped to a single contact today.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const { id } = await params
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('id, wa_id')
      .eq('id', id)
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .maybeSingle()
    if (error || !conversation) throw new Error('Contato de teste não encontrado')

    await supabaseAdmin.from('messages').delete().eq('conversation_id', conversation.id)
    await supabaseAdmin.from('flow_runs').delete()
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .eq('remote_jid', conversation.wa_id)
    await supabaseAdmin.from('ai_sessions').delete()
      .eq('instance_name', SANDBOX_INSTANCE_NAME)
      .eq('remote_jid', conversation.wa_id)
    await supabaseAdmin.from('conversations').delete().eq('id', conversation.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
