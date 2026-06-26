import { NextRequest, NextResponse } from 'next/server'
import { setEvolutionWebhook } from '@/lib/evolution-api'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const instanceName = decodeURIComponent(name)

  try {
    await setEvolutionWebhook(instanceName)

    const res = await fetch(
      `${process.env.EVOLUTION_API_URL}/instance/connect/${instanceName}`,
      {
        method: 'GET',
        headers: { apikey: process.env.EVOLUTION_API_KEY! },
      }
    )

    if (!res.ok) {
      const body = await res.text()
      console.error(`[reconnect] Evolution API error ${res.status}: ${body.slice(0, 200)}`)
      return NextResponse.json({ ok: false, error: 'Falha ao reconectar instância' }, { status: 502 })
    }

    console.log(`[reconnect] Instância "${instanceName}" solicitada para reconexão`)
    return NextResponse.json({ ok: true, instanceName })
  } catch (err) {
    console.error('[reconnect] Erro:', err)
    return NextResponse.json({ ok: false, error: 'Erro interno' }, { status: 500 })
  }
}
