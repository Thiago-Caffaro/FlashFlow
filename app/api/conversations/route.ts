import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/conversations?instance=xxx
// Lista de conversas de uma instância, autenticada pelo cookie de sessão
// (proxy.ts). Existe para que o frontend nunca precise consultar a tabela
// "conversations" diretamente com a anon key do Supabase.
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('instance_name', instance)
    .order('last_message_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, conversations: data ?? [] }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
