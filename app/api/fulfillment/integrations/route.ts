import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/ai-crypto'
import { FulfillmentApiError, FulfillmentClient, FulfillmentEnvironment } from '@/lib/fulfillment-client'
import { isAdminRequest } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const INTEGRATION_SELECT = 'id, country, environment, active, token_expires_at, created_at, updated_at'
const TEST_ENVIRONMENT_ERROR = 'O teste documentado está indisponível/stale; use credenciais de produção.'

function parseEnvironment(value: unknown): FulfillmentEnvironment | null {
  const environment = String(value ?? 'production').trim() as FulfillmentEnvironment
  return ['test', 'production'].includes(environment) ? environment : null
}

function encryptedCredentialPatch(email: string, password: string, token: string, expiresAt: Date) {
  const encEmail = encryptSecret(email)
  const encPassword = encryptSecret(password)
  const encToken = encryptSecret(token)
  return {
    encrypted_email: encEmail.encrypted_key,
    email_iv: encEmail.iv,
    email_auth_tag: encEmail.auth_tag,
    encrypted_password: encPassword.encrypted_key,
    password_iv: encPassword.iv,
    password_auth_tag: encPassword.auth_tag,
    encrypted_token: encToken.encrypted_key,
    token_iv: encToken.iv,
    token_auth_tag: encToken.auth_tag,
    token_expires_at: expiresAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('fulfillment_integrations')
    .select(INTEGRATION_SELECT)
    .order('country')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, integrations: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json()
    const country = String(body.country ?? '').trim().toUpperCase()
    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    const environment = parseEnvironment(body.environment)
    if (!country || !email || !password || !environment) {
      return NextResponse.json({ ok: false, error: 'Campos inválidos' }, { status: 400 })
    }
    if (environment === 'test') {
      return NextResponse.json({ ok: false, error: TEST_ENVIRONMENT_ERROR }, { status: 400 })
    }

    const login = await FulfillmentClient.login({ email, password, environment })
    const { data, error } = await supabaseAdmin.from('fulfillment_integrations').insert({
      country,
      environment,
      ...encryptedCredentialPatch(email, password, login.token, login.expiresAt),
      active: typeof body.active === 'boolean' ? body.active : true,
    }).select(INTEGRATION_SELECT).single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, integration: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    const upstreamStatus = error instanceof FulfillmentApiError ? error.status : 502
    const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502
    return NextResponse.json({ ok: false, error: message, upstreamStatus }, { status })
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const body = await req.json()
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('fulfillment_integrations')
      .select('id, country, environment, active')
      .eq('id', id)
      .single()
    if (existingError || !existing) {
      return NextResponse.json({ ok: false, error: existingError?.message ?? 'Integração não encontrada' }, { status: 404 })
    }

    const requestedCountry = body.country === undefined ? String(existing.country) : String(body.country ?? '').trim().toUpperCase()
    if (!requestedCountry || requestedCountry !== existing.country) {
      return NextResponse.json({ ok: false, error: 'O país da integração não pode ser alterado; crie uma nova integração.' }, { status: 400 })
    }

    const environment = parseEnvironment(body.environment ?? existing.environment)
    if (!environment) return NextResponse.json({ ok: false, error: 'Ambiente inválido' }, { status: 400 })
    if (environment === 'test') {
      return NextResponse.json({ ok: false, error: TEST_ENVIRONMENT_ERROR }, { status: 400 })
    }

    const email = String(body.email ?? '').trim()
    const password = String(body.password ?? '')
    const credentialsProvided = Boolean(email || password)
    const environmentChanged = environment !== existing.environment
    if ((credentialsProvided || environmentChanged) && (!email || !password)) {
      return NextResponse.json({ ok: false, error: 'Informe e-mail e senha para validar credenciais de produção.' }, { status: 400 })
    }

    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Status ativo inválido' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {
      environment,
      active: typeof body.active === 'boolean' ? body.active : existing.active,
      updated_at: new Date().toISOString(),
    }

    if (credentialsProvided || environmentChanged) {
      const login = await FulfillmentClient.login({ email, password, environment })
      Object.assign(patch, encryptedCredentialPatch(email, password, login.token, login.expiresAt))
    }

    const { data, error } = await supabaseAdmin
      .from('fulfillment_integrations')
      .update(patch)
      .eq('id', id)
      .select(INTEGRATION_SELECT)
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, integration: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado'
    const upstreamStatus = error instanceof FulfillmentApiError ? error.status : 502
    const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502
    return NextResponse.json({ ok: false, error: message, upstreamStatus }, { status })
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const id = String(req.nextUrl.searchParams.get('id') ?? '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('fulfillment_integrations')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(INTEGRATION_SELECT)
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, integration: data })
}
