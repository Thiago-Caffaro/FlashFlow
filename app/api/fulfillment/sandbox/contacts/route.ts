import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Lists every test contact currently in the sandbox (including the original
// fixed "Sandbox" one, created lazily by the message endpoint on first use).
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { data: contacts, error } = await supabaseAdmin
    .from('conversations')
    .select('id, wa_id, contact_name, contact_phone, last_message, last_message_at')
    .eq('instance_name', SANDBOX_INSTANCE_NAME)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, contacts: contacts ?? [] })
}

// Adds a new test contact — either typed manually or pre-filled from a real
// contact picked via /contacts/search. Its wa_id is derived from the phone;
// no collision with a real account's conversations is possible since those
// live under a different instance_name.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json() as Record<string, unknown>
    const contactName = String(body.contactName ?? '').trim()
    const contactPhone = String(body.contactPhone ?? '').trim()
    if (!contactName || !contactPhone) {
      return NextResponse.json({ ok: false, error: 'Nome e telefone são obrigatórios' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('conversations')
      .upsert(
        {
          wa_id: `${contactPhone}@s.whatsapp.net`,
          instance_name: SANDBOX_INSTANCE_NAME,
          contact_name: contactName,
          contact_phone: contactPhone,
        },
        { onConflict: 'wa_id, instance_name' }
      )
      .select('id, wa_id, contact_name, contact_phone')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Falha ao criar contato de teste')

    return NextResponse.json({ ok: true, contact: data })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
