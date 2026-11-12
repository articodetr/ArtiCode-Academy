import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { RoleList } from '../api/roles'
import type { UserDetail, UserList } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { REGISTRAR_ROLE } from '../test/roles'
import { ADMIN_PERMISSIONS, READ_ONLY_PERMISSIONS, ROLE_LABELS, ROLE_OPTIONS, makeListItem, makeRoleList, makeUserDetail, makeUserList, reduced } from '../test/users'
import { UsersPage } from './UsersPage'

const sara = makeListItem()
const omar = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000002', fullName: 'عمر خالد', email: 'omar@test.local', username: 'omar', phone: null, status: 'invited', roles: ['student'] })
/** Holds the custom role `librarian` of the fixture roles (API-022) besides a system role. */
const layla = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000004', fullName: 'ليلى حسن', email: 'layla@test.local', username: 'layla', roles: ['librarian', 'teacher'] })

/** The labels of the five system roles as the role filter lists them, in menu order. */
const SYSTEM_ROLE_OPTIONS = [ar.roles.admin, ar.roles.staff, ar.roles.teacher, ar.roles.guardian, ar.roles.student]

type RolesAnswer = RoleList | Response

/**
 * Serves GET /api/users from `pages` keyed by cursor ('first' = no cursor),
 * GET /api/users/:id from `detail`, GET /api/roles from `roles` (a function
 * gets the 1-based attempt and the request's signal, and may answer later) and
 * PUT /api/users/:id/roles with the detail holding the requested roles; records
 * every list query, every roles request and every PUT body for assertions.
 */
function mockUsersApi(
  pages: Record<string, UserList | Response>,
  detail: UserDetail = makeUserDetail(),
  roles: RolesAnswer | ((attempt: number, signal: AbortSignal | null | undefined) => RolesAnswer | Promise<RolesAnswer>) = makeRoleList(),
) {
  const queries: URLSearchParams[] = []
  const rolesRequests: string[] = []
  const puts: unknown[] = []
  const fetchMock = mockFetch(async (url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/roles' && method === 'GET') {
      rolesRequests.push(url)
      const answer = await (typeof roles === 'function' ? roles(rolesRequests.length, init?.signal) : roles)
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (parsed.pathname === '/api/users' && method === 'GET') {
      queries.push(parsed.searchParams)
      const page = pages[parsed.searchParams.get('cursor') ?? 'first']
      if (page instanceof Response) return page
      return page ? jsonResponse(200, page) : jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'bad cursor' })
    }
    if (parsed.pathname.startsWith('/api/users/') && method === 'GET') return jsonResponse(200, detail)
    if (parsed.pathname === `/api/users/${detail.id}/roles` && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { roleKeys: (keyof typeof ROLE_LABELS)[] }
      puts.push(body)
      return jsonResponse(200, { ...detail, roles: body.roleKeys.map((key) => ({ key, label: ROLE_LABELS[key] })) })
    }
    return jsonResponse(404, { statusCode: 404, code: 'user_not_found', message: 'User not found' })
  })
  return { queries, rolesRequests, puts, fetchMock, lastQuery: () => queries[queries.length - 1] }
}

/** A promise resolved from the test — an answer that arrives when the test says so. */
function later<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Opens the drawer of `name` from its row and its roles tab; resolves with the drawer. */
async function openRolesTab(name: string) {
  fireEvent.click(screen.getByLabelText(`${ar.common.view}: ${name}`))
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('heading', { level: 4, name })
  fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.roles }))
  return drawer
}

/** The option texts of the open roles dropdown of the drawer's tab. */
const OPEN_ROLE_OPTION = '.ant-select-dropdown .ant-select-item-option-content'

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

