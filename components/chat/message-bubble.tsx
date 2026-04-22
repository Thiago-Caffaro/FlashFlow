import { CheckCheck, ChevronsRight, Play } from 'lucide-react'
import { Message } from '@/types'
import AudioPlayer from './audio-player'

interface MessageBubbleProps {
  message: Message
  waId?: string
  instanceName?: string
  avatarUrl?: string | null
  initials?: string
  isGroup?: boolean
}

const GROUP_NAME_COLORS = ['#e17055', '#0984e3', '#00b894', '#6c5ce7', '#fdcb6e', '#e84393']

function senderColor(jid: string): string {
  let h = 0
  for (const c of jid) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return GROUP_NAME_COLORS[Math.abs(h) % GROUP_NAME_COLORS.length]
}

function SenderLabel({
  senderJid,
  senderName,
  instanceName,
}: {
  senderJid: string
  senderName: string | null | undefined
  instanceName?: string
}) {
  const color = senderColor(senderJid)
  const phone = senderJid.replace('@s.whatsapp.net', '').replace('@lid', '')
  const displayName = senderName || phone
  const proxyUrl = instanceName
    ? `/api/profile-picture/proxy?waId=${encodeURIComponent(senderJid)}&instance=${encodeURIComponent(instanceName)}`
    : null

  return (
    <div className="flex items-center gap-1.5 mb-0.5">
      {proxyUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxyUrl}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <span className="text-[11px] font-semibold leading-none" style={{ color }}>
        {displayName}
      </span>
    </div>
  )
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
    return <ChevronsRight size={size} className="text-[#667781] dark:text-[#8696a0] animate-move-right" />
  }
  return (
    <CheckCheck
      size={size}
      className={status === 'read' ? 'text-[#53bdeb]' : 'text-[#667781] dark:text-[#8696a0]'}
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
        className={`text-[10px] leading-none ${overlay ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]'}`}
      >
        {time}
      </span>
      {isOutbound && <StatusIcon status={status} size={14} />}
    </div>
  )
}

export default function MessageBubble({ message, waId, instanceName, avatarUrl, initials, isGroup }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const time = formatTime(message.created_at)
  const fromMe = isOutbound
  const canLoadMedia =
    !!message.wa_message_id && !!waId && !!instanceName

  const showSenderCompact = isGroup && !isOutbound && !!message.sender_jid

  if (message.type === 'audio') {
    const msgType = canLoadMedia ? 'audioMessage' : null
    const src = canLoadMedia && msgType
      ? buildMediaProxyUrl(message.wa_message_id!, fromMe, waId!, instanceName!, msgType)
      : null

    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
        <div
          className={`relative rounded-2xl shadow-sm px-3 pt-2 pb-1 ${
            isOutbound ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none' : 'bg-white dark:bg-[#202c33] rounded-tl-none'
          }`}
        >
          {showSenderCompact && (
            <SenderLabel
              senderJid={message.sender_jid!}
              senderName={message.sender_name}
              instanceName={instanceName}
            />
          )}
          {src ? (
            <AudioPlayer
              src={src}
              isOutbound={isOutbound}
              avatarUrl={avatarUrl}
              initials={initials}
            />
          ) : (
            <span className="text-sm text-[#667781] dark:text-[#8696a0]">[áudio]</span>
          )}
          <div className="flex items-center justify-end gap-1 mt-1">
            <span className="text-[10px] text-[#667781] dark:text-[#8696a0] leading-none">{time}</span>
            {isOutbound && <StatusIcon status={message.status} />}
          </div>
        </div>
      </div>
    )
  }

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
            <div className="w-20 h-20 rounded bg-[#d9fdd3] dark:bg-[#005c4b] flex items-center justify-center text-2xl">
              🎭
            </div>
          )}
          <TimestampRow time={time} isOutbound={isOutbound} status={message.status} overlay />
        </div>
      </div>
    )
  }

  if (message.type === 'video') {
    const src = canLoadMedia
      ? buildMediaProxyUrl(message.wa_message_id!, fromMe, waId!, instanceName!, 'videoMessage')
      : null

    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
        <div
          className={`relative rounded-lg shadow-sm overflow-hidden ${
            isOutbound ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none' : 'bg-white dark:bg-[#202c33] rounded-tl-none'
          }`}
          style={{ maxWidth: 280 }}
        >
          {showSenderCompact && (
            <div className="px-3 pt-2">
              <SenderLabel
                senderJid={message.sender_jid!}
                senderName={message.sender_name}
                instanceName={instanceName}
              />
            </div>
          )}
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
            <p className="text-[#111b21] dark:text-[#e9edef] text-sm px-3 pt-1 pb-0 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
          <TimestampRow time={time} isOutbound={isOutbound} status={message.status} />
        </div>
      </div>
    )
  }

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
            isOutbound ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none' : 'bg-white dark:bg-[#202c33] rounded-tl-none'
          } max-w-[60%] min-w-[120px] p-1`}
        >
          {showSenderCompact && (
            <div className="px-1 pt-1">
              <SenderLabel
                senderJid={message.sender_jid!}
                senderName={message.sender_name}
                instanceName={instanceName}
              />
            </div>
          )}
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
              className="flex items-center justify-center bg-[#e9edef] dark:bg-[#2a3942] rounded"
              style={{ width: 160, height: 120 }}
            >
              <span className="text-[#667781] dark:text-[#8696a0] text-xs">imagem</span>
            </div>
          )}
          {message.content && !isImageUrl(message.content) && message.content !== '[imagem]' && (
            <p className="text-[#111b21] dark:text-[#e9edef] text-sm px-2 pt-1 pb-0 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
    )
  }

  const showSender = isGroup && !isOutbound && !!message.sender_jid

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`relative rounded-lg shadow-sm overflow-hidden ${
          isOutbound ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none' : 'bg-white dark:bg-[#202c33] rounded-tl-none'
        } max-w-[65%] min-w-[80px] px-3 pt-2 pb-1`}
      >
        {showSender && (
          <SenderLabel
            senderJid={message.sender_jid!}
            senderName={message.sender_name}
            instanceName={instanceName}
          />
        )}
        <p className="text-[#111b21] dark:text-[#e9edef] text-sm whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-[#667781] dark:text-[#8696a0] leading-none">{time}</span>
          {isOutbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  )
}
