import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CLASS_ID, TEACHER_IDS, makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { changeClassStatus, classesListPath, createClass, deleteClass, getClass, listClasses, replaceClassTeachers, updateClass } from './classes'

describe('classes API (API-050..API-056)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty parameters only, in a fixed order', () => {
    expect(classesListPath()).toBe('/api/classes')
    expect(classesListPath({ q: '  ', status: undefined, courseId: '' })).toBe('/api/classes')
    expect(classesListPath({ q: ' py ', courseId: 'c-1', status: 'open', teacherId: 't-1', sort: 'createdAt', order: 'desc', limit: 50, cursor: 'c%1' })).toBe(
      '/api/classes?q=py&courseId=c-1&status=open&teacherId=t-1&sort=createdAt&order=desc&limit=50&cursor=c%251',
    )
  })

  it('reads with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.includes('?') ? makeClassList([makeClass()]) : makeClass()))
    const controller = new AbortController()
    await listClasses({ status: 'running' }, controller.signal)
    await getClass(CLASS_ID, controller.signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/classes?status=running', `/api/classes/${CLASS_ID}`])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('writes with the documented methods and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(200, makeClass())))
    await createClass({ courseId: 'c-1', code: 'PY-101-A', name: { ar: 'الفصل أ' }, capacity: 20 })
    await updateClass(CLASS_ID, { notes: null, capacity: 25 })
    await changeClassStatus(CLASS_ID, { action: 'cancel', reason: 'لا طلاب' })
    await replaceClassTeachers(CLASS_ID, { teachers: [{ userId: TEACHER_IDS[0], role: 'lead' }] })
    await expect(deleteClass(CLASS_ID)).resolves.toBeUndefined()
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    expect(calls).toEqual([
      ['/api/classes', 'POST', JSON.stringify({ courseId: 'c-1', code: 'PY-101-A', name: { ar: 'الفصل أ' }, capacity: 20 })],
      [`/api/classes/${CLASS_ID}`, 'PATCH', JSON.stringify({ notes: null, capacity: 25 })],
      [`/api/classes/${CLASS_ID}/status`, 'POST', JSON.stringify({ action: 'cancel', reason: 'لا طلاب' })],
      [`/api/classes/${CLASS_ID}/teachers`, 'PUT', JSON.stringify({ teachers: [{ userId: TEACHER_IDS[0], role: 'lead' }] })],
      [`/api/classes/${CLASS_ID}`, 'DELETE', undefined],
    ])
  })
})
