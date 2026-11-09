// KI-054 (J-F23): while an editor of the user drawer holds unsaved work — a change
// in the edit form, a roles selection that differs from the held roles, a party
// picked in a link form — Escape and a mask click no longer close the drawer, and
// the close button asks before discarding it. An editor opened without a change,
// or changed back, holds nothing (the J-F21 rule of the class drawer).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeGuardianLinkItem, makeListItem, makeRoleList, makeUserDetail, makeUserList } from '../test/users'
import { UserDrawer } from './UserDrawer'

const student = makeUserDetail()
const LAYLA = makeListItem({ id: '0192f0a0-0000-7000-8000-000000000007', fullName: 'ليلى حسن', email: 'layla@test.local', username: 'layla', roles: ['guardian'] })

/** The detail, the roles, the student's guardians and the guardian search (Layla); every write is recorded and refused. */
function mockDrawerApi(detail: UserDetail = student) {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push(`${method} ${pathname}`)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === '/api/roles') return jsonResponse(200, makeRoleList())
    if (pathname === '/api/users') return jsonResponse(200, makeUserList([LAYLA]))
    if (pathname.endsWith('/guardians')) return jsonResponse(200, { items: [makeGuardianLinkItem()] })
    return jsonResponse(200, detail)
  })
  return { writes }
}

function renderDrawer(detail: UserDetail = student) {
  const onClose = vi.fn()
  renderWithProviders(<UserDrawer userId={detail.id} onClose={onClose} onUpdated={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }),
  })
  return { onClose }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while an editor holds unsaved work: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

async function openDrawer() {
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('heading', { level: 4, name: student.fullName })
  return drawer
}

async function startEditing(drawer: HTMLElement) {
  fireEvent.click(within(drawer).getByText(ar.common.edit).closest('button')!)
  return within(drawer).findByLabelText(ar.users.fields.displayName)
}

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  fireEvent.click(closeButton())
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('UserDrawer — unsaved editors (KI-054)', () => {
  it('closes at once on Escape, on a mask click and with the close button while nothing is unsaved (as before)', async () => {
    mockDrawerApi()
    const { onClose } = renderDrawer()
    await openDrawer()

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(mask())
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps the edit form and its draft on Escape and on a mask click; the close button asks — cancel stays, confirm closes', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    const drawer = await openDrawer()
    const displayName = await startEditing(drawer)
    await userEvent.type(displayName, 'عمر')

    pressEscape()
    pressEscape()
    fireEvent.click(mask())
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(within(drawer).getByLabelText(ar.users.fields.displayName)).toHaveValue('عمر')

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(within(drawer).getByLabelText(ar.users.fields.displayName)).toHaveValue('عمر'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('holds nothing while the edit form is open without a change, and lets go of a change typed back', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    const drawer = await openDrawer()
    const displayName = await startEditing(drawer)

    // Opened, nothing typed: Escape closes at once.
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)

    // Typed, then typed back to the stored (empty) value: nothing is left to lose.
    await userEvent.type(displayName, 'ع')
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.clear(displayName)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(2)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('keeps a roles selection that differs from the held roles; the roles tab opened without a change holds nothing', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.roles }))
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)

    // A change without opening the popup: the held «طالب» tag is removed.
    const tag = select.closest('.ant-select')!.querySelector<HTMLElement>('.ant-select-selection-item-remove')!
    fireEvent.click(tag)
    await waitFor(() => expect(select.closest('.ant-select')!.querySelector('.ant-select-selection-item')).toBeNull())

    pressEscape()
    pressEscape()
    fireEvent.click(mask())
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()

    const dialog = await openDiscardDialog()
    fireEvent.click(within(dialog).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
    expect(writes).toEqual([])
  })

  it('lets go of a roles selection changed back to the held roles: the close button closes without asking', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.roles }))
    const select = await within(drawer).findByRole('combobox', { name: ar.users.rolesTab.label })

    fireEvent.click(select.closest('.ant-select')!.querySelector<HTMLElement>('.ant-select-selection-item-remove')!)
    await waitFor(() => expect(select.closest('.ant-select')!.querySelector('.ant-select-selection-item')).toBeNull())
    fireEvent.click(mask())
    expect(onClose).not.toHaveBeenCalled()

    // «طالب» picked again: the selection is the held one. (The open popup would take Escape in jsdom — the close button proves it.)
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByText(ar.roles.student, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(select.closest('.ant-select')!.querySelector('.ant-select-selection-item')).not.toBeNull())
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('counts a guardian picked in the link form as unsaved: the mask keeps the drawer and the close button asks; the form cancelled, it closes at once', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = renderDrawer()
    const drawer = await openDrawer()
    fireEvent.click(within(drawer).getByRole('tab', { name: ar.users.tabs.guardians }))
    fireEvent.click((await within(drawer).findByText(ar.users.links.add.guardians)).closest('button')!)

    // The open form alone holds nothing.
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()

    const party = within(drawer).getByRole('combobox', { name: ar.users.links.party.guardians })
    fireEvent.mouseDown(party)
    fireEvent.change(party, { target: { value: 'ليلى' } })
    fireEvent.click(await screen.findByText('ليلى حسن', { selector: '.ant-select-item-option-content' }, { timeout: 3000 }))

    // No Escape here: jsdom never ends the closing animation of the search popup, which so stays on
    // top of the Escape stack and takes the key itself (in a browser it leaves within ~0.2 s). The
    // Escape path is proven by the other editors; the mask and the close button prove the report.
    fireEvent.click(mask())
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    const dialog = await openDiscardDialog()
    fireEvent.click(within(dialog).getByText(ar.common.unsaved.cancel).closest('button')!)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(within(drawer).getByText(ar.common.cancel, { selector: 'button span' }).closest('button')!)
    await waitFor(() => expect(within(drawer).queryByRole('combobox', { name: ar.users.links.party.guardians })).not.toBeInTheDocument())
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(writes).toEqual([])
  })
})
