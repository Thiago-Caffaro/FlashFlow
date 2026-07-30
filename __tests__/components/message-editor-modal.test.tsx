import { renderToStaticMarkup } from 'react-dom/server'
import MessageEditorModal from '@/components/flows/message-editor-modal'
import type { FlowNode } from '@/types'

function node(combineImageAndMessage?: boolean): FlowNode {
  return {
    id: 'message',
    type: 'sendMessage',
    position: { x: 0, y: 0 },
    data: {
      message: 'Legenda da imagem',
      images: [{ id: 'image-1', url: 'https://example.com/image.jpg', filename: 'image.jpg' }],
      ...(combineImageAndMessage === undefined ? {} : { combineImageAndMessage }),
    },
  }
}

function renderEditor(flowNode: FlowNode) {
  return renderToStaticMarkup(
    <MessageEditorModal
      node={flowNode}
      instanceName="wa-1"
      onChange={jest.fn()}
      onClose={jest.fn()}
    />
  )
}

describe('MessageEditorModal image layout preview', () => {
  it('combines the image and message by default', () => {
    const html = renderEditor(node())
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('data-preview-layout="combined"')
  })

  it('shows image and message separately when disabled', () => {
    const html = renderEditor(node(false))
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('data-preview-layout="separate"')
    expect(html).toContain('data-preview-layout="message"')
  })
})
