import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateFlowJson } from '@/lib/flow-validation'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/flows?instance=xxx
export async function GET(req: NextRequest) {
  const instance = req.nextUrl.searchParams.get('instance')
  if (!instance) return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('flows')
    .select('*')
    .eq('instance_name', instance)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, flows: data ?? [] })
}

// POST /api/flows
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { instance_name, name, json: flowJson, ativo } = body
    if (!instance_name) return NextResponse.json({ ok: false, error: 'instance_name required' }, { status: 400 })

    const jsonToSave = flowJson ?? { nodes: [], edges: [] }
    const validation = validateFlowJson(jsonToSave)
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 422 })
    }

    const { data, error } = await supabaseAdmin
      .from('flows')
      .insert({
        instance_name,
        name: name ?? 'Novo Fluxo',
        json: jsonToSave,
        ativo: ativo ?? true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, flow: data })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
