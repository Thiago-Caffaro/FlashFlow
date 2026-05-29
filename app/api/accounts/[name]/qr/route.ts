import { NextRequest, NextResponse } from 'next/server'
import { getQr } from '@/lib/qr-cache'
import { ensureEvoSocket } from '@/lib/evo-socket'

export const dynamic = 'force-dynamic'

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!

// GET /api/accounts/[name]/qr — polling de QR
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  // Garante conexão Socket.io ativa com a Evolution API para receber eventos de QR
  ensureEvoSocket()

  // 1. Cache — populado via webhook QRCODE_UPDATED ou Socket.io
  const cached = getQr(name)
  if (cached) {
    console.log(`[qr/${name}] cache hit`)
    return NextResponse.json({ qr: cached })
  }

  // 1.5. /instance/connectionState — estado LIVE do Baileys (não do banco)
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (res.ok) {
      const d = await res.json() as Record<string, unknown>
      const inst = (d as Record<string, Record<string, unknown>>)?.instance ?? d
      const state = (inst as Record<string, unknown>)?.state ?? d?.state ?? d?.connectionStatus ?? '?'
      const qr = ((d as Record<string, Record<string, unknown>>)?.qrcode?.base64 as string) ?? null
      console.log(`[qr/${name}] connectionState state=${state} qr=${!!qr} raw:`, JSON.stringify(d).slice(0, 300))
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] connectionState error:`, (e as Error).message)
  }

  // 2. /instance/connect — inicia o Baileys se ainda não iniciou e tenta obter QR
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (res.ok) {
      const d = await res.json() as Record<string, unknown>
      const qr = (d?.base64 ?? (d?.qrcode as Record<string, unknown> | undefined)?.base64 ?? null) as string | null
      console.log(`[qr/${name}] /instance/connect qr=${!!qr} raw:`, JSON.stringify(d).slice(0, 200))
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] /instance/connect error:`, e)
  }

  // 3. /instance/qrcode/{name} — endpoint alternativo disponível em algumas versões
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/qrcode/${name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    if (res.ok) {
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('image/')) {
        // Retornou imagem diretamente — converter para base64
        const buf = await res.arrayBuffer()
        const b64 = `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
        console.log(`[qr/${name}] /instance/qrcode image response, length=${b64.length}`)
        return NextResponse.json({ qr: b64 })
      }
      const d = await res.json() as Record<string, unknown>
      const qr = (d?.base64 ?? (d?.qrcode as Record<string, unknown> | undefined)?.base64 ?? null) as string | null
      console.log(`[qr/${name}] /instance/qrcode json qr=${!!qr} raw:`, JSON.stringify(d).slice(0, 200))
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] /instance/qrcode error:`, e)
  }

  // 4. fetchInstances — inclui QR quando instância está em estado qrcode
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
      console.log(`[qr/${name}] fetchInstances state=${inst?.connectionStatus ?? inst?.status ?? '?'} qr=${!!qr} raw:`, JSON.stringify(inst).slice(0, 300))
      if (qr) return NextResponse.json({ qr })
    }
  } catch (e) {
    console.log(`[qr/${name}] fetchInstances error:`, e)
  }

  return NextResponse.json({ qr: null })
}
