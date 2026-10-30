// Roles tab of the user drawer (MOD-03-T14): PUT /api/users/:id/roles as a full set.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { UserDetail } from '../api/users'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, LIMITED_ASSIGNER_PERMISSIONS, makeRoleList, makeUserDetail, ROLE_LABELS } from '../test/users'
import { UserDrawer } from './UserDrawer'

type RoleKey = keyof typeof ROLE_LABELS

const role = (key: RoleKey) => ({ key, label: ROLE_LABELS[key] })

/** GET detail / GET roles from fixtures; a PUT is recorded and answered by `reply` (default: the detail with the requested roles). */
function mockRolesApi(detail: UserDetail, reply?: (body: Record<string, unknown>) => Response) {
  const puts: Record<string, unknown>[] = []
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      puts.push(body)
      if (reply) return reply(body)
      return jsonResponse(200, { ...detail, roles: (body.roleKeys as RoleKey[]).map(role) })
    }
    if (path === '/api/roles') return jsonResponse(200, makeRoleList())
    return jsonResponse(200, detail)
  })
  return { fetchMock, puts }
}

function renderDrawer(detail: UserDetail, permissions: string[] = ADMIN_PERMISSIONS, selfId = 'user-1') {
  const onUpdated = vi.fn()
  const reloadUser = vi.fn(async () => undefined)
  renderWithProviders(<UserDrawer userId={detail.id} onClose={vi.fn()} onUpdated={onUpdated} />, {
    auth: makeAuth({ user: makeUser({ id: selfId, permissions }), reloadUser }),
  })
  return { onUpdated, reloadUser }
}

async function openRolesTab(detail: UserDetail) {
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 4, name: detail.fullName })
  await userEvent.click(within(dialog).getByRole('tab', { name: ar.users.tabs.roles }))
  const select = await within(dialog).findByRole('combobox', { name: ar.users.rolesTab.label })
  return { dialog, select }
}

/** Opens the dropdown and returns the option row of a role label (`.ant-select-item`). */
async function optionOf(select: HTMLElement, label: string) {
  fireEvent.mouseDown(select)
  const content = await screen.findByText(label, { selector: '.ant-select-item-option-content' })
  return content.closest('.ant-select-item') as HTMLElement
}

const saveButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: ar.users.rolesTab.save })

