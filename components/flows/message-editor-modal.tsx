'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Italic, Paperclip, X, Loader2, AlertCircle, Upload, Images, Check } from 'lucide-react'
import { FlowImage, FlowMedia, FlowNode, FlowNodeData } from '@/types'
import { FEATURES } from '@/lib/features'

interface Props {
  node: FlowNode
  onChange: (id: string, data: Partial<FlowNodeData>) => void
  onClose: () => void
  instanceName: string
}

const MAX_SIZE = 500 * 1024

function parseWhatsAppText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

type ImageTab = 'upload' | 'gallery'

export default function MessageEditorModal({ node, onChange, onClose, instanceName }: Props) {
  const [text, setText] = useState<string>((node.data.message as string) ?? '')
  const [images, setImages] = useState<FlowImage[]>((node.data.images as FlowImage[]) ?? [])
  const [imageTab, setImageTab] = useState<ImageTab>('upload')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<FlowMedia[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const textRef = useRef(text)
  const imagesRef = useRef(images)
  textRef.current = text
  imagesRef.current = images

  // Save on unmount (closing without Salvar)
  useEffect(() => {
    return () => {
      onChange(node.id, { message: textRef.current, images: imagesRef.current })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchGallery = useCallback(async () => {
    setGalleryLoading(true)
    try {
      const res = await fetch(`/api/flow-media?instance=${encodeURIComponent(instanceName)}`)
      const json = await res.json()
      setGallery(json.data ?? [])
    } finally {
      setGalleryLoading(false)
    }
  }, [instanceName])

  useEffect(() => {
    if (imageTab === 'gallery' && gallery.length === 0 && !galleryLoading) {
      fetchGallery()
    }
  }, [imageTab, gallery.length, galleryLoading, fetchGallery])

  function wrapSelection(open: string, close: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = text.slice(start, end)
    const before = text.slice(0, start)
    const after = text.slice(end)
    const next = selected
      ? `${before}${open}${selected}${close}${after}`
      : `${before}${open}${close}${after}`
    setText(next)
    const cursor = selected ? end + open.length : start + open.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(cursor, cursor)
    })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadError(null)

    if (!file.type.startsWith('image/')) { setUploadError('Apenas imagens são permitidas'); return }
    if (file.size > MAX_SIZE) { setUploadError('A imagem excede o limite de 500KB'); return }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('instanceName', instanceName)
      const res = await fetch('/api/flow-media', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.data) { setUploadError(json.error ?? 'Erro ao fazer upload'); return }
      const added: FlowImage = { id: json.data.id, url: json.data.url, filename: json.data.filename }
      setImages((prev) => [...prev, added])
      // Also add to gallery cache if it was loaded
      setGallery((prev) => prev.length > 0 ? [json.data as FlowMedia, ...prev] : prev)
    } catch {
      setUploadError('Erro ao fazer upload')
    } finally {
      setUploading(false)
    }
  }

  function toggleGalleryImage(item: FlowMedia) {
    setImages((prev) => {
      const already = prev.some((img) => img.id === item.id)
      if (already) return prev.filter((img) => img.id !== item.id)
      return [...prev, { id: item.id, url: item.url, filename: item.filename }]
    })
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  function handleSave() {
    onChange(node.id, { message: text, images })
    onClose()
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onChange(node.id, { message: text, images })
      onClose()
    }
  }

  const selectedIds = new Set(images.map((img) => img.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        className="relative bg-white dark:bg-[#111b21] rounded-2xl shadow-2xl w-[92vw] max-w-5xl flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
          <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Editar Mensagem</h2>
          <button
            onClick={() => { onChange(node.id, { message: text, images }); onClose() }}
            className="p-1.5 rounded-lg text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-[#f0f2f5] dark:divide-[#2a3942]">
          {/* Left: Editor */}
          <div className="flex flex-col w-[55%] p-5 gap-4 min-w-0 overflow-y-auto">
            {/* Formatting toolbar */}
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide mr-2">Formatação</span>
              <button
                onClick={() => wrapSelection('*', '*')}
                title="Negrito (*texto*)"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors"
              >
                <Bold size={15} />
              </button>
              <button
                onClick={() => wrapSelection('_', '_')}
                title="Itálico (_texto_)"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[#111b21] dark:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors"
              >
                <Italic size={15} />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite a mensagem..."
              rows={8}
              className="w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-4 py-3 outline-none focus:border-[#00a884] transition-colors resize-none font-mono"
            />

            {/* Images section */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Imagens</span>
                {/* Attached images chips */}
                {images.length > 0 && (
                  <span className="text-xs text-[#00a884]">{images.length} selecionada{images.length > 1 ? 's' : ''}</span>
                )}
              </div>

              {/* Attached images */}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <div key={img.id} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.filename}
                        className="w-14 h-14 object-cover rounded-lg border-2 border-[#00a884]"
                      />
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={11} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab toggle: upload vs gallery */}
              {FEATURES.gallery && <div className="flex items-center gap-1 p-1 bg-[#f0f2f5] dark:bg-[#2a3942] rounded-xl w-fit">
                <button
                  onClick={() => setImageTab('upload')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    imageTab === 'upload'
                      ? 'bg-white dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] shadow-sm'
                      : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef]'
                  }`}
                >
                  <Upload size={12} />
                  Novo upload
                </button>
                <button
                  onClick={() => setImageTab('gallery')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    imageTab === 'gallery'
                      ? 'bg-white dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef] shadow-sm'
                      : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef]'
                  }`}
                >
                  <Images size={12} />
                  Da galeria
                </button>
              </div>}

              {/* Upload tab */}
              {imageTab === 'upload' && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 self-start text-xs font-semibold text-[#00a884] hover:text-[#008f72] disabled:opacity-50 transition-colors"
                  >
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                    Selecionar arquivo
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  {uploadError && (
                    <div className="flex items-center gap-2 text-xs text-red-500">
                      <AlertCircle size={12} />
                      {uploadError}
                    </div>
                  )}
                  <p className="text-[11px] text-[#aebac1] dark:text-[#667781]">Máx. 500KB · JPG, PNG, GIF, WebP</p>
                </div>
              )}

              {/* Gallery tab */}
              {FEATURES.gallery && imageTab === 'gallery' && (
                <div className="flex flex-col gap-2">
                  {galleryLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#667781]">
                      <Loader2 size={13} className="animate-spin" />
                      Carregando galeria...
                    </div>
                  ) : gallery.length === 0 ? (
                    <p className="text-xs text-[#aebac1] dark:text-[#667781]">Nenhuma imagem na galeria. Faça upload na aba "Galeria".</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                      {gallery.map((item) => {
                        const selected = selectedIds.has(item.id)
                        return (
                          <button
                            key={item.id}
                            onClick={() => toggleGalleryImage(item)}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                              selected
                                ? 'border-[#00a884] ring-2 ring-[#00a884]/30'
                                : 'border-[#d1d7db] dark:border-[#3d4f5a] hover:border-[#00a884]/50'
                            }`}
                            title={item.filename}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.url} alt={item.filename} className="w-full h-full object-cover" />
                            {selected && (
                              <div className="absolute inset-0 bg-[#00a884]/20 flex items-center justify-center">
                                <div className="w-5 h-5 bg-[#00a884] rounded-full flex items-center justify-center">
                                  <Check size={11} className="text-white" />
                                </div>
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex flex-col w-[45%] p-5 gap-4 min-w-0 overflow-y-auto bg-[#efeae2] dark:bg-[#0d1a1f] rounded-br-2xl">
            <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide shrink-0">Pré-visualização</span>

            <div className="flex flex-col gap-2 flex-1">
              {images.length > 0 && (
                <div className="self-end max-w-[85%]">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {images.map((img) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={img.id}
                        src={img.url}
                        alt={img.filename}
                        className="w-24 h-24 object-cover rounded-lg shadow"
                      />
                    ))}
                  </div>
                </div>
              )}

              {text.trim() && (
                <div className="self-end max-w-[85%] bg-[#d9fdd3] dark:bg-[#005c4b] px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm">
                  <p
                    className="text-sm text-[#111b21] dark:text-[#e9edef] break-words"
                    dangerouslySetInnerHTML={{ __html: parseWhatsAppText(text) }}
                  />
                </div>
              )}

              {!text.trim() && images.length === 0 && (
                <p className="text-xs text-[#aebac1] dark:text-[#667781] text-center mt-12">
                  A pré-visualização aparecerá aqui
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
          <button
            onClick={() => { onChange(node.id, { message: text, images }); onClose() }}
            className="px-4 py-2 text-sm text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm font-semibold bg-[#00a884] text-white rounded-xl hover:bg-[#008f72] transition-colors shadow-sm"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
