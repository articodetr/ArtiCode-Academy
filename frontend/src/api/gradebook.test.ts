import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { GRADE_SCHEME_IDS } from '../test/gradeSchemes'
import { finalizedGradebook, fullGradebook, readyGradebook } from '../test/gradebook'
import { jsonResponse, mockFetch } from '../test/http'
import { finalGradesPath, finalizeGrades, getGradebook, gradebookPath, withdrawFinalGrades } from './gradebook'

describe('gradebook API (API-126..API-128)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the class paths, encoding the id', () => {
    expect(gradebookPath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/gradebook`)
    expect(finalGradesPath(CLASS_ID)).toBe(`/api/classes/${CLASS_ID}/final-grades`)
    expect(gradebookPath('a/b')).toBe('/api/classes/a%2Fb/gradebook')
  })

  it('reads the gradebook with the Bearer token and the abort signal, exactly as the server sends it', async () => {
    const gradebook = fullGradebook()
    const fetchMock = mockFetch(() => jsonResponse(200, gradebook))
    const controller = new AbortController()
    const result = await getGradebook(CLASS_ID, controller.signal)
    expect(result).toEqual(gradebook)
    expect(result.students[0]?.cells[0]).toEqual({ kind: 'assignment', id: gradebook.components[0]?.id, status: 'graded', score: 18, effectiveScore: 16.2, late: true })
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe(`/api/classes/${CLASS_ID}/gradebook`)
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
    expect(init?.credentials).toBe('include')
  })

  it('finalizes with POST and the chosen scheme, withdraws with DELETE and no body; both answer with the gradebook', async () => {
    const fetchMock = mockFetch((_url, init) => jsonResponse(200, init?.method === 'POST' ? finalizedGradebook(GRADE_SCHEME_IDS[1]) : readyGradebook()))
    const finalized = await finalizeGrades(CLASS_ID, { schemeId: GRADE_SCHEME_IDS[1] })
    expect(finalized.students[0]?.final?.schemeId).toBe(GRADE_SCHEME_IDS[1])
    const withdrawn = await withdrawFinalGrades(CLASS_ID)
    expect(withdrawn.students.every((student) => student.final === null)).toBe(true)
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/classes/${CLASS_ID}/final-grades`, 'POST', JSON.stringify({ schemeId: GRADE_SCHEME_IDS[1] })],
      [`/api/classes/${CLASS_ID}/final-grades`, 'DELETE', undefined],
    ])
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe('application/json')
  })

  it('surfaces the stable error code and details of a refusal', async () => {
    mockFetch(() =>
      jsonResponse(409, { statusCode: 409, error: 'Conflict', code: 'grades_not_ready', message: 'not settled', openAssignments: 1, awaitingReview: 2, unpublishedExams: 0, weightedComponents: 3 }),
    )
    await expect(finalizeGrades(CLASS_ID, {})).rejects.toMatchObject({ status: 409, code: 'grades_not_ready', body: { openAssignments: 1, awaitingReview: 2 } })
  })
})
