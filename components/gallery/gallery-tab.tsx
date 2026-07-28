'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Images, Loader2, Pencil, Plus, Trash2, X, Check, AlertCircle, Upload } from 'lucide-react'
import { FlowMedia } from '@/types'

interface Props {
  instanceName: string
}

const MAX_SIZE = 500 * 1024

export default function GalleryTab({ instanceName }: Props) {
  const [items, setItems] = useState<FlowMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<FlowMedia | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/flow-media?instance=${encodeURIComponent(instanceName)}`)
    const json = await res.json()
    setItems(json.data ?? [])
    setLoading(false)
  }, [instanceName])

  useEffect(() => { fetchItems() }, [fetchItems])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

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
      setItems((prev) => [json.data as FlowMedia, ...prev])
    } catch {
      setUploadError('Erro ao fazer upload')
    } finally {
      setUploading(false)
    }
  }

  function startRename(item: FlowMedia) {
    const nameWithoutExt = item.filename.includes('.')
      ? item.filename.slice(0, item.filename.lastIndexOf('.'))
      : item.filename
    setRenamingId(item.id)
    setRenameValue(nameWithoutExt)
  }

  async function commitRename(id: string) {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const res = await fetch(`/api/flow-media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: trimmed, instance_name: instanceName }),
    })
    const json = await res.json()
    if (res.ok && json.data) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, filename: json.data.filename } : it)))
    }
    setRenamingId(null)
  }

  function handleRenameKey(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter') commitRename(id)
    if (e.key === 'Escape') setRenamingId(null)
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/flow-media/${id}?instance=${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
      if (res.ok) setItems((prev) => prev.filter((it) => it.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(0)} KB`
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#111b21]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f2f5] dark:border-[#2a3942] shrink-0">
        <div className="flex items-center gap-3">
          <Images size={20} className="text-[#00a884]" />
          <div>
            <h2 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Galeria de Mídia</h2>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">{items.length} imagem{items.length !== 1 ? 'ns' : ''}</p>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#00a884] text-white rounded-xl hover:bg-[#008f72] disabled:opacity-60 transition-colors shadow-sm"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          Adicionar imagem
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {/* Upload error */}
      {uploadError && (
        <div className="mx-6 mt-3 flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} />
          {uploadError}
          <button onClick={() => setUploadError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-[#aebac1]" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Upload size={36} className="text-[#d1d7db] dark:text-[#3d4f5a]" />
            <p className="text-sm text-[#aebac1] dark:text-[#667781]">Nenhuma imagem na galeria</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-semibold text-[#00a884] hover:underline"
            >
              Fazer upload
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {items.map((item) => (
              <div key={item.id} className="group flex flex-col gap-1.5">
                {/* Thumbnail */}
                <div
                  className="relative aspect-square rounded-xl overflow-hidden border-2 border-[#f0f2f5] dark:border-[#2a3942] cursor-pointer"
                  onClick={() => setLightbox(item)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.filename} className="w-full h-full object-cover" />

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(item) }}
                      className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors"
                      title="Renomear"
                    >
                      <Pencil size={14} className="text-white" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}
                      disabled={deletingId === item.id}
                      className="w-8 h-8 bg-red-500/80 hover:bg-red-600/80 rounded-lg flex items-center justify-center transition-colors disabled:opacity-60"
                      title="Excluir"
                    >
                      {deletingId === item.id
                        ? <Loader2 size={14} className="text-white animate-spin" />
                        : <Trash2 size={14} className="text-white" />}
                    </button>
                  </div>
                </div>

                {/* Filename / rename input */}
                {renamingId === item.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => handleRenameKey(e, item.id)}
                      className="flex-1 text-xs bg-[#f0f2f5] dark:bg-[#2a3942] text-[#111b21] dark:text-[#e9edef] rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-[#00a884] min-w-0"
                    />
                    <button onClick={() => commitRename(item.id)} className="text-[#00a884] shrink-0">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setRenamingId(null)} className="text-[#667781] shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1 px-0.5">
                    <p className="text-[11px] text-[#54656f] dark:text-[#8696a0] truncate flex-1" title={item.filename}>
                      {item.filename}
                    </p>
                    <span className="text-[10px] text-[#aebac1] dark:text-[#667781] shrink-0">
                      {formatSize(item.size_bytes)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.filename} className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl" />
            <p className="text-sm text-white/80">{lightbox.filename} · {formatSize(lightbox.size_bytes)}</p>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center"
            >
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
