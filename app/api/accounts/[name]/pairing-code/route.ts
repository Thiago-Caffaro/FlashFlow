import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

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

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/pairingCode/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ number: phoneNumber }),
      }
    )

    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    console.log(`[pairing-code] instance="${name}" phone="${phoneNumber}" status=${res.status} raw:`, JSON.stringify(data).slice(0, 200))

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? data.error ?? 'Falha ao gerar código' },
        { status: res.status }
      )
    }

    // Evolution API retorna { code: "XXXX-XXXX" } ou { pairingCode: "XXXXXXXX" }
    const code: string | null =
      (data.code as string) ??
      (data.pairingCode as string) ??
      null

    if (!code) {
      return NextResponse.json({ error: 'Código não retornado pela API' }, { status: 500 })
    }

    return NextResponse.json({ code })
  } catch (err) {
    console.error(`[pairing-code] error:`, err)
    return NextResponse.json({ error: 'Erro de conexão com a Evolution API' }, { status: 500 })
  }
}
