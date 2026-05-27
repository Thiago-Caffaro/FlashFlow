import { NextRequest, NextResponse } from 'next/server'
import { getQr } from '@/lib/qr-cache'

export const dynamic = 'force-dynamic'

// GET /api/accounts/[name]/qr — polling de QR para o modal de vinculação
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const qr = getQr(name)
  return NextResponse.json({ qr })
}
