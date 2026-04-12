import { CheckCheck, ChevronsRight, Play } from 'lucide-react'
import { Message } from '@/types'

interface MessageBubbleProps {
  message: Message
  waId?: string
  instanceName?: string
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function isImageUrl(content: string): boolean {
  return content.startsWith('http') || content.startsWith('data:image') || content.startsWith('blob:')
}

function buildMediaProxyUrl(
  waMessageId: string,
  fromMe: boolean,
  remoteJid: string,
  instance: string,
  msgType: string
): string {
  const p = new URLSearchParams({
    id: waMessageId,
    fromMe: String(fromMe),
    remoteJid,
    instance,
    type: msgType,
  })
  return `/api/media/proxy?${p}`
}

function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  if (status === 'sending') {
    return <ChevronsRight size={size} className="text-[#667781] animate-move-right" />
  }
  return (
    <CheckCheck
      size={size}
      className={status === 'read' ? 'text-[#53bdeb]' : 'text-[#667781]'}
    />
  )
}

function TimestampRow({
  time,
  isOutbound,
  status,
  overlay = false,
}: {
  time: string
  isOutbound: boolean
  status: string
  overlay?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-end gap-1 ${
        overlay
          ? 'absolute bottom-1 right-1 bg-black/30 rounded-full px-1.5 py-0.5'
          : 'mt-1'
      }`}
    >
      <span
        className={`text-[10px] leading-none ${overlay ? 'text-white' : 'text-[#667781]'}`}
      >
        {time}
      </span>
      {isOutbound && <StatusIcon status={status} size={14} />}
    </div>
  )
}

export default function MessageBubble({ message, waId, instanceName }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const time = formatTime(message.created_at)
  const fromMe = isOutbound
  const canLoadMedia =
    !!message.wa_message_id && !!waId && !!instanceName

  // ── Sticker ──────────────────────────────────────────────────────────────
  if (message.type === 'sticker') {
    const src = canLoadMedia
      ? buildMediaProxyUrl(message.wa_message_id!, fromMe, waId!, instanceName!, 'stickerMessage')
      : null

    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
        <div className="relative" style={{ maxWidth: 160 }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="figurinha"
              className="rounded block"
              style={{ maxWidth: 160, maxHeight: 160 }}
            />
          ) : (
            <div className="w-20 h-20 rounded bg-[#d9fdd3] flex items-center justify-center text-2xl">
              🎭
            </div>
          )}
          <TimestampRow time={time} isOutbound={isOutbound} status={message.status} overlay />
        </div>
      </div>
    )
  }

  // ── Video ─────────────────────────────────────────────────────────────────
  if (message.type === 'video') {
    const src = canLoadMedia
      ? buildMediaProxyUrl(message.wa_message_id!, fromMe, waId!, instanceName!, 'videoMessage')
      : null

    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
        <div
          className={`relative rounded-lg shadow-sm overflow-hidden ${
            isOutbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'
          }`}
          style={{ maxWidth: 280 }}
        >
          {src ? (
            <div className="relative">
              <video
                src={src}
                controls
                preload="metadata"
                className="rounded block max-w-full"
                style={{ maxHeight: 240 }}
              >
                <source src={src} type="video/mp4" />
              </video>
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 bg-[#1f2c34] text-white rounded"
              style={{ width: 200, height: 140 }}
            >
              <Play size={32} className="opacity-70" />
              <span className="text-xs opacity-60">vídeo</span>
            </div>
          )}
          {message.content && message.content !== '[vídeo]' && (
            <p className="text-[#111b21] text-sm px-3 pt-1 pb-0 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
          <TimestampRow time={time} isOutbound={isOutbound} status={message.status} />
        </div>
      </div>
    )
  }

  // ── Image ─────────────────────────────────────────────────────────────────
  if (message.type === 'image') {
    const src = isImageUrl(message.content)
      ? message.content
      : canLoadMedia
      ? buildMediaProxyUrl(message.wa_message_id!, fromMe, waId!, instanceName!, 'imageMessage')
      : null

    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
        <div
          className={`relative rounded-lg shadow-sm overflow-hidden ${
            isOutbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'
          } max-w-[60%] min-w-[120px] p-1`}
        >
          {src ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="imagem"
                className="rounded block max-w-full"
                style={{ maxHeight: 300 }}
              />
              <TimestampRow time={time} isOutbound={isOutbound} status={message.status} overlay />
            </div>
          ) : (
            <div
              className="flex items-center justify-center bg-[#e9edef] rounded"
              style={{ width: 160, height: 120 }}
            >
              <span className="text-[#667781] text-xs">imagem</span>
            </div>
          )}
          {message.content && !isImageUrl(message.content) && message.content !== '[imagem]' && (
            <p className="text-[#111b21] text-sm px-2 pt-1 pb-0 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Text / fallback ───────────────────────────────────────────────────────
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`relative rounded-lg shadow-sm overflow-hidden ${
          isOutbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'
        } max-w-[65%] min-w-[80px] px-3 pt-2 pb-1`}
      >
        <p className="text-[#111b21] text-sm whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-[#667781] leading-none">{time}</span>
          {isOutbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  )
}
