import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeUserDetail, makeUserList } from '../test/users'
import { createUser, getUser, listUsers, updateUser, usersListPath } from './users'

describe('usersListPath', () => {
  it('returns the bare path when every parameter is absent or empty', () => {
    expect(usersListPath()).toBe('/api/users')
    expect(usersListPath({ q: '   ', includeDeleted: false })).toBe('/api/users')
  })

  it('serialises the filters of API-012, trimming the search text and sending includeDeleted only when true', () => {
    const path = usersListPath({
      q: ' sara ',
      status: 'active',
      role: 'teacher',
      includeDeleted: true,
      sort: 'fullName',
      order: 'asc',
      limit: 50,
      cursor: 'abc_-',
    })
    const query = new URL(path, 'http://localhost').searchParams
    expect(path.startsWith('/api/users?')).toBe(true)
    expect(Object.fromEntries(query)).toEqual({
      q: 'sara',
      status: 'active',
      role: 'teacher',
      includeDeleted: 'true',
      sort: 'fullName',
      order: 'asc',
      limit: '50',
      cursor: 'abc_-',
    })
  })

  it('percent-encodes the search text', () => {
    expect(usersListPath({ q: 'a&b=c' })).toBe('/api/users?q=a%26b%3Dc')
  })
})

describe('users API calls', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('listUsers sends GET with the bearer token and passes the abort signal', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, makeUserList([])))
    const controller = new AbortController()

    await expect(listUsers({ status: 'invited' }, controller.signal)).resolves.toEqual({ items: [], nextCursor: null })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/users?status=invited')
    expect(init?.method).toBe('GET')
    expect(init?.signal).toBe(controller.signal)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1')
  })

  it('getUser targets /api/users/:id and adds includeDeleted only on request', async () => {
    const detail = makeUserDetail()
    const fetchMock = mockFetch(() => jsonResponse(200, detail))

    await expect(getUser(detail.id)).resolves.toEqual(detail)
    await getUser(detail.id, { includeDeleted: true })

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/users/${detail.id}`)
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/users/${detail.id}?includeDeleted=true`)
  })

  it('createUser posts the body of API-014 as JSON', async () => {
    const created = makeUserDetail()
    const fetchMock = mockFetch(() => jsonResponse(201, created))

    await expect(createUser({ kind: 'student', fullName: 'عمر خالد', email: 'omar@test.local' })).resolves.toEqual(created)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/users')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ kind: 'student', fullName: 'عمر خالد', email: 'omar@test.local' })
  })

  it('updateUser patches /api/users/:id and keeps explicit nulls (cleared fields) in the body', async () => {
    const updated = makeUserDetail({ phone: null, displayName: 'عمر' })
    const fetchMock = mockFetch(() => jsonResponse(200, updated))

    await expect(updateUser(updated.id, { displayName: 'عمر', phone: null })).resolves.toEqual(updated)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/users/${updated.id}`)
    expect(init?.method).toBe('PATCH')
    expect(init?.body).toBe('{"displayName":"عمر","phone":null}')
  })
})
