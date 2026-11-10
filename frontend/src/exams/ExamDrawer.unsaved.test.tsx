// The exam drawer keeps unsaved work like the lesson drawer (KI-058): while its edit form
// or its results sheet holds a change — compared with what the server holds, so a change
// changed back holds nothing — Escape and a mask click no longer close the drawer, the
// close button asks before discarding it (common.unsaved.*), a reload or a tab close is
// held (beforeunload), and a browser back/forward asks the same question (a data router
// — src/test/navigation.tsx). A tab switch is no close.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { EXAM_ID, EXAM_TEACHER_PERMISSIONS, makeExam, makeResultsSheet } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLessonList } from '../test/lessons'
import { answerDiscardQuestion, blockerStates, discardQuestionCount, goBack, latestDiscardQuestion, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamDrawer } from './ExamDrawer'

/** The exam (API-114), its sheet (API-119), the academy and the lessons of the edit form; every write is recorded and refused. */
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
    if (pathname === '/api/lessons') return jsonResponse(200, makeLessonList([]))
    if (pathname === `/api/exams/${EXAM_ID}/results`) return jsonResponse(200, makeResultsSheet())
    if (pathname === `/api/exams/${EXAM_ID}`) return jsonResponse(200, makeExam({ status: 'scheduled' }))
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { writes }
}

const auth = () => makeAuth({ user: makeUser({ permissions: EXAM_TEACHER_PERMISSIONS }) })

/** The drawer with a spy parent: it stays open, so every close request is counted. */
async function renderDrawer() {
  const onClose = vi.fn()
  renderWithProviders(<ExamDrawer examId={EXAM_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, { auth: auth(), route: '/exams' })
  await screen.findByText('PY-101-A')
  return { onClose }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()
const resultsTab = () => screen.getByRole('tab', { name: ar.exams.drawer.tabs.results })
const detailsTab = () => screen.getByRole('tab', { name: ar.exams.drawer.tabs.details })
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const saraAbsent = () => within(row('سارة الطالبة')).getByLabelText(ar.exams.results.status.absent)

/** Opens the results tab and marks Sara absent (a status button: no popup is opened). */
async function markSaraAbsent() {
  fireEvent.click(resultsTab())
  await screen.findByText('سارة الطالبة')
  fireEvent.click(saraAbsent())
}

/** Opens the edit form and types a new Arabic title. */
async function typeTitle() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  const title = await screen.findByLabelText(ar.exams.fields.titleAr)
  await userEvent.clear(title)
  await userEvent.type(title, 'اختبار الفصل')
  return title
}

describe('ExamDrawer — unsaved edit form and results sheet', () => {
  it('closes at once on Escape, a mask click and the close button while nothing is unsaved — the sheet open untouched', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer()
    fireEvent.click(resultsTab())
    await screen.findByText('سارة الطالبة')
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(mask())
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps a marked result row on Escape and a mask click, holds a reload, and keeps it across a tab switch; the close button asks — «keep editing» stays, «discard» closes once without a PUT', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    await markSaraAbsent()

    pressEscape()
    fireEvent.click(mask())
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(detailsTab())
    fireEvent.click(resultsTab())
    expect(saraAbsent()).toBeChecked()

    fireEvent.click(closeButton())
    const first = await latestDiscardQuestion()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    await answerDiscardQuestion(first, 'keep')
    expect(saraAbsent()).toBeChecked()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(closeButton())
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(writes).toEqual([])
  })

  it('keeps the edit form and its draft on Escape; changed back, it holds nothing', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await typeTitle()

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect(title).toHaveValue('اختبار الفصل')
    expect(unloadWouldPrompt()).toBe(true)

    await userEvent.clear(title)
    await userEvent.type(title, 'اختبار منتصف الفصل')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
  })
})

describe('ExamDrawer — browser back with unsaved work', () => {
  async function renderRouted() {
    const onClose = vi.fn()
    const { router } = renderInDataRouter(<ExamDrawer examId={EXAM_ID} onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />, { auth: auth(), path: '/exams' })
    await screen.findByText('PY-101-A')
    return { router, onClose }
  }

  it('lets a back navigation through while nothing is unsaved', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderRouted()
    await goBack(router)
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/')
    expect(discardQuestionCount()).toBe(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a back navigation while a result row is unsaved: «keep editing» stays with the row, «discard» goes back and closes once', async () => {
    const { writes } = mockDrawerApi()
    const { router, onClose } = await renderRouted()
    await markSaraAbsent()

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(router.state.location.pathname).toBe('/exams')
    await answerDiscardQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/exams')
    expect(saraAbsent()).toBeChecked()

    await goBack(router)
    await answerDiscardQuestion(await latestDiscardQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('holds a back navigation while the edit form is unsaved, with one question', async () => {
    mockDrawerApi()
    const { router, onClose } = await renderRouted()
    await typeTitle()

    await goBack(router)
    const first = await latestDiscardQuestion()
    expect(discardQuestionCount()).toBe(1)
    await answerDiscardQuestion(first, 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
