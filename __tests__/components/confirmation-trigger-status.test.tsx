import { renderToStaticMarkup } from 'react-dom/server'
import ConfirmationTriggerStatus from '@/components/fulfillment/confirmation-trigger-status'

describe('ConfirmationTriggerStatus', () => {
  it('shows the sent state from the order timestamp', () => {
    const html = renderToStaticMarkup(
      <ConfirmationTriggerStatus order={{
        confirmation_message_sent_at: '2026-08-03T10:00:00.000Z',
        confirmation_message_error: null,
      }} />,
    )
    expect(html).toContain('Gatilho disparado')
  })

  it('shows a failed state without affecting another order', () => {
    const html = renderToStaticMarkup(
      <ConfirmationTriggerStatus order={{
        confirmation_message_sent_at: null,
        confirmation_message_error: 'Falha de envio',
      }} />,
    )
    expect(html).toContain('Falha no gatilho')
    expect(html).toContain('Falha de envio')
  })
})
