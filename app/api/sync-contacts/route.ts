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
    // Busca todas as conversas (para corrigir nomes errados também)
    const { data: conversations, error: convErr } = await supabase
      .from('conversations')
      .select('id, wa_id')

    if (convErr) {
      return NextResponse.json({ error: convErr.message }, { status: 500 })
    }
    if (!conversations?.length) {
      return NextResponse.json({ ok: true, updated: 0 })
    }

    const waIds = conversations.map((c) => c.wa_id)

    // 1. Busca pushName na tabela Contact da Evolution
    const { data: contacts } = await supabase
      .from('Contact')
      .select('remoteJid, pushName')
      .in('remoteJid', waIds)

    const nameMap = new Map<string, string>()
    for (const c of contacts ?? []) {
      if (c.pushName) nameMap.set(c.remoteJid, c.pushName)
    }

    // 2. Para os wa_ids sem pushName, tenta Chat.name como fallback
    const missingIds = waIds.filter((id) => !nameMap.has(id))
    if (missingIds.length > 0) {
      const { data: chats } = await supabase
        .from('Chat')
        .select('remoteJid, name')
        .in('remoteJid', missingIds)

      for (const ch of chats ?? []) {
        if (ch.name) nameMap.set(ch.remoteJid, ch.name)
      }
    }

    // 3. Atualiza conversas que têm nome disponível
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
