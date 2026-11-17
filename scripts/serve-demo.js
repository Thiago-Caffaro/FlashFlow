// Serve `out/` em http://localhost:4173/FlashFlow/, como o GitHub Pages
// (mesmo basePath), para conferir a demo antes de publicar.
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const OUT = path.resolve(__dirname, '..', 'out')
const BASE = '/FlashFlow'
const PORT = Number(process.env.PORT) || 4173
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.png': 'image/png', '.map': 'application/json',
}

function resolveFile(urlPath) {
  const relative = decodeURIComponent(urlPath.slice(BASE.length)) || '/'
  const target = path.join(OUT, relative)
  if (!target.startsWith(OUT)) return null
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target
  const index = path.join(target, 'index.html')
  return fs.existsSync(index) ? index : null
}

http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]
  if (urlPath === '/') {
    res.writeHead(302, { Location: `${BASE}/` })
    return res.end()
  }
  const file = urlPath.startsWith(BASE) ? resolveFile(urlPath) : null
  if (!file) {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] })
    return res.end(fs.existsSync(path.join(OUT, '404.html')) ? fs.readFileSync(path.join(OUT, '404.html')) : 'Not found')
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`Demo em http://localhost:${PORT}${BASE}/`))
