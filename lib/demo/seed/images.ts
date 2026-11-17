/** Imagem de exemplo embutida (SVG em data URI): nenhum pedido sai do site. */
export function demoImage(label: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">` +
    `<rect width="480" height="360" fill="${color}"/>` +
    `<circle cx="240" cy="150" r="70" fill="#ffffff" fill-opacity="0.25"/>` +
    `<text x="240" y="290" font-family="Arial, sans-serif" font-size="28" fill="#ffffff" text-anchor="middle">${label}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
