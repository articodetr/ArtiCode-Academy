// Two-step verification in the user drawer (MFA-T04): the «التحقق بخطوتين» row of
// the details tab (`mfaEnabledAt` of API-013) and the administrative reset
// through POST /api/users/:id/mfa/reset (API-212).
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

const ON = '2026-11-01T08:00:00.000Z'
const ENABLED_SINCE = ar.users.mfa.enabledSince.replace('{{date}}', formatDateTime(ON, 'ar'))
const sessionsEnded = (count: number) => ar.users.mfa.reset.done.replace('{{sessions}}', String(count))

interface ResetCall {
  method: string
  url: string
  body: unknown
}

interface Server {
  /** What GET /api/users/:id answers right now. */
  read: () => Response
  resets: ResetCall[]
  gets: number
}

/**
 * GET answers `server.read()`; every other request is recorded and answered by
 * `reply`. By default the reset succeeds, ends three sessions and the next read
 * shows two-step verification off — as the server would.
 */
function mockMfaApi(detail: UserDetail, reply?: (call: ResetCall, server: Server) => Response) {
  const server: Server = { read: () => jsonResponse(200, detail), resets: [], gets: 0 }
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      server.gets += 1
      return server.read()
    }
    const call: ResetCall = { method, url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
    server.resets.push(call)
    if (reply) return reply(call, server)
    server.read = () => jsonResponse(200, { ...detail, mfaEnabledAt: null })
    return jsonResponse(200, { userId: detail.id, reset: true, revokedSessions: 3 })
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

/**
 * Picks «reset two-step verification» in the menu and returns its confirmation
 * (found through the explanation). The item is clicked with fireEvent: the popup
 * is still animating in and carries `pointer-events: none`.
 */
async function chooseReset(dialog: HTMLElement) {
  const { menu } = await openMenu(dialog)
  fireEvent.click(within(menu).getByText(ar.users.mfa.reset.action))
  const hint = await screen.findByText(ar.users.mfa.reset.hint)
  return hint.closest('[role="dialog"]') as HTMLElement
}

const confirmButton = (modal: HTMLElement) => within(modal).getByText(ar.users.mfa.reset.confirm).closest('button') as HTMLButtonElement

/** antd clears a button's loading state in an effect after the render: a click in that gap is ignored. */
const settled = (button: HTMLElement) => waitFor(() => expect(button).not.toHaveClass('ant-btn-loading'))

const STATUS_ACTIONS = [ar.users.status.actions.suspend, ar.users.status.actions.archive, ar.users.status.actions.delete]

describe('UserDrawer — the two-step verification row', () => {
  it('says since when it is on, and offers the reset to a holder of users.update on somebody else’s account', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    mockMfaApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(ar.users.mfa.label)).toBeInTheDocument()
    expect(within(dialog).getByText(ENABLED_SINCE)).toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.mfa.disabled)).not.toBeInTheDocument()
    // The reset closes the menu, after the status actions.
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([...STATUS_ACTIONS, ar.users.mfa.reset.action])
  })

  it('says «off» to a viewer of the full projection, and then offers no reset', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: null })
    mockMfaApi(detail)
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(ar.users.mfa.label)).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.mfa.disabled)).toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('shows no row at all without users.read_contact — null means unknown there, never «off» — and offers no reset on a guess', async () => {
    // The server sends null to this viewer even though the account has two-step verification on.
    const detail = reduced(makeUserDetail({ status: 'active', mfaEnabledAt: ON }))
    expect(detail.mfaEnabledAt).toBeNull()
    mockMfaApi(detail)
    renderDrawer(detail, ['users.read', 'users.update'])
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(ar.users.reducedHint)).toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.mfa.label)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.mfa.disabled)).not.toBeInTheDocument()
    // `unlock` stays offered on a guess (a harmless no-op); the reset does not.
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.status.actions.unlock])
  })
})

