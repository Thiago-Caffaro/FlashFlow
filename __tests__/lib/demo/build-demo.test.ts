import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type WithStashed = (paths: string[], stashDir: string, run: () => Promise<void>) => Promise<void>

const { withStashed, flattenSegmentFiles, recoverStash } = jest.requireActual('../../../scripts/build-demo.js') as {
  withStashed: WithStashed
  recoverStash: (paths: string[], stashDir: string) => number
  flattenSegmentFiles: (dir: string) => number
}

describe('withStashed', () => {
  let root: string
  let apiDir: string
  let proxyFile: string
  let stashDir: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-demo-'))
    apiDir = path.join(root, 'app', 'api')
    proxyFile = path.join(root, 'proxy.ts')
    stashDir = path.join(root, '.demo-stash')
    fs.mkdirSync(path.join(apiDir, 'x'), { recursive: true })
    fs.writeFileSync(path.join(apiDir, 'x', 'route.ts'), 'route')
    fs.writeFileSync(proxyFile, 'proxy')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('tira os caminhos durante a execução e repõe-os no fim', async () => {
    let seenDuringRun = true
    await withStashed([apiDir, proxyFile], stashDir, async () => {
      seenDuringRun = fs.existsSync(apiDir) || fs.existsSync(proxyFile)
    })
    expect(seenDuringRun).toBe(false)
    expect(fs.readFileSync(path.join(apiDir, 'x', 'route.ts'), 'utf8')).toBe('route')
    expect(fs.readFileSync(proxyFile, 'utf8')).toBe('proxy')
    expect(fs.existsSync(stashDir)).toBe(false)
  })

  it('repõe os caminhos e propaga o erro quando a execução falha', async () => {
    await expect(
      withStashed([apiDir, proxyFile], stashDir, async () => {
        throw new Error('build falhou')
      }),
    ).rejects.toThrow('build falhou')
    expect(fs.existsSync(path.join(apiDir, 'x', 'route.ts'))).toBe(true)
    expect(fs.existsSync(proxyFile)).toBe(true)
  })

  it('recupera o que um build interrompido deixou afastado', async () => {
    // Simula um processo morto a meio: os caminhos ficaram no stash.
    fs.mkdirSync(stashDir)
    fs.renameSync(apiDir, path.join(stashDir, '0-api'))
    fs.renameSync(proxyFile, path.join(stashDir, '1-proxy.ts'))

    expect(recoverStash([apiDir, proxyFile], stashDir)).toBe(2)
    expect(fs.readFileSync(path.join(apiDir, 'x', 'route.ts'), 'utf8')).toBe('route')
    expect(fs.readFileSync(proxyFile, 'utf8')).toBe('proxy')
    expect(fs.existsSync(stashDir)).toBe(false)
  })

  it('a recuperação nunca escreve por cima de um caminho que já existe', async () => {
    fs.mkdirSync(stashDir)
    fs.writeFileSync(path.join(stashDir, '1-proxy.ts'), 'antigo')
    expect(recoverStash([apiDir, proxyFile], stashDir)).toBe(0)
    expect(fs.readFileSync(proxyFile, 'utf8')).toBe('proxy')
  })

  it('ignora caminhos que não existem', async () => {
    await withStashed([path.join(root, 'nao-existe')], stashDir, async () => {})
    expect(fs.existsSync(apiDir)).toBe(true)
  })
})

describe('flattenSegmentFiles', () => {
  it('cria os nomes com pontos que o router pede, em qualquer profundidade', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-demo-out-'))
    try {
      fs.mkdirSync(path.join(out, 'fulfillment', '__next.fulfillment'), { recursive: true })
      fs.writeFileSync(path.join(out, 'fulfillment', '__next.fulfillment', '__PAGE__.txt'), 'pagina')
      fs.mkdirSync(path.join(out, '__next.a', 'b'), { recursive: true })
      fs.writeFileSync(path.join(out, '__next.a', 'b', 'c.txt'), 'fundo')

      expect(flattenSegmentFiles(out)).toBe(2)
      expect(fs.readFileSync(path.join(out, 'fulfillment', '__next.fulfillment.__PAGE__.txt'), 'utf8')).toBe('pagina')
      expect(fs.readFileSync(path.join(out, '__next.a.b.c.txt'), 'utf8')).toBe('fundo')
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })
})
