import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

const HEADERS = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY }

// Variações de path que diferentes versões da Evolution API usam para pairing code
const PAIRING_PATHS = (name: string, phone: string) => [
  {
    url: `${EVOLUTION_API_URL}/instance/pairingCode/${encodeURIComponent(name)}`,
    method: 'POST',
    body: JSON.stringify({ number: phone }),
  },
  {
    url: `${EVOLUTION_API_URL}/instance/pairing-code/${encodeURIComponent(name)}`,
    method: 'POST',
    body: JSON.stringify({ number: phone }),
  },
  {
    url: `${EVOLUTION_API_URL}/chat/pairingCode/${encodeURIComponent(name)}`,
    method: 'POST',
    body: JSON.stringify({ number: phone }),
  },
  {
    url: `${EVOLUTION_API_URL}/instance/connect/${encodeURIComponent(name)}?pairingCode=true&number=${phone}`,
    method: 'GET',
    body: undefined,
  },
]

// POST /api/accounts/[name]/pairing-code — gera código de pareamento WhatsApp
// Body: { "phoneNumber": "5511999999999" }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  let phoneNumber: string
  try {
    const body = await req.json()
    phoneNumber = String(body.phoneNumber ?? '').replace(/\D/g, '')
    if (!phoneNumber || phoneNumber.length < 8) {
      return NextResponse.json({ error: 'Número de telefone inválido' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const paths = PAIRING_PATHS(name, phoneNumber)

  for (const { url, method, body } of paths) {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? HEADERS : { apikey: EVOLUTION_API_KEY },
        ...(body ? { body } : {}),
      })

      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      console.log(`[pairing-code] ${method} ${url.replace(EVOLUTION_API_URL, '')} → ${res.status}:`, JSON.stringify(data).slice(0, 300))

      if (res.status === 404) continue  // tenta próxima variação

      if (!res.ok) {
        const msg = Array.isArray(data.message) ? (data.message as string[]).join('; ') : String(data.message ?? data.error ?? 'Falha ao gerar código')
        return NextResponse.json({ error: msg }, { status: res.status })
      }

      const code: string | null =
        (data.code as string) ??
        (data.pairingCode as string) ??
        null

      if (code) return NextResponse.json({ code })

      // Retornou 200 mas sem código — pode ser QR em base64
      const qr: string | null =
        (data.base64 as string) ??
        ((data.qrcode as Record<string, unknown> | undefined)?.base64 as string) ??
        null

      if (qr) return NextResponse.json({ qr })

      console.log(`[pairing-code] 200 mas sem code nem base64 — body:`, JSON.stringify(data).slice(0, 300))
    } catch (err) {
      console.log(`[pairing-code] fetch error for ${url}:`, (err as Error).message)
    }
  }

  return NextResponse.json(
    { error: 'Pairing code não suportado nesta versão da Evolution API. Endpoint não encontrado.' },
    { status: 404 }
  )
}
