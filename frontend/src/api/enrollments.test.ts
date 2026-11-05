import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { ENROLLMENT_IDS, STUDENT_IDS, makeEnrollment, makeEnrollmentList, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { changeEnrollmentStatus, enrollStudent, enrollmentsListPath, listEnrollments, listMyClasses, myClassesPath } from './enrollments'

describe('enrollments API (API-057..API-060)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the roster and my-classes paths with the non-empty parameters only', () => {
    expect(enrollmentsListPath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/enrollments`)
    expect(enrollmentsListPath(CLASS_ID, { status: undefined, cursor: '' })).toBe(`/api/classes/${CLASS_ID}/enrollments`)
    expect(enrollmentsListPath(CLASS_ID, { status: 'withdrawn', limit: 50, cursor: 'c%1' })).toBe(`/api/classes/${CLASS_ID}/enrollments?status=withdrawn&limit=50&cursor=c%251`)
    expect(myClassesPath()).toBe('/api/me/classes')
    expect(myClassesPath({ status: 'cancelled' })).toBe('/api/me/classes?status=cancelled')
  })

  it('reads the roster and my classes with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.startsWith('/api/me/') ? makeMyClassList([makeMyClassItem()]) : makeEnrollmentList([makeEnrollment()])))
    const controller = new AbortController()
    const roster = await listEnrollments(CLASS_ID, { status: 'active' }, controller.signal)
    const mine = await listMyClasses({}, controller.signal)
    expect(roster.items[0]!.student.id).toBe(STUDENT_IDS[0])
    expect(mine.items[0]!.relation).toBe('self')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`/api/classes/${CLASS_ID}/enrollments?status=active`, '/api/me/classes'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods and bodies', async () => {
    const fetchMock = mockFetch(() => jsonResponse(201, makeEnrollment()))
    await enrollStudent(CLASS_ID, { studentId: STUDENT_IDS[1] })
    await changeEnrollmentStatus(ENROLLMENT_IDS[0], { action: 'withdraw', reason: 'سفر' })
    await changeEnrollmentStatus(ENROLLMENT_IDS[0], { action: 'reactivate' })
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      [`/api/classes/${CLASS_ID}/enrollments`, 'POST', JSON.stringify({ studentId: STUDENT_IDS[1] })],
      [`/api/enrollments/${ENROLLMENT_IDS[0]}/status`, 'POST', JSON.stringify({ action: 'withdraw', reason: 'سفر' })],
      [`/api/enrollments/${ENROLLMENT_IDS[0]}/status`, 'POST', JSON.stringify({ action: 'reactivate' })],
    ])
  })
})
