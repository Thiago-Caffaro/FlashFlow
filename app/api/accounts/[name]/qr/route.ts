import { NextRequest, NextResponse } from 'next/server'
import { getQr } from '@/lib/qr-cache'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// GET /api/accounts/[name]/qr — polling de QR; tenta cache, fetchInstances e /instance/connect
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  // 1. Cache — populado via webhook QRCODE_UPDATED
  const cached = getQr(name)
  if (cached) return NextResponse.json({ qr: cached })

  // 2. fetchInstances — inclui QR quando instância está em estado qrcode
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`,
      { headers: { apikey: EVOLUTION_API_KEY } }
    )
    if (res.ok) {
      const data = await res.json()
      let items: unknown[] = Array.isArray(data) ? data : []
      if (!Array.isArray(data) && data && typeof data === 'object') {
        items = (data as Record<string, unknown[]>).instances ?? (data as Record<string, unknown[]>).data ?? []
      }
      const item = items[0] as Record<string, unknown> | undefined
      const inst = (item?.instance as Record<string, unknown> | undefined) ?? item
      const qr = (inst?.qrcode as Record<string, unknown> | undefined)?.base64 as string | null ?? null
      const state = inst?.connectionStatus ?? inst?.status ?? inst?.state ?? 'unknown'
      console.log(`[qr/${name}] fetchInstances state=${state} qr=${!!qr}`, !qr ? JSON.stringify(inst ?? item ?? data).slice(0, 300) : '')
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] fetchInstances error:`, e)
  }

  // 3. /instance/connect — em v2.3.7 retorna {"count":0} enquanto QR não está pronto
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (res.ok) {
      const d = await res.json() as Record<string, unknown>
      const qr = (d?.base64 ?? (d?.qrcode as Record<string, unknown> | undefined)?.base64 ?? null) as string | null
      console.log(`[qr/${name}] /instance/connect qr=${!!qr} raw:`, JSON.stringify(d).slice(0, 300))
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] /instance/connect error:`, e)
  }

  return NextResponse.json({ qr: null })
}
