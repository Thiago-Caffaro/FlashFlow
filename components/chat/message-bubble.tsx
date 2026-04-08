import { CheckCheck } from 'lucide-react'
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

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`relative max-w-[65%] min-w-[80px] rounded-lg px-3 pt-2 pb-1 shadow-sm ${
          isOutbound
            ? 'bg-[#d9fdd3] rounded-tr-none'
            : 'bg-white rounded-tl-none'
        }`}
      >
        <p className="text-[#111b21] text-sm whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-[#667781] leading-none">
            {formatTime(message.created_at)}
          </span>
          {isOutbound && (
            <CheckCheck
              size={14}
              className={message.status === 'read' ? 'text-[#53bdeb]' : 'text-[#667781]'}
            />
          )}
        </div>
      </div>
    </div>
  )
}
