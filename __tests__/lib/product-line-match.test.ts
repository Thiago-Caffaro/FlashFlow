import {
  extractShopifyProductIds,
  normalizeMatchText,
  parseLineProductInput,
  parseProductLineInput,
  pickProductLine,
  suggestLineProduct,
} from '@/lib/product-line-match'
import type { ProductLine } from '@/types'

function line(id: string, code: string, priority: number): ProductLine {
  return { id, code, name: code, priority, created_at: '', updated_at: '' }
}

const LINES = [line('l-ema', 'EMA', 10), line('l-reju', 'REJU', 20), line('l-vista', 'VISTA', 40)]
const PRODUCTS = [
  { id: 'p-lipogan', product_line_id: 'l-ema' },
  { id: 'p-rejuvia', product_line_id: 'l-reju' },
  { id: 'p-vista', product_line_id: 'l-vista' },
]
const LINKS = [
  { external_product_id: '100', line_product_id: 'p-lipogan' },
  { external_product_id: '200', line_product_id: 'p-rejuvia' },
  { external_product_id: '300', line_product_id: 'p-vista' },
]

describe('extractShopifyProductIds', () => {
  it('lê product_id dos line_items sem repetir e ignora itens sem produto', () => {
    expect(extractShopifyProductIds({
      line_items: [{ product_id: 100 }, { product_id: '100' }, { product_id: null }, { title: 'frete' }, { product_id: 200 }],
    })).toEqual(['100', '200'])
  })

  it('devolve vazio para payload sem line_items', () => {
    expect(extractShopifyProductIds({})).toEqual([])
    expect(extractShopifyProductIds(null)).toEqual([])
  })
})

describe('pickProductLine', () => {
  it('escolhe a linha de menor prioridade entre os produtos do carrinho', () => {
    expect(pickProductLine(['300', '200'], LINKS, PRODUCTS, LINES)?.code).toBe('REJU')
    expect(pickProductLine(['300', '100', '200'], LINKS, PRODUCTS, LINES)?.code).toBe('EMA')
  })

  it('ignora produtos sem vínculo e devolve null quando nenhum casa', () => {
    expect(pickProductLine(['999', '300'], LINKS, PRODUCTS, LINES)?.code).toBe('VISTA')
    expect(pickProductLine(['999'], LINKS, PRODUCTS, LINES)).toBeNull()
    expect(pickProductLine([], LINKS, PRODUCTS, LINES)).toBeNull()
  })

  it('desempata prioridade igual pelo código', () => {
    const tied = [line('a', 'ZETA', 10), line('b', 'ALFA', 10)]
    const products = [{ id: 'pa', product_line_id: 'a' }, { id: 'pb', product_line_id: 'b' }]
    const links = [{ external_product_id: '1', line_product_id: 'pa' }, { external_product_id: '2', line_product_id: 'pb' }]
    expect(pickProductLine(['1', '2'], links, products, tied)?.code).toBe('ALFA')
  })
})

describe('suggestLineProduct', () => {
  const products = [
    { id: 'lipogan', name: 'LIPOGAN' },
    { id: 'vista', name: 'VISTA' },
    { id: 'vista-plus', name: 'VISTA PLUS' },
    { id: 'neuratine', name: 'NEURATINE' },
  ]

  it('casa nome como palavra inteira, sem acento nem caixa', () => {
    expect(suggestLineProduct('Lipogan® - 3 frascos', products)?.id).toBe('lipogan')
    expect(suggestLineProduct('neuratiné cápsulas', products)?.id).toBe('neuratine')
  })

  it('prefere o nome mais longo', () => {
    expect(suggestLineProduct('Vista Plus 60 cápsulas', products)?.id).toBe('vista-plus')
    expect(suggestLineProduct('Vista 60 cápsulas', products)?.id).toBe('vista')
  })

  it('não casa parte de palavra', () => {
    expect(suggestLineProduct('Lipoganix', products)).toBeNull()
  })
})

describe('normalizeMatchText', () => {
  it('remove acentos e símbolos', () => {
    expect(normalizeMatchText('  Réjuvia®  60caps ')).toBe('REJUVIA 60CAPS')
  })
})

describe('parseProductLineInput / parseLineProductInput', () => {
  it('normaliza código em maiúsculas, usa o código como nome e prioridade padrão 100', () => {
    expect(parseProductLineInput({ code: ' ema ' })).toEqual({ patch: { code: 'EMA', name: 'EMA', priority: 100 } })
  })

  it('rejeita código vazio e prioridade inválida', () => {
    expect(parseProductLineInput({ code: '' })).toEqual({ error: 'Código da linha obrigatório' })
    expect(parseProductLineInput({ priority: -1 }, true)).toEqual({ error: 'Prioridade inválida' })
    expect(parseProductLineInput({ priority: 1.5 }, true)).toEqual({ error: 'Prioridade inválida' })
  })

  it('atualização parcial só mexe no que veio', () => {
    expect(parseProductLineInput({ priority: 5 }, true)).toEqual({ patch: { priority: 5 } })
  })

  it('produto exige nome e linha; nome em maiúsculas', () => {
    expect(parseLineProductInput({ name: 'Lipogan', product_line_id: 'l-1' })).toEqual({ patch: { name: 'LIPOGAN', product_line_id: 'l-1' } })
    expect(parseLineProductInput({ name: 'Lipogan' })).toEqual({ error: 'Linha do produto obrigatória' })
    expect(parseLineProductInput({ product_line_id: 'l-1' })).toEqual({ error: 'Nome do produto obrigatório' })
  })
})
