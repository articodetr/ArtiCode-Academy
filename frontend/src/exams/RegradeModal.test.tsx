import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CORRECTION_REASON_MAX_LENGTH } from '../api/examQuestions'
import type { RegradeSummary } from '../api/examQuestions'
import { ar } from '../i18n/ar'
import { makeRegradeSummary, makeScheduledOnlineExam } from '../test/examAttempts'
import { EXAM_ID, EXAM_TEACHER_PERMISSIONS } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { discardQuestionCount, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { RegradeModal } from './RegradeModal'

const TITLE = ar.examAttempts.regrade.title.replace('{{name}}', makeScheduledOnlineExam().title.ar)
const REGRADE_URL = `/api/exams/${EXAM_ID}/regrade`

/** POST /api/exams/:id/regrade answers `answer()`; every body is recorded. */
function mockRegradeApi(answer: () => Response | Promise<Response> = () => jsonResponse(200, makeRegradeSummary())) {
  const posts: unknown[] = []
  mockFetch((url, init) => {
    if (init?.method === 'POST' && url === REGRADE_URL) {
      posts.push(JSON.parse(String(init.body)))
      return answer()
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return posts
}

function renderModal() {
  const onClose = vi.fn()
  const onDone = vi.fn<(summary: RegradeSummary) => void>()
  const onStale = vi.fn()
  const view = renderWithProviders(<RegradeModal exam={makeScheduledOnlineExam()} onClose={onClose} onDone={onDone} onStale={onStale} />, {
    auth: makeAuth({ user: makeUser({ permissions: EXAM_TEACHER_PERMISSIONS }) }),
    route: '/exams',
  })
  return { ...view, onClose, onDone, onStale }
}

const dialog = () => screen.getByText(TITLE).closest('[role="dialog"]') as HTMLElement
const reasonField = () => within(dialog()).getByLabelText(ar.examAttempts.regrade.reason) as HTMLTextAreaElement
const okButton = () => within(dialog()).getByText(ar.examAttempts.regrade.submit).closest('button') as HTMLButtonElement
const cancelButton = () => within(dialog()).getByText(ar.common.cancel).closest('button') as HTMLButtonElement
const closeIcon = () => dialog().querySelector<HTMLButtonElement>('.ant-modal-close')!
const type = (value: string) => fireEvent.change(reasonField(), { target: { value } })
/** Escape as the browser sends it: the modal listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
/** A click on the mask around the modal (rc-dialog closes on a mouse-down and a click on its wrapper). */
function clickMask() {
  const wrap = dialog().closest('.ant-modal-wrap') as HTMLElement
  fireEvent.mouseDown(wrap)
  fireEvent.click(wrap)
}

/**
 * The dialog's own «discard?» question (examAttempts.regrade.unsaved.*): counted by dialog — an antd confirm shows its
 * title twice — and the latest one is the open one (jsdom never ends the closing animation of an answered one).
 */
const QUESTION = ar.examAttempts.regrade.unsaved
const questionCount = () => new Set(screen.queryAllByText(QUESTION.title).map((title) => title.closest('[role="dialog"]'))).size
async function latestQuestion(): Promise<HTMLElement> {
  const titles = await screen.findAllByText(QUESTION.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}
async function answer(question: HTMLElement, choice: 'discard' | 'keep') {
  await act(async () => {
    fireEvent.click(within(question).getByText(choice === 'discard' ? QUESTION.ok : QUESTION.cancel).closest('button')!)
  })
}

describe('RegradeModal (API-273)', () => {
  it('says what a regrade does, that it normally changes nothing, and what the required reason is for', async () => {
    mockRegradeApi()
    renderModal()
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(within(dialog()).getByText(ar.examAttempts.regrade.what)).toBeInTheDocument()
    expect(within(dialog()).getByText(ar.examAttempts.regrade.usual)).toBeInTheDocument()
    expect(within(dialog()).getByText(ar.examAttempts.regrade.stale)).toBeInTheDocument()
    expect(within(dialog()).getByText(ar.examAttempts.regrade.reasonHint.replace('{{max}}', '500'))).toBeInTheDocument()
    expect(reasonField()).toHaveAttribute('maxlength', String(CORRECTION_REASON_MAX_LENGTH))
    expect(reasonField()).toHaveValue('')
  })

  it('sends nothing without a reason, or with one made of spaces', async () => {
    const posts = mockRegradeApi()
    const { onDone } = renderModal()
    await screen.findByText(TITLE)

    fireEvent.click(okButton())
    expect(await within(dialog()).findByText(ar.examAttempts.regrade.reasonRequired)).toBeInTheDocument()
    type('  \n  ')
    fireEvent.click(okButton())
    // The validation runs in a later task: give a wrong pass the time to send.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(within(dialog()).getByText(ar.examAttempts.regrade.reasonRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
    expect(onDone).not.toHaveBeenCalled()
  })

  it('sends the trimmed reason once as { reason } and hands the server’s counts on; while it runs a second confirm and «cancel» do nothing', async () => {
    let respond: (response: Response) => void = () => {}
    const posts = mockRegradeApi(() => new Promise<Response>((resolve) => (respond = resolve)))
    const { onDone, onClose, onStale } = renderModal()
    await screen.findByText(TITLE)
    type('  تحقق بعد تصحيح مفتاح السؤال الثاني  ')
    fireEvent.click(okButton())

    await waitFor(() => expect(okButton()).toHaveClass('ant-btn-loading'))
    fireEvent.click(okButton())
    fireEvent.click(cancelButton())
    fireEvent.click(closeIcon())
    expect(onClose).not.toHaveBeenCalled()
    expect(questionCount()).toBe(0)

    const summary = makeRegradeSummary({ attempts: 9, changedAttempts: 1, changedResults: 1 })
    await act(async () => respond(jsonResponse(200, summary)))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone).toHaveBeenCalledWith(summary)
    expect(posts).toEqual([{ reason: 'تحقق بعد تصحيح مفتاح السؤال الثاني' }])
    expect(onStale).not.toHaveBeenCalled()
  })

  it('says in a toast, closes and has the drawer re-read the exam when the exam is no longer what it shows: draft again, manual, its class cancelled, gone', async () => {
    const cases: [number, Record<string, unknown>, string][] = [
      [409, { code: 'exam_not_frozen', status: 'draft' }, ar.examAttempts.errors.exam_not_frozen],
      [409, { code: 'exam_not_online', examId: EXAM_ID }, ar.examAttempts.errors.exam_not_online],
      [409, { code: 'class_closed', classId: 'c-1', status: 'cancelled' }, ar.examAttempts.errors.class_closed],
      [404, { code: 'exam_not_found', examId: EXAM_ID }, ar.exams.errors.exam_not_found],
    ]
    for (const [status, body, text] of cases) {
      mockRegradeApi(() => jsonResponse(status, { statusCode: status, message: 'refused', ...body }))
      const { onClose, onDone, onStale, unmount } = renderModal()
      await screen.findByText(TITLE)
      type('مراجعة')
      fireEvent.click(okButton())

      expect(await screen.findByText(text)).toBeInTheDocument()
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(onStale).toHaveBeenCalledTimes(1)
      expect(onDone).not.toHaveBeenCalled()
      // The tab unmounts the dialog on close; the next case renders its own.
      unmount()
    }
  })

  it('keeps the dialog and the typed reason for a refusal the exam did not cause — the permission, a validation, a server or a network failure — and a second try can go through', async () => {
    let step = 0
    const answers: (() => Response)[] = [
      () => jsonResponse(403, { statusCode: 403, code: 'permission_denied', missing: ['exams.grade'], message: 'Missing permission' }),
      () => jsonResponse(400, { statusCode: 400, message: 'reason must be shorter than or equal to 500 characters' }),
      () => jsonResponse(500, { statusCode: 500, message: 'boom' }),
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => jsonResponse(200, makeRegradeSummary()),
    ]
    const posts = mockRegradeApi(() => answers[step++]!())
    const { onClose, onDone, onStale } = renderModal()
    await screen.findByText(TITLE)
    type('مراجعة')

    const texts = [
      'ليست لديك الصلاحية اللازمة لهذا الإجراء (exams.grade)',
      'رفض الخادم البيانات: reason must be shorter than or equal to 500 characters',
      ar.login.errors.server,
      ar.login.errors.network,
    ]
    for (const text of texts) {
      await waitFor(() => expect(okButton()).not.toHaveClass('ant-btn-loading'))
      fireEvent.click(okButton())
      expect(await within(dialog()).findByText(text)).toBeInTheDocument()
      expect(reasonField()).toHaveValue('مراجعة')
    }
    expect(onClose).not.toHaveBeenCalled()
    expect(onStale).not.toHaveBeenCalled()

    await waitFor(() => expect(okButton()).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(okButton())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(posts).toHaveLength(5)
  })
})

describe('RegradeModal — a typed reason is never dropped without asking', () => {
  it('closes at once on Escape, a mask click, × or «cancel» while nothing (or only spaces) is typed', async () => {
    mockRegradeApi()
    const { onClose } = renderModal()
    await screen.findByText(TITLE)
    type('   ')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    clickMask()
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(closeIcon())
    fireEvent.click(cancelButton())
    expect(onClose).toHaveBeenCalledTimes(4)
    expect(questionCount()).toBe(0)
  })

  it('keeps a typed reason on Escape and on a mask click; × and «cancel» ask in the dialog’s own words — keep writing stays, discard closes', async () => {
    const posts = mockRegradeApi()
    const { onClose } = renderModal()
    await screen.findByText(TITLE)
    type('سبب كتبته للتو')
    // A reload or a tab close gets the browser's own prompt.
    expect(unloadWouldPrompt()).toBe(true)

    pressEscape()
    clickMask()
    expect(onClose).not.toHaveBeenCalled()
    expect(questionCount()).toBe(0)

    fireEvent.click(closeIcon())
    const first = await latestQuestion()
    expect(within(first).getByText(QUESTION.content)).toBeInTheDocument()
    // Not the drawers' question about an editor in a drawer.
    expect(discardQuestionCount()).toBe(0)
    await answer(first, 'keep')
    expect(onClose).not.toHaveBeenCalled()
    expect(reasonField()).toHaveValue('سبب كتبته للتو')

    fireEvent.click(cancelButton())
    await waitFor(() => expect(questionCount()).toBe(2))
    await answer(await latestQuestion(), 'discard')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(posts).toEqual([])
  })

  it('lets go once the reason is cleared again: Escape closes', async () => {
    mockRegradeApi()
    const { onClose } = renderModal()
    await screen.findByText(TITLE)
    type('مسودة')
    expect(unloadWouldPrompt()).toBe(true)
    type('')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
