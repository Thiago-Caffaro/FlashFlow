import { io, Socket } from 'socket.io-client'
import { cacheQr, clearQr } from './qr-cache'

let socket: Socket | null = null

function handleQrEvent(data: unknown) {
  const d = data as Record<string, unknown>
  const instance: string = (d.instance as string) ?? ''
  const dataField = d.data as Record<string, unknown> | undefined
  const qr: string | null =
    (dataField?.qrcode as Record<string, unknown> | undefined)?.base64 as string ??
    (dataField?.base64 as string) ??
    (typeof dataField?.qrcode === 'string' ? dataField.qrcode : null) ??
    null
  console.log(`[evo-socket] qrcode.updated instance="${instance}" qr=${!!qr}`)
  if (instance && qr) cacheQr(instance, qr)
}

function handleConnectionEvent(data: unknown) {
  const d = data as Record<string, unknown>
  const instance: string = (d.instance as string) ?? ''
  const dataField = d.data as Record<string, unknown> | undefined
  const state: string = (
    (dataField?.instance as Record<string, unknown> | undefined)?.state ??
    dataField?.state ??
    ''
  ) as string
  console.log(`[evo-socket] connection.update instance="${instance}" state=${state}`)
  if (state === 'open' && instance) clearQr(instance)
}

export function ensureEvoSocket() {
  if (socket?.connected) return

  const url = process.env.EVOLUTION_API_URL
  const apikey = process.env.EVOLUTION_API_KEY
  if (!url || !apikey) return

  console.log(`[evo-socket] connecting to ${url}`)

  socket = io(url, {
    auth: { apikey },
    query: { apikey },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 5000,
    timeout: 10000,
  })

  socket.on('connect', () => {
    console.log(`[evo-socket] connected id=${socket?.id}`)
  })

  socket.on('connect_error', (err) => {
    console.log(`[evo-socket] connect_error: ${err.message}`)
  })

  socket.on('disconnect', (reason) => {
    console.log(`[evo-socket] disconnected reason=${reason}`)
  })

  // Event names com ponto (formato padrão Evolution API v2.x)
  socket.on('qrcode.updated', handleQrEvent)
  socket.on('connection.update', handleConnectionEvent)

  // Fallback: evento genérico com type discriminator (algumas versões usam isso)
  socket.on('events', (data: unknown) => {
    const d = data as Record<string, unknown>
    const eventType = ((d.event ?? d.type ?? '') as string).toLowerCase()
    if (eventType === 'qrcode.updated' || eventType === 'qrcode_updated') handleQrEvent(data)
    if (eventType === 'connection.update' || eventType === 'connection_update') handleConnectionEvent(data)
  })
}
