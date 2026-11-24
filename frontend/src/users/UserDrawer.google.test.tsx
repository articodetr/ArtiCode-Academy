// The Google link in the user drawer (PORTAL-04): the «الدخول عبر Google» row of the details tab (`googleLinkedAt`
// of API-013), «فك ربط حساب Google» in the account-actions menu (DELETE /api/users/:id/google-identity, whose answer
// is the detail) and no «activate» for a self-registration awaiting its owner (`awaitingRegistration`).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail, reduced, SUPPORT_PERMISSIONS } from '../test/users'
import { UserDrawer } from './UserDrawer'
import { formatDateTime } from './users.format'

const LINKED = '2026-11-20T08:00:00.000Z'
const LINKED_SINCE = ar.users.google.linkedSince.replace('{{date}}', formatDateTime(LINKED, 'ar'))
const unlink = ar.users.google.unlink

interface WriteCall {
  method: string
  url: string
  body: unknown
}

interface Server {
  /** What GET /api/users/:id answers right now. */
  read: () => Response
  writes: WriteCall[]
  gets: number
}

/**
 * GET answers `server.read()`; every other request is recorded and answered by `reply`. By default the unlink
 * succeeds and answers the detail without the link — as the server would.
 */
function mockGoogleApi(detail: UserDetail, reply?: (call: WriteCall, server: Server) => Response) {
  const server: Server = { read: () => jsonResponse(200, detail), writes: [], gets: 0 }
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      server.gets += 1
      return server.read()
    }
    const call: WriteCall = { method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
    server.writes.push(call)
    if (reply) return reply(call, server)
    const unlinked = { ...detail, googleLinkedAt: null, updatedAt: '2026-11-24T10:00:00.000Z' }
    server.read = () => jsonResponse(200, unlinked)
    return jsonResponse(200, unlinked)
  })
  return server
}

const refusal = (status: number, body: Record<string, unknown>) => jsonResponse(status, { statusCode: status, message: 'refused', ...body })

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

/** Opens the account-actions menu and returns the labels of its items (a divider is no item). */
async function openMenu(dialog: HTMLElement) {
  await userEvent.click(menuButton(dialog) as HTMLElement)
  const menu = await screen.findByRole('menu')
  return { menu, labels: within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim()) }
}

/** Picks «unlink» in the menu (fireEvent: the popup is still animating in) and returns its confirmation. */
async function chooseUnlink(dialog: HTMLElement) {
  const { menu } = await openMenu(dialog)
  fireEvent.click(within(menu).getByText(unlink.action))
  const hint = await screen.findByText(unlink.hint)
  return hint.closest('[role="dialog"]') as HTMLElement
}

const confirmButton = (modal: HTMLElement) => within(modal).getByText(unlink.confirm).closest('button') as HTMLButtonElement

const STATUS_ACTIONS = [ar.users.status.actions.suspend, ar.users.status.actions.archive, ar.users.status.actions.delete]

describe('UserDrawer — the Google row', () => {
  it('says since when a Google account is linked, and offers the unlink below the status actions', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    mockGoogleApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(ar.users.google.label)).toBeInTheDocument()
    expect(within(dialog).getByText(LINKED_SINCE)).toBeInTheDocument()
    const { menu, labels } = await openMenu(dialog)
    expect(labels).toEqual([...STATUS_ACTIONS, unlink.action])
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
  })

  it('shows no row and offers no unlink while none is linked', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: null })
    mockGoogleApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).queryByText(ar.users.google.label)).not.toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('shows no row without users.read_contact — null means unknown there — and offers no unlink on a guess', async () => {
    const detail = reduced(makeUserDetail({ status: 'active', googleLinkedAt: LINKED }))
    expect(detail.googleLinkedAt).toBeNull()
    mockGoogleApi(detail)
    renderDrawer(detail, ['users.read', 'users.update'])
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).queryByText(ar.users.google.label)).not.toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.unlock])
  })

  it('reads a detail from an older server (no field) as «none linked»', async () => {
    const { googleLinkedAt: _absent, awaitingRegistration: _flag, ...older } = makeUserDetail({ status: 'active' })
    mockGoogleApi(older as UserDetail)
    renderDrawer(older as UserDetail)
    const dialog = await drawerLoaded(older as UserDetail)

    expect(within(dialog).queryByText(ar.users.google.label)).not.toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })
})

