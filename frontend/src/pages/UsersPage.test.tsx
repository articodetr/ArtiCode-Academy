import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { RoleList } from '../api/roles'
import type { UserDetail, UserList } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, READ_ONLY_PERMISSIONS, ROLE_LABELS, makeListItem, makeRoleList, makeUserDetail, makeUserList, reduced } from '../test/users'
import { UsersPage } from './UsersPage'

const sara = makeListItem()
const omar = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000002', fullName: 'عمر خالد', email: 'omar@test.local', username: 'omar', phone: null, status: 'invited', roles: ['student'] })
/** Holds the custom role `librarian` of the fixture roles (API-022) besides a system role. */
const layla = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000004', fullName: 'ليلى حسن', email: 'layla@test.local', username: 'layla', roles: ['librarian', 'teacher'] })

/** The labels of the five system roles as the role filter lists them, in menu order. */
const SYSTEM_ROLE_OPTIONS = [ar.roles.admin, ar.roles.staff, ar.roles.teacher, ar.roles.guardian, ar.roles.student]

/**
 * Serves GET /api/users from `pages` keyed by cursor ('first' = no cursor),
 * GET /api/users/:id from `detail` and GET /api/roles from `roles`; records
 * every list query and every roles request for assertions.
 */
function mockUsersApi(pages: Record<string, UserList | Response>, detail: UserDetail = makeUserDetail(), roles: RoleList | Response = makeRoleList()) {
  const queries: URLSearchParams[] = []
  const rolesRequests: string[] = []
  const fetchMock = mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/roles' && method === 'GET') {
      rolesRequests.push(url)
      return roles instanceof Response ? roles : jsonResponse(200, roles)
    }
    if (parsed.pathname === '/api/users' && method === 'GET') {
      queries.push(parsed.searchParams)
      const page = pages[parsed.searchParams.get('cursor') ?? 'first']
      if (page instanceof Response) return page
      return page ? jsonResponse(200, page) : jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'bad cursor' })
    }
    if (parsed.pathname.startsWith('/api/users/') && method === 'GET') return jsonResponse(200, detail)
    return jsonResponse(404, { statusCode: 404, code: 'user_not_found', message: 'User not found' })
  })
  return { queries, rolesRequests, fetchMock, lastQuery: () => queries[queries.length - 1] }
}

function renderPage(permissions: string[] = ADMIN_PERMISSIONS) {
  return renderWithProviders(<UsersPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/users' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  // Ant Design renders a measurement row before the data rows; keep the rows that carry cells with text.
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

async function selectOption(comboboxName: string, optionLabel: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: comboboxName }))
  const option = await screen.findByText(optionLabel, { selector: '.ant-select-item-option-content' })
  fireEvent.click(option)
}

/** Opens the role filter and returns the texts of its options, in order (the only open dropdown). */
async function roleFilterOptions() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.users.role }))
  await screen.findByText(ar.roles.admin, { selector: '.ant-select-item-option-content' })
  return Array.from(document.querySelectorAll('.ant-select-item-option-content'), (option) => option.textContent)
}

