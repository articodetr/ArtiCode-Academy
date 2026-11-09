import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { ASSIGNMENT_ID } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { SUBMISSION_IDS, makeGradedSubmission, makeSubmission, makeSubmissionRoster } from '../test/submissions'
import { ApiError } from './client'
import { assignmentSubmissionsPath, getSubmission, getSubmissionRoster, reviewSubmission, submissionPath, submitAssignment } from './submissions'

describe('submissions API (API-108..API-111)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the roster and submission paths with encoded ids', () => {
    expect(assignmentSubmissionsPath(ASSIGNMENT_ID)).toBe(`/api/assignments/${ASSIGNMENT_ID}/submissions`)
    expect(submissionPath(SUBMISSION_IDS[0])).toBe(`/api/submissions/${SUBMISSION_IDS[0]}`)
    expect(submissionPath('a/b')).toBe('/api/submissions/a%2Fb')
  })

  it('reads the roster (API-108) and a submission (API-110) with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('/assignments/') ? makeSubmissionRoster() : makeSubmission()))
    const controller = new AbortController()
    const roster = await getSubmissionRoster(ASSIGNMENT_ID, controller.signal)
    const submission = await getSubmission(SUBMISSION_IDS[0], controller.signal)
    expect(roster.items).toHaveLength(4)
    expect(roster.maxAttempts).toBe(2)
    expect(submission.linkUrl).toBe('https://docs.example.com/sara-loops')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      [`/api/assignments/${ASSIGNMENT_ID}/submissions`, 'GET'],
      [`/api/submissions/${SUBMISSION_IDS[0]}`, 'GET'],
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('submits (API-109) and reviews (API-111) with POST and the bodies exactly as given', async () => {
    const fetchMock = mockFetch((url) => (url.endsWith('/review') ? jsonResponse(200, makeGradedSubmission()) : jsonResponse(201, makeSubmission())))
    await submitAssignment(ASSIGNMENT_ID, { textAnswer: 'إجابتي' })
    await reviewSubmission(SUBMISSION_IDS[0], { action: 'grade', score: 17.5, feedback: 'عمل جيد' })
    await reviewSubmission(SUBMISSION_IDS[0], { action: 'return', feedback: 'أكمل التمرين الثالث' })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/assignments/${ASSIGNMENT_ID}/submissions`, 'POST', JSON.stringify({ textAnswer: 'إجابتي' })],
      [`/api/submissions/${SUBMISSION_IDS[0]}/review`, 'POST', JSON.stringify({ action: 'grade', score: 17.5, feedback: 'عمل جيد' })],
      [`/api/submissions/${SUBMISSION_IDS[0]}/review`, 'POST', JSON.stringify({ action: 'return', feedback: 'أكمل التمرين الثالث' })],
    ])
  })

  it('rejects with the server code (score_out_of_range carries its details)', async () => {
    mockFetch(() => jsonResponse(400, { statusCode: 400, code: 'score_out_of_range', score: 25, maxScore: 20, message: 'The score must be between 0 and 20' }))
    const failure = await reviewSubmission(SUBMISSION_IDS[0], { action: 'grade', score: 25 }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).code).toBe('score_out_of_range')
    expect((failure as ApiError).body).toMatchObject({ score: 25, maxScore: 20 })
  })
})
