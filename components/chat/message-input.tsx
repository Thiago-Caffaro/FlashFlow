'use client'

import { useState, KeyboardEvent, useRef, useEffect } from 'react'
import { Send, Smile, Paperclip } from 'lucide-react'

interface MessageInputProps {
  onSend: (content: string) => void
  onSendImage: (file: File) => void
  disabled?: boolean
}

export default function MessageInput({ onSend, onSendImage, disabled }: MessageInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  const handleSend = () => {
    if (!text.trim() || disabled) return
    onSend(text.trim())
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || disabled) return
    onSendImage(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-end gap-2 px-3 py-2 bg-[#f0f2f5] shrink-0">
      <button
        type="button"
        className="p-2 text-[#54656f] hover:bg-[#e9edef] rounded-full transition-colors shrink-0"
      >
        <Smile size={22} />
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="p-2 text-[#54656f] hover:bg-[#e9edef] rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Paperclip size={22} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex-1 bg-white rounded-lg px-4 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem"
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent text-sm text-[#111b21] placeholder:text-[#667781] outline-none leading-relaxed disabled:opacity-60 block"
        />
      </div>

      <button
        type="button"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        className="p-2 bg-[#00a884] text-white rounded-full hover:bg-[#02906f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        <Send size={20} />
      </button>
    </div>
  )
}
