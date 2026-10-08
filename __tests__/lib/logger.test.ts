import { _resetLoggerThrottleForTests, createLogger, isLogLevelEnabled } from '@/lib/logger'

describe('logger', () => {
  const originalLevel = process.env.LOG_LEVEL
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    _resetLoggerThrottleForTests()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.LOG_LEVEL = originalLevel
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('hides debug by default and shows it with LOG_LEVEL=debug', () => {
    delete process.env.LOG_LEVEL
    const log = createLogger('teste')
    log.debug('detalhe')
    log.info('resumo')
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[teste] resumo')

    process.env.LOG_LEVEL = 'debug'
    expect(isLogLevelEnabled('debug')).toBe(true)
    log.debug('detalhe')
    expect(logSpy).toHaveBeenLastCalledWith('[teste] detalhe')
  })

  it('writes one line with key=value context and the Postgres error code', () => {
    const log = createLogger('webhook')
    log.error('falha ao gravar', {
      msgId: 'ABC',
      note: 'com espaço',
      err: { message: 'duplicate key value', code: '23505', details: 'Key (wa_message_id)=(ABC) already exists.' },
    })
    const line = errorSpy.mock.calls[0][0] as string
    expect(line).toContain('[webhook] falha ao gravar msgId=ABC note="com espaço"')
    expect(line).toContain('code=23505')
    expect(line).toContain('error="duplicate key value"')
  })

  it('suppresses repeats of the same problem inside the window and reports how many were suppressed', () => {
    jest.useFakeTimers({ now: 0 })
    const log = createLogger('media')
    for (let i = 0; i < 5; i += 1) log.warn('Evolution falhou', { status: 404 }, { throttleKey: 'inst:404', throttleMs: 1000 })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    jest.setSystemTime(1500)
    log.warn('Evolution falhou', { status: 404 }, { throttleKey: 'inst:404', throttleMs: 1000 })
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[1][0]).toContain('(+4 ocorrências iguais suprimidas)')
  })

  it('throttles keys independently', () => {
    const log = createLogger('media')
    log.warn('a', {}, { throttleKey: 'one' })
    log.warn('b', {}, { throttleKey: 'two' })
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})
