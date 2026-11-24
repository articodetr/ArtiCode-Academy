// PORTAL-04 — the school subjects client: the documented methods, paths and bodies, the Bearer token and the signal.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { SUBJECT_ID, makeSubject, makeSubjectList } from '../test/subjects'
import { SUBJECTS_PATH, createSubject, deleteSubject, listSubjects, reorderSubjects, updateSubject } from './subjects'

describe('subjects API (PORTAL-04)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('reads the list with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeSubjectList()))
    const controller = new AbortController()
    await expect(listSubjects(controller.signal)).resolves.toEqual(makeSubjectList())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(SUBJECTS_PATH)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(init?.signal).toBe(controller.signal)
  })

  it('writes with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(204)
      return jsonResponse(200, url.endsWith('/order') ? makeSubjectList() : makeSubject())
    })
    await createSubject({ code: 'MATH', name: { ar: 'الرياضيات' } })
    await updateSubject(SUBJECT_ID, { isActive: false })
    await expect(deleteSubject(SUBJECT_ID)).resolves.toBeUndefined()
    await reorderSubjects(['b', 'a'])
    await updateSubject('a/b', { code: 'X' })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/subjects', 'POST', JSON.stringify({ code: 'MATH', name: { ar: 'الرياضيات' } })],
      [`/api/subjects/${SUBJECT_ID}`, 'PATCH', JSON.stringify({ isActive: false })],
      [`/api/subjects/${SUBJECT_ID}`, 'DELETE', undefined],
      ['/api/subjects/order', 'PUT', JSON.stringify({ subjectIds: ['b', 'a'] })],
      ['/api/subjects/a%2Fb', 'PATCH', JSON.stringify({ code: 'X' })],
    ])
  })
})
