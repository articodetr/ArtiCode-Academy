import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeGuardianLinkItem } from '../test/users'
import { GUARDIANS_PATHS, linkGuardian, listGuardians, listStudents, unlinkGuardian, updateGuardianLink } from './guardians'

const STUDENT = '0192f0a0-0000-7000-8000-000000000002'
const GUARDIAN = '0192f0a0-0000-7000-8000-000000000003'

describe('guardians API calls (API-029..API-033)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the paths of both sides and of one link, percent-encoding the ids', () => {
    expect(GUARDIANS_PATHS.guardians(STUDENT)).toBe(`/api/users/${STUDENT}/guardians`)
    expect(GUARDIANS_PATHS.students(GUARDIAN)).toBe(`/api/users/${GUARDIAN}/students`)
    expect(GUARDIANS_PATHS.link('a/b', 'c d')).toBe('/api/users/a%2Fb/guardians/c%20d')
  })

  it('lists guardians and students with the bearer token and the abort signal', async () => {
    const item = makeGuardianLinkItem()
    const fetchMock = mockFetch(() => jsonResponse(200, { items: [item] }))
    const controller = new AbortController()

    await expect(listGuardians(STUDENT, controller.signal)).resolves.toEqual({ items: [item] })
    await expect(listStudents(GUARDIAN)).resolves.toEqual({ items: [item] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/users/${STUDENT}/guardians`)
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/users/${GUARDIAN}/students`)
  })

  it('links with POST, updates with PATCH and unlinks with DELETE (204 resolves to nothing)', async () => {
    const item = makeGuardianLinkItem({ relationship: 'mother', isPrimary: true })
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(init?.method === 'POST' ? 201 : 200, item)))

    await expect(linkGuardian(STUDENT, { guardianId: GUARDIAN, relationship: 'mother', isPrimary: true })).resolves.toEqual(item)
    await expect(updateGuardianLink(STUDENT, GUARDIAN, { isPrimary: true })).resolves.toEqual(item)
    await expect(unlinkGuardian(STUDENT, GUARDIAN)).resolves.toBeUndefined()

    const [post, patch, remove] = fetchMock.mock.calls
    expect(post[0]).toBe(`/api/users/${STUDENT}/guardians`)
    expect(post[1]?.method).toBe('POST')
    expect(JSON.parse(String(post[1]?.body))).toEqual({ guardianId: GUARDIAN, relationship: 'mother', isPrimary: true })
    expect(patch[0]).toBe(`/api/users/${STUDENT}/guardians/${GUARDIAN}`)
    expect(patch[1]?.method).toBe('PATCH')
    expect(patch[1]?.body).toBe('{"isPrimary":true}')
    expect(remove[0]).toBe(`/api/users/${STUDENT}/guardians/${GUARDIAN}`)
    expect(remove[1]?.method).toBe('DELETE')
    expect(remove[1]?.body).toBeUndefined()
  })
})
