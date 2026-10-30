// Account actions of the user drawer (MOD-03-T14): POST /api/users/:id/status and DELETE /api/users/:id.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail, READ_ONLY_PERMISSIONS, SUPPORT_PERMISSIONS } from '../test/users'
import { UserDrawer } from './UserDrawer'

interface Write {
  method: string
  url: string
  body: unknown
}

/** GET detail from `detail`; POST/DELETE recorded and answered by `reply` (default: the detail after the action). */
function mockStatusApi(detail: UserDetail, reply?: (write: Write) => Response) {
  const writes: Write[] = []
  let gets = 0
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      gets += 1
      return jsonResponse(200, detail)
    }
    const write: Write = { method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
    writes.push(write)
    if (reply) return reply(write)
    if (method === 'DELETE') return jsonResponse(200, { ...detail, status: 'archived', deletedAt: '2026-10-30T12:00:00.000Z' })
    const action = (write.body as { action: string }).action
    const status = action === 'suspend' ? 'suspended' : action === 'archive' ? 'archived' : 'active'
    return jsonResponse(200, { ...detail, status, lockedUntil: action === 'unlock' ? null : detail.lockedUntil })
  })
  return { fetchMock, writes, gets: () => gets }
}

function renderDrawer(detail: UserDetail, permissions: string[] = ADMIN_PERMISSIONS, selfId = 'user-1') {
  const onUpdated = vi.fn()
  renderWithProviders(<UserDrawer userId={detail.id} onClose={vi.fn()} onUpdated={onUpdated} />, {
    auth: makeAuth({ user: makeUser({ id: selfId, permissions }) }),
  })
  return { onUpdated }
}

async function drawerLoaded(detail: UserDetail) {
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 4, name: detail.fullName })
  return dialog
}

const menuButton = (dialog: HTMLElement) => within(dialog).queryByRole('button', { name: new RegExp(ar.users.status.menu) })

/** Opens the menu and returns the labels of its items. */
async function openMenu(dialog: HTMLElement) {
  await userEvent.click(menuButton(dialog) as HTMLElement)
  const menu = await screen.findByRole('menu')
  return { menu, labels: within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim()) }
}

type ActionKey = keyof typeof ar.users.status.actions

/**
 * Picks the action in the menu and returns the confirmation modal (found through
 * the action's hint). The menu item is clicked with fireEvent: the popup is still
 * animating in and carries `pointer-events: none`, which user-event refuses.
 */
async function chooseAction(dialog: HTMLElement, action: ActionKey) {
  const { menu } = await openMenu(dialog)
  fireEvent.click(within(menu).getByText(ar.users.status.actions[action]))
  const hint = await screen.findByText(ar.users.status.hints[action])
  return hint.closest('[role="dialog"]') as HTMLElement
}

