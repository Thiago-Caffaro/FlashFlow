import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SANDBOX_INSTANCE_NAME, SANDBOX_REMOTE_JID } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Wipes one sandbox test contact's conversation history (and, since there's
// only ever one simulation dataset, every simulated order/checkout), so a
// developer can restart a test scenario from a clean slate. `conversationId`
// selects which test contact; omitted, it resets the original fixed one.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined

    const { data: conversation } = conversationId
      ? await supabaseAdmin
        .from('conversations')
        .select('id, wa_id')
        .eq('id', conversationId)
        .eq('instance_name', SANDBOX_INSTANCE_NAME)
        .maybeSingle()
      : await supabaseAdmin
        .from('conversations')
        .select('id, wa_id')
        .eq('instance_name', SANDBOX_INSTANCE_NAME)
        .eq('wa_id', SANDBOX_REMOTE_JID)
        .maybeSingle()

    if (conversation) {
      await supabaseAdmin.from('messages').delete().eq('conversation_id', conversation.id)
      await supabaseAdmin.from('conversations').update({
        last_message: null,
        last_message_at: null,
        unread_count: 0,
      }).eq('id', conversation.id)

      await supabaseAdmin.from('flow_runs').delete()
        .eq('instance_name', SANDBOX_INSTANCE_NAME)
        .eq('remote_jid', conversation.wa_id)
      await supabaseAdmin.from('ai_sessions').delete()
        .eq('instance_name', SANDBOX_INSTANCE_NAME)
        .eq('remote_jid', conversation.wa_id)
    }

    await supabaseAdmin.from('fulfillment_orders').delete().eq('is_simulation', true)
    await supabaseAdmin.from('shopify_abandoned_checkouts').delete().eq('is_simulation', true)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