describe('UserDrawer — who is offered the two-step verification reset', () => {
  it('is the only menu item for support staff (users.update without users.deactivate)', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    mockMfaApi(detail)
    renderDrawer(detail, SUPPORT_PERMISSIONS)
    const dialog = await drawerLoaded(detail)

    const { menu, labels } = await openMenu(dialog)
    expect(labels).toEqual([ar.users.mfa.reset.action])
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
  })

  it('is not offered without users.update, whatever else the viewer holds', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    mockMfaApi(detail)
    renderDrawer(detail, ['users.read', 'users.read_contact', 'users.deactivate'])
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).getByText(ENABLED_SINCE)).toBeInTheDocument()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('is never offered on the signed-in user’s own account: the row shows, the menu does not', async () => {
    const me = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    mockMfaApi(me)
    renderDrawer(me, ADMIN_PERMISSIONS, me.id)
    const dialog = await drawerLoaded(me)

    expect(within(dialog).getByText(ENABLED_SINCE)).toBeInTheDocument()
    // Nothing else applies to one's own unlocked account either, so the whole menu is absent.
    expect(menuButton(dialog)).not.toBeInTheDocument()
  })
})

describe('UserDrawer — resetting two-step verification (API-212)', () => {
  it('explains, sends one POST with the trimmed reason, names the sessions ended and re-reads the detail', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    const server = mockMfaApi(detail)
    const { onUpdated } = renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseReset(dialog)
    expect(within(modal).getByText(`${ar.users.mfa.reset.action} — ${detail.fullName}`)).toBeInTheDocument()
    expect(within(modal).getByText(ar.users.mfa.reset.verify)).toBeInTheDocument()
    expect(within(modal).getByText(ar.users.status.reasonHint)).toBeInTheDocument()
    await userEvent.type(within(modal).getByLabelText(ar.users.status.reason), ' فقد هاتفه ')
    expect(server.resets).toHaveLength(0)
    await userEvent.click(confirmButton(modal))

    await waitFor(() => expect(server.resets).toHaveLength(1))
    expect(server.resets[0]).toEqual({ method: 'POST', url: `/api/users/${detail.id}/mfa/reset`, body: { reason: 'فقد هاتفه' } })
    expect(await screen.findByText(sessionsEnded(3))).toBeInTheDocument()
    // API-212 answers no detail: the row comes from a new read, and the confirmation is gone.
    await waitFor(() => expect(server.gets).toBe(readsBefore + 1))
    expect(await within(dialog).findByText(ar.users.mfa.disabled)).toBeInTheDocument()
    expect(within(dialog).queryByText(ENABLED_SINCE)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.users.mfa.reset.hint)).not.toBeInTheDocument()
    // The list row carries no two-step verification state: nothing is handed to it.
    expect(onUpdated).not.toHaveBeenCalled()
    const { labels } = await openMenu(dialog)
    expect(labels).toEqual(STATUS_ACTIONS)
  })

  it('sends no body without a reason, starts every confirmation with an empty reason, and words a reset that ended no session', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    const server = mockMfaApi(detail, (_call, api) => {
      api.read = () => jsonResponse(200, { ...detail, mfaEnabledAt: null })
      return jsonResponse(200, { userId: detail.id, reset: true, revokedSessions: 0 })
    })
    renderDrawer(detail, SUPPORT_PERMISSIONS)
    const dialog = await drawerLoaded(detail)

    // A cancelled confirmation sends nothing and leaves nothing behind (KI-049).
    let modal = await chooseReset(dialog)
    await userEvent.type(within(modal).getByLabelText(ar.users.status.reason), 'مسودة')
    await userEvent.click(within(modal).getByText(ar.common.cancel).closest('button') as HTMLElement)
    await waitFor(() => expect(screen.queryByText(ar.users.mfa.reset.hint)).not.toBeInTheDocument())
    expect(server.resets).toHaveLength(0)

    modal = await chooseReset(dialog)
    expect(within(modal).getByLabelText(ar.users.status.reason)).toHaveValue('')
    await userEvent.click(confirmButton(modal))

    await waitFor(() => expect(server.resets).toHaveLength(1))
    expect(server.resets[0]).toEqual({ method: 'POST', url: `/api/users/${detail.id}/mfa/reset`, body: undefined })
    expect(await screen.findByText(ar.users.mfa.reset.doneNoSessions)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.users.mfa.disabled)).toBeInTheDocument()
    // Support staff had this one action: with nothing left to reset the menu is gone.
    await waitFor(() => expect(menuButton(dialog)).not.toBeInTheDocument())
  })

  it('tells the administrator when nothing was on any more (reset: false) and re-reads the detail', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    const server = mockMfaApi(detail, (_call, api) => {
      // The user turned it off themself in the meantime.
      api.read = () => jsonResponse(200, { ...detail, mfaEnabledAt: null })
      return jsonResponse(200, { userId: detail.id, reset: false, revokedSessions: 0 })
    })
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseReset(dialog)
    await userEvent.click(confirmButton(modal))

    expect(await screen.findByText(ar.users.mfa.reset.notEnabled)).toBeInTheDocument()
    expect(screen.queryByText(ar.users.mfa.reset.doneNoSessions)).not.toBeInTheDocument()
    await waitFor(() => expect(server.gets).toBe(readsBefore + 1))
    expect(await within(dialog).findByText(ar.users.mfa.disabled)).toBeInTheDocument()
    expect(screen.queryByText(ar.users.mfa.reset.hint)).not.toBeInTheDocument()
  })

  it('words self_forbidden and permission_denied inside the confirmation, keeps it open and changes nothing', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    const server = mockMfaApi(detail, (_call, api) =>
      api.resets.length === 1
        ? refusal(403, { code: 'self_forbidden', action: 'mfa_reset' })
        : refusal(403, { code: 'permission_denied', missing: ['roles.manage', 'users.deactivate'] }),
    )
    renderDrawer(detail, SUPPORT_PERMISSIONS)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseReset(dialog)
    const confirm = confirmButton(modal)
    await userEvent.click(confirm)
    expect(await within(modal).findByText(ar.users.errors.self_forbidden_mfa)).toBeInTheDocument()
    // Never the status wording of the same code, never the raw code.
    expect(within(modal).queryByText(ar.users.errors.self_forbidden)).not.toBeInTheDocument()
    expect(within(modal).queryByText(/self_forbidden|mfa_reset/)).not.toBeInTheDocument()

    // SEC-R-15: the account's roles confer permissions the caller lacks — the wording of the other user actions.
    await settled(confirm)
    await userEvent.click(confirm)
    await waitFor(() => expect(server.resets).toHaveLength(2))
    expect(await within(modal).findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (roles.manage, users.deactivate)')).toBeInTheDocument()
    expect(within(modal).queryByText(ar.users.errors.self_forbidden_mfa)).not.toBeInTheDocument()

    expect(within(modal).getByText(ar.users.mfa.reset.hint)).toBeInTheDocument()
    expect(server.gets).toBe(readsBefore)
    expect(within(dialog).getByText(ENABLED_SINCE)).toBeInTheDocument()
  })

  it('re-reads an account that is gone (user_not_found): the drawer shows the load failure instead of the confirmation', async () => {
    const detail = makeUserDetail({ status: 'active', mfaEnabledAt: ON })
    const gone = () => refusal(404, { code: 'user_not_found' })
    const server = mockMfaApi(detail, (_call, api) => {
      api.read = gone
      return gone()
    })
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)
    const readsBefore = server.gets

    const modal = await chooseReset(dialog)
    await userEvent.click(confirmButton(modal))

    await waitFor(() => expect(server.gets).toBe(readsBefore + 1))
    const failure = (await within(dialog).findByText(ar.users.detail.loadFailed)).closest('[role="alert"]') as HTMLElement
    expect(failure).toHaveTextContent(ar.users.errors.user_not_found)
    expect(screen.queryByText(ar.users.mfa.reset.hint)).not.toBeInTheDocument()
    expect(menuButton(dialog)).not.toBeInTheDocument()
  })
})
