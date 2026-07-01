import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureEvoSocket } from '@/lib/evo-socket'
import {
  EVOLUTION_WEBHOOK_EVENTS,
  getEvolutionConnectionState,
  setEvolutionWebhook,
  webhookConfigPayload,
} from '@/lib/evolution-api'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

const COUNTRY_MIGRATION_ERROR =
  'Banco desatualizado: aplique migrations/001_fulfillment_shopify_oauth.sql antes de criar contas.'

function isMissingCountryColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST204' && error.message?.includes("'country' column") === true
}

function isMissingConfirmationColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST204' &&
    (error.message?.includes("'confirmation_enabled' column") === true ||
      error.message?.includes("'confirmation_priority' column") === true)
}

function isMissingSandboxColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST204' && error.message?.includes("'is_sandbox' column") === true
}

// Ensures all instances point their webhook to the current WEBHOOK_BASE_URL and
// have inbound message events enabled. Retry periodically because Evolution
// v2.3.7 can return 500 from read endpoints while write endpoints still work.
let lastWebhookSyncAt = 0
async function syncWebhooks(instanceNames: string[]) {
  if (instanceNames.length === 0) return
  const results = await Promise.allSettled(instanceNames.map((name) => setEvolutionWebhook(name)))
  const okCount = results.filter((result) => result.status === 'fulfilled' && result.value).length
  console.log(`[accounts] webhook sync ${okCount}/${instanceNames.length}`)
}

function shouldSyncWebhooks() {
  const now = Date.now()
  if (now - lastWebhookSyncAt < 60_000) return false
  lastWebhookSyncAt = now
  return true
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
  ensureEvoSocket()
  try {
    let { data: stored, error } = await supabaseAdmin
      .from('accounts')
      .select('instance_name, label, country, confirmation_enabled, confirmation_priority, is_sandbox')
      .order('created_at', { ascending: true })

    if (isMissingSandboxColumn(error)) {
      const fallback = await supabaseAdmin
        .from('accounts')
        .select('instance_name, label, country, confirmation_enabled, confirmation_priority')
        .order('created_at', { ascending: true })
      stored = fallback.data?.map((row) => ({ ...row, is_sandbox: false })) ?? null
      error = fallback.error
    }

    if (isMissingCountryColumn(error) || isMissingConfirmationColumn(error)) {
      const fallback = await supabaseAdmin
        .from('accounts')
        .select('instance_name, label')
        .order('created_at', { ascending: true })
      stored = fallback.data?.map((row) => ({
        ...row,
        country: null,
        confirmation_enabled: true,
        confirmation_priority: 100,
        is_sandbox: false,
      })) ?? null
      error = fallback.error
    }

    if (error) return NextResponse.json({ accounts: [] })

    // Evolution v2.3.7 can return 500 from /instance/fetchInstances while
    // /instance/connectionState/{name} still works. Use the per-instance
    // endpoint so a Next.js restart can recover already connected accounts.
    // Sandbox accounts don't correspond to a real Evolution instance, so
    // skip the real API call and report a fixed synthetic state.
    const stateMap = new Map<string, { state: string; profileName?: string | null; profilePicUrl?: string | null; phone?: string | null }>()
    await Promise.all((stored ?? []).map(async (row) => {
      if (row.is_sandbox) {
        stateMap.set(row.instance_name, { state: 'open', profileName: 'Sandbox', profilePicUrl: null, phone: null })
        return
      }
      stateMap.set(row.instance_name, await getEvolutionConnectionState(row.instance_name))
    }))

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
        phone: evo?.phone ?? null,
        country: row.country ?? null,
        confirmationEnabled: row.confirmation_enabled ?? true,
        confirmationPriority: row.confirmation_priority ?? 100,
        isSandbox: row.is_sandbox ?? false,
      }
    })

    // Repair stale/missing per-instance webhook settings in the background.
    if (accounts.length > 0 && shouldSyncWebhooks()) {
      void syncWebhooks(accounts.map((a) => a.instanceName))
    }

    return NextResponse.json({ accounts })
  } catch (err) {
    console.error('GET /api/accounts error:', err)
    return NextResponse.json({ accounts: [] })
  }
}

// POST /api/accounts — cria nova instância e inicia fluxo de QR code
// Body: { label: string }
// qrcode:true sem number → Baileys usa fluxo QR (não pairing code)
// O QR chega via webhook qrcode.updated → cache → GET /api/accounts/[name]/qr
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const label: string = body.label ?? ''
    const country: string = String(body.country ?? '').trim().toUpperCase()

    if (!label.trim() || !country) {
      return NextResponse.json({ error: 'Nome e país são obrigatórios' }, { status: 400 })
    }

    const instanceName = sanitizeInstanceName(label)

    // Validate the required schema before creating an Evolution instance.
    const { data: existing, error: schemaError } = await supabaseAdmin
      .from('accounts')
      .select('instance_name, country')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (isMissingCountryColumn(schemaError)) {
      return NextResponse.json({ error: COUNTRY_MIGRATION_ERROR }, { status: 503 })
    }
    if (schemaError) {
      console.error('Erro ao validar schema/accounts:', schemaError)
      return NextResponse.json({ error: 'Falha ao consultar contas' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ error: 'Já existe uma conta com esse nome' }, { status: 409 })
    }

    const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: webhookConfigPayload(),
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.error('Erro ao criar instância:', errBody)
      return NextResponse.json({ error: 'Falha ao criar instância' }, { status: 500 })
    }

    const createData = await createRes.json().catch(() => ({})) as Record<string, unknown>
    console.log(`[accounts] create "${instanceName}" raw:`, JSON.stringify(createData).slice(0, 300))
    console.log(`[accounts] webhook events for "${instanceName}": ${EVOLUTION_WEBHOOK_EVENTS.join(',')}`)

    // Salva no banco
    const { error: insertError } = await supabaseAdmin
      .from('accounts')
      .insert({ instance_name: instanceName, label: label.trim(), country })

    if (insertError) {
      console.error('Erro ao salvar conta no banco:', insertError)
      await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers: { apikey: EVOLUTION_API_KEY },
      }).catch((cleanupError) => {
        console.error(`Erro ao remover instância órfã "${instanceName}":`, cleanupError)
      })
      return NextResponse.json({ error: 'Falha ao registrar conta no banco' }, { status: 500 })
    }

    // Monitor 90s: chama connectionState a cada 5s para diagnóstico do fluxo de QR
    void (async () => {
      for (let i = 1; i <= 18; i++) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          const r = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
            headers: { apikey: EVOLUTION_API_KEY },
          })
          const d = await r.json().catch(() => ({})) as Record<string, unknown>
          console.log(`[monitor] "${instanceName}" t=${i * 5}s:`, JSON.stringify(d).slice(0, 300))
        } catch (e) {
          console.log(`[monitor] "${instanceName}" t=${i * 5}s error:`, (e as Error).message)
        }
      }
    })()

    return NextResponse.json({ instanceName })
  } catch (err) {
    console.error('POST /api/accounts error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
