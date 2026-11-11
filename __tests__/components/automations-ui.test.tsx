import { renderToStaticMarkup } from 'react-dom/server'
import AutomationCard from '@/components/automations/automation-card'
import AutomationDialog from '@/components/automations/automation-dialog'
import { countryLabel, formatDelay, splitDelay } from '@/lib/automation-display'
import type { Account, AutomationWithSteps } from '@/types'

const automation: AutomationWithSteps = {
  id: 'auto-1',
  name: 'Carrinho ES',
  kind: 'abandoned_cart',
  platform: 'shopify',
  country: 'ES',
  product_line_id: 'line-ema',
  instance_name: 'wa-es',
  enabled: true,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  steps: [
    { id: 's1', automation_id: 'auto-1', position: 1, delay_minutes: 60, message: 'Oi', fallback_template_id: null, fallback_template_variable_map: {}, flow_id: 'f1', created_at: '', updated_at: '' },
    { id: 's2', automation_id: 'auto-1', position: 2, delay_minutes: 1440, message: 'Último', fallback_template_id: null, fallback_template_variable_map: {}, flow_id: 'f2', created_at: '', updated_at: '' },
  ],
}

const account = (overrides: Partial<Account> = {}): Account => ({
  instanceName: 'wa-es',
  label: 'Espanha 1',
  state: 'open',
  provider: 'evolution',
  ...overrides,
})

const noop = async () => true

describe('automation-display', () => {
  it('quebra e formata o tempo de espera na maior unidade exata', () => {
    expect(splitDelay(90)).toEqual({ value: 90, unit: 'minutes' })
    expect(splitDelay(120)).toEqual({ value: 2, unit: 'hours' })
    expect(splitDelay(2880)).toEqual({ value: 2, unit: 'days' })
    expect([30, 60, 1440, 4320].map(formatDelay)).toEqual(['30 min', '1 h', '1 dia', '3 dias'])
  })

  it('mostra o país pelo nome', () => {
    expect(countryLabel('es')).toBe('Espanha (ES)')
    expect(countryLabel('LT')).toBe('LT')
  })
})

describe('AutomationCard', () => {
  it('mostra país, linha, número e a sequência de lembretes', () => {
    const html = renderToStaticMarkup(
      <AutomationCard
        automation={automation}
        line={{ id: 'line-ema', code: 'EMA', name: 'EMA', priority: 10, created_at: '', updated_at: '' }}
        account={account()}
        onToggle={noop}
        onEdit={() => {}}
        onDelete={noop}
      />,
    )
    expect(html).toContain('Carrinho ES')
    expect(html).toContain('Espanha (ES)')
    expect(html).toContain('EMA')
    expect(html).toContain('Espanha 1')
    expect(html).toContain('1 h → 1 dia')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('desconectado')
  })

  it('avisa quando o número está desconectado', () => {
    const html = renderToStaticMarkup(
      <AutomationCard automation={automation} line={null} account={account({ state: 'close' })} onToggle={noop} onEdit={() => {}} onDelete={noop} />,
    )
    expect(html).toContain('Qualquer linha')
    expect(html).toContain('desconectado')
  })
})

describe('AutomationDialog', () => {
  it('nova automação começa no modelo, com Lightfunnels ainda indisponível', () => {
    const html = renderToStaticMarkup(
      <AutomationDialog automation={null} lines={[]} accounts={[account()]} onSaved={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('Nova automação')
    expect(html).toContain('Carrinho abandonado')
    expect(html).toContain('Lightfunnels (em breve)')
    expect(html).toContain('criada desligada')
  })

  it('edição abre nos lembretes; número oficial pede template', () => {
    const html = renderToStaticMarkup(
      <AutomationDialog
        automation={automation}
        lines={[]}
        accounts={[account({ provider: 'cloud_api' })]}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Editar automação')
    expect(html).toContain('Lembrete 2')
    expect(html).toContain('Template de fallback')
    expect(html).toContain('Link do carrinho')
    expect(html).not.toContain('Pedido')
  })
})
