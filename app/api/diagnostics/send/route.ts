import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { redactPhone } from '@/lib/redact'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

const RATE_LIMIT = 10
const RATE_WINDOW_MS = 5 * 60 * 1000

// POST /api/diagnostics/send — envia mensagem de teste diretamente pela Evolution API
// Body: { instance, number, message }
// Endpoint de diagnóstico capaz de disparar uma mensagem real para qualquer
// número — rate limit e redaction de PII nos logs são obrigatórios aqui.
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)
    if (!checkRateLimit(`diag-send:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return NextResponse.json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, { status: 429 })
    }

    const { instance, number, message } = await req.json()
    if (!instance || !number || !message) {
      return NextResponse.json({ error: 'instance, number e message são obrigatórios' }, { status: 400 })
    }

    const waId = String(number).replace(/\D/g, '')
    console.log(`[diag/send] instance="${instance}" to="${redactPhone(waId)}" msgLength=${String(message).length}`)

    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: waId, text: message }),
    })

    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    console.log(`[diag/send] Evolution status=${res.status}`)

    if (!res.ok) {
      return NextResponse.json(
        { error: (data.message as string) ?? (data.error as string) ?? `HTTP ${res.status}` },
        { status: res.status }
      )
    }

    const msgId = (data?.key as Record<string, unknown>)?.id as string ?? null
    return NextResponse.json({ ok: true, msgId, raw: data })
  } catch (err) {
    console.error('[diag/send] error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
