import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { COURSE_ID, LEVEL_ID, makeLevel, makeLevelList, makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { createLevel, deleteLevel, reorderLevels, updateLevel } from './levels'
import { getSyllabus, replaceSyllabus } from './syllabus'

describe('levels writes (API-038..API-041) and syllabus (API-048/API-049)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('writes levels with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(204)
      return jsonResponse(200, url.endsWith('/order') ? makeLevelList() : makeLevel())
    })
    await createLevel({ code: 'BEG', name: { ar: 'مبتدئ' } })
    await updateLevel(LEVEL_ID, { description: null, isActive: false })
    await expect(deleteLevel(LEVEL_ID)).resolves.toBeUndefined()
    await reorderLevels(['b', 'a'])
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/levels', 'POST', JSON.stringify({ code: 'BEG', name: { ar: 'مبتدئ' } })],
      [`/api/levels/${LEVEL_ID}`, 'PATCH', JSON.stringify({ description: null, isActive: false })],
      [`/api/levels/${LEVEL_ID}`, 'DELETE', undefined],
      ['/api/levels/order', 'PUT', JSON.stringify({ levelIds: ['b', 'a'] })],
    ])
  })

  it('reads the syllabus with the Bearer token and replaces it with the complete list', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeSyllabus()))
    const controller = new AbortController()
    await getSyllabus(COURSE_ID, controller.signal)
    await replaceSyllabus(COURSE_ID, [{ title: { ar: 'جديد' } }])
    const [[readUrl, readInit], [writeUrl, writeInit]] = fetchMock.mock.calls
    expect(readUrl).toBe(`/api/courses/${COURSE_ID}/syllabus`)
    expect(new Headers(readInit?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(readInit?.signal).toBe(controller.signal)
    expect([writeUrl, writeInit?.method, writeInit?.body]).toEqual([`/api/courses/${COURSE_ID}/syllabus`, 'PUT', JSON.stringify({ items: [{ title: { ar: 'جديد' } }] })])
  })
})
