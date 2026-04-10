import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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
    let evoData = evoRes.ok ? await evoRes.json() : []
    // Se vier { instances: [...] } ou similar
    if (!Array.isArray(evoData) && evoData && typeof evoData === 'object') {
      evoData = evoData.instances ?? evoData.data ?? []
    }

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
      const rawState = (evo?.state ?? 'close').toLowerCase()
      return {
        instanceName: row.instance_name,
        label: row.label,
        state: (rawState === 'open' ? 'open' : rawState === 'connecting' ? 'connecting' : 'close') as
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

    // Cria instância na Evolution API com webhook já configurado
    const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/evolution`
    const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({
        instanceName,
        qrcode: false,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhook_by_events: true,
          webhook_base64: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'MESSAGES_DELETE',
            'SEND_MESSAGE',
            'CONNECTION_UPDATE',
            'TYPE_UPDATE',
            'CHATS_UPSERT',
            'CHATS_UPDATE'
          ],
        }
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.error('Erro ao criar instância:', errBody)
      return NextResponse.json({ error: 'Falha ao criar instância' }, { status: 500 })
    }

    // Salva no banco
    const { error: insertError } = await supabaseAdmin
      .from('accounts')
      .insert({ instance_name: instanceName, label: label.trim() })

    if (insertError) {
      console.error('Erro ao salvar conta no banco:', insertError)
      return NextResponse.json({ error: 'Falha ao registrar conta no banco' }, { status: 500 })
    }

    // Obtém QR code
    const qrRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    const qrData = qrRes.ok ? await qrRes.json() : {}
    const qr: string | null = qrData?.base64 ?? qrData?.qrcode?.base64 ?? qrData?.code ?? null

    return NextResponse.json({ instanceName, qr })
  } catch (err) {
    console.error('POST /api/accounts error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
