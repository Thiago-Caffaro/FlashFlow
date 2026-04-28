import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/memory-blocks?instance=xxx
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('agent_memory_blocks')
    .select('*')
    .eq('instance_name', instance)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, blocks: data ?? [] })
}

// POST /api/memory-blocks
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { instance_name, name, content, type, keywords } = body
    if (!instance_name) return NextResponse.json({ ok: false, error: 'instance_name required' }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
    if (!content?.trim()) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('agent_memory_blocks')
      .insert({
        instance_name,
        name: name.trim(),
        content: content.trim(),
        type: type ?? 'always',
        keywords: keywords ?? [],
      })
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, block: data })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
