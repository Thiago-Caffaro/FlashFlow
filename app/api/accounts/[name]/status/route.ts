import { NextRequest, NextResponse } from 'next/server'
import { getEvolutionConnectionState, setEvolutionWebhook } from '@/lib/evolution-api'

export const dynamic = 'force-dynamic'

// GET /api/accounts/[name]/status — estado de conexão da instância
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  try {
    const current = await getEvolutionConnectionState(name)
    if (current.state === 'open') {
      void setEvolutionWebhook(name).catch((err) => {
        console.error(`[status] setEvolutionWebhook("${name}") falhou:`, err instanceof Error ? err.message : err)
      })
    }

    return NextResponse.json(current)
  } catch {
    return NextResponse.json({ state: 'close' })
  }
}
