import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useLocation } from 'react-router'
import type { IssuedLink } from '../api/account'
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

/** The account the one-step form creates, and its one-time invitation (API-015). */
const CREATED_ID = '0192f0a0-0000-7000-8000-0000000000aa'
const TOKEN = 'tok_'.padEnd(43, 'q')
function issuedFor(userId: string): IssuedLink {
  return { userId, token: TOKEN, link: `/invite/${TOKEN}`, expiresAt: '2026-11-28T10:00:00.000Z', delivery: { transport: 'none', status: 'skipped' } }
}

/** The labels of the five system roles as the role filter lists them, in menu order. */
const SYSTEM_ROLE_OPTIONS = [ar.roles.admin, ar.roles.staff, ar.roles.teacher, ar.roles.guardian, ar.roles.student]

/**
 * Serves GET /api/users from `pages` keyed by cursor ('first' = no cursor),
 * GET /api/users/:id from `detail` and GET /api/roles from `roles`; records
 * every list query and every roles request for assertions.
 */
function mockUsersApi(
  pages: Record<string, UserList | Response>,
  detail: UserDetail = makeUserDetail(),
  roles: RoleList | Response | ((attempt: number) => RoleList | Response) = makeRoleList(),
  /** Answers the writes (POST …) it knows; anything it leaves undefined falls through to the 404 below. */
  writes?: (url: string, init: RequestInit | undefined) => Response | undefined,
) {
  const queries: URLSearchParams[] = []
  const rolesRequests: string[] = []
  const fetchMock = mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const written = method !== 'GET' ? writes?.(url, init) : undefined
    if (written) return written
    if (parsed.pathname === '/api/roles' && method === 'GET') {
      rolesRequests.push(url)
      const answer = typeof roles === 'function' ? roles(rolesRequests.length) : roles
      return answer instanceof Response ? answer : jsonResponse(200, answer)
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

/** The address's query string, to see that `?create=` is dropped once read (J-F59). */
function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>
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
    // «إضافة طالب» first and primary, «إضافة مدرس», then the less prominent «حساب آخر».
    const header = screen.getByRole('heading', { name: ar.users.title }).parentElement!.parentElement!
    const buttons = Array.from(header.querySelectorAll('button'), (button) => button.textContent?.trim())
    expect(buttons).toEqual([ar.users.addStudent, ar.users.addTeacher, ar.users.addOther])
    expect(screen.getByText(ar.users.addStudent).closest('button')).toHaveClass('ant-btn-primary')
    expect(screen.getByText(ar.users.addOther).closest('button')).not.toHaveClass('ant-btn-primary')
    expect(screen.getByRole('checkbox', { name: ar.users.includeDeleted })).toBeInTheDocument()
  })

  it('keeps the table in its own horizontal scroll box, so a phone never scrolls the page sideways (KI-094)', async () => {
    mockUsersApi({ first: makeUserList([sara, omar]) })
    renderPage()
    await screen.findByText(sara.fullName)

    // jsdom has no layout: assert the configuration. `scroll.x` makes antd wrap the table in a box of its own that
    // scrolls sideways; `x: true` keeps the table at the box's width whenever it fits (an unchanged desktop) —
    // 'max-content' would size it to its content and scroll a desktop table that is a few pixels too wide.
    const table = screen.getByRole('table')
    expect(table.closest('.ant-table')).toHaveClass('ant-table-scroll-horizontal')
    expect(table.style.width).toBe('auto')
    expect(table.style.minWidth).toBe('100%')
  })

  it('shows the e-mail, the user name and the phone each in a plain LTR isolate, so `+90…` never reads `…+` in Arabic (QA 2026-11-17)', async () => {
    mockUsersApi({ first: makeUserList([sara]) })
    renderPage()
    await screen.findByText(sara.fullName)

    const [row] = bodyRows()
    for (const value of [sara.email!, sara.username!, sara.phone!]) {
      const element = within(row!).getByText(value)
      // An antd Typography would beat `dir` with its `-rtl` class: the attribute sits on a plain <bdi> inside it.
      expect(element.tagName).toBe('BDI')
      expect(element).toHaveAttribute('dir', 'ltr')
    }
    expect(row!.querySelectorAll('.ant-typography[dir]')).toHaveLength(0)
  })

  it('shows the reduced projection without users.read_contact: no contact column, no add button, no deleted toggle', async () => {
    mockUsersApi({ first: makeUserList([reduced(sara)]) })
    renderPage(READ_ONLY_PERMISSIONS)

    expect(await screen.findByText(sara.fullName)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: ar.users.columns.contact })).not.toBeInTheDocument()
    expect(screen.queryByText('sara@test.local')).not.toBeInTheDocument()
    for (const add of [ar.users.addStudent, ar.users.addTeacher, ar.users.addOther]) expect(screen.queryByText(add)).not.toBeInTheDocument()
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

  it('opens the full wizard from «حساب آخر», offering staff and guardian only (staff first)', async () => {
    mockUsersApi({ first: makeUserList([]) })
    renderPage()
    await screen.findByText(ar.users.empty)

    await userEvent.click(screen.getByText(ar.users.addOther).closest('button')!)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.users.create.title)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: new RegExp(`^${ar.users.kinds.staff}`) })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: new RegExp(`^${ar.users.kinds.guardian}`) })).not.toBeChecked()
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2)
  })

  it('opens the one-step form from «إضافة طالب» and «إضافة مدرس»', async () => {
    mockUsersApi({ first: makeUserList([]) })
    renderPage()
    await screen.findByText(ar.users.empty)

    await userEvent.click(screen.getByText(ar.users.addTeacher).closest('button')!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.users.quick.title.teacher, { selector: '.ant-modal-title' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(ar.users.quick.fields.phone)).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
  })

  it('creates a student in one step, shows the invitation link once, then opens the new account and the newest list', async () => {
    const created = makeUserDetail({ id: CREATED_ID, fullName: 'عمر خالد', email: 'omar@test.local', username: null, status: 'invited', guardians: [] })
    const posts: { url: string; body: unknown }[] = []
    const api = mockUsersApi({ first: makeUserList([]) }, created, undefined, (url, init) => {
      posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === '/api/users') return jsonResponse(201, created)
      if (url === `/api/users/${CREATED_ID}/invitations`) return jsonResponse(201, issuedFor(CREATED_ID))
      return undefined
    })
    renderPage()
    await screen.findByText(ar.users.empty)
    const listRequests = api.queries.length

    await userEvent.click(screen.getByText(ar.users.addStudent).closest('button')!)
    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText(ar.users.fields.fullName), 'عمر خالد')
    await userEvent.type(within(form).getByLabelText(ar.users.fields.email), 'omar@test.local')
    await userEvent.click(within(form).getByText(ar.users.quick.submit.student, { selector: 'button span' }).closest('button')!)

    expect(await screen.findByText('تمت إضافة الطالب عمر خالد')).toBeInTheDocument()
    expect(posts).toEqual([
      { url: '/api/users', body: { kind: 'student', fullName: 'عمر خالد', email: 'omar@test.local' } },
      { url: `/api/users/${CREATED_ID}/invitations`, body: undefined },
    ])
    const link = await screen.findByLabelText(ar.account.issued.link)
    expect(link).toHaveValue(`${window.location.origin}/invite/${TOKEN}`)
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(listRequests))
    // The drawer waits until the link has been seen.
    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${CREATED_ID}`)).toBe(false)

    fireEvent.click(within(link.closest('[role="dialog"]') as HTMLElement).getByText(ar.account.issued.close).closest('button')!)

    await waitFor(() => expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${CREATED_ID}`)).toBe(true))
    expect(await screen.findByText(ar.users.detail.title)).toBeInTheDocument()
  })

  it('reports the account and a warning when the invitation fails, and opens the new account at once', async () => {
    const created = makeUserDetail({ id: CREATED_ID, fullName: 'سارة أحمد', email: 'sara@test.local', username: null, phone: '+966500000002', status: 'invited', studentProfile: null, guardians: [] })
    const api = mockUsersApi({ first: makeUserList([]) }, created, undefined, (url) => {
      if (url === '/api/users') return jsonResponse(201, created)
      if (url === `/api/users/${CREATED_ID}/invitations`) return jsonResponse(429, { statusCode: 429, code: 'rate_limited', message: 'Too many requests' })
      return undefined
    })
    renderPage()
    await screen.findByText(ar.users.empty)

    await userEvent.click(screen.getByText(ar.users.addTeacher).closest('button')!)
    const form = await screen.findByRole('dialog')
    await userEvent.type(within(form).getByLabelText(ar.users.fields.fullName), 'سارة أحمد')
    await userEvent.type(within(form).getByLabelText(ar.users.fields.email), 'sara@test.local')
    await userEvent.type(within(form).getByLabelText(ar.users.quick.fields.phone), '+966500000002')
    await userEvent.click(within(form).getByText(ar.users.quick.submit.teacher, { selector: 'button span' }).closest('button')!)

    expect(await screen.findByText('تمت إضافة المدرس سارة أحمد')).toBeInTheDocument()
    expect(
      await screen.findByText(ar.users.quick.invitationFailed.replace('{{reason}}', ar.users.errors.rate_limited)),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.account.issued.link)).not.toBeInTheDocument()
    await waitFor(() => expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${CREATED_ID}`)).toBe(true))
    expect(await screen.findByText(ar.users.detail.title)).toBeInTheDocument()
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

  it('opens the one-step form from ?create=student and ?create=teacher (the dashboard’s quick actions) and drops the parameter (J-F59)', async () => {
    mockUsersApi({ first: makeUserList([]) })
    const auth = makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) })
    const { unmount } = renderWithProviders(
      <>
        <UsersPage />
        <SearchProbe />
      </>,
      { auth, route: '/users?create=student' },
    )
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.users.quick.title.student, { selector: '.ant-modal-title' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(new RegExp(ar.users.quick.fields.backupPhone))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    unmount()

    renderWithProviders(
      <>
        <UsersPage />
        <SearchProbe />
      </>,
      { auth, route: '/users?create=teacher' },
    )
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.users.quick.title.teacher, { selector: '.ant-modal-title' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  })

  it('opens the wizard on the guardian kind from ?create=guardian', async () => {
    mockUsersApi({ first: makeUserList([]) })
    renderWithProviders(<UsersPage />, { auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }), route: '/users?create=guardian' })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: new RegExp(`^${ar.users.kinds.guardian}`) })).toBeChecked()
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2)
  })

  it('opens no wizard from ?create= without users.create or for an unknown kind, and drops the parameter either way (J-F59)', async () => {
    mockUsersApi({ first: makeUserList([]) })
    const { unmount } = renderWithProviders(
      <>
        <UsersPage />
        <SearchProbe />
      </>,
      { auth: makeAuth({ user: makeUser({ permissions: READ_ONLY_PERMISSIONS }) }), route: '/users?create=student' },
    )
    await screen.findByText(ar.users.empty)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    renderWithProviders(
      <>
        <UsersPage />
        <SearchProbe />
      </>,
      { auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }), route: '/users?create=admin' },
    )
    await screen.findByText(ar.users.empty)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
