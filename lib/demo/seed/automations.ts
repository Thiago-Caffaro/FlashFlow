import type { AutomationWithSteps, CatalogProductOption, ProductLineWithProducts } from '@/types'
import { minutesAgo } from '../clock'
import { DEMO_INSTANCE_ES, DEMO_INSTANCE_PT } from './accounts'
import { demoImage } from './images'

export const SHOPIFY_ES_ID = 'shop-es'
export const SHOPIFY_PT_ID = 'shop-pt'
export const LIGHTFUNNELS_ID = 'lf-es'

const stamp = () => ({ created_at: minutesAgo(45_000), updated_at: minutesAgo(45_000) })

export function seedProductLines(): ProductLineWithProducts[] {
  return [
    {
      ...stamp(), id: 'line-descanso', code: 'DESCANSO', name: 'Descanso', priority: 1,
      products: [
        {
          ...stamp(), id: 'lp-cojin', product_line_id: 'line-descanso', name: 'Almofada ortopédica',
          links: [
            { id: 'link-1', line_product_id: 'lp-cojin', platform: 'shopify', integration_id: SHOPIFY_ES_ID, external_product_id: 'sp-1001', title: 'Cojín Ortopédico Brisa', created_at: minutesAgo(45_000) },
            { id: 'link-2', line_product_id: 'lp-cojin', platform: 'shopify', integration_id: SHOPIFY_PT_ID, external_product_id: 'sp-2001', title: 'Almofada Ortopédica Brisa', created_at: minutesAgo(45_000) },
          ],
        },
        {
          ...stamp(), id: 'lp-almohada', product_line_id: 'line-descanso', name: 'Almofada viscoelástica',
          links: [
            { id: 'link-3', line_product_id: 'lp-almohada', platform: 'shopify', integration_id: SHOPIFY_ES_ID, external_product_id: 'sp-1003', title: 'Almohada Viscoelástica Brisa', created_at: minutesAgo(45_000) },
          ],
        },
      ],
    },
    {
      ...stamp(), id: 'line-bem-estar', code: 'BEMESTAR', name: 'Bem-estar', priority: 2,
      products: [
        {
          ...stamp(), id: 'lp-masajeador', product_line_id: 'line-bem-estar', name: 'Massajador cervical',
          links: [
            { id: 'link-4', line_product_id: 'lp-masajeador', platform: 'shopify', integration_id: SHOPIFY_ES_ID, external_product_id: 'sp-1002', title: 'Masajeador Cervical Brisa', created_at: minutesAgo(45_000) },
            { id: 'link-5', line_product_id: 'lp-masajeador', platform: 'lightfunnels', integration_id: LIGHTFUNNELS_ID, external_product_id: 'lf-3001', title: 'Masajeador Cervical Brisa (funil)', created_at: minutesAgo(45_000) },
          ],
        },
      ],
    },
  ]
}

export function seedCatalog(): CatalogProductOption[] {
  const rows: Array<[CatalogProductOption['platform'], string, string, string, string, string, string | null]> = [
    ['shopify', SHOPIFY_ES_ID, 'Casa Brisa España', 'sp-1001', 'Cojín Ortopédico Brisa', '#00a884', 'lp-cojin'],
    ['shopify', SHOPIFY_ES_ID, 'Casa Brisa España', 'sp-1002', 'Masajeador Cervical Brisa', '#7c5cbf', 'lp-masajeador'],
    ['shopify', SHOPIFY_ES_ID, 'Casa Brisa España', 'sp-1003', 'Almohada Viscoelástica Brisa', '#3b82a6', 'lp-almohada'],
    ['shopify', SHOPIFY_ES_ID, 'Casa Brisa España', 'sp-1004', 'Corrector de Postura Brisa', '#c2703d', null],
    ['shopify', SHOPIFY_PT_ID, 'Casa Brisa Portugal', 'sp-2001', 'Almofada Ortopédica Brisa', '#00a884', 'lp-cojin'],
    ['shopify', SHOPIFY_PT_ID, 'Casa Brisa Portugal', 'sp-2002', 'Massajador Cervical Brisa', '#7c5cbf', null],
    ['lightfunnels', LIGHTFUNNELS_ID, 'Funis Brisa', 'lf-3001', 'Masajeador Cervical Brisa (funil)', '#7c5cbf', 'lp-masajeador'],
  ]
  return rows.map(([platform, integration_id, store_label, external_product_id, title, color, linked]) => ({
    platform, integration_id, store_label, external_product_id, title,
    image_url: demoImage(title.split(' ')[0], color),
    linked_line_product_id: linked,
  }))
}

export function seedAutomations(): AutomationWithSteps[] {
  const step = (automationId: string, position: number, delay: number, message: string, templateId: string | null = null) => ({
    ...stamp(), id: `${automationId}-step-${position + 1}`, automation_id: automationId, position,
    delay_minutes: delay, message, fallback_template_id: templateId, fallback_template_variable_map: {}, flow_id: null,
  })
  return [
    {
      ...stamp(), id: 'auto-carrinho-es', name: 'Carrinho abandonado · Espanha', kind: 'abandoned_cart',
      platform: 'shopify', country: 'ES', product_line_id: null, instance_name: DEMO_INSTANCE_ES, enabled: true, config: {},
      steps: [
        step('auto-carrinho-es', 0, 30, 'Hola {{contato.primeiro_nome}}, vimos que dejaste {{carrinho.produtos}} en el carrito 🛒 ¿Te ayudo a terminar el pedido? Pagas al recibir.'),
        step('auto-carrinho-es', 1, 1440, '{{contato.primeiro_nome}}, tu carrito sigue guardado. Si quieres, te lo dejo listo en un minuto 🙂'),
      ],
    },
    {
      ...stamp(), id: 'auto-entregue-pt', name: 'Encomenda entregue · Portugal', kind: 'delivery_status',
      platform: 'shopify', country: 'PT', product_line_id: 'line-descanso', instance_name: DEMO_INSTANCE_PT, enabled: false,
      config: { statuses: ['Entregue'] },
      steps: [
        step('auto-entregue-pt', 0, 120, 'Olá {{contato.primeiro_nome}}, a sua encomenda {{pedido.numero}} foi entregue. Esperamos que goste! 💚', 'tpl-avaliacao'),
      ],
    },
  ]
}
