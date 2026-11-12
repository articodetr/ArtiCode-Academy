// KI-062 (J-F55 — the owner's note 1 on #106): while the assignment drawer's edit form holds
// unsaved work — a field changed — Escape and a mask click no longer close the drawer, the
// close button asks before discarding it (common.unsaved.* — the guard of the class, user,
// course, lesson and exam drawers: KI-052, KI-054, KI-055, KI-058), and a reload or a tab
// close is held (beforeunload). The form is compared with the assignment as the server holds
// it, so a change changed back holds nothing; the form's own Cancel is an explicit discard;
// a tab switch is no close. Browser back/forward: AssignmentDrawer.navigation.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Assignment } from '../api/assignments'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ADMIN_PERMISSIONS, ASSIGNMENT_ID, makeAssignment } from '../test/assignments'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson, makeLessonList } from '../test/lessons'
import { unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeSubmissionRoster } from '../test/submissions'
import { AssignmentDrawer } from './AssignmentDrawer'

interface DrawerApiOptions {
  /** What GET /api/assignments/:id answers — read again on every call. */
  detail?: () => Assignment
  /** The answer of PATCH /api/assignments/:id; any other write fails. */
  patch?: () => Response
}

/** The assignment (API-103), the academy, the class's lessons (the lesson select) and the roster; every write is recorded. */
function mockDrawerApi({ detail = () => makeAssignment(), patch }: DrawerApiOptions = {}) {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push(`${method} ${pathname}`)
      return method === 'PATCH' && patch ? patch() : jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/lessons') return jsonResponse(200, makeLessonList([{ ...makeLesson(), timeZone: 'Asia/Riyadh' } as ReturnType<typeof makeLesson>]))
    if (pathname === `/api/assignments/${ASSIGNMENT_ID}/submissions`) return jsonResponse(200, makeSubmissionRoster())
    if (pathname === `/api/assignments/${ASSIGNMENT_ID}`) return jsonResponse(200, detail())
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { writes }
}

/** The drawer with a spy parent: it stays open, so every close request is counted. */
async function renderDrawer() {
  const onClose = vi.fn()
  const onUpdated = vi.fn()
  renderWithProviders(<AssignmentDrawer assignmentId={ASSIGNMENT_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ASSIGNMENT_ADMIN_PERMISSIONS }) }),
    route: '/assignments',
  })
  await screen.findByText('PY-101-A')
  return { onClose, onUpdated }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while the form holds unsaved work: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()
// Text and label queries, never getByRole with a name over the whole drawer (KI-044).
const tabOf = (label: string) => screen.getByText(label).closest('[role="tab"]') as HTMLElement
const titleInput = () => screen.getByLabelText(ar.assignments.fields.titleAr)

/** Opens the edit form and returns its Arabic title. */
async function startEditing() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.assignments.fields.titleAr)
}

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  await clickWhenSettled(closeButton)
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('AssignmentDrawer — unsaved edit form (KI-062)', () => {
  it('closes at once on Escape, on a mask click and with the close button while nothing is unsaved — the edit form open untouched', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer()
    await startEditing()
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps the edit form and its draft on Escape (twice) and on a mask click; the close button asks — «keep editing» stays, «discard» closes once without a request', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.clear(title)
    await userEvent.type(title, 'الحلقات المتداخلة')

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(titleInput()).toHaveValue('الحلقات المتداخلة')
    expect(unloadWouldPrompt()).toBe(true)

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(titleInput()).toHaveValue('الحلقات المتداخلة'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('drops the draft on the form’s own Cancel (an explicit discard): the form closes, nothing is held, and Escape closes at once', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)
    await waitFor(() => expect(screen.queryByLabelText(ar.assignments.fields.titleAr)).not.toBeInTheDocument())
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('lets go of changes changed back — a title and a weight typed away and back; holds what the save would refuse — an emptied title, half a due date', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()

    await userEvent.type(title, '!')
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.type(title, '{Backspace}')
    expect(title).toHaveValue('تمارين الحلقات')
    expect(unloadWouldPrompt()).toBe(false)

    const weight = screen.getByLabelText(ar.assignments.fields.weight)
    await userEvent.clear(weight)
    await userEvent.type(weight, '12')
    expect(unloadWouldPrompt()).toBe(true)
    await userEvent.clear(weight)
    await userEvent.type(weight, '10.00')
    expect(unloadWouldPrompt()).toBe(false)

    // Nothing the PATCH would send, but work the save refuses instead of dropping silently.
    await userEvent.clear(title)
    expect(unloadWouldPrompt()).toBe(true)
    await userEvent.type(title, 'تمارين الحلقات')
    fireEvent.change(screen.getByLabelText(ar.assignments.fields.dueTime), { target: { value: '' } })
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.change(screen.getByLabelText(ar.assignments.fields.dueTime), { target: { value: '23:59' } })
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('treats a tab switch as no close: with a title typed, the submissions tab and back ask nothing and the draft stays', async () => {
    mockDrawerApi({ detail: () => makeAssignment({ status: 'open', publishedAt: '2026-11-09T09:00:00.000Z' }) })
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')

    fireEvent.click(tabOf(ar.assignments.drawer.tabs.submissions))
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(tabOf(ar.assignments.drawer.tabs.details))
    expect(tabOf(ar.assignments.drawer.tabs.details)).toHaveAttribute('aria-selected', 'true')
    expect(titleInput()).toHaveValue('تمارين الحلقات!')
    expectNoDiscardQuestion()
  })

  it('holds a reload or a tab close only while unsaved: released once the form saves', async () => {
    const saved = makeAssignment({ title: { ar: 'الحلقات المتداخلة', en: 'Loop exercises' }, updatedAt: '2026-11-09T11:00:00.000Z' })
    const { writes } = mockDrawerApi({ patch: () => jsonResponse(200, saved) })
    const { onUpdated } = await renderDrawer()
    expect(unloadWouldPrompt()).toBe(false)

    const title = await startEditing()
    await userEvent.clear(title)
    await userEvent.type(title, 'الحلقات المتداخلة')
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(await screen.findByText(ar.assignments.drawer.saved)).toBeInTheDocument()
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))
    expect(writes).toEqual([`PATCH /api/assignments/${ASSIGNMENT_ID}`])
  })

  it('after assignment_locked holds the other changes only: the refused score returns to its stored value, and the title changed back lets go', async () => {
    let current = makeAssignment({ status: 'open', publishedAt: '2026-11-09T09:00:00.000Z' })
    const { writes } = mockDrawerApi({
      detail: () => current,
      patch: () => {
        // A student submitted meanwhile: the grading rules lock.
        current = makeAssignment({ status: 'open', publishedAt: '2026-11-09T09:00:00.000Z', submissions: { students: 1, submitted: 1, graded: 0, returned: 0 } })
        return jsonResponse(409, { statusCode: 409, code: 'assignment_locked', status: 'open', fields: ['maxScore'], submissionCount: 1, message: 'Locked' })
      },
    })
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')
    const score = screen.getByLabelText(ar.assignments.fields.maxScore)
    await userEvent.clear(score)
    await userEvent.type(score, '25')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    expect(await screen.findByText(ar.assignments.validation.lockedAfterSubmission)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.assignments.fields.maxScore)).toHaveValue('20')
    await waitFor(() => expect(screen.getByLabelText(ar.assignments.fields.maxScore)).toBeDisabled())
    // The title is still unsaved work.
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)

    await userEvent.type(titleInput(), '{Backspace}')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([`PATCH /api/assignments/${ASSIGNMENT_ID}`])
  })
})
