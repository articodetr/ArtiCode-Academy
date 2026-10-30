// Guardians / students tab of the user drawer (MOD-03-T14) on API-029..API-033.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GuardianLinkItem } from '../api/guardians'
import type { UserDetail, UserListItem } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeGuardianLinkItem, makeListItem, makeUserDetail, makeUserList } from '../test/users'
import { UserDrawer } from './UserDrawer'

interface Write {
  method: string
  url: string
  body: unknown
}

const LAYLA = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000007', fullName: 'ليلى حسن', email: 'layla@test.local', username: 'layla', roles: ['guardian'] })

interface ApiOptions {
  /** Items of GET …/guardians or …/students; may change between reads. */
  links?: () => GuardianLinkItem[]
  /** Items of the GET /api/users search. */
  candidates?: UserListItem[]
  /** Answers POST/PATCH/DELETE; default 201/200 with an item, 204 for DELETE. */
  reply?: (write: Write) => Response
}

function mockLinksApi(detail: UserDetail, options: ApiOptions = {}) {
  const writes: Write[] = []
  const searches: URLSearchParams[] = []
  let listReads = 0
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    if (method === 'GET') {
      if (parsed.pathname === '/api/users') {
        searches.push(parsed.searchParams)
        return jsonResponse(200, makeUserList(options.candidates ?? []))
      }
      if (parsed.pathname.endsWith('/guardians') || parsed.pathname.endsWith('/students')) {
        listReads += 1
        return jsonResponse(200, { items: options.links ? options.links() : [makeGuardianLinkItem()] })
      }
      return jsonResponse(200, detail)
    }
    const write: Write = { method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
    writes.push(write)
    if (options.reply) return options.reply(write)
    if (method === 'DELETE') return jsonResponse(204)
    return jsonResponse(method === 'POST' ? 201 : 200, makeGuardianLinkItem({ user: LAYLA, relationship: 'mother', isPrimary: true }))
  })
  return { fetchMock, writes, searches, listReads: () => listReads }
}

function renderDrawer(detail: UserDetail, permissions: string[] = ADMIN_PERMISSIONS) {
  renderWithProviders(<UserDrawer userId={detail.id} onClose={vi.fn()} onUpdated={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
  })
}

async function openTab(detail: UserDetail, tab: string) {
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 4, name: detail.fullName })
  await userEvent.click(within(dialog).getByRole('tab', { name: tab }))
  return dialog
}

const student = makeUserDetail()