/** Opens the role filter and returns the texts of its options, in order — read from the open dropdown only (PR #62 review, note 2). */
async function roleFilterOptions() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.users.role }))
  await screen.findByText(ar.roles.admin, { selector: '.ant-select-item-option-content' })
  const open = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
  expect(open).toHaveLength(1)
  return Array.from(open[0]!.querySelectorAll('.ant-select-item-option-content'), (option) => option.textContent)
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

  it('hands the roles it read to the drawer: opening the roles tab asks GET /api/roles no second time (J-F23 — PR #62 review, note 1)', async () => {
    const detail = makeUserDetail({ id: sara.id, fullName: sara.fullName, roles: [{ key: 'teacher', label: ROLE_LABELS.teacher }], studentProfile: null, guardians: [] })
    const api = mockUsersApi({ first: makeUserList([layla, sara]) }, detail)
    renderPage()
    // Layla's custom role shows its server label once the page holds the roles.
    expect(await screen.findByText(ROLE_LABELS.librarian.ar)).toBeInTheDocument()
    expect(api.rolesRequests).toEqual(['/api/roles'])

    fireEvent.click(screen.getByLabelText(`${ar.common.view}: ${sara.fullName}`))
    const drawer = await screen.findByRole('dialog')
    await within(drawer).findByRole('heading', { level: 4, name: sara.fullName })
    fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.roles }))
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })
    fireEvent.mouseDown(select)
    expect(await screen.findByText(ROLE_LABELS.librarian.ar, { selector: '.ant-select-dropdown .ant-select-item-option-content' })).toBeInTheDocument()
    expect(api.rolesRequests).toEqual(['/api/roles'])
  })

  it('lets the roles tab read the roles itself when the page could not (J-F23 — the fallback)', async () => {
    const detail = makeUserDetail({ id: sara.id, fullName: sara.fullName, roles: [{ key: 'teacher', label: ROLE_LABELS.teacher }], studentProfile: null, guardians: [] })
    const api = mockUsersApi({ first: makeUserList([sara]) }, detail, (attempt) =>
      attempt === 1 ? jsonResponse(500, { statusCode: 500, message: 'Internal server error' }) : makeRoleList(),
    )
    renderPage()
    await screen.findByText(sara.fullName)
    await waitFor(() => expect(api.rolesRequests).toHaveLength(1))

    fireEvent.click(screen.getByLabelText(`${ar.common.view}: ${sara.fullName}`))
    const drawer = await screen.findByRole('dialog')
    await within(drawer).findByRole('heading', { level: 4, name: sara.fullName })
    fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.roles }))
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })
    expect(api.rolesRequests).toEqual(['/api/roles', '/api/roles'])
    fireEvent.mouseDown(select)
    expect(await screen.findByText(ROLE_LABELS.librarian.ar, { selector: '.ant-select-dropdown .ant-select-item-option-content' })).toBeInTheDocument()
  })

  it('drops the roles tab’s own read when the page’s roles arrive while it runs, and serves the tab from them (J-F23 race — the owner’s note 1 on #78)', async () => {
    const detail = makeUserDetail({ id: sara.id, fullName: sara.fullName })
    const pageRoles = later<RoleList>()
    const tabRoles = later<RoleList>()
    let tabSignal: AbortSignal | null | undefined
    const api = mockUsersApi({ first: makeUserList([layla, sara]) }, detail, (attempt, signal) => {
      if (attempt === 1) return pageRoles.promise
      tabSignal = signal
      return tabRoles.promise
    })
    renderPage()
    await screen.findByText(sara.fullName)

    // The page's read still runs, so the tab asks for the roles itself.
    const drawer = await openRolesTab(sara.fullName)
    await waitFor(() => expect(api.rolesRequests).toEqual(['/api/roles', '/api/roles']))
    expect(tabSignal?.aborted).toBe(false)

    await act(async () => pageRoles.resolve(makeRoleList()))
    // The page's roles serve the tab: its own request is aborted…
    expect(tabSignal?.aborted).toBe(true)
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })
    // …and its late answer changes nothing.
    await act(async () => tabRoles.resolve(makeRoleList([...ROLE_OPTIONS, REGISTRAR_ROLE])))
    fireEvent.mouseDown(select)
    expect(await screen.findByText(ROLE_LABELS.librarian.ar, { selector: OPEN_ROLE_OPTION })).toBeInTheDocument()
    expect(screen.queryByText(REGISTRAR_ROLE.label.ar, { selector: OPEN_ROLE_OPTION })).not.toBeInTheDocument()
    expect(api.rolesRequests).toHaveLength(2)
  })

  it('keeps the roles tab’s own list and the selection being made when the page’s roles arrive after it (J-F23 race — the owner’s note 1 on #78)', async () => {
    const detail = makeUserDetail({ id: sara.id, fullName: sara.fullName })
    const pageRoles = later<RoleList>()
    const api = mockUsersApi({ first: makeUserList([layla, sara]) }, detail, (attempt) => (attempt === 1 ? pageRoles.promise : makeRoleList()))
    renderPage()
    await screen.findByText(sara.fullName)

    const drawer = await openRolesTab(sara.fullName)
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })
    expect(api.rolesRequests).toEqual(['/api/roles', '/api/roles'])
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByText(ROLE_LABELS.teacher.ar, { selector: OPEN_ROLE_OPTION }))

    // The page's answer arrives (a list of its own): Layla's custom role gets its label in the list behind the drawer.
    await act(async () => pageRoles.resolve(makeRoleList()))
    const laylaRow = screen.getByLabelText(`${ar.common.view}: ${layla.fullName}`).closest('tr') as HTMLElement
    expect(within(laylaRow).getByText(ROLE_LABELS.librarian.ar)).toBeInTheDocument()

    // The tab kept its list, so the form was not reset: the save sends the selection made before.
    fireEvent.click(within(drawer).getByRole('button', { name: ar.users.rolesTab.save }))
    await waitFor(() => expect(api.puts).toEqual([{ roleKeys: ['student', 'teacher'] }]))
    expect(api.rolesRequests).toHaveLength(2)
  })

  it('reads the roles again with the refresh button: a role created meanwhile in /settings/roles gets its label and its place in the role filter (the owner’s note 2 on #78)', async () => {
    const nour = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000005', fullName: 'نور سالم', email: 'nour@test.local', username: 'nour', roles: ['registrar'] })
    const api = mockUsersApi({ first: makeUserList([nour, layla]) }, undefined, (attempt) => (attempt === 1 ? makeRoleList() : makeRoleList([...ROLE_OPTIONS, REGISTRAR_ROLE])))
    renderPage()
    const rowOf = (name: string) => screen.getByLabelText(`${ar.common.view}: ${name}`).closest('tr') as HTMLElement
    // The roles read when the page opened have landed (Layla's custom role has its label)…
    await waitFor(() => expect(within(rowOf(layla.fullName)).getByText(ROLE_LABELS.librarian.ar)).toBeInTheDocument())
    // …and the role created after them is not among them: the raw key.
    expect(within(rowOf(nour.fullName)).getByText('registrar')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(ar.users.refresh))

    await waitFor(() => expect(within(rowOf(nour.fullName)).getByText(REGISTRAR_ROLE.label.ar)).toBeInTheDocument())
    expect(api.rolesRequests).toEqual(['/api/roles', '/api/roles'])
    expect(api.queries).toHaveLength(2)
    expect(await roleFilterOptions()).toEqual([...SYSTEM_ROLE_OPTIONS, ROLE_LABELS.librarian.ar, REGISTRAR_ROLE.label.ar])
  })
})
