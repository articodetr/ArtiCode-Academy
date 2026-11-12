import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { ASSIGNMENT_ID } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { SUBMISSION_ID, makeMyAssignment, makeMyAssignmentList, makeMySubmission } from '../test/myAssignments'
import { getMySubmission, listMyAssignments, myAssignmentsPath, mySubmissionPath, submitAttemptPath, submitMyAttempt } from './myAssignments'

describe('my assignments API (API-112) and the learner submission calls (API-109, API-110)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the given parameters only, in a fixed order', () => {
    expect(myAssignmentsPath()).toBe('/api/me/assignments')
    expect(myAssignmentsPath({ classId: '', studentId: undefined, status: undefined, pending: false, cursor: '' })).toBe('/api/me/assignments')
    expect(
      myAssignmentsPath({
        cursor: 'c%1',
        limit: 100,
        order: 'desc',
        dueTo: '2026-11-30T20:59:59.999Z',
        dueFrom: '2026-11-01T00:00:00.000Z',
        pending: true,
        status: 'open',
        studentId: 's-1',
        classId: 'c-1',
      }),
    ).toBe(
      '/api/me/assignments?classId=c-1&studentId=s-1&status=open&pending=true&dueFrom=2026-11-01T00%3A00%3A00.000Z&dueTo=2026-11-30T20%3A59%3A59.999Z&order=desc&limit=100&cursor=c%251',
    )
  })

  it('sends pending only when true — false and absent mean every item to the server — and encodes the + of an offset', () => {
    expect(myAssignmentsPath({ pending: false, status: 'closed' })).toBe('/api/me/assignments?status=closed')
    expect(myAssignmentsPath({ dueFrom: '2026-11-01T00:00:00+03:00' })).toBe('/api/me/assignments?dueFrom=2026-11-01T00%3A00%3A00%2B03%3A00')
  })

  it('builds the submission paths of API-109 and API-110', () => {
    expect(submitAttemptPath(ASSIGNMENT_ID)).toBe(`/api/assignments/${ASSIGNMENT_ID}/submissions`)
    expect(mySubmissionPath(SUBMISSION_ID)).toBe(`/api/submissions/${SUBMISSION_ID}`)
    expect(mySubmissionPath('a/b')).toBe('/api/submissions/a%2Fb')
  })

  it('reads the list and one submission with the Bearer token and the abort signal', async () => {
    const list = makeMyAssignmentList([makeMyAssignment()], 'next-1')
    const fetchMock = mockFetch((url) => jsonResponse(200, url.startsWith('/api/me/') ? list : makeMySubmission()))
    const controller = new AbortController()
    await expect(listMyAssignments({ studentId: 's-1', limit: 20 }, controller.signal)).resolves.toEqual(list)
    await expect(getMySubmission(SUBMISSION_ID, controller.signal)).resolves.toEqual(makeMySubmission())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/me/assignments?studentId=s-1&limit=20', `/api/submissions/${SUBMISSION_ID}`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('sends one attempt as a POST with the typed fields and the attempt meant, and returns the stored attempt (201)', async () => {
    const created = makeMySubmission({ textAnswer: null })
    const fetchMock = mockFetch(() => jsonResponse(201, created))
    await expect(submitMyAttempt(ASSIGNMENT_ID, { linkUrl: 'https://docs.example.com/answer', attemptNo: 1 })).resolves.toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`/api/assignments/${ASSIGNMENT_ID}/submissions`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ linkUrl: 'https://docs.example.com/answer', attemptNo: 1 }))
  })

  it('reads the MOD-08-T07 fields: the item’s enrollment and submit state, the attempt’s history and its assignment’s late policy and zone', async () => {
    const item = makeMyAssignment({ submitBlocker: 'past_due', submitsLate: false, enrollmentStatus: 'active' })
    mockFetch((url) => jsonResponse(200, url.startsWith('/api/me/') ? makeMyAssignmentList([item]) : makeMySubmission()))
    const list = await listMyAssignments()
    expect(list.items[0]).toMatchObject({ enrollmentStatus: 'active', submitBlocker: 'past_due', submitsLate: false })
    const submission = await getMySubmission(SUBMISSION_ID)
    expect(submission.assignment).toMatchObject({ allowLate: false, timeZone: 'Asia/Riyadh' })
    expect(submission.history).toEqual([{ id: SUBMISSION_ID, attemptNo: 1, submittedAt: '2026-11-10T08:30:00.000Z', isLate: false, status: 'submitted', score: null, gradedAt: null }])
  })
})
