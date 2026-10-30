import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Role } from '../api/roles'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_ROLE, CATALOG_GROUPS, LIBRARIAN_ROLE, LIMITED_MANAGER_PERMISSIONS, REGISTRAR_ROLE, ROLES_ADMIN_PERMISSIONS, TEACHER_ROLE } from '../test/roles'
import { RoleEditor } from './RoleEditor'
import type { EditorTarget } from './RoleEditor'

/** Records every POST/PATCH body; answers with `reply` (default: echo the role merged with the body). */
function mockWrites(reply?: (method: string, body: Record<string, unknown>) => Response, base: Role = LIBRARIAN_ROLE) {
  const writes: { method: string; url: string; body: Record<string, unknown> }[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    writes.push({ method, url, body })
    if (reply) return reply(method, body)
    return jsonResponse(method === 'POST' ? 201 : 200, { ...base, ...body, permissions: (body.permissions as string[] | undefined) ?? base.permissions })
  })
  return writes
}

function renderEditor(target: EditorTarget, permissions: string[] = ROLES_ADMIN_PERMISSIONS) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<RoleEditor target={target} groups={CATALOG_GROUPS} onClose={onClose} onSaved={onSaved} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
  })
  return { onSaved, onClose }
}

const checkbox = (dialog: HTMLElement, key: string) => within(dialog).getByRole('checkbox', { name: new RegExp(`^${key.replace(/\./g, '\\.')}( |$)`) })

