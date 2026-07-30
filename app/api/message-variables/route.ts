import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateMessageVariableInput } from '@/lib/message-variable-validation'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const instanceName = req.nextUrl.searchParams.get('instance')?.trim()
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('message_variables')
    .select('*')
    .eq('instance_name', instanceName)
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, variables: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const validation = validateMessageVariableInput(await req.json())
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('message_variables')
      .insert(validation.value)
      .select()
      .single()

    if (error?.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ja existe uma variavel com essa chave.' }, { status: 409 })
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, variable: data }, { status: 201 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Corpo da requisicao invalido.' }, { status: 400 })
  }
}
