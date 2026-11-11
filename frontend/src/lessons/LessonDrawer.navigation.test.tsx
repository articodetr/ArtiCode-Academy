// KI-058 (J-F40): the lesson drawer's unsaved work — the attendance sheet's rows and the
// edit form's fields — also holds a browser back/forward: the router blocker asks the
// drawer's «discard?» question (common.unsaved.*), one at a time with the close button's
// (KI-055). Rendered in a data router (src/test/navigation.tsx), which useBlocker needs;
// Escape, the mask, the close button and the reload prompt stay in LessonDrawer.unsaved.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { ATTENDANCE_TEACHER_PERMISSIONS, makeAttendanceSheet } from '../test/attendance'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { clickWhenSettled } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, makeLesson } from '../test/lessons'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { LessonDrawer } from './LessonDrawer'

/** The lesson (API-094), its sheet (API-099) and the pickers of the edit form; every write is recorded and refused. */
function mockDrawerApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push(`${method} ${pathname}`)
      return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === `/api/lessons/${LESSON_ID}/attendance`) return jsonResponse(200, makeAttendanceSheet())
    if (pathname === `/api/lessons/${LESSON_ID}`) return jsonResponse(200, makeLesson())
    if (pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
    if (pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { writes }
}

async function renderDrawer() {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<LessonDrawer lessonId={LESSON_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: ATTENDANCE_TEACHER_PERMISSIONS }) }),
    path: '/lessons',
  })
  await screen.findByText('PY-101-A')
  return { router, onClose }
}

const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const saraAbsent = () => within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.absent)
const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

/** Opens the attendance tab and marks Sara absent (a status button: no popup is opened). */
async function markSaraAbsent() {
  fireEvent.click(screen.getByRole('tab', { name: ar.attendance.drawerTabs.sheet }))
  await screen.findByText('سارة الطالبة')
  fireEvent.click(saraAbsent())
}

/** Opens the edit form and types a new Arabic title. */
async function typeTitle() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  const title = await screen.findByLabelText(ar.lessons.fields.titleAr)
  await userEvent.clear(title)
  await userEvent.type(title, 'الأنواع')
  return title
}

describe('LessonDrawer — browser back with unsaved work (KI-058)', () => {
  it('lets a back navigation through while nothing is unsaved, even with the sheet open', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: ar.attendance.drawerTabs.sheet }))
    await screen.findByText('سارة الطالبة')

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while an attendance row is unsaved: «keep editing» stays with the row, «discard» goes back and closes once', async () => {
    const { writes } = mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    await markSaraAbsent()
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/lessons')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/lessons')
    expect(saraAbsent()).toBeChecked()
    expect(onClose).not.toHaveBeenCalled()

    // Held again: the second back asks again, and «discard» lets it go on.
    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    expect(router.state.location.pathname).toBe('/lessons')
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    // The drawer left with its page: a reload is no longer held.
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('asks no second question when a back navigation comes while the close button asks: «keep editing» keeps the form and the route, «discard» goes back and closes once', async () => {
    const { writes } = mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    const title = await typeTitle()

    await clickWhenSettled(closeButton)
    const first = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(1)
    expect(router.state.location.pathname).toBe('/lessons')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/lessons')
    expect(title).toHaveValue('الأنواع')
    expect(onClose).not.toHaveBeenCalled()

    const asked = discardQuestionCount()
    await clickWhenSettled(closeButton)
    const second = await latestDiscardQuestion()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    await answerDiscardQuestion(second, 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it('lets back through again once the row is changed back to its saved state', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderDrawer()
    await markSaraAbsent()
    // Sara had no record: «تراجع» takes the row back to the server's state.
    fireEvent.click(within(row('سارة الطالبة')).getByText(ar.attendance.revert).closest('button')!)
    expect(saraAbsent()).not.toBeChecked()
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})
