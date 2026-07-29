import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

// Origem do Supabase Storage — as imagens da galeria de mídia dos fluxos
// (components/gallery/gallery-tab.tsx) e mensagens de imagem apontam
// diretamente para o bucket público, não passam pelo nosso proxy.
let supabaseOrigin = ''
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (url) supabaseOrigin = new URL(url).origin
} catch {
  // Sem NEXT_PUBLIC_SUPABASE_URL configurada no momento do build — CSP
  // ainda funciona, só sem essa origem extra liberada para img-src.
}

// Sem infraestrutura de nonce por requisição (exigiria renderização dinâmica
// em todas as páginas — mudança maior de comportamento). 'unsafe-inline'
// para script/style é o baseline oficialmente documentado pelo Next.js para
// quem não usa nonces (node_modules/next/dist/docs/.../content-security-policy.md).
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://cdn.shopify.com${supabaseOrigin ? ` ${supabaseOrigin}` : ''};
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`.replace(/\s{2,}/g, ' ').trim()

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspHeader },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
