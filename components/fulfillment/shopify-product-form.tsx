'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react'
import { ShopifyProduct } from '@/types'

export interface ShopifyProductFormValues {
  title: string
  variant_title: string
  sku: string
  units_per_pack: string
  price: string
  currency: string
  image_url: string
}

const emptyForm: ShopifyProductFormValues = {
  title: '', variant_title: '', sku: '', units_per_pack: '1', price: '', currency: 'EUR', image_url: '',
}

const inputClass = 'w-full rounded-lg border border-transparent bg-[#f0f2f5] px-3 py-2.5 text-sm outline-none focus:border-[#00a884] dark:bg-[#2a3942] dark:text-[#e9edef]'
const btnPrimary = 'flex items-center gap-2 rounded-lg bg-[#00a884] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008f72] disabled:opacity-50'
const btnSecondary = 'flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm font-semibold text-[#667781] hover:bg-[#e6e9ec] disabled:opacity-40 dark:bg-[#2a3942] dark:text-[#e9edef] dark:hover:bg-[#334650]'

interface ShopifyProductFormProps {
  editing: ShopifyProduct | null
  busy: boolean
  saveState: 'idle' | 'saving' | 'success' | 'error'
  saveError: string | null
  onSave: (values: ShopifyProductFormValues) => Promise<void>
  onCancel: () => void
}

export default function ShopifyProductForm({
  editing,
  busy,
  saveState,
  saveError,
  onSave,
  onCancel,
}: ShopifyProductFormProps) {
  const [form, setForm] = useState<ShopifyProductFormValues>(emptyForm)

  useEffect(() => {
    setForm(editing ? {
      title: editing.title,
      variant_title: editing.variant_title ?? '',
      sku: editing.sku ?? '',
      units_per_pack: String(editing.units_per_pack ?? 1),
      price: String(editing.price),
      currency: editing.currency,
      image_url: editing.image_url ?? '',
    } : emptyForm)
  }, [editing])

  return (
    <div className="space-y-3" aria-busy={busy}>
      {editing?.source === 'shopify' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          O SKU exibido é o SKU limpo enviado ao FenixCOD. O sufixo Shopify &quot;,N&quot; é convertido
          automaticamente em unidades por pacote durante a sincronização.
        </p>
      )}
      <fieldset disabled={busy} className="space-y-3 disabled:opacity-70">
        <input
          className={inputClass}
          placeholder="Nome do produto"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="Variante (opcional, ex: Grande / Azul)"
          value={form.variant_title}
          onChange={(e) => setForm((f) => ({ ...f, variant_title: e.target.value }))}
        />
        <input
          className={inputClass}
          placeholder="SKU usado no FenixCOD"
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-[#667781]">Unidades físicas por pacote</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={1000}
            step={1}
            value={form.units_per_pack}
            onChange={(e) => setForm((f) => ({ ...f, units_per_pack: e.target.value }))}
          />
          <span className="mt-1 block text-xs text-[#667781]">
            Exemplo: um pacote comprado no Shopify com 3 frascos envia quantidade 3 ao FenixCOD.
          </span>
        </label>
        <div className="grid grid-cols-[1fr_80px] gap-2">
          <input
            className={inputClass}
            placeholder="Preço"
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
          <input
            className={inputClass}
            placeholder="EUR"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
          />
        </div>
        <input
          className={inputClass}
          placeholder="URL da imagem (opcional)"
          value={form.image_url}
          onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
        />
      </fieldset>
      <div aria-live="polite" className="min-h-5">
        {saveState === 'saving' && (
          <p className="flex items-center gap-2 text-sm font-medium text-[#54656f] dark:text-[#aebac1]">
            <Loader2 size={15} className="animate-spin text-[#00a884]" />
            Salvando alterações...
          </p>
        )}
        {saveState === 'success' && (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={15} />
            Alterações salvas com sucesso.
          </p>
        )}
        {saveState === 'error' && (
          <p className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
            <AlertCircle size={15} />
            {saveError ?? 'Não foi possível salvar. Tente novamente.'}
          </p>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => void onSave(form)}
          disabled={busy || !form.title.trim() || !form.price}
          className={btnPrimary}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? 'Salvando...' : editing ? 'Salvar' : 'Adicionar produto'}
        </button>
        <button onClick={onCancel} disabled={busy} className={btnSecondary}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
