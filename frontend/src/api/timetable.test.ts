import { describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAcademySchedule, makeMySchedule, makeSlot } from '../test/timetable'
import { academySchedulePath, getAcademySchedule, getMySchedule, mySchedulePath } from './timetable'

describe('timetable API (API-090/091)', () => {
  it('builds the academy schedule path from the given filters only', () => {
    expect(academySchedulePath()).toBe('/api/schedule')
    expect(academySchedulePath({ on: undefined, classId: undefined })).toBe('/api/schedule')
    expect(academySchedulePath({ on: '2026-11-10', classId: 'c-1', teacherUserId: 't-1', roomId: 'r-1', branchId: 'none', weekday: 0 })).toBe(
      '/api/schedule?on=2026-11-10&branchId=none&roomId=r-1&teacherUserId=t-1&classId=c-1&weekday=0',
    )
    expect(mySchedulePath()).toBe('/api/me/schedule')
    expect(mySchedulePath({ on: '2026-11-10' })).toBe('/api/me/schedule?on=2026-11-10')
  })

  it('reads both schedules with the bearer token and an abort signal', async () => {
    setAccessToken('token-1', 'user-1')
    const calls: { url: string; auth: string | null; signal: AbortSignal | null | undefined }[] = []
    mockFetch((url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization'), signal: init?.signal })
      return url.includes('/me/') ? jsonResponse(200, makeMySchedule([])) : jsonResponse(200, makeAcademySchedule([makeSlot()]))
    })
    const controller = new AbortController()
    const academy = await getAcademySchedule({ classId: 'c-1' }, controller.signal)
    expect(academy.slots).toHaveLength(1)
    expect(academy.on).toBe('2026-11-08')
    const mine = await getMySchedule({ on: '2026-11-09' })
    expect(mine.items).toEqual([])
    expect(calls.map((call) => [call.url.replace(/^https?:\/\/[^/]+/, ''), call.auth])).toEqual([
      ['/api/schedule?classId=c-1', 'Bearer token-1'],
      ['/api/me/schedule?on=2026-11-09', 'Bearer token-1'],
    ])
    expect(calls[0]!.signal).toBe(controller.signal)
  })
})
