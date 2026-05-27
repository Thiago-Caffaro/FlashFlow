import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// GET /api/accounts/[name]/qr — polling de QR para o modal de vinculação
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (!res.ok) return NextResponse.json({ qr: null })
    const d = await res.json()
    const qr: string | null = d?.base64 ?? d?.qrcode?.base64 ?? null
    return NextResponse.json({ qr })
  } catch {
    return NextResponse.json({ qr: null })
  }
}
