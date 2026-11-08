import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID, TEACHER_IDS } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { ROOM_IDS, SLOT_IDS, makeGeneratedLessons, makeSchedule, makeSlot } from '../test/schedule'
import { classSchedulePath, generateClassLessons, generateLessonsPath, getClassSchedule, replaceClassSchedule } from './schedule'

describe('class schedule API (API-088/API-089)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the schedule path of a class', () => {
    expect(classSchedulePath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/schedule`)
    expect(classSchedulePath('a/b')).toBe('/api/classes/a%2Fb/schedule')
  })

  it('reads with GET, the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeSchedule()))
    const controller = new AbortController()
    const schedule = await getClassSchedule(CLASS_ID, controller.signal)
    expect(schedule.slots.map((slot) => slot.id)).toEqual([SLOT_IDS[0]])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/classes/${CLASS_ID}/schedule`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('replaces with PUT and the whole list as JSON, answering with the server schedule', async () => {
    const answered = makeSchedule([makeSlot({ endTime: '11:30' })])
    const fetchMock = mockFetch(() => jsonResponse(200, answered))
    const body = {
      slots: [
        { id: SLOT_IDS[0], weekday: 0, startTime: '10:00', endTime: '11:30', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-10', effectiveTo: null },
        { weekday: 2, startTime: '09:00', endTime: '10:00', roomId: null, teacherUserId: null, effectiveFrom: '2026-11-12', effectiveTo: '2026-12-20' },
      ],
    }
    await expect(replaceClassSchedule(CLASS_ID, body)).resolves.toEqual(answered)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/classes/${CLASS_ID}/schedule`)
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual(body)
  })

  it('generates lessons with ONE POST of { from, to } and returns the server counts (API-092, J-F16)', async () => {
    const answered = makeGeneratedLessons({ created: 11, existing: 2 })
    const fetchMock = mockFetch(() => jsonResponse(200, answered))
    expect(generateLessonsPath('a/b')).toBe('/api/classes/a%2Fb/schedule/generate')
    await expect(generateClassLessons(CLASS_ID, { from: '2026-11-15', to: '2026-12-31' })).resolves.toEqual(answered)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/classes/${CLASS_ID}/schedule/generate`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(JSON.parse(String(init?.body))).toEqual({ from: '2026-11-15', to: '2026-12-31' })
  })
})
