// One-time invitation / reset links issued from the user drawer (MOD-03-T12).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssuedLink } from '../api/account'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail } from '../test/users'
import { UserDrawer } from './UserDrawer'

const TOKEN = 'tok_'.padEnd(43, 'x')

function makeIssued(kind: 'invite' | 'reset-password', userId: string): IssuedLink {
  return {
    userId,
    token: TOKEN,
    link: `/${kind}/${TOKEN}`,
    expiresAt: '2026-11-01T10:00:00.000Z',
    delivery: { transport: 'none', status: 'skipped' },
  }
}

/** GET returns `detail`; a POST is answered by `post`. */
function mockDrawerApi(detail: UserDetail, post: (url: string) => Response) {
  return mockFetch((url, init) => ((init?.method ?? 'GET') === 'POST' ? post(url) : jsonResponse(200, detail)))
}

function renderDrawer(detail: UserDetail, permissions: string[] = ADMIN_PERMISSIONS) {
  return renderWithProviders(<UserDrawer userId={detail.id} onClose={vi.fn()} onUpdated={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
  })
}

async function drawerLoaded(detail: UserDetail) {
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 4, name: detail.fullName })
  return dialog
}

describe('UserDrawer — one-time links', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  it('issues an invitation link for an invited account and shows it once with copy, expiry and delivery', async () => {
    const detail = makeUserDetail({ status: 'invited' })
    const fetchMock = mockDrawerApi(detail, () => jsonResponse(201, makeIssued('invite', detail.id)))
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.reset.button) })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.account.issued.invitation.button) }))

    const link = await screen.findByLabelText(ar.account.issued.link)
    const expected = `${window.location.origin}/invite/${TOKEN}`
    expect(link).toHaveValue(expected)
    expect(screen.getByText(ar.account.issued.invitation.title)).toBeInTheDocument()
    expect(screen.getByText(ar.account.issued.onceHint)).toBeInTheDocument()
    expect(screen.getByText(ar.account.issued.expiresAt)).toBeInTheDocument()
    expect(screen.getByText(ar.account.issued.delivery.skipped)).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe(`/api/users/${detail.id}/invitations`)
    expect(post?.[1]?.body).toBeUndefined()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ar.account.issued.copy) }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected))
  })

  it('issues a reset link for an active account after confirmation', async () => {
    const detail = makeUserDetail({ status: 'active' })
    const fetchMock = mockDrawerApi(detail, () => jsonResponse(201, makeIssued('reset-password', detail.id)))
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.invitation.button) })).not.toBeInTheDocument()
    const trigger = within(dialog).getByRole('button', { name: new RegExp(ar.account.issued.reset.button) })
    await userEvent.click(trigger)

    expect(await screen.findByText(ar.account.issued.reset.confirm)).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)

    const ok = screen.getAllByRole('button', { name: ar.account.issued.reset.button }).find((button) => button !== trigger)
    await userEvent.click(ok as HTMLElement)

    expect(await screen.findByLabelText(ar.account.issued.link)).toHaveValue(`${window.location.origin}/reset-password/${TOKEN}`)
    expect(screen.getByText(ar.account.issued.reset.title)).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe(`/api/users/${detail.id}/password-reset`)
  })

  it('shows neither button without the issuing permission or for a status the link cannot serve', async () => {
    const invited = makeUserDetail({ status: 'invited' })
    mockDrawerApi(invited, () => jsonResponse(500))
    const { unmount } = renderDrawer(invited, ['users.read', 'users.read_contact', 'users.update'])
    let dialog = await drawerLoaded(invited)
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.invitation.button) })).not.toBeInTheDocument()
    // `users.update` alone would allow a reset link — not for an invited account.
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.reset.button) })).not.toBeInTheDocument()
    unmount()

    const suspended = makeUserDetail({ status: 'suspended' })
    mockDrawerApi(suspended, () => jsonResponse(500))
    renderDrawer(suspended)
    dialog = await drawerLoaded(suspended)
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.invitation.button) })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.account.issued.reset.button) })).not.toBeInTheDocument()
  })

  it('reports a refused issue by its code and keeps the drawer usable', async () => {
    const detail = makeUserDetail({ status: 'invited' })
    mockDrawerApi(detail, () => jsonResponse(409, { statusCode: 409, code: 'user_not_invitable', status: 'active' }))
    renderDrawer(detail)
    const dialog = await drawerLoaded(detail)

    await userEvent.click(within(dialog).getByRole('button', { name: new RegExp(ar.account.issued.invitation.button) }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(ar.users.errors.user_not_invitable)
    expect(screen.queryByLabelText(ar.account.issued.link)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: new RegExp(ar.account.issued.invitation.button) })).toBeEnabled()
  })
})
