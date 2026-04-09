import { CheckCheck, ChevronsRight } from 'lucide-react'
import { Message } from '@/types'

interface MessageBubbleProps {
  message: Message
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

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const isImage = message.type === 'image'

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`relative rounded-lg shadow-sm overflow-hidden ${
          isOutbound
            ? 'bg-[#d9fdd3] rounded-tr-none'
            : 'bg-white rounded-tl-none'
        } ${isImage ? 'max-w-[60%] min-w-[120px] p-1' : 'max-w-[65%] min-w-[80px] px-3 pt-2 pb-1'}`}
      >
        {isImage && isImageUrl(message.content) ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.content}
              alt="imagem"
              className="rounded block max-w-full"
              style={{ maxHeight: 300 }}
            />
            <div className="flex items-center justify-end gap-1 px-1 pb-0.5 mt-0.5">
              <span className="text-[10px] text-[#667781] leading-none">
                {formatTime(message.created_at)}
              </span>
                {message.status === 'sending' ? (
                  <ChevronsRight size={14} className="text-[#667781] animate-move-right" />
                ) : (
                  <CheckCheck
                    size={14}
                    className={message.status === 'read' ? 'text-[#53bdeb]' : 'text-[#667781]'}
                  />
                )}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[#111b21] text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className="text-[10px] text-[#667781] leading-none">
                {formatTime(message.created_at)}
              </span>
              {isOutbound && (
                message.status === 'sending' ? (
                  <ChevronsRight size={14} className="text-[#667781] animate-move-right" />
                ) : (
                  <CheckCheck
                    size={14}
                    className={message.status === 'read' ? 'text-[#53bdeb]' : 'text-[#667781]'}
                  />
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
