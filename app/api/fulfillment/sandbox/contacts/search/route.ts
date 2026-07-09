import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getEvolutionConnectionState } from '@/lib/evolution-api'
import { SANDBOX_INSTANCE_NAME } from '@/lib/sandbox'

export const dynamic = 'force-dynamic'

// Searches real contacts (by name or phone) across accounts that are
// currently connected, for the "import a real contact into the sandbox"
// picker. Never touches or exposes anything from the sandbox account itself.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return NextResponse.json({ ok: true, contacts: [] })

    const { data: accounts } = await supabaseAdmin
      .from('accounts')
      .select('instance_name, label')
      .neq('instance_name', SANDBOX_INSTANCE_NAME)
    if (!accounts?.length) return NextResponse.json({ ok: true, contacts: [] })

    const states = await Promise.all(
      accounts.map((a) => getEvolutionConnectionState(a.instance_name))
    )
    const connectedInstances = accounts
      .filter((_, i) => states[i].state === 'open')
      .map((a) => a.instance_name)
    if (!connectedInstances.length) return NextResponse.json({ ok: true, contacts: [] })

    const { data: contacts, error } = await supabaseAdmin
      .from('conversations')
      .select('id, wa_id, instance_name, contact_name, contact_phone')
      .in('instance_name', connectedInstances)
      .or(`contact_name.ilike.%${q}%,contact_phone.ilike.%${q}%`)
      .limit(20)
    if (error) throw new Error(error.message)

    const labelByInstance = new Map(accounts.map((a) => [a.instance_name, a.label]))
    const result = (contacts ?? []).map((c) => ({
      ...c,
      accountLabel: labelByInstance.get(c.instance_name) ?? c.instance_name,
    }))

    return NextResponse.json({ ok: true, contacts: result })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro inesperado',
    }, { status: 400 })
  }
}
