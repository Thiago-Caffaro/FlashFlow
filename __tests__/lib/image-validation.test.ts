import { extensionForSniffedType, sniffImageType } from '@/lib/image-validation'

function bytes(...values: number[]): Buffer {
  return Buffer.from(values)
}

describe('sniffImageType', () => {
  it('reconhece JPEG pelos magic bytes', () => {
    const buf = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(20)])
    expect(sniffImageType(buf)).toBe('image/jpeg')
  })

  it('reconhece PNG pelos magic bytes', () => {
    const buf = Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(20)])
    expect(sniffImageType(buf)).toBe('image/png')
  })

  it('reconhece GIF87a e GIF89a', () => {
    const buf87 = Buffer.concat([Buffer.from('GIF87a', 'ascii'), Buffer.alloc(20)])
    const buf89 = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(20)])
    expect(sniffImageType(buf87)).toBe('image/gif')
    expect(sniffImageType(buf89)).toBe('image/gif')
  })

  it('reconhece WebP (RIFF....WEBP)', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      bytes(0, 0, 0, 0),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(10),
    ])
    expect(sniffImageType(buf)).toBe('image/webp')
  })

  it('rejeita SVG mesmo que o texto contenha "<svg"', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8')
    expect(sniffImageType(buf)).toBeNull()
  })

  it('rejeita HTML disfarçado de imagem', () => {
    const buf = Buffer.from('<html><body>not an image</body></html>', 'utf8')
    expect(sniffImageType(buf)).toBeNull()
  })

  it('rejeita buffer vazio ou pequeno demais', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull()
  })

  it('rejeita bytes aleatórios sem assinatura conhecida', () => {
    const buf = Buffer.from('nao-e-uma-imagem-de-verdade-com-conteudo-qualquer', 'utf8')
    expect(sniffImageType(buf)).toBeNull()
  })
})

describe('extensionForSniffedType', () => {
  it('mapeia cada tipo para a extensão correta', () => {
    expect(extensionForSniffedType('image/jpeg')).toBe('jpg')
    expect(extensionForSniffedType('image/png')).toBe('png')
    expect(extensionForSniffedType('image/gif')).toBe('gif')
    expect(extensionForSniffedType('image/webp')).toBe('webp')
  })
})
