// Exibição das automações simples na UI (sem 'server-only'): países e tempo
// de espera dos lembretes. Também usado nas regras de casamento de país.

import { ISO_TO_FULFILLMENT_COUNTRY } from './fulfillment-countries'

const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Espanha',
  PT: 'Portugal',
  IT: 'Itália',
  PL: 'Polônia',
  SK: 'Eslováquia',
  CZ: 'República Tcheca',
  RO: 'Romênia',
  BG: 'Bulgária',
  GR: 'Grécia',
  HU: 'Hungria',
  SI: 'Eslovênia',
  HR: 'Croácia',
  AT: 'Áustria',
  DE: 'Alemanha',
  FR: 'França',
  BE: 'Bélgica',
  NL: 'Holanda',
  CO: 'Colômbia',
}

// Países oferecidos nas automações além dos do FenixCOD (que não tem nome
// próprio para eles): o pedido chega com o código ISO ou o nome em inglês.
const EXTRA_AUTOMATION_COUNTRIES = ['CO']

// Outras grafias com que o país pode chegar no pedido/carrinho.
export const AUTOMATION_COUNTRY_ALIASES: Record<string, string[]> = {
  CO: ['COLOMBIA'],
}

// Países das automações, na ordem alfabética do nome.
export const AUTOMATION_COUNTRIES: Array<{ code: string; name: string }> = [...Object.keys(ISO_TO_FULFILLMENT_COUNTRY), ...EXTRA_AUTOMATION_COUNTRIES]
  .map((code) => ({ code, name: COUNTRY_NAMES[code] ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

export function countryLabel(code: string): string {
  const upper = code.toUpperCase()
  return COUNTRY_NAMES[upper] ? `${COUNTRY_NAMES[upper]} (${upper})` : upper
}

export type DelayUnit = 'minutes' | 'hours' | 'days'

export const DELAY_UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 }

export const DELAY_UNIT_LABELS: Record<DelayUnit, string> = { minutes: 'minutos', hours: 'horas', days: 'dias' }

// Maior unidade que representa o tempo sem fração (90 min fica em minutos).
export function splitDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes > 0 && minutes % DELAY_UNIT_MINUTES.days === 0) return { value: minutes / DELAY_UNIT_MINUTES.days, unit: 'days' }
  if (minutes > 0 && minutes % DELAY_UNIT_MINUTES.hours === 0) return { value: minutes / DELAY_UNIT_MINUTES.hours, unit: 'hours' }
  return { value: minutes, unit: 'minutes' }
}

export function formatDelay(minutes: number): string {
  const { value, unit } = splitDelay(minutes)
  if (unit === 'days') return value === 1 ? '1 dia' : `${value} dias`
  if (unit === 'hours') return `${value} h`
  return `${value} min`
}
