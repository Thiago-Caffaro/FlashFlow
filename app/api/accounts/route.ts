import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cacheQr } from '@/lib/qr-cache'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL!

const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE',
  'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED',
  'CHATS_UPSERT', 'CHATS_UPDATE',
]

// Ensures all instances point their webhook to the current WEBHOOK_BASE_URL.
// Old instances may have a stale IP-based URL that doesn't resolve inside Docker
// (hairpin NAT is blocked on most VPS providers).
let webhooksSynced = false
async function syncWebhooks(instanceNames: string[]) {
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/evolution`
  await Promise.all(
    instanceNames.map(name =>
      fetch(`${EVOLUTION_API_URL}/webhook/set/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhook_by_events: true,
            webhook_base64: false,
            events: WEBHOOK_EVENTS,
          },
        }),
      }).catch(() => {})
    )
  )
}

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

    // Reconcilia: instâncias abertas na Evolution que não estão no Supabase são auto-registradas
    const storedNames = new Set((stored ?? []).map((r) => r.instance_name))
    const toInsert: { instance_name: string; label: string }[] = []
    for (const [name, evo] of stateMap.entries()) {
      if (!storedNames.has(name) && evo.state.toLowerCase() === 'open') {
        toInsert.push({ instance_name: name, label: name })
      }
    }
    if (toInsert.length > 0) {
      await supabaseAdmin.from('accounts').upsert(toInsert, { onConflict: 'instance_name', ignoreDuplicates: true })
      for (const row of toInsert) {
        ;(stored ?? []).push(row)
        storedNames.add(row.instance_name)
      }
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

    // One-time sync: update stale webhook URLs for existing instances (fire and forget)
    if (!webhooksSynced && accounts.length > 0) {
      webhooksSynced = true
      void syncWebhooks(accounts.map((a) => a.instanceName))
    }

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

    const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/evolution`

    // Cria instância com qrcode:true para obter o QR diretamente na resposta.
    // Timeout de 40s — o handshake via proxy pode demorar alguns segundos.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 40_000)

    let createRes: Response
    try {
      createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        signal: controller.signal,
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhook_by_events: true,
            webhook_base64: false,
            events: WEBHOOK_EVENTS,
          },
        }),
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.error('Erro ao criar instância:', errBody)
      return NextResponse.json({ error: 'Falha ao criar instância' }, { status: 500 })
    }

    const createData = await createRes.json()
    console.log('[accounts/create] resposta completa:', JSON.stringify(createData).slice(0, 800))

    // Salva no banco
    const { error: insertError } = await supabaseAdmin
      .from('accounts')
      .insert({ instance_name: instanceName, label: label.trim() })

    if (insertError) {
      console.error('Erro ao salvar conta no banco:', insertError)
      return NextResponse.json({ error: 'Falha ao registrar conta no banco' }, { status: 500 })
    }

    // qrcode:true → QR vem na resposta do create
    const qr: string | null = createData?.qrcode?.base64 ?? createData?.base64 ?? null

    if (qr) {
      cacheQr(instanceName, qr)
    } else {
      console.log('[accounts/create] QR não veio no create — aguardando QRCODE_UPDATED webhook')
    }

    return NextResponse.json({ instanceName, qr })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('POST /api/accounts: timeout ao criar instância (40s)')
      return NextResponse.json({ error: 'Timeout ao criar instância' }, { status: 504 })
    }
    console.error('POST /api/accounts error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
