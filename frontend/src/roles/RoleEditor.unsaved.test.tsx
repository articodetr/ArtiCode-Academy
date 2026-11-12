// KI-057 (J-F39): while the role editor's form holds unsaved work — a permission
// ticked or unticked, a label typed, a new role's key — Escape and a mask click no
// longer close the drawer, the close button asks before discarding it (common.unsaved.*
// — the guard of the class, user and course drawers: KI-052, KI-054, KI-055), and a
// reload or a tab close is held (beforeunload). The form is compared with the saved
// values, so a change changed back holds nothing; academy_admin, shown read-only, never
// holds anything. Browser back/forward: RoleEditor.navigation.test.tsx. Since J-F55 a
// question still open when the save finishes is withdrawn (the owner's note 1 on #104).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Role } from '../api/roles'
import { ar } from '../i18n/ar'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_ROLE, CATALOG_GROUPS, LIBRARIAN_ROLE, ROLES_ADMIN_PERMISSIONS } from '../test/roles'
import { RoleEditor } from './RoleEditor'
import type { EditorTarget } from './RoleEditor'

/** Every write is recorded; PATCH and POST answer with the role merged with the body. */
function mockRolesApi() {
  const writes: { method: string; url: string; body: Record<string, unknown> }[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    writes.push({ method, url, body })
    const saved: Role = { ...LIBRARIAN_ROLE, ...body, updatedAt: '2026-11-09T18:00:00.000Z' }
    return jsonResponse(method === 'POST' ? 201 : 200, saved)
  })
  return { writes }
}

/** The editor with a spy parent: the drawer stays open, so every close request is counted. */
function renderEditor(target: EditorTarget) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const view = renderWithProviders(<RoleEditor target={target} groups={CATALOG_GROUPS} onClose={onClose} onSaved={onSaved} />, {
    auth: makeAuth({ user: makeUser({ permissions: ROLES_ADMIN_PERMISSIONS }) }),
    route: '/settings/roles',
  })
  return { ...view, onClose, onSaved }
}

const LIBRARIAN: EditorTarget = { mode: 'edit', role: LIBRARIAN_ROLE }

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while the form holds unsaved work: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

