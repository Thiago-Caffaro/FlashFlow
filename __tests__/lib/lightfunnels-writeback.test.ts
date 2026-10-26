jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: jest.fn() } }))
jest.mock('@/lib/lightfunnels-integration-store', () => ({ loadLightfunnelsIntegration: jest.fn() }))
jest.mock('@/lib/lightfunnels-token', () => ({ lightfunnelsClientFor: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { desiredWritebackTags, mergeWritebackTags, scheduleLightfunnelsWriteback } = require('@/lib/lightfunnels-writeback')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabaseAdmin } = require('@/lib/supabase-admin')

describe('Lightfunnels write-back tags', () => {
  it('derives tags from commercial, FenixCOD and delivery state', () => {
    expect(desiredWritebackTags({ commercial_status: 'Não responde', lead_number: null, delivery_status: 'Não enviado' })).toEqual([])
    expect(desiredWritebackTags({ commercial_status: 'Confirmado WhatsApp', lead_number: null, delivery_status: 'Não enviado' }))
      .toEqual(['ff:confirmado'])
    expect(desiredWritebackTags({ commercial_status: 'Confirmado Call', lead_number: 'L-1', delivery_status: 'Entregue' }))
      .toEqual(['ff:confirmado', 'ff:enviado-fenixcod', 'ff:entregue'])
    expect(desiredWritebackTags({ commercial_status: 'Desistiu', lead_number: null, delivery_status: 'Não enviado' }))
      .toEqual(['ff:desistiu'])
  })

  it('keeps merchant tags and replaces previous ff: tags', () => {
    expect(mergeWritebackTags(['vip', 'ff:confirmado', ' promo '], ['ff:desistiu'])).toEqual(['vip', 'promo', 'ff:desistiu'])
    expect(mergeWritebackTags(null, ['ff:confirmado'])).toEqual(['ff:confirmado'])
  })

  it('does not query anything for orders from other platforms', () => {
    scheduleLightfunnelsWriteback({ id: 'order-1', source: 'shopify' })
    scheduleLightfunnelsWriteback(null)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
