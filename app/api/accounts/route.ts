import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL!

function sanitizeInstanceName(label: string): string {
  const sanitized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30)
  return sanitized || `conta-${Date.now()}`
}

// GET /api/accounts — lista contas com estado de conexão
export async function GET() {
  try {
    const { data: stored, error } = await supabaseAdmin
      .from('accounts')
      .select('instance_name, label')
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ accounts: [] })

    // Busca estados das instâncias na Evolution API
    const evoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    const evoData = evoRes.ok ? await evoRes.json() : []

    // Normaliza o formato variável da Evolution API
    const stateMap = new Map<string, { state: string; profileName?: string; profilePicUrl?: string }>()
    for (const item of Array.isArray(evoData) ? evoData : []) {
      const inst = item?.instance ?? item
      const name: string = inst?.instanceName ?? inst?.name ?? ''
      const state: string = inst?.connectionStatus ?? inst?.status ?? inst?.state ?? 'close'
      stateMap.set(name, {
        state,
        profileName: inst?.profileName ?? null,
        profilePicUrl: inst?.profilePicUrl ?? null,
      })
    }

    const accounts = (stored ?? []).map((row) => {
      const evo = stateMap.get(row.instance_name)
      return {
        instanceName: row.instance_name,
        label: row.label,
        state: (evo?.state === 'open' ? 'open' : evo?.state === 'connecting' ? 'connecting' : 'close') as
          'open' | 'connecting' | 'close',
        profileName: evo?.profileName ?? null,
        profilePicUrl: evo?.profilePicUrl ?? null,
      }
    })

    return NextResponse.json({ accounts })
  } catch (err) {
    console.error('GET /api/accounts error:', err)
    return NextResponse.json({ accounts: [] })
  }
}

// POST /api/accounts — cria nova instância e retorna QR code
export async function POST(req: NextRequest) {
  try {
    const { label } = await req.json()
    if (!label?.trim()) {
      return NextResponse.json({ error: 'Label obrigatório' }, { status: 400 })
    }

    const instanceName = sanitizeInstanceName(label)

    // Verifica se já existe
    const { data: existing } = await supabaseAdmin
      .from('accounts')
      .select('instance_name')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Já existe uma conta com esse nome' }, { status: 409 })
    }

    // Cria instância na Evolution API
    const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({
        instanceName,
        qrcode: false,
        integration: 'WHATSAPP-BAILEYS',
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.error('Erro ao criar instância:', errBody)
      return NextResponse.json({ error: 'Falha ao criar instância' }, { status: 500 })
    }

    // Configura webhook
    const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/evolution`
    await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({
        url: webhookUrl,
        enabled: true,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
      }),
    })

    // Obtém QR code
    const qrRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    const qrData = qrRes.ok ? await qrRes.json() : {}
    const qr: string | null = qrData?.base64 ?? qrData?.qrcode?.base64 ?? qrData?.code ?? null

    // Salva no banco
    await supabaseAdmin.from('accounts').insert({ instance_name: instanceName, label: label.trim() })

    return NextResponse.json({ instanceName, qr })
  } catch (err) {
    console.error('POST /api/accounts error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
