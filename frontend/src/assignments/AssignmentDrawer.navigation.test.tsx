// KI-062 (J-F55 — the owner's note 1 on #106): the assignment drawer's unsaved edit form also
// holds a browser back/forward: the router blocker asks the drawer's «discard?» question
// (common.unsaved.*), one at a time with the close button's (KI-055). Rendered in a data
// router (src/test/navigation.tsx), which useBlocker needs; Escape, the mask, the close button
// and the reload prompt stay in AssignmentDrawer.unsaved.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ADMIN_PERMISSIONS, ASSIGNMENT_ID, makeAssignment } from '../test/assignments'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson, makeLessonList } from '../test/lessons'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { AssignmentDrawer } from './AssignmentDrawer'

/** The assignment (API-103), the academy and the class's lessons; every write is recorded and refused. */
function mockDrawerApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push(`${method} ${pathname}`)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/lessons') return jsonResponse(200, makeLessonList([{ ...makeLesson(), timeZone: 'Asia/Riyadh' } as ReturnType<typeof makeLesson>]))
    if (pathname === `/api/assignments/${ASSIGNMENT_ID}`) return jsonResponse(200, makeAssignment())
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { writes }
}

async function renderDrawer() {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<AssignmentDrawer assignmentId={ASSIGNMENT_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ASSIGNMENT_ADMIN_PERMISSIONS }) }),
    path: '/assignments',
  })
  await screen.findByText('PY-101-A')
  return { router, onClose }
}

const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

/** Opens the edit form and returns its Arabic title. */
async function startEditing() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.assignments.fields.titleAr)
}

describe('AssignmentDrawer — browser back with unsaved work (KI-062)', () => {
  it('lets a back navigation through while nothing is unsaved, even with the edit form open', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    await startEditing()

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while a field is unsaved: «keep editing» stays with the draft, «discard» goes back and closes once', async () => {
    const { writes } = mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.clear(title)
    await userEvent.type(title, 'الحلقات المتداخلة')
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/assignments')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/assignments')
    expect(title).toHaveValue('الحلقات المتداخلة')
    expect(onClose).not.toHaveBeenCalled()

    // Held again: the second back asks again, and «discard» lets it go on.
    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    expect(router.state.location.pathname).toBe('/assignments')
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    // The drawer left with its page: a reload is no longer held.
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('asks no second question when a back navigation comes while the close button asks: «keep editing» keeps the form and the route', async () => {
    const { writes } = mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')

    await clickWhenSettled(closeButton)
    const question = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(1)
    expect(router.state.location.pathname).toBe('/assignments')
    await answerDiscardQuestion(question, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/assignments')
    expect(title).toHaveValue('تمارين الحلقات!')
    expect(onClose).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('lets back through again once the change is changed back', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')
    expect(unloadWouldPrompt()).toBe(true)
    await userEvent.type(title, '{Backspace}')
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})