describe('UserDrawer — guardians / students tab', () => {
  it('lists the guardians of a student with relationship, primary tag and contact, and offers link actions to guardians.link holders', async () => {
    const api = mockLinksApi(student)
    renderDrawer(student)
    const dialog = await openTab(student, ar.users.tabs.guardians)

    expect(await within(dialog).findByText('خالد محمود')).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${student.id}/guardians`)).toBe(true)
    expect(within(dialog).getByText(ar.users.detail.primary)).toBeInTheDocument()
    expect(within(dialog).getByText('khaled@test.local')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: `${ar.users.links.relationship}: خالد محمود` })).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.relationships.father)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: new RegExp(ar.users.links.add.guardians) })).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.links.unlink)).toBeInTheDocument()
    // The primary guardian has no "make primary" action.
    expect(within(dialog).queryByText(ar.users.links.setPrimary)).not.toBeInTheDocument()
  })

  it('links a guardian found through the role-filtered search and re-reads the list', async () => {
    const api = mockLinksApi(student, { candidates: [LAYLA] })
    renderDrawer(student)
    const dialog = await openTab(student, ar.users.tabs.guardians)
    await within(dialog).findByText('خالد محمود')

    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.users.links.add.guardians) }))
    const party = within(dialog).getByRole('combobox', { name: ar.users.links.party.guardians })
    fireEvent.mouseDown(party)
    fireEvent.change(party, { target: { value: 'ليلى' } })
    fireEvent.click(await screen.findByText('ليلى حسن', { selector: '.ant-select-item-option-content' }, { timeout: 3000 }))
    expect(Object.fromEntries(api.searches[0])).toEqual({ q: 'ليلى', role: 'guardian', limit: '10' })

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: ar.users.links.relationship }))
    fireEvent.click(await screen.findByText(ar.users.relationships.mother, { selector: '.ant-select-item-option-content' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: ar.users.links.isPrimary }))
    const readsBefore = api.listReads()
    await userEvent.click(within(dialog).getByRole('button', { name: ar.users.links.submit }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({
      method: 'POST',
      url: `/api/users/${student.id}/guardians`,
      body: { guardianId: LAYLA.id, relationship: 'mother', isPrimary: true },
    })
    expect(await screen.findByText(ar.users.links.linked)).toBeInTheDocument()
    await waitFor(() => expect(api.listReads()).toBe(readsBefore + 1))
    expect(within(dialog).queryByRole('combobox', { name: ar.users.links.party.guardians })).not.toBeInTheDocument()
  })

  it('refuses the same person and an already linked party locally, before any request (AC3)', async () => {
    const self = makeListItem({ id: student.id, fullName: student.fullName, roles: ['student', 'guardian'] })
    const khaled = makeGuardianLinkItem().user
    const api = mockLinksApi(student, { candidates: [self, khaled] })
    renderDrawer(student)
    const dialog = await openTab(student, ar.users.tabs.guardians)
    await within(dialog).findByText('خالد محمود')

    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.users.links.add.guardians) }))
    const party = within(dialog).getByRole('combobox', { name: ar.users.links.party.guardians })
    fireEvent.mouseDown(party)
    fireEvent.change(party, { target: { value: 'خا' } })
    const selfOption = (await screen.findByText(student.fullName, { selector: '.ant-select-item-option-content' }, { timeout: 3000 })).closest(
      '.ant-select-item',
    ) as HTMLElement
    expect(selfOption).toHaveClass('ant-select-item-option-disabled')
    expect(selfOption).toHaveAttribute('title', ar.users.links.samePerson)
    const linkedOption = screen.getByText('خالد محمود', { selector: '.ant-select-item-option-content' }).closest('.ant-select-item') as HTMLElement
    expect(linkedOption).toHaveClass('ant-select-item-option-disabled')
    expect(linkedOption).toHaveAttribute('title', ar.users.links.alreadyLinked)

    fireEvent.click(selfOption)
    await userEvent.click(within(dialog).getByRole('button', { name: ar.users.links.submit }))

    expect(await within(dialog).findAllByText(ar.users.links.required)).not.toHaveLength(0)
    expect(api.writes).toHaveLength(0)
  })

  it('makes a guardian primary and changes the relationship with the smallest PATCH', async () => {
    const second = makeGuardianLinkItem({ user: LAYLA, relationship: 'other', isPrimary: false, createdAt: '2026-10-30T11:00:00.000Z' })
    const api = mockLinksApi(student, { links: () => [makeGuardianLinkItem(), second] })
    renderDrawer(student)
    const dialog = await openTab(student, ar.users.tabs.guardians)
    await within(dialog).findByText('ليلى حسن')

    await userEvent.click(within(dialog).getByText(ar.users.links.setPrimary))
    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'PATCH', url: `/api/users/${student.id}/guardians/${LAYLA.id}`, body: { isPrimary: true } })
    expect(await screen.findByText(ar.users.links.updated)).toBeInTheDocument()

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: `${ar.users.links.relationship}: ليلى حسن` }))
    fireEvent.click(await screen.findByText(ar.users.relationships.legal_guardian, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.writes).toHaveLength(2))
    expect(api.writes[1]).toEqual({ method: 'PATCH', url: `/api/users/${student.id}/guardians/${LAYLA.id}`, body: { relationship: 'legal_guardian' } })
  })

  it('unlinks after confirmation with DELETE and reports a 409 already_linked from the server by its message', async () => {
    const api = mockLinksApi(student, {
      candidates: [LAYLA],
      reply: (write) => (write.method === 'POST' ? jsonResponse(409, { statusCode: 409, code: 'already_linked', message: 'linked' }) : jsonResponse(204)),
    })
    renderDrawer(student)
    const dialog = await openTab(student, ar.users.tabs.guardians)
    await within(dialog).findByText('خالد محمود')

    await userEvent.click(within(dialog).getByText(ar.users.links.unlink))
    expect(await screen.findByText(ar.users.links.unlinkConfirm.replace('{{name}}', 'خالد محمود'))).toBeInTheDocument()
    expect(api.writes).toHaveLength(0)
    const confirmButtons = screen.getAllByRole('button', { name: ar.users.links.unlink })
    await userEvent.click(confirmButtons[confirmButtons.length - 1])
    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'DELETE', url: `/api/users/${student.id}/guardians/${makeGuardianLinkItem().user.id}`, body: undefined })
    expect(await screen.findByText(ar.users.links.unlinked)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.users.links.add.guardians) }))
    const party = within(dialog).getByRole('combobox', { name: ar.users.links.party.guardians })
    fireEvent.mouseDown(party)
    fireEvent.change(party, { target: { value: 'ليلى' } })
    fireEvent.click(await screen.findByText('ليلى حسن', { selector: '.ant-select-item-option-content' }, { timeout: 3000 }))
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: ar.users.links.relationship }))
    fireEvent.click(await screen.findByText(ar.users.relationships.sibling, { selector: '.ant-select-item-option-content' }))
    await userEvent.click(within(dialog).getByRole('button', { name: ar.users.links.submit }))
    await waitFor(() => expect(api.writes).toHaveLength(2))
    expect(await within(dialog).findByText(ar.users.errors.already_linked)).toBeInTheDocument()
  })

  it('shows a guardian’s students and links a student through the student’s path with this guardian', async () => {
    const guardian = makeUserDetail({
      id: '0192f0a0-0000-7000-8000-000000000003',
      fullName: 'خالد محمود',
      roles: [{ key: 'guardian', label: { ar: 'ولي أمر' } }],
      studentProfile: null,
      guardians: [],
      students: [{ userId: student.id, fullName: student.fullName, displayName: null, relationship: 'father', isPrimary: true }],
    })
    const omarAsItem = makeGuardianLinkItem({ user: makeListItem({ id: student.id, fullName: student.fullName, roles: ['student'] }), relationship: 'father', isPrimary: true })
    const newStudent = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000008', fullName: 'نور خالد', roles: ['student'] })
    const api = mockLinksApi(guardian, { links: () => [omarAsItem], candidates: [newStudent] })
    renderDrawer(guardian)
    const dialog = await openTab(guardian, ar.users.tabs.students)

    expect(await within(dialog).findByText(student.fullName)).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === `/api/users/${guardian.id}/students`)).toBe(true)
    expect(within(dialog).queryByRole('tab', { name: ar.users.tabs.guardians })).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.users.links.add.students) }))
    const party = within(dialog).getByRole('combobox', { name: ar.users.links.party.students })
    fireEvent.mouseDown(party)
    fireEvent.change(party, { target: { value: 'نور' } })
    fireEvent.click(await screen.findByText('نور خالد', { selector: '.ant-select-item-option-content' }, { timeout: 3000 }))
    expect(api.searches[0].get('role')).toBe('student')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: ar.users.links.relationship }))
    fireEvent.click(await screen.findByText(ar.users.relationships.father, { selector: '.ant-select-item-option-content' }))
    await userEvent.click(within(dialog).getByRole('button', { name: ar.users.links.submit }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'POST', url: `/api/users/${newStudent.id}/guardians`, body: { guardianId: guardian.id, relationship: 'father' } })
  })

  it('is read-only without guardians.link: relationship as a tag, no add button, no row actions', async () => {
    mockLinksApi(student)
    renderDrawer(student, ['users.read', 'users.read_contact'])
    const dialog = await openTab(student, ar.users.tabs.guardians)

    expect(await within(dialog).findByText('خالد محمود')).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.relationships.father)).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.users.links.add.guardians) })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.links.unlink)).not.toBeInTheDocument()
  })
})
