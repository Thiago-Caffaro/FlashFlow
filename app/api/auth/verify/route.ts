import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ ok: false })

  const parts = token.split('.')
  if (parts.length !== 2) return NextResponse.json({ ok: false })

  const [payload, sig] = parts
  const secret = process.env.AUTH_SECRET ?? 'fallback-secret-change-in-env'
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')

  if (sig !== expected) return NextResponse.json({ ok: false })

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Date.now() > data.exp) return NextResponse.json({ ok: false })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
