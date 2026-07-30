import { renderToStaticMarkup } from 'react-dom/server'
import ShopifyProductForm from '@/components/fulfillment/shopify-product-form'

const baseProps = {
  editing: null,
  onSave: jest.fn(async () => {}),
  onCancel: jest.fn(),
}

describe('ShopifyProductForm feedback', () => {
  it('shows explicit saving feedback while preserving the form fields', () => {
    const html = renderToStaticMarkup(
      <ShopifyProductForm
        {...baseProps}
        busy
        saveState="saving"
        saveError={null}
      />
    )
    expect(html).toContain('Salvando alterações...')
    expect(html).toContain('Nome do produto')
    expect(html).toContain('aria-busy="true"')
  })

  it('shows success feedback', () => {
    const html = renderToStaticMarkup(
      <ShopifyProductForm
        {...baseProps}
        busy={false}
        saveState="success"
        saveError={null}
      />
    )
    expect(html).toContain('Alterações salvas com sucesso.')
  })

  it('shows a network error without removing the form', () => {
    const html = renderToStaticMarkup(
      <ShopifyProductForm
        {...baseProps}
        busy={false}
        saveState="error"
        saveError="Falha de rede"
      />
    )
    expect(html).toContain('Falha de rede')
    expect(html).toContain('URL da imagem')
  })
})