describe('UsersPage', () => {
  it('lists the users of GET /api/users with name, contact, roles and status; the first request asks for the default page', async () => {
    const api = mockUsersApi({ first: makeUserList([sara, omar]) })
    renderPage()

    expect(await screen.findByText(sara.fullName)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ar.users.title })).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('sara@test.local')).toBeInTheDocument()
    expect(within(rows[0]).getByText('sara.ahmed')).toBeInTheDocument()
    expect(within(rows[0]).getByText(ar.roles.teacher)).toBeInTheDocument()
    expect(within(rows[0]).getByText(ar.labels.active)).toBeInTheDocument()
    expect(within(rows[1]).getByText(ar.labels.invited)).toBeInTheDocument()
    expect(within(rows[1]).getByText(ar.roles.student)).toBeInTheDocument()

    expect(Object.fromEntries(api.queries[0])).toEqual({ sort: 'createdAt', limit: '20' })
    expect(screen.getByRole('button', { name: new RegExp(ar.users.addUser) })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: ar.users.includeDeleted })).toBeInTheDocument()
  })

  it('shows the reduced projection without users.read_contact: no contact column, no add button, no deleted toggle', async () => {
    mockUsersApi({ first: makeUserList([reduced(sara)]) })
    renderPage(READ_ONLY_PERMISSIONS)

    expect(await screen.findByText(sara.fullName)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: ar.users.columns.contact })).not.toBeInTheDocument()
    expect(screen.queryByText('sara@test.local')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(ar.users.addUser) })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: ar.users.includeDeleted })).not.toBeInTheDocument()
    expect(screen.getByText(ar.users.reducedHint)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(ar.users.searchByName)).toBeInTheDocument()
  })

  it('sends the search text as q and the chosen status, restarting from the first page', async () => {
    const api = mockUsersApi({ first: makeUserList([sara]) })
    renderPage()
    await screen.findByText(sara.fullName)

    const search = screen.getByRole('searchbox', { name: ar.common.search })
    // API-012 accepts q of 1–200 characters (PR #26 note 5 — J-F14).
    expect(search).toHaveAttribute('maxlength', '200')
    await userEvent.type(search, 'sara{enter}')
    await waitFor(() => expect(api.lastQuery().get('q')).toBe('sara'))

    await selectOption(ar.common.status, ar.labels.suspended)
    await waitFor(() => expect(api.lastQuery().get('status')).toBe('suspended'))
    expect(api.lastQuery().get('q')).toBe('sara')
    expect(api.lastQuery().has('cursor')).toBe(false)
  })

  it('sends includeDeleted=true and marks soft-deleted rows', async () => {
    const gone = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000009', fullName: 'حساب محذوف', status: 'archived', deletedAt: '2026-10-29T12:00:00.000Z' })
    const api = mockUsersApi({ first: makeUserList([sara]) })
    renderPage()
    await screen.findByText(sara.fullName)

    api.fetchMock.mockImplementation(async () => jsonResponse(200, makeUserList([sara, gone])))
    await userEvent.click(screen.getByRole('checkbox', { name: ar.users.includeDeleted }))

    expect(await screen.findByText(gone.fullName)).toBeInTheDocument()
    expect(screen.getByText(ar.users.deleted)).toBeInTheDocument()
    const [url] = api.fetchMock.mock.calls[api.fetchMock.mock.calls.length - 1]
    expect(new URL(String(url), 'http://localhost').searchParams.get('includeDeleted')).toBe('true')
  })

  it('pages forward with the opaque cursor and back to the previous page', async () => {
    const api = mockUsersApi({ first: makeUserList([sara], 'cursor-2'), 'cursor-2': makeUserList([omar], null) })
    renderPage()
    await screen.findByText(sara.fullName)

    const next = screen.getByRole('button', { name: ar.users.pagination.next })
    const previous = screen.getByRole('button', { name: ar.users.pagination.previous })
    expect(previous).toBeDisabled()
    await userEvent.click(next)

    expect(await screen.findByText(omar.fullName)).toBeInTheDocument()
    expect(screen.queryByText(sara.fullName)).not.toBeInTheDocument()
    expect(api.lastQuery().get('cursor')).toBe('cursor-2')
    expect(screen.getByText(ar.users.pagination.page.replace('{{page}}', '2'))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: ar.users.pagination.next })).toBeDisabled())

    await userEvent.click(screen.getByRole('button', { name: ar.users.pagination.previous }))
    expect(await screen.findByText(sara.fullName)).toBeInTheDocument()
    expect(api.lastQuery().has('cursor')).toBe(false)
  })

  it('shows the empty text when no user matches', async () => {
    mockUsersApi({ first: makeUserList([]) })
    renderPage()
    expect(await screen.findByText(ar.users.empty)).toBeInTheDocument()
  })

  it('shows the permission message when the list is refused', async () => {
    mockUsersApi({ first: jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['users.read'] }) })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ليست لديك الصلاحية اللازمة لهذا الإجراء (users.read)')
  })

  it('opens the detail drawer for the clicked row', async () => {
    const detail = makeUserDetail({ id: sara.id, fullName: sara.fullName, roles: [{ key: 'teacher', label: { ar: 'معلم', en: 'Teacher' } }], studentProfile: null, guardians: [] })
    const api = mockUsersApi({ first: makeUserList([sara]) }, detail)
    renderPage()
    await screen.findByText(sara.fullName)

    await userEvent.click(screen.getByRole('button', { name: `${ar.common.view}: ${sara.fullName}` }))

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(ar.users.detail.title)).toBeInTheDocument()
    expect(await within(drawer).findByRole('heading', { level: 4, name: sara.fullName })).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${sara.id}`)).toBe(true)
  })

  it('opens the creation wizard from the add button', async () => {
    mockUsersApi({ first: makeUserList([]) })
    renderPage()
    await screen.findByText(ar.users.empty)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ar.users.addUser) }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.users.create.title)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: new RegExp(`^${ar.users.kinds.teacher}`) })).toBeInTheDocument()
  })

  it('shows a custom role by its server label in the list and offers it in the role filter, from one GET /api/roles (J-F12)', async () => {
    const api = mockUsersApi({ first: makeUserList([layla, sara]) })
    renderPage()

    expect(await screen.findByText(ROLE_LABELS.librarian.ar)).toBeInTheDocument()
    const [row] = bodyRows()
    expect(within(row).getByText(ROLE_LABELS.librarian.ar)).toBeInTheDocument()
    expect(within(row).getByText(ar.roles.teacher)).toBeInTheDocument()
    expect(within(row).queryByText('librarian')).not.toBeInTheDocument()

    expect(await roleFilterOptions()).toEqual([...SYSTEM_ROLE_OPTIONS, ROLE_LABELS.librarian.ar])
    fireEvent.click(screen.getByText(ROLE_LABELS.librarian.ar, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.lastQuery().get('role')).toBe('librarian'))
    // Every row, re-render and list request reuses the labels: one roles request for the visit.
    expect(api.rolesRequests).toEqual(['/api/roles'])
  })

  it('keeps the raw key and the five system roles in the filter when GET /api/roles fails, with no error on the page (J-F12)', async () => {
    const api = mockUsersApi({ first: makeUserList([layla]) }, undefined, jsonResponse(500, { statusCode: 500, message: 'Internal server error' }))
    renderPage()

    await screen.findByText(layla.fullName)
    await waitFor(() => expect(api.rolesRequests).toHaveLength(1))
    expect(within(bodyRows()[0]).getByText('librarian')).toBeInTheDocument()
    expect(await roleFilterOptions()).toEqual(SYSTEM_ROLE_OPTIONS)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks for no roles without users.read (the permission of GET /api/roles) and shows the raw key (J-F12)', async () => {
    const api = mockUsersApi({ first: makeUserList([reduced(layla)]) })
    renderPage([])

    await screen.findByText(layla.fullName)
    expect(within(bodyRows()[0]).getByText('librarian')).toBeInTheDocument()
    expect(api.rolesRequests).toEqual([])
  })
})
