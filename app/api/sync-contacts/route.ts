import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/sync-contacts
// Atualiza contact_name nas conversas que ainda não têm nome,
// buscando pushName da tabela Contact da Evolution API.
// Requer: GRANT SELECT ON TABLE public."Contact" TO service_role;
export async function POST() {
  try {
    // Busca conversas sem nome
    const { data: conversations, error: convErr } = await supabase
      .from('conversations')
      .select('id, wa_id')
      .is('contact_name', null)

    if (convErr) {
      return NextResponse.json({ error: convErr.message }, { status: 500 })
    }
    if (!conversations?.length) {
      return NextResponse.json({ ok: true, updated: 0 })
    }

    const waIds = conversations.map((c) => c.wa_id)

    // Busca pushName na tabela Contact da Evolution
    const { data: contacts, error: contactErr } = await supabase
      .from('Contact')
      .select('remoteJid, pushName')
      .in('remoteJid', waIds)

    if (contactErr) {
      return NextResponse.json({ error: contactErr.message }, { status: 500 })
    }

    const nameMap = new Map<string, string>()
    for (const c of contacts ?? []) {
      if (c.pushName) nameMap.set(c.remoteJid, c.pushName)
    }

    // Atualiza conversas que têm pushName disponível
    let updated = 0
    await Promise.all(
      conversations
        .filter((c) => nameMap.has(c.wa_id))
        .map(async (c) => {
          await supabase
            .from('conversations')
            .update({ contact_name: nameMap.get(c.wa_id) })
            .eq('id', c.id)
          updated++
        })
    )

    return NextResponse.json({ ok: true, updated })
  } catch (err) {
    console.error('sync-contacts error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
