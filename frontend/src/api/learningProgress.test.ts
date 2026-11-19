// MOD-20 — the class learning progress client (API-235): the path, the Bearer token and the abort signal.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeClassLearningProgress } from '../test/learningProgress'
import { classLearningProgressPath, getClassLearningProgress } from './learningProgress'

describe('learning progress API (API-235)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('reads one class with a GET, the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeClassLearningProgress()))
    const controller = new AbortController()
    const progress = await getClassLearningProgress(CLASS_ID, controller.signal)
    expect(progress.students).toHaveLength(3)
    expect(classLearningProgressPath('a/b')).toBe('/api/classes/a%2Fb/learning-progress')
    const [[url, init]] = fetchMock.mock.calls
    expect(url).toBe(`/api/classes/${CLASS_ID}/learning-progress`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })
})
