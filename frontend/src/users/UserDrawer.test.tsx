import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeUserDetail, reduced } from '../test/users'
import { UserDrawer } from './UserDrawer'

/** GET returns `detail`; PATCH is answered by `patch` (default: echo the merged body). */
function mockDetailApi(detail: UserDetail | Response, patch?: (body: Record<string, unknown>) => Response) {
  const patches: Record<string, unknown>[] = []
  const fetchMock = mockFetch((_url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      patches.push(body)
      if (patch) return patch(body)
      const current = detail instanceof Response ? makeUserDetail() : detail
      return jsonResponse(200, { ...current, ...body })
    }
    if (detail instanceof Response) return detail
    return jsonResponse(200, detail)
  })
  return { fetchMock, patches }
}

function renderDrawer(permissions: string[] = ADMIN_PERMISSIONS, onUpdated = vi.fn()) {
  const utils = renderWithProviders(<UserDrawer userId={makeUserDetail().id} onClose={vi.fn()} onUpdated={onUpdated} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
  })
  return { ...utils, onUpdated }
}

async function startEditing() {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(ar.common.edit) }))
  return screen.getByRole('button', { name: ar.common.save })
}

describe('UserDrawer', () => {
  it('shows identity, localized roles, the student profile and activity for the full projection, with the roles and guardians tabs (T14)', async () => {
    mockDetailApi(makeUserDetail())
    renderDrawer()

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { level: 4, name: 'عمر خالد' })).toBeInTheDocument()
    expect(within(dialog).getByText('طالب')).toBeInTheDocument()
    expect(within(dialog).getByText(ar.labels.invited)).toBeInTheDocument()
    expect(within(dialog).getByText('omar@test.local')).toBeInTheDocument()
    expect(within(dialog).getByText('S-2026-001')).toBeInTheDocument()
    expect(within(dialog).getByText(ar.users.detail.notVerified)).toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.reducedHint)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: new RegExp(ar.common.edit) })).toBeInTheDocument()
    // Since T14 the links live in their own tab; a student gets the guardians tab, never the students tab.
    expect(within(dialog).getByRole('tab', { name: ar.users.tabs.details })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tab', { name: ar.users.tabs.roles })).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: ar.users.tabs.guardians })).toBeInTheDocument()
    expect(within(dialog).queryByRole('tab', { name: ar.users.tabs.students })).not.toBeInTheDocument()
    expect(within(dialog).queryByText('خالد محمود')).not.toBeInTheDocument()
  })

  it('shows the reduced projection without contact rows, the edit button only with users.update and the roles tab only with users.roles.assign', async () => {
    mockDetailApi(reduced(makeUserDetail()))
    renderDrawer(['users.read'])

    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('heading', { level: 4, name: 'عمر خالد' })
    expect(within(dialog).getByText(ar.users.reducedHint)).toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.fields.email)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(ar.users.detail.lastLoginAt)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.common.edit) })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('tab', { name: ar.users.tabs.roles })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: new RegExp(ar.users.status.menu) })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: ar.users.tabs.guardians })).toBeInTheDocument()
  })

  it('sends only the changed fields as PATCH, reports success and hands the updated detail back', async () => {
    const api = mockDetailApi(makeUserDetail({ phone: '+905551234567' }))
    const { onUpdated } = renderDrawer()
    const save = await startEditing()

    const displayName = screen.getByLabelText(ar.users.fields.displayName)
    await userEvent.type(displayName, 'عمر')
    await userEvent.clear(screen.getByLabelText(ar.users.fields.phone))
    await userEvent.click(save)

    await waitFor(() => expect(api.patches).toHaveLength(1))
    expect(api.patches[0]).toEqual({ displayName: 'عمر', phone: null })
    expect(await screen.findByText(ar.users.detail.saved)).toBeInTheDocument()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'عمر', phone: null }))
    // Back in view mode with the new display name on top.
    expect(await screen.findByRole('heading', { level: 4, name: 'عمر' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ar.common.save })).not.toBeInTheDocument()
  })

  it('does not call the server when nothing changed', async () => {
    const api = mockDetailApi(makeUserDetail())
    renderDrawer()
    const save = await startEditing()

    await userEvent.click(save)

    expect(await screen.findByText(ar.users.detail.nothingChanged)).toBeInTheDocument()
    expect(api.patches).toHaveLength(0)
    expect(screen.queryByRole('button', { name: ar.common.save })).not.toBeInTheDocument()
  })

  it('puts a 409 email_in_use on the e-mail field and stays in edit mode', async () => {
    const api = mockDetailApi(makeUserDetail(), () => jsonResponse(409, { statusCode: 409, code: 'email_in_use', message: 'taken' }))
    renderDrawer()
    const save = await startEditing()

    const email = screen.getByLabelText(ar.users.fields.email)
    await userEvent.clear(email)
    await userEvent.type(email, 'taken@test.local')
    await userEvent.click(save)

    expect(await screen.findByText(ar.users.errors.email_in_use)).toBeInTheDocument()
    expect(api.patches[0]).toEqual({ email: 'taken@test.local' })
    expect(screen.getByRole('button', { name: ar.common.save })).toBeInTheDocument()
  })

  it('validates locally before sending: an invalid username and no identifier are refused', async () => {
    const api = mockDetailApi(makeUserDetail())
    renderDrawer()
    const save = await startEditing()

    const username = screen.getByLabelText(ar.users.fields.username)
    await userEvent.clear(username)
    await userEvent.type(username, 'a b')
    await userEvent.click(save)
    expect(await screen.findByText(ar.users.validation.username)).toBeInTheDocument()

    await userEvent.clear(username)
    await userEvent.clear(screen.getByLabelText(ar.users.fields.email))
    await userEvent.click(save)
    expect(await screen.findAllByText(ar.users.validation.identifierRequired)).not.toHaveLength(0)
    expect(api.patches).toHaveLength(0)
  })

  it('shows the load failure for an unknown or deleted user', async () => {
    mockDetailApi(jsonResponse(404, { statusCode: 404, code: 'user_not_found', message: 'User not found' }))
    renderDrawer()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.users.detail.loadFailed)
    expect(alert).toHaveTextContent(ar.users.errors.user_not_found)
  })
})
