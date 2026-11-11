'use client'

import { useState } from 'react'
import { Workflow } from 'lucide-react'
import ProductLinesPanel from './product-lines-panel'
import AutomationsPanel from './automations-panel'

type Section = 'automacoes' | 'linhas'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'automacoes', label: 'Automações' },
  { id: 'linhas', label: 'Linhas e produtos' },
]

// Automações simples (sem montar fluxo) — globais, não dependem da conta
// ativa: cada automação escolhe o próprio número.
export default function AutomationsTab() {
  const [section, setSection] = useState<Section>('automacoes')

  return (
    <div className="h-full overflow-y-auto bg-[#f0f2f5] dark:bg-[#0b141a]">
      <div className="mx-auto max-w-5xl p-4 sm:p-9">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#00a884]/10">
            <Workflow size={28} className="text-[#00a884]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#111b21] dark:text-[#e9edef]">Automações</h2>
            <p className="mt-0.5 text-sm text-[#667781] dark:text-[#8696a0]">
              Automações prontas e lineares, sem montar fluxo. Para atendimentos com caminhos diferentes, use Fluxos.
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                section === item.id
                  ? 'bg-[#00a884] text-white'
                  : 'bg-white text-[#54656f] hover:bg-[#e9edef] dark:bg-[#202c33] dark:text-[#aebac1] dark:hover:bg-[#2a3942]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {section === 'linhas' ? (
          <ProductLinesPanel />
        ) : (
          <AutomationsPanel />
        )}
      </div>
    </div>
  )
}
