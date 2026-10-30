import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { ALL_ROLES, LIBRARIAN_ROLE, makeCatalog } from '../test/roles'
import { createRole, deleteRole, listPermissions, listRoles, ROLES_PATHS, updateRole } from './roles'

describe('roles API calls', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('listRoles sends GET /api/roles with the bearer token and the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { items: ALL_ROLES }))
    const controller = new AbortController()

    await expect(listRoles(controller.signal)).resolves.toEqual({ items: ALL_ROLES })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/roles')
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('listPermissions sends GET /api/permissions', async () => {
    const catalog = makeCatalog()
    const fetchMock = mockFetch(() => jsonResponse(200, catalog))

    await expect(listPermissions()).resolves.toEqual(catalog)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/permissions')
  })

  it('createRole POSTs the body as JSON and returns the created role', async () => {
    const fetchMock = mockFetch(() => jsonResponse(201, LIBRARIAN_ROLE))
    const input = { key: 'librarian', label: { ar: 'أمين المكتبة', en: 'Librarian' }, permissions: ['courses.read'] }

    await expect(createRole(input)).resolves.toEqual(LIBRARIAN_ROLE)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/roles')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('updateRole PATCHes /api/roles/:id with the given body only', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { ...LIBRARIAN_ROLE, permissions: ['courses.manage', 'courses.read'] }))

    await updateRole(LIBRARIAN_ROLE.id, { permissions: ['courses.manage', 'courses.read'] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/roles/${LIBRARIAN_ROLE.id}`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ permissions: ['courses.manage', 'courses.read'] })
  })

  it('deleteRole sends DELETE and resolves on the empty 204', async () => {
    const fetchMock = mockFetch(() => jsonResponse(204))

    await expect(deleteRole(LIBRARIAN_ROLE.id)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ROLES_PATHS.byId(LIBRARIAN_ROLE.id))
    expect(init?.method).toBe('DELETE')
    expect(init?.body).toBeUndefined()
  })

  it('percent-encodes the id in the path', () => {
    expect(ROLES_PATHS.byId('a/b')).toBe('/api/roles/a%2Fb')
  })
})
