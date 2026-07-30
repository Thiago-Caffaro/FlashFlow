import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { belongsToInstance } from '@/lib/instance-guard'
import { validateMessageVariableInput } from '@/lib/message-variable-validation'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const instanceName = typeof body.instance_name === 'string' ? body.instance_name.trim() : ''
    if (!instanceName) {
      return NextResponse.json({ ok: false, error: 'instance_name obrigatorio' }, { status: 400 })
    }
    if (!(await belongsToInstance(supabaseAdmin, 'message_variables', id, instanceName))) {
      return NextResponse.json({ ok: false, error: 'Variavel nao encontrada' }, { status: 404 })
    }

    const validation = validateMessageVariableInput(body, false)
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 })
    }
    const patch = {
      ...validation.value,
      instance_name: undefined,
      updated_at: new Date().toISOString(),
    }
    delete patch.instance_name

    const { data, error } = await supabaseAdmin
      .from('message_variables')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error?.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ja existe uma variavel com essa chave.' }, { status: 409 })
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, variable: data })
  } catch {
    return NextResponse.json({ ok: false, error: 'Corpo da requisicao invalido.' }, { status: 400 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const instanceName = req.nextUrl.searchParams.get('instance')?.trim() ?? ''
  if (!instanceName) {
    return NextResponse.json({ ok: false, error: 'instance required' }, { status: 400 })
  }
  if (!(await belongsToInstance(supabaseAdmin, 'message_variables', id, instanceName))) {
    return NextResponse.json({ ok: false, error: 'Variavel nao encontrada' }, { status: 404 })
  }

  const { error } = await supabaseAdmin.from('message_variables').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
