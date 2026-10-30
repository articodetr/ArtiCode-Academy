import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Role } from '../api/roles'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ALL_ROLES, LIBRARIAN_ROLE, REGISTRAR_ROLE, ROLES_ADMIN_PERMISSIONS, makeCatalog } from '../test/roles'
import { RolesManager } from './RolesManager'

interface Options {
  roles?: Role[] | Response
  /** Answers PATCH/DELETE; default: PATCH echoes the merged role, DELETE answers 204. */
  write?: (method: string, url: string, body: Record<string, unknown>) => Response
}

/** Serves GET /api/roles and GET /api/permissions; records every write. */
function mockRolesApi({ roles = ALL_ROLES, write }: Options = {}) {
  const writes: { method: string; url: string; body: Record<string, unknown> }[] = []
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/permissions') return jsonResponse(200, makeCatalog())
    if (method === 'GET' && url === '/api/roles') return roles instanceof Response ? roles : jsonResponse(200, { items: roles })
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    writes.push({ method, url, body })
    if (write) return write(method, url, body)
    if (method === 'DELETE') return jsonResponse(204)
    const id = url.slice('/api/roles/'.length)
    const current = (roles instanceof Response ? ALL_ROLES : roles).find((role) => role.id === id) ?? LIBRARIAN_ROLE
    return jsonResponse(200, { ...current, ...body })
  })
  return { writes, fetchMock }
}

