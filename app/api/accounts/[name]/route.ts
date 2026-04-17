import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// DELETE /api/accounts/[name] — remove conta + todos os dados
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  try {
    // Busca conversas da instância para deletar mensagens em cascata
    const { data: conversations } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('instance_name', name)

    if (conversations?.length) {
      const ids = conversations.map((c) => c.id)
      await supabaseAdmin.from('messages').delete().in('conversation_id', ids)
      await supabaseAdmin.from('conversations').delete().eq('instance_name', name)
    }

    // Remove da tabela de contas
    await supabaseAdmin.from('accounts').delete().eq('instance_name', name)

    // Remove instância na Evolution API
    await fetch(`${EVOLUTION_API_URL}/instance/delete/${name}`, {
      method: 'DELETE',
      headers: { apikey: EVOLUTION_API_KEY },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/accounts/[name] error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