describe('RoleEditor', () => {
  it('shows academy_admin read-only: every box ticked and disabled, no save button, close only (AC1)', async () => {
    const { onClose } = renderEditor({ mode: 'edit', role: ADMIN_ROLE })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.viewTitle)).toBeInTheDocument()
    expect(within(dialog).getByText(ar.rolesAdmin.editor.adminReadOnly)).toBeInTheDocument()
    for (const key of ['users.read', 'roles.manage', 'courses.manage', 'grades.read_own']) {
      const box = checkbox(dialog, key)
      expect(box).toBeChecked()
      expect(box).toBeDisabled()
    }
    expect(within(dialog).queryByRole('button', { name: ar.common.save })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.rolesAdmin.fields.labelAr)).not.toBeInTheDocument()
    // The drawer's own close icon carries the same accessible name; the footer button is the plain one.
    const closeButtons = within(dialog).getAllByRole('button', { name: ar.rolesAdmin.editor.close })
    await userEvent.click(closeButtons[closeButtons.length - 1])
    expect(onClose).toHaveBeenCalled()
  })

  it('exposes only the permission set of another system role and sends it as the full set', async () => {
    const writes = mockWrites(undefined, TEACHER_ROLE)
    const { onSaved } = renderEditor({ mode: 'edit', role: TEACHER_ROLE })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.systemLabelsHint)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.rolesAdmin.fields.labelAr)).not.toBeInTheDocument()
    expect(within(dialog).getByText('معلم')).toBeInTheDocument()

    await userEvent.click(checkbox(dialog, 'courses.manage'))
    await userEvent.click(checkbox(dialog, 'users.read'))
    await userEvent.click(within(dialog).getByRole('button', { name: ar.common.save }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe('PATCH')
    expect(writes[0].url).toBe(`/api/roles/${TEACHER_ROLE.id}`)
    expect(writes[0].body).toEqual({ permissions: ['courses.manage', 'courses.read', 'exams.read'] })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: TEACHER_ROLE.id, permissions: ['courses.manage', 'courses.read', 'exams.read'] }), 'edit')
    expect(await screen.findByText('تم حفظ الدور «معلم»')).toBeInTheDocument()
  })

  it('sends only the changed metadata of a custom role and the whole module through its select-all box', async () => {
    const writes = mockWrites()
    const { onSaved } = renderEditor({ mode: 'edit', role: LIBRARIAN_ROLE })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.editTitle)).toBeInTheDocument()
    const labelEn = within(dialog).getByLabelText(ar.rolesAdmin.fields.labelEn)
    await userEvent.clear(labelEn)
    await userEvent.type(labelEn, 'Head librarian')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'تحديد كل صلاحيات MOD-04' }))
    await userEvent.click(within(dialog).getByRole('button', { name: ar.common.save }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].body).toEqual({
      label: { ar: 'أمين المكتبة', en: 'Head librarian' },
      permissions: ['courses.manage', 'courses.read'],
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ label: { ar: 'أمين المكتبة', en: 'Head librarian' } }), 'edit')
  })

  it('does not call the server when nothing changed', async () => {
    const writes = mockWrites()
    const { onSaved } = renderEditor({ mode: 'edit', role: LIBRARIAN_ROLE })

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(checkbox(dialog, 'users.read'))
    await userEvent.click(checkbox(dialog, 'users.read'))
    await userEvent.click(within(dialog).getByRole('button', { name: ar.common.save }))

    expect(await screen.findByText(ar.rolesAdmin.nothingChanged)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('creates a custom role: validates the key locally (pattern, reserved) then POSTs the normalised body', async () => {
    const writes = mockWrites()
    const { onSaved } = renderEditor({ mode: 'create' })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.createTitle)).toBeInTheDocument()
    const key = within(dialog).getByLabelText(ar.rolesAdmin.fields.key)
    const submit = within(dialog).getByRole('button', { name: ar.rolesAdmin.editor.submitCreate })

    await userEvent.type(key, 'Bad Key')
    await userEvent.click(submit)
    expect(await within(dialog).findByText(ar.rolesAdmin.validation.key)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.rolesAdmin.validation.labelAr)).toBeInTheDocument()

    await userEvent.clear(key)
    await userEvent.type(key, 'teacher')
    await userEvent.click(submit)
    expect(await within(dialog).findByText(ar.rolesAdmin.validation.keyReserved)).toBeInTheDocument()
    expect(writes).toHaveLength(0)

    await userEvent.clear(key)
    await userEvent.type(key, ' Exam_Proctor ')
    await userEvent.type(within(dialog).getByLabelText(ar.rolesAdmin.fields.labelAr), 'مراقب اختبارات')
    await userEvent.type(within(dialog).getByLabelText(ar.rolesAdmin.fields.descriptionEn), 'Proctors exams')
    await userEvent.click(submit)
    expect(await within(dialog).findByText(ar.rolesAdmin.validation.descriptionAr)).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText(ar.rolesAdmin.fields.descriptionAr), 'يراقب الاختبارات')
    await userEvent.click(checkbox(dialog, 'exams.read'))
    await userEvent.click(checkbox(dialog, 'exams.take'))
    await userEvent.click(submit)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe('POST')
    expect(writes[0].url).toBe('/api/roles')
    expect(writes[0].body).toEqual({
      key: 'exam_proctor',
      label: { ar: 'مراقب اختبارات' },
      description: { ar: 'يراقب الاختبارات', en: 'Proctors exams' },
      permissions: ['exams.read', 'exams.take'],
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ key: 'exam_proctor' }), 'create')
  })

  it('puts a 409 role_in_use on the key field and a 400 permission_unknown under the matrix, staying open', async () => {
    const writes = mockWrites((method, body) => {
      if (method === 'POST' && body.key === 'taken') return jsonResponse(409, { statusCode: 409, code: 'role_in_use', message: 'taken', key: 'taken' })
      return jsonResponse(400, { statusCode: 400, code: 'permission_unknown', message: 'unknown', permissions: ['courses.read'] })
    })
    const { onSaved } = renderEditor({ mode: 'create' })

    const dialog = await screen.findByRole('dialog')
    const key = within(dialog).getByLabelText(ar.rolesAdmin.fields.key)
    await userEvent.type(key, 'taken')
    await userEvent.type(within(dialog).getByLabelText(ar.rolesAdmin.fields.labelAr), 'دور')
    const submit = within(dialog).getByRole('button', { name: ar.rolesAdmin.editor.submitCreate })
    await userEvent.click(submit)
    expect(await within(dialog).findByText(ar.rolesAdmin.errors.role_in_use_key)).toBeInTheDocument()

    await userEvent.clear(key)
    await userEvent.type(key, 'other')
    await userEvent.click(checkbox(dialog, 'courses.read'))
    await userEvent.click(submit)
    expect(await within(dialog).findByText('صلاحية غير معروفة أو مهملة (courses.read)')).toBeInTheDocument()
    expect(writes.filter((write) => write.method === 'POST')).toHaveLength(2)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('locks the keys a limited manager does not hold unless the role already has them (no-exceeding rule)', async () => {
    renderEditor({ mode: 'edit', role: REGISTRAR_ROLE }, LIMITED_MANAGER_PERMISSIONS)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.unreachableHint)).toBeInTheDocument()
    // Not held by the caller, not in the role: locked.
    expect(checkbox(dialog, 'users.read_contact')).toBeDisabled()
    // Not held by the caller but already granted to the role: stays free.
    expect(checkbox(dialog, 'courses.manage')).toBeEnabled()
    expect(checkbox(dialog, 'courses.manage')).toBeChecked()
    // Held by the caller, and the learner baseline key nobody needs to hold: free.
    expect(checkbox(dialog, 'roles.manage')).toBeEnabled()
    expect(checkbox(dialog, 'grades.read_own')).toBeEnabled()
  })
})
