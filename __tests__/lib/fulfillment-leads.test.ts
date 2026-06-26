import { normalizeExternalFulfillmentLeads } from '@/lib/fulfillment-leads'

describe('normalizeExternalFulfillmentLeads', () => {
  it('normalizes nested FenixCOD lead lists', () => {
    const leads = normalizeExternalFulfillmentLeads({
      data: {
        data: [
          {
            lead_number: 'DS-564887',
            order_number: '#1747',
            name_costumer: 'Nitu Victorio',
            mobile: '40726818469',
            lead_value: 'RON 749.00',
            city: 'Constanta',
            confirmation: 'confirmed',
          },
        ],
      },
    }, 'ROMANIA')

    expect(leads).toEqual([
      {
        source: 'fenixcod',
        lead_number: 'DS-564887',
        order_number: '#1747',
        country: 'ROMANIA',
        customer_name: 'Nitu Victorio',
        contact_phone: '40726818469',
        city: 'Constanta',
        total: 749,
        currency: null,
        status: 'confirmed',
        created_at: null,
        updated_at: null,
        raw: {
          lead_number: 'DS-564887',
          order_number: '#1747',
          name_costumer: 'Nitu Victorio',
          mobile: '40726818469',
          lead_value: 'RON 749.00',
          city: 'Constanta',
          confirmation: 'confirmed',
        },
      },
    ])
  })

  it('falls back to stable values when the API shape is sparse', () => {
    const leads = normalizeExternalFulfillmentLeads([
      { id: 123, name: 'Client', total: '1,234.50', status: 'new' },
    ], 'PORTUGAL')

    expect(leads[0]).toMatchObject({
      lead_number: '123',
      country: 'PORTUGAL',
      customer_name: 'Client',
      total: 1234.5,
      status: 'new',
    })
  })
})
