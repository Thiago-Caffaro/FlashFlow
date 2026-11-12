import { renderToStaticMarkup } from 'react-dom/server'
import AutomationCard from '@/components/automations/automation-card'
import AutomationDialog from '@/components/automations/automation-dialog'
import { AUTOMATION_COUNTRIES, countryLabel, formatDelay, splitDelay } from '@/lib/automation-display'
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
  config: {},
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

describe('modelos na tela', () => {
  it('oferece os quatro modelos e a Colômbia', () => {
    const html = renderToStaticMarkup(
      <AutomationDialog automation={null} lines={[]} accounts={[account()]} onSaved={() => {}} onClose={() => {}} />,
    )
    for (const label of ['Carrinho abandonado', 'Pedido criado', 'Status de entrega', 'Resposta por palavra-chave']) {
      expect(html).toContain(label)
    }
    expect(AUTOMATION_COUNTRIES.find((country) => country.code === 'CO')?.name).toBe('Colômbia')
  })

  it('card de palavra-chave mostra as palavras e envia na hora, sem país nem linha', () => {
    const keyword: AutomationWithSteps = {
      ...automation,
      kind: 'message_keyword',
      name: 'Preço',
      platform: null,
      country: null,
      product_line_id: null,
      config: { keywords: 'preço, valor', match: 'contains' },
      steps: [{ ...automation.steps[0], delay_minutes: 0 }],
    }
    const html = renderToStaticMarkup(
      <AutomationCard automation={keyword} line={null} account={account()} onToggle={noop} onEdit={() => {}} onDelete={noop} />,
    )
    expect(html).toContain('preço, valor')
    expect(html).toContain('Envia na hora')
    expect(html).not.toContain('Qualquer linha')
  })

  it('edição de status de entrega mostra só a mensagem, sem espera', () => {
    const delivery: AutomationWithSteps = {
      ...automation,
      kind: 'delivery_status',
      config: { statuses: ['Entregue'] },
      steps: [{ ...automation.steps[0], delay_minutes: 0 }],
    }
    const html = renderToStaticMarkup(
      <AutomationDialog automation={delivery} lines={[]} accounts={[account()]} onSaved={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('Mensagem')
    expect(html).not.toContain('Lembrete 1')
    expect(html).not.toContain('minutos sem atividade')
    expect(html).toContain('Status de entrega')
  })
})
