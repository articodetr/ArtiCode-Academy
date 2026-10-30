import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { makeAuditList } from '../test/audit'
import { jsonResponse, mockFetch } from '../test/http'
import { auditLogsPath, listAuditLogs } from './audit'

describe('auditLogsPath', () => {
  it('returns the bare path when every parameter is absent or blank', () => {
    expect(auditLogsPath()).toBe('/api/audit-logs')
    expect(auditLogsPath({ action: '  ', actorUserId: '', cursor: ' ' })).toBe('/api/audit-logs')
  })

  it('serialises the filters of API-011, trimming text and keeping the limit', () => {
    const path = auditLogsPath({
      action: ' users. ',
      actorUserId: '0192f0a0-0000-7000-8000-000000000001',
      entityType: 'users',
      entityId: '0192f0a0-0000-7000-8000-000000000002',
      before: '2026-10-30T09:00:00.000Z',
      limit: 100,
      cursor: '0192f0a0-0000-7000-8000-00000000aaaa',
    })
    expect(path.startsWith('/api/audit-logs?')).toBe(true)
    expect(Object.fromEntries(new URL(path, 'http://localhost').searchParams)).toEqual({
      action: 'users.',
      actorUserId: '0192f0a0-0000-7000-8000-000000000001',
      entityType: 'users',
      entityId: '0192f0a0-0000-7000-8000-000000000002',
      before: '2026-10-30T09:00:00.000Z',
      limit: '100',
      cursor: '0192f0a0-0000-7000-8000-00000000aaaa',
    })
  })

  it('percent-encodes the values', () => {
    expect(auditLogsPath({ entityId: 'a&b=c' })).toBe('/api/audit-logs?entityId=a%26b%3Dc')
  })
})

describe('listAuditLogs', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('sends GET with the bearer token and passes the abort signal', async () => {
    const list = makeAuditList([])
    const fetchMock = mockFetch(() => jsonResponse(200, list))
    const controller = new AbortController()

    await expect(listAuditLogs({ action: 'auth.' }, controller.signal)).resolves.toEqual(list)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/audit-logs?action=auth.')
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })
})
