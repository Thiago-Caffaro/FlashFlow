import { NextRequest } from 'next/server'

const fromMock = jest.fn()
const isAdminRequestMock = jest.fn(() => true)

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: fromMock },
}))
jest.mock('@/lib/server-auth', () => ({
  isAdminRequest: isAdminRequestMock,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DELETE, GET, PATCH } = require('@/app/api/notifications/route')

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}

function getTables(notifications: Array<{ id: string; read_at: string | null }> = []) {
  const notificationLimit = jest.fn().mockResolvedValue({ data: notifications, error: null })
  const notificationOrder = jest.fn(() => ({ limit: notificationLimit }))
  const notificationActive = jest.fn(() => ({ order: notificationOrder }))
  const notificationEq = jest.fn(() => ({ is: notificationActive }))
  const sessionEqHuman = jest.fn().mockResolvedValue({ data: [], error: null })
  const sessionEqInstance = jest.fn(() => ({ eq: sessionEqHuman }))

  fromMock.mockImplementation((table: string) => {
    if (table === 'ai_sessions') {
      return { select: jest.fn(() => ({ eq: sessionEqInstance })) }
    }
    if (table === 'notifications') {
      return { select: jest.fn(() => ({ eq: notificationEq })) }
    }
    throw new Error(`Unexpected table ${table}`)
  })
  return { notificationActive, notificationEq, sessionEqInstance }
}

beforeEach(() => {
  jest.clearAllMocks()
  isAdminRequestMock.mockReturnValue(true)
})

describe('notifications API', () => {
  it('rejects requests without an authenticated admin session', async () => {
    isAdminRequestMock.mockReturnValue(false)
    const response = await GET(request('/api/notifications?instance=wa-a'))
    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('loads only the requested instance and reports unread count', async () => {
    const tables = getTables([
      { id: 'n1', read_at: null },
      { id: 'n2', read_at: '2026-07-31T10:00:00.000Z' },
    ])
    const response = await GET(request('/api/notifications?instance=wa-a'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ ok: true, unreadCount: 1 })
    expect(tables.sessionEqInstance).toHaveBeenCalledWith('instance_name', 'wa-a')
    expect(tables.notificationEq).toHaveBeenCalledWith('instance_name', 'wa-a')
    expect(tables.notificationActive).toHaveBeenCalledWith('dismissed_at', null)
  })

  it('marks a single notification as read within its instance', async () => {
    const finalEq = jest.fn().mockResolvedValue({ error: null })
    const isUnread = jest.fn(() => ({ eq: finalEq }))
    const instanceEq = jest.fn(() => ({ is: isUnread }))
    const update = jest.fn(() => ({ eq: instanceEq }))
    fromMock.mockReturnValue({ update })

    const response = await PATCH(request('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: 'wa-a', id: 'notification-1' }),
    }))

    expect(response.status).toBe(200)
    expect(instanceEq).toHaveBeenCalledWith('instance_name', 'wa-a')
    expect(finalEq).toHaveBeenCalledWith('id', 'notification-1')
  })

  it('dismisses a single notification only within its instance', async () => {
    const finalEq = jest.fn().mockResolvedValue({ error: null })
    const activeOnly = jest.fn(() => ({ eq: finalEq }))
    const instanceEq = jest.fn(() => ({ is: activeOnly }))
    const update = jest.fn(() => ({ eq: instanceEq }))
    fromMock.mockReturnValue({ update })

    const response = await DELETE(request('/api/notifications?instance=wa-a&id=notification-1', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(200)
    expect(instanceEq).toHaveBeenCalledWith('instance_name', 'wa-a')
    expect(activeOnly).toHaveBeenCalledWith('dismissed_at', null)
    expect(finalEq).toHaveBeenCalledWith('id', 'notification-1')
  })

  it('dismisses every active notification for the requested instance', async () => {
    const activeOnly = jest.fn().mockResolvedValue({ error: null })
    const instanceEq = jest.fn(() => ({ is: activeOnly }))
    const update = jest.fn(() => ({ eq: instanceEq }))
    fromMock.mockReturnValue({ update })

    const response = await DELETE(request('/api/notifications?instance=wa-a', { method: 'DELETE' }))

    expect(response.status).toBe(200)
    expect(instanceEq).toHaveBeenCalledWith('instance_name', 'wa-a')
    expect(activeOnly).toHaveBeenCalledWith('dismissed_at', null)
  })
})
