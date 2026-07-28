import 'server-only'

export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/**
 * Detecta o tipo real de uma imagem pelos magic bytes do arquivo — nunca
 * confia no Content-Type/nome enviado pelo cliente, que é trivialmente
 * falsificável. Deliberadamente NÃO reconhece SVG (formato ativo, pode
 * conter <script>) nem qualquer outro formato fora desta lista fixa.
 */
export function sniffImageType(buffer: Buffer): SniffedImageType | null {
  if (buffer.length < 12) return null

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  // GIF87a / GIF89a
  const gifHeader = buffer.subarray(0, 6).toString('ascii')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif'
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

const EXT_BY_TYPE: Record<SniffedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function extensionForSniffedType(type: SniffedImageType): string {
  return EXT_BY_TYPE[type]
}
