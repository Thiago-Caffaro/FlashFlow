'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bold,
  Check,
  Images,
  Italic,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { FlowImage, FlowMedia, FlowNode, FlowNodeData, FlowReplyButton, MessageVariable } from '@/types'
import { FEATURES } from '@/lib/features'
import { AUTOMATIC_MESSAGE_VARIABLES } from '@/lib/message-template'

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
type InsertTarget = 'title' | 'message' | 'footer' | `button:${string}`

export default function MessageEditorModal({ node, onChange, onClose, instanceName }: Props) {
  const [title, setTitle] = useState<string>((node.data.messageTitle as string) ?? '')
  const [text, setText] = useState<string>((node.data.message as string) ?? '')
  const [footer, setFooter] = useState<string>((node.data.footer as string) ?? '')
  const [replyButtons, setReplyButtons] = useState<FlowReplyButton[]>(
    (node.data.replyButtons as FlowReplyButton[] | undefined) ?? []
  )
  const [images, setImages] = useState<FlowImage[]>((node.data.images as FlowImage[]) ?? [])
  const [imageTab, setImageTab] = useState<ImageTab>('upload')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<FlowMedia[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [variableQuery, setVariableQuery] = useState('')
  const [customVariables, setCustomVariables] = useState<MessageVariable[]>([])
  const [variablesLoading, setVariablesLoading] = useState(true)
  const [variableError, setVariableError] = useState<string | null>(null)
  const [variableSaving, setVariableSaving] = useState(false)
  const [editingVariableId, setEditingVariableId] = useState<string | null>(null)
  const [variableKey, setVariableKey] = useState('')
  const [variableLabel, setVariableLabel] = useState('')
  const [variableValue, setVariableValue] = useState('')
  const [insertTarget, setInsertTarget] = useState<InsertTarget>('message')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const messageDataRef = useRef({
    messageTitle: title,
    message: text,
    footer,
    replyButtons,
    images,
  })
  messageDataRef.current = {
    messageTitle: title,
    message: text,
    footer,
    replyButtons,
    images,
  }

  // Save on unmount (closing without Salvar)
  useEffect(() => {
    return () => {
      onChange(node.id, messageDataRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchVariables = useCallback(async () => {
    setVariablesLoading(true)
    setVariableError(null)
    try {
      const response = await fetch(`/api/message-variables?instance=${encodeURIComponent(instanceName)}`)
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar variaveis')
      setCustomVariables(json.variables ?? [])
    } catch (error) {
      setVariableError(error instanceof Error ? error.message : 'Falha ao carregar variaveis')
    } finally {
      setVariablesLoading(false)
    }
  }, [instanceName])

  useEffect(() => {
    void fetchVariables()
  }, [fetchVariables])

  const filteredAutomaticVariables = useMemo(() => {
    const query = variableQuery.trim().toLocaleLowerCase()
    if (!query) return AUTOMATIC_MESSAGE_VARIABLES
    return AUTOMATIC_MESSAGE_VARIABLES.filter((variable) => (
      variable.key.toLocaleLowerCase().includes(query)
      || variable.label.toLocaleLowerCase().includes(query)
    ))
  }, [variableQuery])

  const filteredCustomVariables = useMemo(() => {
    const query = variableQuery.trim().toLocaleLowerCase()
    if (!query) return customVariables
    return customVariables.filter((variable) => (
      variable.key.toLocaleLowerCase().includes(query)
      || variable.label.toLocaleLowerCase().includes(query)
    ))
  }, [customVariables, variableQuery])

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

  function insertVariable(key: string) {
    const placeholder = `{{${key}}}`
    if (insertTarget === 'title') {
      setTitle((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}${placeholder}`)
      return
    }
    if (insertTarget === 'footer') {
      setFooter((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}${placeholder}`)
      return
    }
    if (insertTarget.startsWith('button:')) {
      const buttonId = insertTarget.slice('button:'.length)
      setReplyButtons((buttons) => buttons.map((button) => (
        button.id === buttonId
          ? { ...button, label: `${button.label}${button.label && !button.label.endsWith(' ') ? ' ' : ''}${placeholder}` }
          : button
      )))
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      setText((value) => `${value}${placeholder}`)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    setText((value) => `${value.slice(0, start)}${placeholder}${value.slice(end)}`)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + placeholder.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  function resetVariableForm() {
    setEditingVariableId(null)
    setVariableKey('')
    setVariableLabel('')
    setVariableValue('')
    setVariableError(null)
  }

  function startEditingVariable(variable: MessageVariable) {
    setEditingVariableId(variable.id)
    setVariableKey(variable.key)
    setVariableLabel(variable.label)
    setVariableValue(variable.value)
    setVariableError(null)
  }

  async function saveCustomVariable() {
    setVariableSaving(true)
    setVariableError(null)
    try {
      const url = editingVariableId
        ? `/api/message-variables/${encodeURIComponent(editingVariableId)}`
        : '/api/message-variables'
      const response = await fetch(url, {
        method: editingVariableId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: instanceName,
          key: variableKey,
          label: variableLabel,
          value: variableValue,
        }),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao salvar variavel')
      resetVariableForm()
      await fetchVariables()
    } catch (error) {
      setVariableError(error instanceof Error ? error.message : 'Falha ao salvar variavel')
    } finally {
      setVariableSaving(false)
    }
  }

  async function deleteCustomVariable(variable: MessageVariable) {
    setVariableError(null)
    try {
      const response = await fetch(
        `/api/message-variables/${encodeURIComponent(variable.id)}?instance=${encodeURIComponent(instanceName)}`,
        { method: 'DELETE' }
      )
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Falha ao excluir variavel')
      if (editingVariableId === variable.id) resetVariableForm()
      await fetchVariables()
    } catch (error) {
      setVariableError(error instanceof Error ? error.message : 'Falha ao excluir variavel')
    }
  }

  function addReplyButton() {
    if (replyButtons.length >= 3) return
    const id = `reply-${Date.now()}-${replyButtons.length + 1}`
    setReplyButtons((buttons) => [...buttons, { id, label: '' }])
    setInsertTarget(`button:${id}`)
  }

  function updateReplyButton(id: string, label: string) {
    setReplyButtons((buttons) => buttons.map((button) => (
      button.id === id ? { ...button, label } : button
    )))
  }

  function removeReplyButton(id: string) {
    setReplyButtons((buttons) => buttons.filter((button) => button.id !== id))
    if (insertTarget === `button:${id}`) setInsertTarget('message')
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
    onChange(node.id, { messageTitle: title, message: text, footer, replyButtons, images })
    onClose()
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onChange(node.id, { messageTitle: title, message: text, footer, replyButtons, images })
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
            onClick={() => {
              onChange(node.id, { messageTitle: title, message: text, footer, replyButtons, images })
              onClose()
            }}
            className="p-1.5 rounded-lg text-[#667781] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-[#f0f2f5] dark:divide-[#2a3942]">
          {/* Left: Editor */}
          <div className="flex flex-col w-[55%] p-5 gap-4 min-w-0 overflow-y-auto">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Titulo</span>
              <input
                value={title}
                onFocus={() => setInsertTarget('title')}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Titulo opcional"
                className="w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-3 py-2 outline-none focus:border-[#00a884]"
              />
            </label>

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
              onFocus={() => setInsertTarget('message')}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite a mensagem..."
              rows={8}
              className="w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-xl px-4 py-3 outline-none focus:border-[#00a884] transition-colors resize-none font-mono"
            />

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Rodape</span>
              <input
                value={footer}
                onFocus={() => setInsertTarget('footer')}
                onChange={(event) => setFooter(event.target.value)}
                placeholder="Selecione uma opcao"
                className="w-full text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-3 py-2 outline-none focus:border-[#00a884]"
              />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Opcoes de resposta</span>
                <button
                  type="button"
                  onClick={addReplyButton}
                  disabled={replyButtons.length >= 3}
                  title="Adicionar opcao"
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-[#00a884] hover:bg-[#e7f8f3] dark:hover:bg-[#103c35] disabled:opacity-40"
                >
                  <Plus size={15} />
                </button>
              </div>
              {replyButtons.length === 0 ? (
                <p className="text-xs text-[#8696a0]">Sem opcoes. Adicione ate tres para pausar o fluxo e aguardar a resposta.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {replyButtons.map((button, index) => (
                    <div key={button.id} className="flex items-center gap-2">
                      <span className="w-5 text-xs font-semibold text-[#667781]">{index + 1}</span>
                      <input
                        value={button.label}
                        onFocus={() => setInsertTarget(`button:${button.id}`)}
                        onChange={(event) => updateReplyButton(button.id, event.target.value)}
                        placeholder={index === 0 ? 'CONFIRMAR PEDIDO' : 'MODIFICAR DADOS'}
                        maxLength={80}
                        className="min-w-0 flex-1 text-sm text-[#111b21] dark:text-[#e9edef] bg-[#f0f2f5] dark:bg-[#2a3942] border border-[#d1d7db] dark:border-[#3d4f5a] rounded-lg px-3 py-2 outline-none focus:border-[#00a884]"
                      />
                      <button
                        type="button"
                        onClick={() => removeReplyButton(button.id)}
                        title="Remover opcao"
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-y border-[#e4e7e9] dark:border-[#2a3942] py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-[#667781] uppercase tracking-wide">Variaveis</span>
                <span className="text-[11px] text-[#8696a0]">Inserir em: {
                  insertTarget === 'message' ? 'mensagem'
                    : insertTarget === 'title' ? 'titulo'
                      : insertTarget === 'footer' ? 'rodape'
                        : 'opcao'
                }</span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                <input
                  value={variableQuery}
                  onChange={(event) => setVariableQuery(event.target.value)}
                  placeholder="Buscar variavel"
                  className="w-full text-sm bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg pl-9 pr-3 py-2 outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
              <div className="max-h-44 overflow-y-auto flex flex-col gap-3 pr-1">
                {filteredAutomaticVariables.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-[#8696a0] uppercase">Automaticas</span>
                    {filteredAutomaticVariables.map((variable) => (
                      <button
                        type="button"
                        key={variable.key}
                        onClick={() => insertVariable(variable.key)}
                        title={variable.description}
                        className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                      >
                        <span className="text-xs font-medium text-[#111b21] dark:text-[#e9edef]">{variable.label}</span>
                        <code className="text-[11px] text-[#008f72]">{`{{${variable.key}}}`}</code>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#8696a0] uppercase">Personalizadas</span>
                  {variablesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-[#8696a0]">
                      <Loader2 size={13} className="animate-spin" />
                      Carregando...
                    </div>
                  ) : filteredCustomVariables.length === 0 ? (
                    <p className="text-xs text-[#8696a0]">Nenhuma variavel personalizada.</p>
                  ) : filteredCustomVariables.map((variable) => (
                    <div key={variable.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => insertVariable(`personalizada.${variable.key}`)}
                        className="min-w-0 flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                      >
                        <span className="truncate text-xs font-medium text-[#111b21] dark:text-[#e9edef]">{variable.label}</span>
                        <code className="shrink-0 text-[11px] text-[#008f72]">{`{{personalizada.${variable.key}}}`}</code>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditingVariable(variable)}
                        title="Editar variavel"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[#667781] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCustomVariable(variable)}
                        title="Excluir variavel"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={variableLabel}
                  onChange={(event) => setVariableLabel(event.target.value)}
                  placeholder="Nome visivel"
                  maxLength={80}
                  className="text-xs bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#00a884]"
                />
                <input
                  value={variableKey}
                  onChange={(event) => setVariableKey(event.target.value.toLocaleLowerCase())}
                  placeholder="chave_sem_espacos"
                  maxLength={48}
                  className="text-xs font-mono bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#00a884]"
                />
                <input
                  value={variableValue}
                  onChange={(event) => setVariableValue(event.target.value)}
                  placeholder="Valor enviado"
                  maxLength={2000}
                  className="col-span-2 text-xs bg-[#f0f2f5] dark:bg-[#2a3942] rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[#00a884]"
                />
              </div>
              {variableError && (
                <div className="flex items-center gap-2 text-xs text-red-500" role="alert">
                  <AlertCircle size={13} />
                  {variableError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                {editingVariableId && (
                  <button type="button" onClick={resetVariableForm} className="text-xs text-[#667781] px-3 py-2">
                    Cancelar edicao
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveCustomVariable()}
                  disabled={variableSaving || !variableKey.trim() || !variableLabel.trim()}
                  className="flex items-center gap-2 text-xs font-semibold text-white bg-[#00a884] hover:bg-[#008f72] disabled:opacity-50 px-3 py-2 rounded-lg"
                >
                  {variableSaving ? <Loader2 size={13} className="animate-spin" /> : editingVariableId ? <Save size={13} /> : <Plus size={13} />}
                  {editingVariableId ? 'Atualizar' : 'Criar variavel'}
                </button>
              </div>
            </div>

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

              {(title.trim() || text.trim() || footer.trim() || replyButtons.length > 0) && (
                <div className="self-end max-w-[85%] bg-[#d9fdd3] dark:bg-[#005c4b] px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm">
                  {title.trim() && (
                    <p
                      className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef] break-words mb-1"
                      dangerouslySetInnerHTML={{ __html: parseWhatsAppText(title) }}
                    />
                  )}
                  {text.trim() && (
                    <p
                      className="text-sm text-[#111b21] dark:text-[#e9edef] break-words"
                      dangerouslySetInnerHTML={{ __html: parseWhatsAppText(text) }}
                    />
                  )}
                  {footer.trim() && (
                    <p
                      className="text-xs text-[#667781] dark:text-[#aebac1] break-words mt-2"
                      dangerouslySetInnerHTML={{ __html: parseWhatsAppText(footer) }}
                    />
                  )}
                  {replyButtons.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#b7dcb2] dark:border-[#287565] flex flex-col">
                      {replyButtons.map((button, index) => (
                        <div
                          key={button.id}
                          className="text-center text-xs font-semibold text-[#008f72] dark:text-[#53bdeb] py-1.5"
                        >
                          {index + 1}. {button.label || 'Opcao sem texto'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!title.trim() && !text.trim() && !footer.trim() && replyButtons.length === 0 && images.length === 0 && (
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
            onClick={() => {
              onChange(node.id, { messageTitle: title, message: text, footer, replyButtons, images })
              onClose()
            }}
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