describe('UserDrawer — roles tab', () => {
  it('offers the roles of GET /api/roles with their labels, sends the full set as PUT and hands the detail back', async () => {
    const detail = makeUserDetail()
    const api = mockRolesApi(detail)
    const { onUpdated, reloadUser } = renderDrawer(detail)
    const { dialog, select } = await openRolesTab(detail)

    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === '/api/roles')).toBe(true)
    const teacher = await optionOf(select, ROLE_LABELS.teacher.ar)
    expect(teacher).not.toHaveClass('ant-select-item-option-disabled')
    expect(screen.getByText(ROLE_LABELS.librarian.ar, { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    fireEvent.click(teacher)
    await userEvent.click(saveButton(dialog))

    await waitFor(() => expect(api.puts).toHaveLength(1))
    expect(api.puts[0]).toEqual({ roleKeys: ['student', 'teacher'] })
    const put = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put?.[0]).toBe(`/api/users/${detail.id}/roles`)
    expect(await screen.findByText(ar.users.rolesTab.saved)).toBeInTheDocument()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ roles: [role('student'), role('teacher')] }))
    expect(reloadUser).not.toHaveBeenCalled()
  })

  it('reloads the session user after changing the signed-in user’s own roles (AC2) and keeps academy_admin locked on oneself', async () => {
    const me = makeUserDetail({ roles: [role('academy_admin'), role('teacher')], studentProfile: null, guardians: [] })
    const api = mockRolesApi(me)
    const { reloadUser } = renderDrawer(me, ADMIN_PERMISSIONS, me.id)
    const { dialog, select } = await openRolesTab(me)

    const admin = await optionOf(select, ROLE_LABELS.academy_admin.ar)
    expect(admin).toHaveClass('ant-select-item-option-disabled')
    expect(admin).toHaveAttribute('title', ar.users.rolesTab.lockedSelfAdmin)
    // Toggling the teacher option off removes it from the set.
    fireEvent.click(screen.getByText(ROLE_LABELS.teacher.ar, { selector: '.ant-select-item-option-content' }))
    await userEvent.click(saveButton(dialog))

    await waitFor(() => expect(api.puts).toHaveLength(1))
    expect(api.puts[0]).toEqual({ roleKeys: ['academy_admin'] })
    await waitFor(() => expect(reloadUser).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(ar.users.rolesTab.savedSelf)).toBeInTheDocument()
  })

  it('shows the dedicated message for 409 last_admin and stays editable (AC1)', async () => {
    const admin = makeUserDetail({ roles: [role('academy_admin')], studentProfile: null, guardians: [] })
    const api = mockRolesApi(admin, () => jsonResponse(409, { statusCode: 409, code: 'last_admin', message: 'last admin' }))
    renderDrawer(admin)
    const { dialog, select } = await openRolesTab(admin)

    fireEvent.click(await optionOf(select, ROLE_LABELS.academy_admin.ar))
    await userEvent.click(saveButton(dialog))

    await waitFor(() => expect(api.puts).toHaveLength(1))
    expect(api.puts[0]).toEqual({ roleKeys: [] })
    expect(await within(dialog).findByText(ar.users.errors.last_admin)).toBeInTheDocument()
    expect(saveButton(dialog)).toBeEnabled()
  })

  it('locks the roles a limited assigner cannot grant (no-exceeding rule) and leaves the rest selectable', async () => {
    const detail = makeUserDetail()
    mockRolesApi(detail)
    renderDrawer(detail, LIMITED_ASSIGNER_PERMISSIONS)
    const { dialog, select } = await openRolesTab(detail)

    const admin = await optionOf(select, ROLE_LABELS.academy_admin.ar)
    expect(admin).toHaveClass('ant-select-item-option-disabled')
    expect(admin).toHaveAttribute('title', ar.users.rolesTab.lockedUnreachable)
    expect(screen.getByText(ROLE_LABELS.staff.ar, { selector: '.ant-select-item-option-content' }).closest('.ant-select-item')).toHaveClass(
      'ant-select-item-option-disabled',
    )
    expect(screen.getByText(ROLE_LABELS.teacher.ar, { selector: '.ant-select-item-option-content' }).closest('.ant-select-item')).not.toHaveClass(
      'ant-select-item-option-disabled',
    )
    expect(within(dialog).queryByText(/لا تحملها أنت \(/)).not.toBeInTheDocument()
    expect(saveButton(dialog)).toBeInTheDocument()
  })

  it('is read-only for a user who already holds a role out of the caller’s reach (SEC-R-17)', async () => {
    const staffMember = makeUserDetail({ roles: [role('staff')], studentProfile: null, guardians: [] })
    mockRolesApi(staffMember)
    renderDrawer(staffMember, LIMITED_ASSIGNER_PERMISSIONS)
    const { dialog, select } = await openRolesTab(staffMember)

    expect(within(dialog).getByText('هذا المستخدم يحمل أدواراً بصلاحيات لا تحملها أنت (staff) فلا يمكنك تغيير أدواره.')).toBeInTheDocument()
    expect(select).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: ar.users.rolesTab.save })).not.toBeInTheDocument()
  })

  it('asks for the employee kind when both employee roles are added to a user without an employee profile, and sends it', async () => {
    const guardian = makeUserDetail({ roles: [role('guardian')], studentProfile: null, employeeProfile: null, guardians: [], students: [] })
    const api = mockRolesApi(guardian)
    renderDrawer(guardian)
    const { dialog, select } = await openRolesTab(guardian)

    fireEvent.click(await optionOf(select, ROLE_LABELS.teacher.ar))
    expect(within(dialog).queryByText(ar.users.rolesTab.employeeKind)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ROLE_LABELS.staff.ar, { selector: '.ant-select-item-option-content' }))
    expect(await within(dialog).findByText(ar.users.rolesTab.employeeKind)).toBeInTheDocument()

    await userEvent.click(saveButton(dialog))
    expect(await within(dialog).findByText(ar.users.links.required)).toBeInTheDocument()
    expect(api.puts).toHaveLength(0)

    await userEvent.click(within(dialog).getByRole('radio', { name: ar.users.kinds.staff }))
    await userEvent.click(saveButton(dialog))
    await waitFor(() => expect(api.puts).toHaveLength(1))
    expect(api.puts[0]).toEqual({ roleKeys: ['guardian', 'staff', 'teacher'], employeeKind: 'staff' })
  })

  it('does not call the server when the set is unchanged', async () => {
    const detail = makeUserDetail()
    const api = mockRolesApi(detail)
    renderDrawer(detail)
    const { dialog } = await openRolesTab(detail)

    await userEvent.click(saveButton(dialog))

    expect(await screen.findByText(ar.users.rolesTab.nothingChanged)).toBeInTheDocument()
    expect(api.puts).toHaveLength(0)
  })
})