describe('UserDrawer — account actions', () => {
  it('suspends with a reason after confirmation and shows the returned status', async () => {
    const detail = makeUserDetail({ status: 'active' })
    const api = mockStatusApi(detail)
    const { onUpdated } = renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    const modal = await chooseAction(dialog, 'suspend')
    expect(within(modal).getByText(`${ar.users.status.actions.suspend} — ${detail.fullName}`)).toBeInTheDocument()
    await userEvent.type(within(modal).getByLabelText(ar.users.status.reason), ' مخالفة السلوك ')
    expect(api.writes).toHaveLength(0)
    await userEvent.click(within(modal).getByRole('button', { name: ar.users.status.actions.suspend }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'POST', url: `/api/users/${detail.id}/status`, body: { action: 'suspend', reason: 'مخالفة السلوك' } })
    expect(await screen.findByText(ar.users.status.done.suspend)).toBeInTheDocument()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'suspended' }))
    expect(within(dialog).getByText(ar.labels.suspended)).toBeInTheDocument()
    // The menu follows the new state: a suspended account can be activated, not suspended again.
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.activate, ar.users.status.actions.archive, ar.users.status.actions.delete])
  })

  it('soft-deletes through DELETE without a body when no reason is given and marks the account deleted', async () => {
    const detail = makeUserDetail({ status: 'invited' })
    const api = mockStatusApi(detail)
    const { onUpdated } = renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.delete])
    const modal = await chooseAction(dialog, 'delete')
    await userEvent.click(within(modal).getByRole('button', { name: ar.users.status.actions.delete }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'DELETE', url: `/api/users/${detail.id}`, body: undefined })
    expect(await screen.findByText(ar.users.status.done.delete)).toBeInTheDocument()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived', deletedAt: '2026-10-30T12:00:00.000Z' }))
    expect(within(dialog).getByText(ar.users.deleted)).toBeInTheDocument()
    expect(menuButton(dialog)).not.toBeInTheDocument()
  })

  it('offers the actions by permission and state: unlock alone for support staff on a locked account, nothing for a reader', async () => {
    const locked = makeUserDetail({ status: 'active', lockedUntil: '2026-10-30T12:00:00.000Z' })
    const api = mockStatusApi(locked)
    const { unmount } = renderWithProviders(<UserDrawer userId={locked.id} onClose={vi.fn()} onUpdated={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: SUPPORT_PERMISSIONS }) }),
    })
    let dialog = await drawerLoaded(locked)
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.unlock])
    const modal = await chooseAction(dialog, 'unlock')
    await userEvent.click(within(modal).getByRole('button', { name: ar.users.status.actions.unlock }))
    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0].body).toEqual({ action: 'unlock' })
    unmount()

    mockStatusApi(locked)
    renderDrawer(locked, READ_ONLY_PERMISSIONS)
    dialog = await drawerLoaded(locked)
    expect(menuButton(dialog)).not.toBeInTheDocument()
  })

  it('never offers suspend, archive or delete on the signed-in user’s own account', async () => {
    const me = makeUserDetail({ status: 'active', lockedUntil: '2026-10-30T12:00:00.000Z' })
    mockStatusApi(me)
    renderDrawer(me, ADMIN_PERMISSIONS, me.id)
    const dialog = await drawerLoaded(me)

    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.unlock])
  })

  it('shows the dedicated last_admin message inside the confirmation (AC1) and keeps it open', async () => {
    const admin = makeUserDetail({ status: 'active', roles: [{ key: 'academy_admin', label: { ar: 'مدير الأكاديمية' } }] })
    const api = mockStatusApi(admin, () => jsonResponse(409, { statusCode: 409, code: 'last_admin', message: 'last admin' }))
    const { onUpdated } = renderDrawer(admin)
    const dialog = await drawerLoaded(admin)

    const modal = await chooseAction(dialog, 'archive')
    await userEvent.click(within(modal).getByRole('button', { name: ar.users.status.actions.archive }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(await within(modal).findByRole('alert')).toHaveTextContent(ar.users.errors.last_admin)
    expect(within(modal).getByText(ar.users.status.hints.archive)).toBeInTheDocument()
    expect(onUpdated).not.toHaveBeenCalled()
    expect(within(dialog).getByText(ar.labels.active)).toBeInTheDocument()
  })

  it('reloads the account when the server answers invalid_transition', async () => {
    const detail = makeUserDetail({ status: 'active' })
    const api = mockStatusApi(detail, () =>
      jsonResponse(409, { statusCode: 409, code: 'invalid_transition', message: 'no', from: 'suspended', action: 'suspend', allowed: ['activate', 'archive', 'delete'] }),
    )
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const getsBefore = api.gets()

    const modal = await chooseAction(dialog, 'suspend')
    await userEvent.click(within(modal).getByRole('button', { name: ar.users.status.actions.suspend }))

    expect(await within(modal).findByRole('alert')).toHaveTextContent(ar.users.errors.invalid_transition)
    await waitFor(() => expect(api.gets()).toBe(getsBefore + 1))
  })
})
