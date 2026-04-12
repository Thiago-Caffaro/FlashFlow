import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// GET /api/accounts/[name]/status — estado de conexão da instância
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/connectionState/${name}`,
      { headers: { apikey: EVOLUTION_API_KEY } }
    )

    if (!res.ok) return NextResponse.json({ state: 'close' })

    const data = await res.json()
    const state: string = (data?.instance?.state ?? data?.state ?? 'close').toLowerCase()

    return NextResponse.json({ state })
  } catch {
    return NextResponse.json({ state: 'close' })
  }
}
