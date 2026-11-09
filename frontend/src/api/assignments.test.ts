import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { ASSIGNMENT_ID, makeAssignment, makeAssignmentList } from '../test/assignments'
import { CLASS_ID } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { assignmentsListPath, changeAssignmentStatus, classAssignmentsPath, createAssignment, deleteAssignment, getAssignment, listAssignments, updateAssignment } from './assignments'

describe('assignments API (API-102..API-107)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(assignmentsListPath()).toBe('/api/assignments')
    expect(assignmentsListPath({ classId: '', status: undefined, dueFrom: undefined })).toBe('/api/assignments')
    expect(
      assignmentsListPath({
        classId: 'c-1',
        lessonId: 'l-1',
        status: 'open',
        dueFrom: '2026-11-01T00:00:00.000Z',
        dueTo: '2026-11-30T20:59:59.999Z',
        order: 'desc',
        limit: 50,
        cursor: 'c%1',
      }),
    ).toBe('/api/assignments?classId=c-1&lessonId=l-1&status=open&dueFrom=2026-11-01T00%3A00%3A00.000Z&dueTo=2026-11-30T20%3A59%3A59.999Z&order=desc&limit=50&cursor=c%251')
    expect(classAssignmentsPath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/assignments`)
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('?') ? makeAssignmentList([makeAssignment()]) : makeAssignment()))
    const controller = new AbortController()
    await listAssignments({ status: 'closed' }, controller.signal)
    await getAssignment(ASSIGNMENT_ID, controller.signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/assignments?status=closed', `/api/assignments/${ASSIGNMENT_ID}`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(init?.method === 'POST' ? 201 : 200, makeAssignment())))
    await createAssignment(CLASS_ID, { title: { ar: 'واجب' }, maxScore: 20, dueAt: '2026-11-20T20:59:00.000Z' })
    await updateAssignment(ASSIGNMENT_ID, { weight: null, maxAttempts: 2 })
    await changeAssignmentStatus(ASSIGNMENT_ID, { action: 'publish', reason: 'جاهز' })
    await expect(deleteAssignment(ASSIGNMENT_ID)).resolves.toBeUndefined()
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      [`/api/classes/${CLASS_ID}/assignments`, 'POST', JSON.stringify({ title: { ar: 'واجب' }, maxScore: 20, dueAt: '2026-11-20T20:59:00.000Z' })],
      [`/api/assignments/${ASSIGNMENT_ID}`, 'PATCH', JSON.stringify({ weight: null, maxAttempts: 2 })],
      [`/api/assignments/${ASSIGNMENT_ID}/status`, 'POST', JSON.stringify({ action: 'publish', reason: 'جاهز' })],
      [`/api/assignments/${ASSIGNMENT_ID}`, 'DELETE', undefined],
    ])
  })
})
