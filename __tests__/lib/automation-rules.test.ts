import {
  automationMatchesCountry,
  buildAutomationStepFlowJson,
  parseAutomationInput,
  pickCartAutomation,
} from '@/lib/automation-rules'
import { validateFlowJson } from '@/lib/flow-validation'
import { AUTOMATION_PRESETS } from '@/lib/automation-presets'

const base = {
  kind: 'abandoned_cart',
  platform: 'shopify',
  country: 'es',
  product_line_id: 'line-ema',
  instance_name: 'conta-es',
  steps: [{ delay_minutes: 60, message: 'Oi {{contato.primeiro_nome}} {{carrinho.link}}' }],
}

describe('parseAutomationInput', () => {
  it('normaliza país, gera nome padrão e nasce desligada', () => {
    const parsed = parseAutomationInput(base)
    expect(parsed).toEqual({
      value: {
        name: 'Carrinho abandonado ES',
        kind: 'abandoned_cart',
        platform: 'shopify',
        country: 'ES',
        product_line_id: 'line-ema',
        instance_name: 'conta-es',
        enabled: false,
        steps: [{
          delay_minutes: 60,
          message: 'Oi {{contato.primeiro_nome}} {{carrinho.link}}',
          fallback_template_id: null,
          fallback_template_variable_map: {},
        }],
      },
    })
  })

  it('linha vazia vira null (qualquer linha)', () => {
    const parsed = parseAutomationInput({ ...base, product_line_id: '' })
    expect('value' in parsed && parsed.value.product_line_id).toBeNull()
  })

  it('carrinho abandonado ainda não aceita Lightfunnels', () => {
    expect(parseAutomationInput({ ...base, platform: 'lightfunnels' })).toEqual({
      error: 'Carrinho abandonado ainda não está disponível para Lightfunnels',
    })
  })

  it('rejeita modelo, país e número inválidos', () => {
    expect(parseAutomationInput({ ...base, kind: 'outro' })).toEqual({ error: 'Modelo de automação inválido' })
    expect(parseAutomationInput({ ...base, country: 'Spain' })).toEqual({ error: 'País inválido — use o código de 2 letras (ex: ES)' })
    expect(parseAutomationInput({ ...base, instance_name: ' ' })).toEqual({ error: 'Número de WhatsApp obrigatório' })
  })

  it('exige de 1 a 3 lembretes com tempos crescentes', () => {
    expect(parseAutomationInput({ ...base, steps: [] })).toEqual({ error: 'Adicione pelo menos um lembrete' })
    const step = (delay: number) => ({ delay_minutes: delay, message: 'x' })
    expect(parseAutomationInput({ ...base, steps: [step(1), step(2), step(3), step(4)] })).toEqual({ error: 'No máximo 3 lembretes' })
    expect(parseAutomationInput({ ...base, steps: [step(60), step(60)] })).toEqual({
      error: 'Lembrete 2: o tempo de espera deve ser maior que o do lembrete anterior',
    })
  })

  it('valida tempo e mensagem de cada lembrete', () => {
    expect(parseAutomationInput({ ...base, steps: [{ delay_minutes: 0, message: 'x' }] })).toEqual({
      error: 'Lembrete 1: tempo de espera deve ser entre 1 minuto e 7 dias',
    })
    expect(parseAutomationInput({ ...base, steps: [{ delay_minutes: 10081, message: 'x' }] })).toEqual({
      error: 'Lembrete 1: tempo de espera deve ser entre 1 minuto e 7 dias',
    })
    expect(parseAutomationInput({ ...base, steps: [{ delay_minutes: 5, message: '  ' }] })).toEqual({
      error: 'Lembrete 1: mensagem obrigatória',
    })
  })

  it('mantém o mapa de variáveis só quando há template', () => {
    const withTemplate = parseAutomationInput({
      ...base,
      steps: [{ delay_minutes: 5, message: 'x', fallback_template_id: 'tpl-1', fallback_template_variable_map: { 1: '{{carrinho.link}}' } }],
    })
    expect('value' in withTemplate && withTemplate.value.steps[0].fallback_template_variable_map).toEqual({ 1: '{{carrinho.link}}' })
    const withoutTemplate = parseAutomationInput({
      ...base,
      steps: [{ delay_minutes: 5, message: 'x', fallback_template_variable_map: { 1: 'y' } }],
    })
    expect('value' in withoutTemplate && withoutTemplate.value.steps[0].fallback_template_variable_map).toEqual({})
    expect(parseAutomationInput({
      ...base,
      steps: [{ delay_minutes: 5, message: 'x', fallback_template_id: 'tpl-1', fallback_template_variable_map: { nome: 'y' } }],
    })).toEqual({ error: 'Lembrete 1: variáveis do template inválidas' })
  })
})