function renderManager(permissions: string[] = ROLES_ADMIN_PERMISSIONS) {
  return renderWithProviders(<RolesManager />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/settings/roles' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

/**
 * The row action button of one role, found by its visible text inside that row.
 * (A `getByRole` with a RegExp name over the whole screen costs seconds in jsdom —
 * it computes the accessible name of every antd button — so queries stay scoped.)
 */
function rowButton(action: string, roleName: string): HTMLElement {
  const row = bodyRows().find((candidate) => within(candidate).queryByText(roleName) !== null)
  if (!row) throw new Error(`no row for ${roleName}`)
  return within(row).getByText(action).closest('button') as HTMLElement
}

// Plain DOM events: these flows exercise state and requests, not pointer semantics, and antd
// tables are slow enough in jsdom that user-event's pointer sequences push them past the timeout under load.
describe('RolesManager', () => {
  it('lists every role of GET /api/roles with its label, key, type, holders and permission count', async () => {
    const api = mockRolesApi()
    renderManager()

    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText('مدير الأكاديمية')).toBeInTheDocument()
    expect(within(rows[0]).getByText('academy_admin')).toBeInTheDocument()
    expect(within(rows[0]).getByText(ar.rolesAdmin.system)).toBeInTheDocument()
    expect(within(rows[0]).getByText('8 من 8')).toBeInTheDocument()
    expect(within(rows[0]).getByText(ar.rolesAdmin.actions.view)).toBeInTheDocument()
    expect(within(rows[0]).queryByText(ar.rolesAdmin.actions.delete)).not.toBeInTheDocument()
    expect(within(rows[2]).getByText(ar.rolesAdmin.custom)).toBeInTheDocument()
    expect(within(rows[2]).getByText('1 من 8')).toBeInTheDocument()
    expect(within(rows[2]).getByText(ar.rolesAdmin.actions.edit)).toBeInTheDocument()
    expect(within(rows[2]).getByText(ar.rolesAdmin.actions.delete)).toBeInTheDocument()
    expect(within(rows[3]).getByText('2')).toBeInTheDocument()
    expect(api.fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/permissions', '/api/roles'])
    expect(screen.getByText(ar.rolesAdmin.addRole).closest('button')).toBeEnabled()
  })

  it('deletes an unassigned custom role after confirmation and drops its row; a role in use keeps a disabled delete button', async () => {
    const api = mockRolesApi()
    renderManager()
    await screen.findByText('أمين المكتبة')

    expect(rowButton(ar.rolesAdmin.actions.delete, 'مسجّل')).toBeDisabled()

    fireEvent.click(rowButton(ar.rolesAdmin.actions.delete, 'أمين المكتبة'))
    const confirmation = (await screen.findByText('حذف الدور «أمين المكتبة»؟ لا يمكن التراجع.')).closest('.ant-popconfirm') as HTMLElement
    fireEvent.click(within(confirmation).getByText(ar.rolesAdmin.actions.delete, { selector: 'button span' }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    expect(api.writes[0]).toEqual({ method: 'DELETE', url: `/api/roles/${LIBRARIAN_ROLE.id}`, body: {} })
    expect(await screen.findByText('تم حذف الدور «أمين المكتبة»')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('أمين المكتبة')).not.toBeInTheDocument())
    expect(bodyRows()).toHaveLength(3)
  })

  it('shows the server message when a delete loses the race with a grant (409 role_in_use) and keeps the row', async () => {
    mockRolesApi({ write: () => jsonResponse(409, { statusCode: 409, code: 'role_in_use', message: 'granted', key: 'librarian', userCount: 1 }) })
    renderManager()
    await screen.findByText('أمين المكتبة')

    fireEvent.click(rowButton(ar.rolesAdmin.actions.delete, 'أمين المكتبة'))
    const confirmation = (await screen.findByText('حذف الدور «أمين المكتبة»؟ لا يمكن التراجع.')).closest('.ant-popconfirm') as HTMLElement
    fireEvent.click(within(confirmation).getByText(ar.rolesAdmin.actions.delete, { selector: 'button span' }))

    expect(await screen.findByText('لا يمكن حذف الدور لأنه ممنوح لمستخدمين (1).')).toBeInTheDocument()
    expect(screen.getByText('أمين المكتبة')).toBeInTheDocument()
  })

  it('shows the row as the server returned it after an edit, not as typed (AC2)', async () => {
    mockRolesApi({
      write: (_method, _url, body) =>
        jsonResponse(200, { ...REGISTRAR_ROLE, label: { ar: 'مسجّل (معتمد)', en: 'Registrar' }, permissions: body.permissions as string[], updatedAt: '2026-10-30T12:00:00.000Z' }),
    })
    renderManager()
    await screen.findByText('مسجّل')

    fireEvent.click(rowButton(ar.rolesAdmin.actions.edit, 'مسجّل'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^exams\.read / }))
    fireEvent.click(within(dialog).getByRole('button', { name: ar.common.save }))

    expect(await screen.findByText('مسجّل (معتمد)')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(bodyRows()[3]).getByText('4 من 8')).toBeInTheDocument()
    expect(screen.queryByText('مسجّل', { exact: true })).not.toBeInTheDocument()
  })

  it('adds a created role to the list in server order', async () => {
    const created = { ...LIBRARIAN_ROLE, id: '0192f0b0-0000-7000-8000-000000000103', key: 'auditor', label: { ar: 'مدقّق' }, permissions: ['users.read'] }
    mockRolesApi({ write: () => jsonResponse(201, created) })
    renderManager()
    await screen.findByText('أمين المكتبة')

    fireEvent.click(screen.getByText(ar.rolesAdmin.addRole).closest('button') as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(ar.rolesAdmin.fields.key), { target: { value: 'auditor' } })
    fireEvent.change(within(dialog).getByLabelText(ar.rolesAdmin.fields.labelAr), { target: { value: 'مدقّق' } })
    fireEvent.click(within(dialog).getByRole('button', { name: ar.rolesAdmin.editor.submitCreate }))

    expect(await screen.findByText('تم إنشاء الدور «مدقّق»')).toBeInTheDocument()
    await waitFor(() => expect(bodyRows()).toHaveLength(5))
    // Custom roles by key: auditor < librarian < registrar, after the two system roles.
    expect(within(bodyRows()[2]).getByText('auditor')).toBeInTheDocument()
  })

  it('shows the load failure with its code and reloads on request', async () => {
    const api = mockRolesApi({ roles: jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['users.read'] }) })
    renderManager()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.rolesAdmin.loadFailed)
    expect(alert).toHaveTextContent('ليست لديك الصلاحية اللازمة لهذا الإجراء (users.read)')
    expect(screen.getByText(ar.rolesAdmin.empty)).toBeInTheDocument()

    api.fetchMock.mockImplementation(async (input) => (String(input) === '/api/roles' ? jsonResponse(200, { items: ALL_ROLES }) : jsonResponse(200, makeCatalog())))
    fireEvent.click(within(alert).getByText(ar.rolesAdmin.refresh))
    expect(await screen.findByText('أمين المكتبة')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
