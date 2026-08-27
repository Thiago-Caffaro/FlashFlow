import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyCloudCredentials } from '@/lib/whatsapp-cloud-client'
import { storeCloudCredentials } from '@/lib/whatsapp-cloud-credentials'

function sanitizeInstanceName(label: string): string {
  const sanitized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30)
  return sanitized || `conta-cloud-${Date.now()}`
}

// POST /api/accounts/cloud-api — conecta uma conta WhatsApp Cloud API por
// credenciais coladas manualmente (phone_number_id/WABA ID/token gerados no
// Meta App Dashboard). Sem QR, sem polling — a Meta confirma as credenciais
// na hora (verifyCloudCredentials) e a conexão é síncrona.
// Body: { label, country, phoneNumberId, wabaId, accessToken, businessId? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : ''
    const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : ''
    const wabaId = typeof body.wabaId === 'string' ? body.wabaId.trim() : ''
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
    const businessId = typeof body.businessId === 'string' && body.businessId.trim() ? body.businessId.trim() : null

    if (!label || !country || !phoneNumberId || !wabaId || !accessToken) {
      return NextResponse.json(
        { error: 'Nome, país, Phone Number ID, WABA ID e token são obrigatórios' },
        { status: 400 }
      )
    }

    const instanceName = sanitizeInstanceName(label)

    const { data: existingAccount, error: existingError } = await supabaseAdmin
      .from('accounts')
      .select('instance_name')
      .eq('instance_name', instanceName)
      .maybeSingle()
    if (existingError) {
      console.error('Erro ao validar schema/accounts:', existingError)
      return NextResponse.json({ error: 'Falha ao consultar contas' }, { status: 500 })
    }
    if (existingAccount) {
      return NextResponse.json({ error: 'Já existe uma conta com esse nome' }, { status: 409 })
    }

    const { data: existingPhone } = await supabaseAdmin
      .from('whatsapp_cloud_credentials')
      .select('instance_name')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    if (existingPhone) {
      return NextResponse.json({ error: 'Este Phone Number ID já está conectado a outra conta' }, { status: 409 })
    }

    let verified
    try {
      verified = await verifyCloudCredentials(phoneNumberId, accessToken)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Falha ao validar credenciais com a Meta' },
        { status: 400 }
      )
    }

    const { error: insertError } = await supabaseAdmin
      .from('accounts')
      .insert({ instance_name: instanceName, label, country, provider: 'cloud_api' })
    if (insertError) {
      console.error('Erro ao salvar conta no banco:', insertError)
      return NextResponse.json({ error: 'Falha ao registrar conta no banco' }, { status: 500 })
    }

    try {
      await storeCloudCredentials({
        instanceName,
        wabaId,
        phoneNumberId,
        businessId,
        displayPhoneNumber: verified.displayPhoneNumber,
        verifiedName: verified.verifiedName,
        accessToken,
      })
    } catch (error) {
      // Rollback — não deixa uma conta "cloud_api" órfã sem credenciais.
      await supabaseAdmin.from('accounts').delete().eq('instance_name', instanceName)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Falha ao salvar credenciais' },
        { status: 500 }
      )
    }

    return NextResponse.json({ instanceName })
  } catch (err) {
    console.error('POST /api/accounts/cloud-api error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