describe('buildAutomationStepFlowJson', () => {
  it('gera início → mensagem → fim válido para o editor', () => {
    const json = buildAutomationStepFlowJson({
      delay_minutes: 60,
      message: 'Olá',
      fallback_template_id: 'tpl-1',
      fallback_template_variable_map: { 1: '{{carrinho.link}}' },
    })
    expect(validateFlowJson(json)).toEqual({ ok: true })
    const send = json.nodes.find((node) => node.type === 'sendMessage')
    expect(send?.data).toMatchObject({
      message: 'Olá',
      fallbackTemplateId: 'tpl-1',
      fallbackTemplateVariableMap: { 1: '{{carrinho.link}}' },
    })
    expect(json.edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual(['start>send', 'send>end'])
  })

  it('sem template não grava campos de fallback', () => {
    const json = buildAutomationStepFlowJson({ delay_minutes: 1, message: 'x', fallback_template_id: null, fallback_template_variable_map: {} })
    const send = json.nodes.find((node) => node.type === 'sendMessage')
    expect(send?.data).not.toHaveProperty('fallbackTemplateId')
  })

  it('as mensagens padrão do modelo são válidas', () => {
    for (const step of AUTOMATION_PRESETS.abandoned_cart.defaultSteps) {
      expect(validateFlowJson(buildAutomationStepFlowJson(step))).toEqual({ ok: true })
    }
    expect(parseAutomationInput({ ...base, steps: AUTOMATION_PRESETS.abandoned_cart.defaultSteps })).toHaveProperty('value')
  })
})

describe('pickCartAutomation', () => {
  const automation = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    kind: 'abandoned_cart' as const,
    platform: 'shopify' as const,
    country: 'ES',
    product_line_id: null as string | null,
    enabled: true,
    ...overrides,
  })
  const cart = { platform: 'shopify' as const, country: 'SPAIN', productLineId: 'line-ema' }

  it('casa o país ISO da automação com o país do fulfillment do carrinho', () => {
    expect(automationMatchesCountry('ES', 'SPAIN')).toBe(true)
    expect(automationMatchesCountry('es', 'ES')).toBe(true)
    expect(automationMatchesCountry('PT', 'SPAIN')).toBe(false)
    expect(automationMatchesCountry('ES', null)).toBe(false)
  })

  it('a automação da linha do carrinho vence a de qualquer linha', () => {
    const any = automation('any')
    const ema = automation('ema', { product_line_id: 'line-ema' })
    expect(pickCartAutomation([any, ema], cart)?.id).toBe('ema')
    expect(pickCartAutomation([any, ema], { ...cart, productLineId: null })?.id).toBe('any')
  })

  it('ignora desligada, outra linha, outro país e outra plataforma', () => {
    expect(pickCartAutomation([
      automation('off', { enabled: false }),
      automation('memo', { product_line_id: 'line-memo' }),
      automation('pt', { country: 'PT' }),
      automation('lf', { platform: 'lightfunnels' }),
    ], cart)).toBeNull()
  })
})
