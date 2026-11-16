import { runBusy } from '@/lib/run-busy'

describe('runBusy', () => {
  it('marca ocupado durante o trabalho e liberta no fim', async () => {
    const calls: boolean[] = []
    const onError = jest.fn()
    await runBusy((busy) => calls.push(busy), async () => { expect(calls).toEqual([true]) }, onError)
    expect(calls).toEqual([true, false])
    expect(onError).not.toHaveBeenCalled()
  })

  it('liberta e reporta quando o trabalho falha, sem relançar', async () => {
    const calls: boolean[] = []
    const onError = jest.fn()
    await expect(runBusy((busy) => calls.push(busy), async () => { throw new Error('rede caiu') }, onError)).resolves.toBeUndefined()
    expect(calls).toEqual([true, false])
    expect(onError).toHaveBeenCalledWith('rede caiu')
  })

  it('usa mensagem genérica para rejeições que não são Error', async () => {
    const onError = jest.fn()
    await runBusy(() => {}, () => Promise.reject('x'), onError)
    expect(onError).toHaveBeenCalledWith('Erro inesperado')
  })
})
