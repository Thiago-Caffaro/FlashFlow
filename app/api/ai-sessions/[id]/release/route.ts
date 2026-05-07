import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 })

    await supabase
      .from('ai_sessions')
      .update({ requires_human: false })
      .eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('release error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