/** The matrix checkbox of one permission key, found by its code text (no accessible-name scan — KI-044). */
function permissionBox(dialog: HTMLElement, key: string): HTMLInputElement {
  return within(dialog).getByText(key, { selector: 'code' }).closest('label')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  await clickWhenSettled(closeButton)
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('RoleEditor — unsaved permissions and texts (KI-057)', () => {
  it('closes at once on Escape, on a mask click and with the close button while nothing is unsaved (as before)', async () => {
    mockRolesApi()
    const { onClose } = renderEditor(LIBRARIAN)
    await screen.findByRole('dialog')

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('keeps the drawer and the ticked permissions on Escape (twice) and on a mask click; the close button asks — «keep editing» stays, «discard» closes without a request', async () => {
    const { writes } = mockRolesApi()
    const { onClose } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(permissionBox(dialog, 'users.read'))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'تحديد كل صلاحيات MOD-09' }))
    expect(permissionBox(dialog, 'exams.take')).toBeChecked()

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    for (const key of ['users.read', 'courses.read', 'exams.read', 'exams.take', 'grades.read_own']) expect(permissionBox(dialog, key)).toBeChecked()

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(permissionBox(dialog, 'users.read')).toBeChecked())
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('lets go of a change changed back: a key ticked then unticked, a label typed then restored — Escape closes at once', async () => {
    const { writes } = mockRolesApi()
    const { onClose } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(permissionBox(dialog, 'users.read'))
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(permissionBox(dialog, 'users.read'))
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)

    const labelEn = within(dialog).getByLabelText(ar.rolesAdmin.fields.labelEn)
    fireEvent.change(labelEn, { target: { value: 'Head librarian' } })
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(1)
    // Typed back to the stored text, with spaces the save would trim.
    fireEvent.change(labelEn, { target: { value: ' Librarian ' } })
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('holds an emptied Arabic label of a custom role even though the save would send nothing for it', async () => {
    mockRolesApi()
    const { onClose } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(ar.rolesAdmin.fields.labelAr), { target: { value: '' } })
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)
  })

  it('holds a new role from the first typed key or ticked permission, and an English description typed without its Arabic text; an emptied form lets go', async () => {
    const { writes } = mockRolesApi()
    const { onClose } = renderEditor({ mode: 'create' })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.createTitle)).toBeInTheDocument()

    const key = within(dialog).getByLabelText(ar.rolesAdmin.fields.key)
    fireEvent.change(key, { target: { value: 'proctor' } })
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.change(key, { target: { value: ' ' } })
    fireEvent.click(permissionBox(dialog, 'exams.read'))
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(permissionBox(dialog, 'exams.read'))

    const descriptionEn = within(dialog).getByLabelText(ar.rolesAdmin.fields.descriptionEn)
    fireEvent.change(descriptionEn, { target: { value: 'Proctors exams' } })
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)

    // Nothing left that the POST would send, nor any typed text.
    fireEvent.change(descriptionEn, { target: { value: '' } })
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it('never holds anything for the read-only academy_admin: Escape, the mask and the close button close at once, and a reload is not held', async () => {
    mockRolesApi()
    const { onClose } = renderEditor({ mode: 'edit', role: ADMIN_ROLE })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(ar.rolesAdmin.editor.adminReadOnly)).toBeInTheDocument()

    // A click on a disabled box changes nothing.
    fireEvent.click(permissionBox(dialog, 'users.read'))
    expect(permissionBox(dialog, 'users.read')).toBeChecked()
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('prevents beforeunload only while the form holds unsaved work, and lets go once the change is saved', async () => {
    const { writes } = mockRolesApi()
    const { onSaved } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')
    expect(unloadWouldPrompt()).toBe(false)

    fireEvent.click(permissionBox(dialog, 'exams.read'))
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(permissionBox(dialog, 'exams.read'))
    expect(unloadWouldPrompt()).toBe(false)
    fireEvent.click(permissionBox(dialog, 'exams.read'))
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([{ method: 'PATCH', url: `/api/roles/${LIBRARIAN_ROLE.id}`, body: { permissions: ['courses.read', 'exams.read'] } }])
    // Saved: nothing is left to lose, even before the parent closes the drawer (this one keeps it open).
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))
  })

  it('lets go once the parent closes the drawer itself, the unsaved form with it', async () => {
    mockRolesApi()
    const { rerender, onClose, onSaved } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(permissionBox(dialog, 'users.read'))
    expect(unloadWouldPrompt()).toBe(true)

    rerender(<RoleEditor target={null} groups={CATALOG_GROUPS} onClose={onClose} onSaved={onSaved} />)
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('withdraws a «discard?» question still open when the save finishes: it closes itself and an answer given to it does nothing (J-F55)', async () => {
    const writes: string[] = []
    let answer: (response: Response) => void = () => {}
    mockFetch((url, init) => {
      writes.push(`${init?.method ?? 'GET'} ${url}`)
      return new Promise<Response>((resolve) => {
        answer = resolve
      })
    })
    const { onClose, onSaved } = renderEditor(LIBRARIAN)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(permissionBox(dialog, 'exams.read'))
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    await waitFor(() => expect(writes).toEqual([`PATCH /api/roles/${LIBRARIAN_ROLE.id}`]))

    // The PATCH is still running: the close button asks.
    const question = await openDiscardDialog()
    expect(isLeaving(question)).toBe(false)

    const saved: Role = { ...LIBRARIAN_ROLE, permissions: ['courses.read', 'exams.read'], updatedAt: '2026-11-09T18:00:00.000Z' }
    await act(async () => answer(jsonResponse(200, saved)))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved, 'edit'))
    // Nothing is left to lose: the question closes itself (its leave motion, which jsdom never ends).
    await waitFor(() => expect(isLeaving(question)).toBe(true))
    expect(unloadWouldPrompt()).toBe(false)
    // «Discard and close» on it now drops nothing and closes nothing: the work is saved.
    fireEvent.click(within(question).getByText(ar.common.unsaved.ok).closest('button')!)
    expect(onClose).not.toHaveBeenCalled()
  })
})

/** A question taken down shows its leave motion: jsdom never ends it, so the dialog stays in the document (KI-060). */
function isLeaving(dialog: HTMLElement): boolean {
  return /-leave\b/.test(dialog.className)
}
