import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { ACADEMY_PATH, getAcademy, updateAcademy } from './academy'

describe('academy API calls', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('getAcademy sends GET /api/academy with the bearer token and the abort signal', async () => {
    const academy = makeAcademy()
    const fetchMock = mockFetch(() => jsonResponse(200, academy))
    const controller = new AbortController()

    await expect(getAcademy(controller.signal)).resolves.toEqual(academy)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ACADEMY_PATH)
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('updateAcademy PATCHes /api/academy with the given body only, as JSON, and returns the entity', async () => {
    const saved = makeAcademy({ currency: 'TRY', contactPhone: null })
    const fetchMock = mockFetch(() => jsonResponse(200, saved))

    await expect(updateAcademy({ currency: 'TRY', contactPhone: null })).resolves.toEqual(saved)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ACADEMY_PATH)
    expect(init?.method).toBe('PATCH')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ currency: 'TRY', contactPhone: null })
  })

  it('rejects with an ApiError carrying the stable code of the backend', async () => {
    mockFetch(() => jsonResponse(503, { statusCode: 503, error: 'Service Unavailable', code: 'academy_not_configured', message: 'seed' }))
    await expect(getAcademy()).rejects.toMatchObject({ status: 503, code: 'academy_not_configured' })
  })
})
