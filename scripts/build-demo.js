// Build estático da demo para o GitHub Pages.
//
// `output: 'export'` não aceita route handlers dinâmicos nem `proxy.ts`, e a
// demo não precisa deles: todos os pedidos `/api/*` são respondidos no browser
// por `lib/demo`. Este script tira `app/api` e `proxy.ts` do caminho, corre o
// build e repõe-os no fim, mesmo quando o build falha.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

/**
 * @param {string[]} paths
 * @param {string} stashDir
 * @param {() => Promise<void>} run
 * @returns {Promise<void>}
 */
async function withStashed(paths, stashDir, run) {
  /** @type {{ from: string, to: string }[]} */
  const moved = []
  const restore = () => {
    while (moved.length > 0) {
      const entry = moved.pop()
      if (entry && fs.existsSync(entry.to)) fs.renameSync(entry.to, entry.from)
    }
    if (fs.existsSync(stashDir) && fs.readdirSync(stashDir).length === 0) fs.rmdirSync(stashDir)
  }
  try {
    fs.mkdirSync(stashDir, { recursive: true })
    paths.forEach((from, index) => {
      if (!fs.existsSync(from)) return
      const to = path.join(stashDir, stashName(from, index))
      fs.renameSync(from, to)
      moved.push({ from, to })
    })
    await run()
  } finally {
    restore()
  }
}

const stashName = (/** @type {string} */ from, /** @type {number} */ index) => `${index}-${path.basename(from)}`

/**
 * Repõe o que um build interrompido (Ctrl+C, processo morto) deixou afastado.
 * Nunca escreve por cima de um caminho que já existe.
 * @param {string[]} paths
 * @param {string} stashDir
 * @returns {number} caminhos repostos
 */
function recoverStash(paths, stashDir) {
  if (!fs.existsSync(stashDir)) return 0
  let restored = 0
  paths.forEach((from, index) => {
    const stashed = path.join(stashDir, stashName(from, index))
    if (!fs.existsSync(stashed) || fs.existsSync(from)) return
    fs.renameSync(stashed, from)
    restored += 1
  })
  if (fs.readdirSync(stashDir).length === 0) fs.rmdirSync(stashDir)
  return restored
}

/** @returns {Promise<void>} */
function runNextBuild() {
  return new Promise((resolve, reject) => {
    const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        NEXT_PUBLIC_DEMO_MODE: '1',
        NEXT_PUBLIC_FEATURE_GALLERY: 'true',
        NEXT_PUBLIC_FEATURE_AI_SESSIONS: 'true',
        NEXT_PUBLIC_FEATURE_SWITCH_CASE: 'true',
        // Valores fictícios: nenhum código da demo fala com o Supabase, mas
        // alguns módulos validam a presença destas variáveis ao carregar.
        NEXT_PUBLIC_SUPABASE_URL: 'https://demo.invalid',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'demo',
      },
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`next build terminou com código ${code}`))
    })
  })
}

// O export grava os dados de cada segmento em pastas (`__next.rota/__PAGE__.txt`),
// mas o router pede-os com pontos (`__next.rota.__PAGE__.txt`). Num servidor de
// ficheiros como o Pages isso dá 404 em cada navegação entre páginas; esta
// cópia cria os nomes pedidos.
/**
 * @param {string} dir
 * @returns {number} ficheiros criados
 */
function flattenSegmentFiles(dir) {
  let created = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    if (!entry.name.startsWith('__next.')) {
      created += flattenSegmentFiles(full)
      continue
    }
    /** @param {string} current @param {string} prefix */
    const walk = (current, prefix) => {
      for (const child of fs.readdirSync(current, { withFileTypes: true })) {
        const childPath = path.join(current, child.name)
        const dotted = `${prefix}.${child.name}`
        if (child.isDirectory()) walk(childPath, dotted)
        else {
          fs.copyFileSync(childPath, path.join(dir, dotted))
          created += 1
        }
      }
    }
    walk(full, entry.name)
  }
  return created
}

async function main() {
  const stashDir = path.join(ROOT, '.demo-stash')
  const stashed = [path.join(ROOT, 'app', 'api'), path.join(ROOT, 'proxy.ts')]
  if (recoverStash(stashed, stashDir) > 0) console.log('Reposto o que um build anterior interrompido deixou em .demo-stash/')
  // Ctrl+C a meio do build não corre o `finally` de withStashed.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      recoverStash(stashed, stashDir)
      process.exit(1)
    })
  }
  fs.rmSync(path.join(ROOT, 'out'), { recursive: true, force: true })
  await withStashed(stashed, stashDir, runNextBuild)
  flattenSegmentFiles(path.join(ROOT, 'out'))
  // Sem isto o GitHub Pages passa o site pelo Jekyll, que ignora `_next/`.
  fs.writeFileSync(path.join(ROOT, 'out', '.nojekyll'), '')
  console.log('Demo gerada em out/')
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { withStashed, flattenSegmentFiles, recoverStash }
