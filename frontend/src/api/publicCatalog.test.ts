// MOD-20 (D-R138) — the public catalog client (API-236/237): the paths, no token, no session refresh, and the
// `catalog_not_public` answer.
import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { CATALOG_NOT_PUBLIC, PUBLIC_COURSE_IDS, makePublicDetail, makePublicList } from '../test/publicCatalog'
import { jsonResponse, mockFetch } from '../test/http'
import { ApiError } from './client'
import { PUBLIC_CATALOG_PATH, getPublicCourse, isCatalogNotPublic, listPublicCatalog, publicCatalogPath } from './publicCatalog'

describe('public catalog API calls', () => {
  beforeEach(() => {
    // A signed-in tab must not leak its token into a public read either.
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty parameters only, the search trimmed', () => {
    expect(publicCatalogPath()).toBe(PUBLIC_CATALOG_PATH)
    expect(publicCatalogPath({ q: '  ', limit: 24 })).toBe(`${PUBLIC_CATALOG_PATH}?limit=24`)
    expect(publicCatalogPath({ q: ' بايثون ', limit: 24, cursor: 'abc' })).toBe(`${PUBLIC_CATALOG_PATH}?q=${encodeURIComponent('بايثون')}&limit=24&cursor=abc`)
    // PORTAL-04: the school subject (no screen sends it yet — the subject list needs a session).
    expect(publicCatalogPath({ subjectId: 'sb-1', limit: 24 })).toBe(`${PUBLIC_CATALOG_PATH}?subjectId=sb-1&limit=24`)
  })

  it('listPublicCatalog sends GET without the bearer token and returns the page', async () => {
    const page = makePublicList()
    const fetchMock = mockFetch(() => jsonResponse(200, page))
    const controller = new AbortController()

    await expect(listPublicCatalog({ limit: 24 }, controller.signal)).resolves.toEqual(page)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${PUBLIC_CATALOG_PATH}?limit=24`)
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
  })

  it('getPublicCourse reads one course by its encoded id, without the bearer token', async () => {
    const detail = makePublicDetail()
    const fetchMock = mockFetch(() => jsonResponse(200, detail))

    await expect(getPublicCourse(PUBLIC_COURSE_IDS[0])).resolves.toEqual(detail)
    await getPublicCourse('a/b').catch(() => undefined)

    expect(fetchMock.mock.calls[0]![0]).toBe(`${PUBLIC_CATALOG_PATH}/${PUBLIC_COURSE_IDS[0]}`)
    expect(fetchMock.mock.calls[1]![0]).toBe(`${PUBLIC_CATALOG_PATH}/a%2Fb`)
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBeNull()
  })

  it('never refreshes a session: a 401 stays the one request', async () => {
    const fetchMock = mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'token_expired', message: 'expired' }))
    await expect(listPublicCatalog()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tells a closed catalog (404 catalog_not_public) from any other refusal', async () => {
    mockFetch(() => jsonResponse(404, CATALOG_NOT_PUBLIC))
    const closed = await listPublicCatalog().catch((error: unknown) => error)
    expect(closed).toBeInstanceOf(ApiError)
    expect(isCatalogNotPublic(closed)).toBe(true)

    mockFetch(() => jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'gone' }))
    const gone = await getPublicCourse(PUBLIC_COURSE_IDS[1]).catch((error: unknown) => error)
    expect(isCatalogNotPublic(gone)).toBe(false)
    expect(isCatalogNotPublic(new Error('network'))).toBe(false)
  })
})
