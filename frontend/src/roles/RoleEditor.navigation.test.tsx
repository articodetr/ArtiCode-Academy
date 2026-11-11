// KI-057 (J-F39): the role editor's unsaved work also holds a browser back/forward —
// the router blocker asks the drawer's «discard?» question (common.unsaved.*, one at a
// time with the close button's) — like the class, user and course drawers (KI-055).
// Rendered in a data router (src/test/navigation.tsx), which useBlocker needs; Escape,
// the mask, the close button and beforeunload stay in RoleEditor.unsaved.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { ADMIN_ROLE, CATALOG_GROUPS, LIBRARIAN_ROLE, ROLES_ADMIN_PERMISSIONS } from '../test/roles'
import { RoleEditor } from './RoleEditor'
import type { EditorTarget } from './RoleEditor'

/** Every write is recorded and refused: nothing here may reach the server. */
function mockRolesApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    writes.push(`${init?.method ?? 'GET'} ${url}`)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { writes }
}

async function renderEditor(target: EditorTarget) {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<RoleEditor target={target} groups={CATALOG_GROUPS} onClose={onClose} onSaved={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ROLES_ADMIN_PERMISSIONS }) }),
    path: '/settings/roles',
  })
  const dialog = await screen.findByRole('dialog')
  return { router, onClose, dialog }
}

/** The matrix checkbox of one permission key, found by its code text (no accessible-name scan — KI-044). */
function permissionBox(dialog: HTMLElement, key: string): HTMLInputElement {
  return within(dialog).getByText(key, { selector: 'code' }).closest('label')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

describe('RoleEditor — browser back with unsaved work (KI-057)', () => {
  it('lets a reload and a back navigation through while nothing is unsaved', async () => {
    mockRolesApi()
    const { router, onClose } = await renderEditor({ mode: 'edit', role: LIBRARIAN_ROLE })
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while a permission is ticked: «keep editing» stays with the draft, «discard» goes back and closes', async () => {
    const { writes } = mockRolesApi()
    const { router, onClose, dialog } = await renderEditor({ mode: 'edit', role: LIBRARIAN_ROLE })
    fireEvent.click(permissionBox(dialog, 'users.read'))
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/roles')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/settings/roles')
    expect(permissionBox(dialog, 'users.read')).toBeChecked()
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)

    // Held again: the second back asks again, and «discard» lets it go on.
    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    expect(router.state.location.pathname).toBe('/settings/roles')
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    // The editor left with its page: a reload is no longer held.
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('holds a back navigation for a new role with a typed key, and asks no second question while the close button asks', async () => {
    const { writes } = mockRolesApi()
    const { router, onClose, dialog } = await renderEditor({ mode: 'create' })
    fireEvent.change(within(dialog).getByLabelText(ar.rolesAdmin.fields.key), { target: { value: 'proctor' } })

    await clickWhenSettled(() => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!)
    const question = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(1)
    expect(router.state.location.pathname).toBe('/settings/roles')

    await answerDiscardQuestion(question, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/settings/roles')
    expect(within(dialog).getByLabelText(ar.rolesAdmin.fields.key)).toHaveValue('proctor')
    expect(onClose).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('lets a back navigation through once a change is changed back', async () => {
    mockRolesApi()
    const { router, onClose, dialog } = await renderEditor({ mode: 'edit', role: LIBRARIAN_ROLE })
    fireEvent.click(permissionBox(dialog, 'courses.read'))
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(permissionBox(dialog, 'courses.read'))
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('never holds a back navigation for the read-only academy_admin', async () => {
    mockRolesApi()
    const { router, dialog } = await renderEditor({ mode: 'edit', role: ADMIN_ROLE })
    fireEvent.click(permissionBox(dialog, 'roles.manage'))
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
  })
})
