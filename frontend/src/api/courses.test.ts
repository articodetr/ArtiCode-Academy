import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { COURSE_ID, makeCourse, makeLevelList } from '../test/courses'
import { changeCourseStatus, coursesListPath, createCourse, deleteCourse, getCourse, listCourses, updateCourse } from './courses'
import { listLevels } from './levels'

describe('courses API (API-042..API-047) and levels (API-037)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty parameters only', () => {
    expect(coursesListPath()).toBe('/api/courses')
    expect(coursesListPath({ q: '  ', status: undefined })).toBe('/api/courses')
    expect(coursesListPath({ q: ' py ', status: 'draft', levelId: 'l-1', sort: 'createdAt', limit: 50, cursor: 'c%1' })).toBe(
      '/api/courses?q=py&status=draft&levelId=l-1&sort=createdAt&limit=50&cursor=c%251',
    )
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => (url === '/api/levels' ? jsonResponse(200, makeLevelList()) : jsonResponse(200, url.includes('?') ? { items: [], nextCursor: null } : makeCourse())))
    const controller = new AbortController()
    await listCourses({ q: 'py' }, controller.signal)
    await getCourse(COURSE_ID, controller.signal)
    await listLevels(controller.signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/courses?q=py', `/api/courses/${COURSE_ID}`, '/api/levels'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(200, makeCourse())))
    await createCourse({ code: 'PY-101', name: { ar: 'بايثون' } })
    await updateCourse(COURSE_ID, { summary: null, maxAge: 15 })
    await changeCourseStatus(COURSE_ID, 'publish')
    await expect(deleteCourse(COURSE_ID)).resolves.toBeUndefined()
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      ['/api/courses', 'POST', JSON.stringify({ code: 'PY-101', name: { ar: 'بايثون' } })],
      [`/api/courses/${COURSE_ID}`, 'PATCH', JSON.stringify({ summary: null, maxAge: 15 })],
      [`/api/courses/${COURSE_ID}/status`, 'POST', JSON.stringify({ action: 'publish' })],
      [`/api/courses/${COURSE_ID}`, 'DELETE', undefined],
    ])
  })
})