describe('UserDrawer — who is offered the unlink', () => {
  it('is the only menu item for support staff with the reset of two-step verification beside it when that is on', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED, mfaEnabledAt: '2026-11-01T08:00:00.000Z' })
    mockGoogleApi(detail)
    renderDrawer(detail, SUPPORT_PERMISSIONS)
    const dialog = await drawerLoaded(detail)

    const { menu, labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.mfa.reset.action, unlink.action])
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
  })

  it('is not offered without users.update, whatever else the viewer holds', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    mockGoogleApi(detail)
    renderDrawer(detail, ['users.read', 'users.read_contact', 'users.deactivate'])
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(LINKED_SINCE)).toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('is offered on the signed-in user’s own account too (the server allows it)', async () => {
    const me = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    mockGoogleApi(me)
    renderDrawer(me, ADMIN_PERMISSIONS, me.id)
    const dialog = await drawerLoaded(me)

    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([unlink.action])
  })

  it('is not offered on a soft-deleted account', async () => {
    const gone = makeUserDetail({ status: 'archived', deletedAt: '2026-11-21T10:00:00.000Z', googleLinkedAt: LINKED })
    mockGoogleApi(gone)
    renderDrawer(gone)
    const dialog = await drawerLoaded(gone)

    expect(menuButton(dialog)).not.toBeInTheDocument()
  })
})

describe('UserDrawer — unlinking the Google account', () => {
  it('explains, sends one DELETE without a body and shows the detail of the answer without a re-read', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    const server = mockGoogleApi(detail)
    const { onUpdated } = renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseUnlink(dialog)
    expect(within(modal).getByText(`${unlink.action} — ${detail.fullName}`)).toBeInTheDocument()
    expect(within(modal).getByText(unlink.noPassword)).toBeInTheDocument()
    expect(server.writes).toHaveLength(0)
    await userEvent.click(confirmButton(modal))

    await waitFor(() => expect(server.writes).toHaveLength(1))
    expect(server.writes[0]).toEqual({ method: 'DELETE', url: `/api/users/${detail.id}/google-identity`, body: undefined })
    expect(await screen.findByText(unlink.done)).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).queryByText(LINKED_SINCE)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText(unlink.hint)).not.toBeInTheDocument())
    // The answer is the detail: it is shown and handed to the list, and nothing is read again.
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: detail.id, googleLinkedAt: null }))
    expect(server.gets).toBe(readsBefore)
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    const server = mockGoogleApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    const modal = await chooseUnlink(dialog)
    await userEvent.click(within(modal).getByText(ar.common.cancel).closest('button') as HTMLElement)
    await waitFor(() => expect(screen.queryByText(unlink.hint)).not.toBeInTheDocument())
    expect(server.writes).toHaveLength(0)
    expect(within(dialog).getByText(LINKED_SINCE)).toBeInTheDocument()
  })

  it('words permission_denied inside the confirmation, keeps it open and changes nothing', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    const server = mockGoogleApi(detail, () => refusal(403, { code: 'permission_denied', missing: ['users.deactivate'] }))
    const { onUpdated } = renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseUnlink(dialog)
    await userEvent.click(confirmButton(modal))

    expect(await within(modal).findByText(/users\.deactivate/)).toBeInTheDocument()
    expect(within(modal).getByText(unlink.hint)).toBeInTheDocument()
    expect(onUpdated).not.toHaveBeenCalled()
    expect(server.gets).toBe(readsBefore)
    expect(within(dialog).getByText(LINKED_SINCE)).toBeInTheDocument()
  })

  it('re-reads the detail when the account is gone (user_not_found) while the message stays', async () => {
    const detail = makeUserDetail({ status: 'active', googleLinkedAt: LINKED })
    const server = mockGoogleApi(detail, () => refusal(404, { code: 'user_not_found' }))
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseUnlink(dialog)
    await userEvent.click(confirmButton(modal))

    expect(await within(modal).findByText(ar.users.errors.user_not_found)).toBeInTheDocument()
    await waitFor(() => expect(server.gets).toBe(readsBefore + 1))
  })
})

describe('UserDrawer — a self-registration awaiting its owner', () => {
  it('offers no «activate» on it (the server answers 409), only the delete', async () => {
    const detail = makeUserDetail({ status: 'pending', awaitingRegistration: true })
    mockGoogleApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.delete])
  })

  it('keeps «activate» on a pending account that is not one', async () => {
    const detail = makeUserDetail({ status: 'pending', awaitingRegistration: false })
    mockGoogleApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.activate, ar.users.status.actions.delete])
  })
})
