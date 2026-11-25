// MOD-19 — the learner's catalog client (API-219..API-223): paths, methods, bodies, the Bearer token and the abort signal.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CATALOG_CLASS_IDS, CATALOG_COURSE_IDS, REQUEST_IDS, makeCatalogDetail, makeCatalogList, makeEnrollResult, makeMyRequest, makeMyRequestList } from '../test/catalog'
import { jsonResponse, mockFetch } from '../test/http'
import { cancelMyEnrollmentRequest, catalogPath, enrollInClass, getCatalogCourse, listCatalog, listMyEnrollmentRequests } from './catalog'

describe('catalog API (API-219..API-223)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the catalog path with the non-empty parameters only, the search trimmed', () => {
    expect(catalogPath()).toBe('/api/catalog/courses')
    expect(catalogPath({ q: '   ', cursor: '' })).toBe('/api/catalog/courses')
    const path = catalogPath({ q: ' بايثون ', pricing: 'paid', levelId: 'lv-1', available: true, limit: 24, cursor: 'c%1' })
    expect(path.startsWith('/api/catalog/courses?')).toBe(true)
    expect([...new URL(path, 'http://localhost').searchParams.entries()]).toEqual([
      ['q', 'بايثون'],
      ['levelId', 'lv-1'],
      ['pricing', 'paid'],
      ['available', 'true'],
      ['limit', '24'],
      ['cursor', 'c%1'],
    ])
    expect(catalogPath({ available: false })).toBe('/api/catalog/courses?available=false')
    // PORTAL-04: the school subject.
    expect(catalogPath({ subjectId: 'sb-1', limit: 24 })).toBe('/api/catalog/courses?subjectId=sb-1&limit=24')
    expect(catalogPath({ subjectId: '' })).toBe('/api/catalog/courses')
  })

  it('reads the catalog, a course and «my requests» with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => {
      if (url === '/api/me/enrollment-requests') return jsonResponse(200, makeMyRequestList([makeMyRequest()]))
      if (url.startsWith(`/api/catalog/courses/`)) return jsonResponse(200, makeCatalogDetail())
      return jsonResponse(200, makeCatalogList())
    })
    const controller = new AbortController()
    expect((await listCatalog({ pricing: 'free' }, controller.signal)).items).toHaveLength(1)
    expect((await getCatalogCourse(CATALOG_COURSE_IDS[0], controller.signal)).classes).toHaveLength(1)
    expect((await listMyEnrollmentRequests(controller.signal)).items[0]!.state).toBe('pending_payment')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/catalog/courses?pricing=free', `/api/catalog/courses/${CATALOG_COURSE_IDS[0]}`, '/api/me/enrollment-requests'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
      expect(init?.signal).toBe(controller.signal)
    }
  })

  it('enrolls and cancels with a POST and an empty JSON body', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(url.endsWith('/enroll') ? 201 : 200, url.endsWith('/enroll') ? makeEnrollResult() : makeMyRequest({ status: 'cancelled', state: 'cancelled' })))
    expect((await enrollInClass(CATALOG_CLASS_IDS[0])).outcome).toBe('enrolled')
    expect((await cancelMyEnrollmentRequest(REQUEST_IDS[0])).state).toBe('cancelled')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [`/api/catalog/classes/${CATALOG_CLASS_IDS[0]}/enroll`, 'POST', '{}'],
      [`/api/me/enrollment-requests/${REQUEST_IDS[0]}/cancel`, 'POST', '{}'],
    ])
  })
})
