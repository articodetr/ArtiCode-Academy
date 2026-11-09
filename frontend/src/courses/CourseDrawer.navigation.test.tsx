// KI-055 (J-F27): the course drawer's unsaved work — here the syllabus editor's and
// the edit form's — also holds a browser back/forward (the router blocker asks the
// drawer's «discard?» question, common.unsaved.*) and a reload or a tab close
// (beforeunload: the browser's own prompt). Rendered in a data router
// (src/test/navigation.tsx); Escape, the mask and the close button stay in
// CourseDrawer.unsaved.test.tsx, the one-question rule in ClassDrawer.navigation.test.tsx.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { COURSE_ID, COURSE_MANAGER_PERMISSIONS, makeCourse, makeLevel, makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser } from '../test/render'
import { CourseDrawer } from './CourseDrawer'

/** The course and its syllabus; the edit form's PATCH answers with the saved course. Every write is recorded. */
function mockCourseApi() {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return jsonResponse(200, url.endsWith('/syllabus') ? makeSyllabus() : makeCourse())
    writes.push(`${method} ${new URL(url, 'http://localhost').pathname}`)
    if (method === 'PATCH') return jsonResponse(200, makeCourse({ name: { ar: 'أساسيات بايثون', en: 'Python 3' }, updatedAt: '2026-11-09T12:00:00.000Z' }))
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { writes }
}

async function renderDrawer() {
  const onClose = vi.fn()
  const { router } = renderInDataRouter(<CourseDrawer courseId={COURSE_ID} levels={[makeLevel()]} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }),
    path: '/courses',
  })
  await screen.findByText('PY-101')
  return { router, onClose }
}

const expectBackOnPrevious = async () => expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')

describe('CourseDrawer — browser back, reload and tab close with unsaved work (KI-055)', () => {
  it('lets a reload and a back navigation through while nothing is unsaved', async () => {
    mockCourseApi()
    const { router, onClose } = await renderDrawer()
    expect(unloadWouldPrompt()).toBe(false)

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while the syllabus editor has a change: «keep editing» stays with the draft, «discard» goes back and closes', async () => {
    const { writes } = mockCourseApi()
    const { router, onClose } = await renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: ar.courses.drawer.tabs.syllabus }))
    fireEvent.click((await screen.findByText(ar.courses.syllabus.edit)).closest('button')!)
    await screen.findAllByTestId('syllabus-item-editor')
    // A change without opening any popup: the first item leaves the list.
    fireEvent.click(screen.getByLabelText(`${ar.courses.syllabus.remove} 1`))
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(2)
    expect(unloadWouldPrompt()).toBe(true)

    await goBack(router)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/courses')
    expect(screen.getAllByTestId('syllabus-item-editor')).toHaveLength(2)
    expect(onClose).not.toHaveBeenCalled()

    const asked = discardQuestionCount()
    await goBack(router)
    expect(discardQuestionCount()).toBe(asked + 1)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await expectBackOnPrevious()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('lets go once the edit form is saved: a reload is not held and back goes through', async () => {
    const { writes } = mockCourseApi()
    const { router } = await renderDrawer()
    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const english = await screen.findByLabelText(ar.courses.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'Python 3')
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.courses.drawer.saved)).toBeInTheDocument()
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))
    expect(writes).toEqual([`PATCH /api/courses/${COURSE_ID}`])

    await goBack(router)
    await expectBackOnPrevious()
    expect(discardQuestionCount()).toBe(0)
  })
})
