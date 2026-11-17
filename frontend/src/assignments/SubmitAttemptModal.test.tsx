import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MyAssignmentItem } from '../api/myAssignments'
import { ar } from '../i18n/ar'
import { ASSIGNMENT_ID, ASSIGNMENT_ID_2 } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { PAST_DUE, STUDENT_LEARNER_PERMISSIONS, makeLatest, makeMyAssignment, makeMySubmission } from '../test/myAssignments'
import { SELF_STUDENT } from '../test/myLessons'
import { blockerStates, discardQuestionCount, goBack, renderInDataRouter, unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SubmitAttemptModal } from './SubmitAttemptModal'
import { formatZonedDateTime } from './assignments.format'

type Answer = Response | (() => Response | Promise<Response>)

/** Serves POST /api/assignments/:id/submissions (one answer per call, the last repeats) and records each body. */
function mockSubmitApi(...answers: Answer[]) {
  const posts: { url: string; body: unknown }[] = []
  mockFetch((url, init) => {
    if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/submissions')) {
      posts.push({ url, body: JSON.parse(String(init?.body)) })
      const answer = answers[Math.min(posts.length - 1, answers.length - 1)] ?? jsonResponse(201, makeMySubmission())
      return typeof answer === 'function' ? answer() : answer.clone()
    }
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return { posts }
}

const studentAuth = () => makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_LEARNER_PERMISSIONS }) })

function renderModal(item: MyAssignmentItem | null = makeMyAssignment()) {
  const onSubmitted = vi.fn()
  const onClose = vi.fn()
  const onStale = vi.fn()
  const view = renderWithProviders(<SubmitAttemptModal item={item} onClose={onClose} onSubmitted={onSubmitted} onStale={onStale} />, { auth: studentAuth(), route: '/my-assignments' })
  const rerender = (next: MyAssignmentItem | null) => view.rerender(<SubmitAttemptModal item={next} onClose={onClose} onSubmitted={onSubmitted} onStale={onStale} />)
  return { onSubmitted, onClose, onStale, rerender }
}

const dialog = () => screen.getByText(ar.myAssignments.submit.ok).closest('[role="dialog"]') as HTMLElement
const okButton = () => within(dialog()).getByText(ar.myAssignments.submit.ok).closest('button')!
const cancelButton = () => within(dialog()).getByText(ar.common.cancel).closest('button')!
const closeIcon = () => dialog().querySelector<HTMLButtonElement>('.ant-modal-close')!
const textField = () => within(dialog()).getByLabelText(ar.myAssignments.submit.textAnswer)
const linkField = () => within(dialog()).getByLabelText(ar.myAssignments.submit.linkUrl)
/** Escape as the browser sends it: the modal listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
/** A click on the mask around the modal (rc-dialog closes on a mouse-down and a click on its wrapper). */
function clickMask() {
  const wrap = dialog().closest('.ant-modal-wrap') as HTMLElement
  fireEvent.mouseDown(wrap)
  fireEvent.click(wrap)
}
const confirmTitle = (number: number) => ar.myAssignments.submit.confirm.title.replace('{{number}}', String(number))

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
}

/**
 * Clicks the modal's OK and returns the D-R38 confirmation it opens. A confirmation closed earlier stays in the DOM
 * (jsdom never ends antd's closing animation), so this waits for one more title than before the click.
 */
async function openConfirm(number = 1): Promise<HTMLElement> {
  const title = confirmTitle(number)
  const before = screen.queryAllByText(title).length
  fireEvent.click(okButton())
  const titles = await waitFor(() => {
    const found = screen.getAllByText(title)
    expect(found.length).toBeGreaterThan(before)
    return found
  })
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

async function confirmSend(number = 1) {
  const confirm = await openConfirm(number)
  fireEvent.click(within(confirm).getByText(ar.myAssignments.submit.confirm.ok, { selector: 'button span' }).closest('button')!)
}

/** The number of D-R38 confirmations opened so far (antd renders a confirmation's title twice — counted by dialog). */
const confirmCount = (number = 1) => new Set(screen.queryAllByText(confirmTitle(number)).map((title) => title.closest('[role="dialog"]'))).size

/**
 * The dialog's own «discard?» question (myAssignments.submit.unsaved.* — useUnsavedChangesGuard with that prefix), the helpers of
 * test/navigation.tsx for the drawers' common.unsaved.* question: counted by dialog (antd shows a confirm's title
 * twice), the latest one is the open one (jsdom never ends the closing animation of an answered one).
 */
const ANSWER_QUESTION = ar.myAssignments.submit.unsaved
const answerQuestionCount = () => new Set(screen.queryAllByText(ANSWER_QUESTION.title).map((title) => title.closest('[role="dialog"]'))).size
async function latestAnswerQuestion(): Promise<HTMLElement> {
  const titles = await screen.findAllByText(ANSWER_QUESTION.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}
/** Answers the question; a navigation it lets go on completes inside `act`. */
async function answerQuestion(question: HTMLElement, answer: 'discard' | 'keep') {
  const label = answer === 'discard' ? ANSWER_QUESTION.ok : ANSWER_QUESTION.cancel
  await act(async () => {
    fireEvent.click(within(question).getByText(label).closest('button')!)
  })
}

describe('SubmitAttemptModal (API-109)', () => {
  it('shows what the student needs before answering: class, due date in the assignment zone, maximum score, the attempt number, the instructions and that an attempt cannot be edited', async () => {
    mockSubmitApi()
    renderModal()
    expect(await screen.findByText('تسليم الواجب — تمارين الحلقات')).toBeInTheDocument()
    const modal = dialog()
    expect(within(modal).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(modal).getByText(formatZonedDateTime(makeMyAssignment().dueAt!, 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(modal).getByText('(Asia/Riyadh)')).toBeInTheDocument()
    expect(within(modal).getByText('20')).toBeInTheDocument()
    expect(within(modal).getByText('المحاولة 1 من 1')).toBeInTheDocument()
    expect(within(modal).getByText('حلّ تمارين الصفحة 12')).toBeInTheDocument()
    expect(within(modal).getByText(ar.myAssignments.submit.immutable)).toBeInTheDocument()
    // On time: no late warning.
    expect(within(modal).queryByText(ar.myAssignments.submit.late)).not.toBeInTheDocument()
  })

  it('refuses an empty attempt and a non-https link locally, with its own Arabic messages, and sends nothing', async () => {
    const { posts } = mockSubmitApi()
    renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)

    type(textField(), '   ')
    fireEvent.click(okButton())
    expect(await within(dialog()).findByText(ar.myAssignments.validation.answerRequired)).toBeInTheDocument()

    type(linkField(), 'http://docs.example.com/answer')
    expect(await within(dialog()).findByText(ar.myAssignments.validation.link)).toBeInTheDocument()
    // A link alone is an answer: the «answer required» message goes once the link is typed.
    await waitFor(() => expect(within(dialog()).queryByText(ar.myAssignments.validation.answerRequired)).not.toBeInTheDocument())
    fireEvent.click(okButton())
    await waitFor(() => expect(within(dialog()).getByText(ar.myAssignments.validation.link)).toBeInTheDocument())
    expect(screen.queryByText(confirmTitle(1))).not.toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('confirms that the attempt cannot be edited (D-R38) — «back» sends nothing, «send» posts the trimmed answer with the attempt meant and hands the stored attempt back', async () => {
    const stored = makeMySubmission()
    const { posts } = mockSubmitApi(jsonResponse(201, stored))
    const { onSubmitted, onStale } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), '  الحلقة for تكرر الأوامر  ')
    type(linkField(), ' https://docs.example.com/answer ')

    const first = await openConfirm()
    // One attempt allowed: this is the last one.
    expect(within(first).getByText(ar.myAssignments.submit.confirm.last)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.myAssignments.submit.confirm.cancel).closest('button')!)
    await waitFor(() => expect(textField()).toHaveValue('  الحلقة for تكرر الأوامر  '))
    expect(posts).toEqual([])

    await confirmSend()
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(stored))
    expect(posts).toEqual([
      { url: `/api/assignments/${ASSIGNMENT_ID}/submissions`, body: { textAnswer: 'الحلقة for تكرر الأوامر', linkUrl: 'https://docs.example.com/answer', attemptNo: 1 } },
    ])
    expect(onStale).not.toHaveBeenCalled()
    // Sent: nothing is held any more.
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('numbers a new attempt after the latest one and names the attempts left after it; a returned attempt shows its feedback', async () => {
    const { posts } = mockSubmitApi(jsonResponse(201, makeMySubmission({ attemptNo: 2, attempts: 2, attemptsAllowed: 3 })))
    renderModal(makeMyAssignment({ maxAttempts: 2, attempts: 1, attemptsAllowed: 3, latest: makeLatest({ status: 'returned', feedback: 'أكمل التمرين الثالث', gradedAt: '2026-11-11T09:00:00.000Z' }) }))
    await screen.findByText('المحاولة 2 من 3')
    expect(within(dialog()).getByText('ملاحظات المعلم على المحاولة 1')).toBeInTheDocument()
    expect(within(dialog()).getByText('أكمل التمرين الثالث')).toBeInTheDocument()

    type(linkField(), 'https://docs.example.com/v2')
    const confirm = await openConfirm(2)
    expect(within(confirm).getByText(ar.myAssignments.submit.confirm.remaining.replace('{{count}}', '1'))).toBeInTheDocument()
    fireEvent.click(within(confirm).getByText(ar.myAssignments.submit.confirm.ok, { selector: 'button span' }).closest('button')!)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.body).toEqual({ linkUrl: 'https://docs.example.com/v2', attemptNo: 2 })
  })

  it('warns that an attempt is marked late when the server says so, with the penalty the grades module applies later', async () => {
    mockSubmitApi()
    renderModal(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true, latePenaltyPercent: 10, submitsLate: true }))
    expect(await screen.findByText(ar.myAssignments.submit.latePenalty.replace('{{percent}}', '10'))).toBeInTheDocument()
  })

  it('takes «late» from the server, never from this device’s clock: a due date past here, on time for the server, warns nothing (#109 note 1)', async () => {
    mockSubmitApi()
    renderModal(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true, submitsLate: false }))
    await screen.findByText(ar.myAssignments.submit.ok)
    expect(within(dialog()).queryByText(ar.myAssignments.submit.late)).not.toBeInTheDocument()
  })

  it('puts submission_invalid on the answer field and lets the student try again — with the same attempt number', async () => {
    const { posts } = mockSubmitApi(jsonResponse(400, { statusCode: 400, code: 'submission_invalid', message: 'A submission needs a text answer or a link' }), jsonResponse(201, makeMySubmission()))
    const { onSubmitted, onStale } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب')
    await confirmSend()
    expect(await within(dialog()).findByText(ar.myAssignments.errors.submission_invalid)).toBeInTheDocument()
    expect(onStale).not.toHaveBeenCalled()

    await waitFor(() => expect(okButton()).not.toHaveClass('ant-btn-loading'))
    expect(okButton()).toBeEnabled()
    type(textField(), 'جواب كامل')
    await confirmSend()
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(posts.map((post) => post.body)).toEqual([
      { textAnswer: 'جواب', attemptNo: 1 },
      { textAnswer: 'جواب كامل', attemptNo: 1 },
    ])
  })

  it.each([
    ['attempts_exhausted', 409, { maxAttempts: 2, attempts: 2 }, 'استُنفدت محاولاتك لهذا الواجب (2 من 2).'],
    ['assignment_closed', 409, { reason: 'past_due', dueAt: PAST_DUE }, ar.myAssignments.errors.assignment_closed_past_due],
    ['assignment_closed', 409, { reason: 'closed', dueAt: null }, ar.myAssignments.errors.assignment_closed_closed],
    ['not_enrolled', 403, { classId: 'c-1' }, ar.myAssignments.errors.not_enrolled],
    ['assignment_not_found', 404, { assignmentId: ASSIGNMENT_ID }, ar.myAssignments.errors.assignment_not_found],
  ])('stops sending on %s (%i) — the form keeps the text to copy, the page re-reads its list', async (code, status, details, text) => {
    mockSubmitApi(jsonResponse(status, { statusCode: status, code, message: 'refused', ...details }))
    const { onSubmitted, onStale } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جوابي الطويل')
    await confirmSend()
    expect(await within(dialog()).findByText(text)).toBeInTheDocument()
    expect(within(dialog()).getByText(ar.myAssignments.submit.stopped)).toBeInTheDocument()
    await waitFor(() => expect(okButton()).toBeDisabled())
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(textField()).toHaveValue('جوابي الطويل')
    expect(textField()).toBeEnabled()
  })

  it('keeps the send button after a server failure so the student can retry', async () => {
    const { posts } = mockSubmitApi(jsonResponse(500, { statusCode: 500, message: 'boom' }))
    const { onStale } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب')
    await confirmSend()
    expect(await within(dialog()).findByText(ar.login.errors.server)).toBeInTheDocument()
    await waitFor(() => expect(okButton()).not.toHaveClass('ant-btn-loading'))
    expect(okButton()).toBeEnabled()
    expect(onStale).not.toHaveBeenCalled()
    expect(posts).toHaveLength(1)
  })

  it('resends the same attempt number after a lost answer: the server says the attempt was received (409 attempt_conflict) instead of using another one (D-R49)', async () => {
    const { posts } = mockSubmitApi(
      () => {
        // The first try reached the server, but its answer was lost on the way back.
        throw new TypeError('Failed to fetch')
      },
      jsonResponse(409, { statusCode: 409, code: 'attempt_conflict', expected: 1, next: 2, message: 'Attempt 1 is not the next attempt (2); it may already have been submitted' }),
    )
    const { onSubmitted, onStale } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جوابي')
    await confirmSend()
    expect(await within(dialog()).findByText(ar.login.errors.network)).toBeInTheDocument()
    expect(onStale).not.toHaveBeenCalled()

    await waitFor(() => expect(okButton()).not.toHaveClass('ant-btn-loading'))
    await confirmSend()
    const outcome = await within(dialog()).findByTestId('submit-outcome')
    expect(outcome).toHaveTextContent(ar.myAssignments.errors.attempt_conflict.replace('{{expected}}', '1'))
    expect(outcome).toHaveClass('ant-alert-info')
    expect(within(dialog()).queryByText(ar.myAssignments.submit.stopped)).not.toBeInTheDocument()
    expect(posts.map((post) => post.body)).toEqual([
      { textAnswer: 'جوابي', attemptNo: 1 },
      { textAnswer: 'جوابي', attemptNo: 1 },
    ])
    // Final: no third try, and the page re-reads its list to show the received attempt.
    await waitFor(() => expect(okButton()).toBeDisabled())
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it('opens one confirmation for a double click on «send», and none while the attempt is on its way (#109)', async () => {
    const held: { release?: () => void } = {}
    const { posts } = mockSubmitApi(() => new Promise<Response>((resolve) => (held.release = () => resolve(jsonResponse(201, makeMySubmission())))))
    const { onSubmitted } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب')

    fireEvent.click(okButton())
    fireEvent.click(okButton())
    await waitFor(() => expect(confirmCount()).toBe(1))
    // «Send» again while the confirmation is open (a click that slips under its mask, or Enter on the focused button).
    fireEvent.click(okButton())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(confirmCount()).toBe(1)
    const confirm = screen.getAllByText(confirmTitle(1)).at(-1)!.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(confirm).getByText(ar.myAssignments.submit.confirm.ok, { selector: 'button span' }).closest('button')!)
    await waitFor(() => expect(posts).toHaveLength(1))

    // The request runs: another «send» opens nothing.
    fireEvent.click(okButton())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(confirmCount()).toBe(1)
    await act(async () => {
      held.release?.()
    })
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(posts).toHaveLength(1)
  })

  it('lays the link field out left to right in the Arabic UI: the class of the LTR rule beats antd’s -rtl class (QA 2026-11-17)', async () => {
    mockSubmitApi()
    renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)

    // jsdom applies no stylesheet: assert what `input.my-assignments__link.ant-input { direction: ltr }`
    // (myAssignments.css) targets. antd's `.ant-input-rtl` is why `dir="ltr"` alone showed `https://` as `//:https`.
    const link = linkField()
    expect(link.tagName).toBe('INPUT')
    expect(link).toHaveClass('ant-input', 'ant-input-rtl', 'my-assignments__link')
    expect(link).toHaveAttribute('dir', 'ltr')
    expect(link).toHaveAttribute('placeholder', 'https://')
    // The answer text keeps its own direction (dir="auto"): it is not LTR-forced.
    expect(textField()).not.toHaveClass('my-assignments__link')
    // The hint under the field names `https://` inside Arabic text: LRI … PDI keep it from reading «//:https» (re-verification).
    expect(screen.getByText(ar.myAssignments.submit.linkHint).textContent).toContain('\u2066https://\u2069')
  })

  it('mounts its form per session (KI-049): another assignment opens with an empty answer', async () => {
    mockSubmitApi()
    const { rerender } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'مسودة لم تُرسل')
    type(linkField(), 'https://docs.example.com/draft')

    // Closed (rc-dialog keeps the closing content on screen in jsdom), then opened on another assignment.
    rerender(null)
    rerender(makeMyAssignment({ id: ASSIGNMENT_ID_2, title: { ar: 'واجب الدوال' } }))
    expect(await screen.findByText('تسليم الواجب — واجب الدوال')).toBeInTheDocument()
    expect(textField()).toHaveValue('')
    expect(linkField()).toHaveValue('')
  })
})

describe('SubmitAttemptModal — the typed answer is never lost without asking (#109)', () => {
  it('closes at once on Escape, a mask click, × or «cancel» while nothing (or only spaces) is typed', async () => {
    mockSubmitApi()
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), '   ')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    clickMask()
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(closeIcon())
    fireEvent.click(cancelButton())
    expect(onClose).toHaveBeenCalledTimes(4)
    expect(answerQuestionCount()).toBe(0)
  })

  it('asks in the dialog’s own words — an unsent answer in a dialog — never the drawers’ question about an editor in a drawer (QA 2026-11-17)', async () => {
    mockSubmitApi()
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب لم يُرسل')

    fireEvent.click(closeIcon())
    const question = await latestAnswerQuestion()
    expect(within(question).getAllByText(ANSWER_QUESTION.title).length).toBeGreaterThan(0)
    expect(within(question).getByText(ANSWER_QUESTION.content)).toBeInTheDocument()
    expect(within(question).getByText(ANSWER_QUESTION.ok)).toBeInTheDocument()
    expect(within(question).getByText(ANSWER_QUESTION.cancel)).toBeInTheDocument()
    // Nothing of common.unsaved («في هذا الدرج محرّر مفتوح… إغلاق الدرج يتجاهلها»).
    expect(discardQuestionCount()).toBe(0)
    expect(screen.queryByText(ar.common.unsaved.content)).not.toBeInTheDocument()
    expect(ANSWER_QUESTION.content).not.toMatch(/الدرج/)
    await answerQuestion(question, 'keep')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps a typed answer on Escape and on a mask click; × asks — keep editing stays with the text, discard closes', async () => {
    const { posts } = mockSubmitApi()
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب طويل كتبته للتو')
    expect(unloadWouldPrompt()).toBe(true)

    pressEscape()
    clickMask()
    expect(onClose).not.toHaveBeenCalled()
    expect(answerQuestionCount()).toBe(0)
    expect(textField()).toHaveValue('جواب طويل كتبته للتو')

    fireEvent.click(closeIcon())
    const first = await latestAnswerQuestion()
    expect(within(first).getByText(ANSWER_QUESTION.content)).toBeInTheDocument()
    await answerQuestion(first, 'keep')
    expect(onClose).not.toHaveBeenCalled()
    expect(textField()).toHaveValue('جواب طويل كتبته للتو')

    fireEvent.click(closeIcon())
    await waitFor(() => expect(answerQuestionCount()).toBe(2))
    await answerQuestion(await latestAnswerQuestion(), 'discard')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(posts).toEqual([])
  })

  it('asks on «cancel» too, and for a link typed alone', async () => {
    mockSubmitApi()
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(linkField(), 'https://docs.example.com/answer')

    fireEvent.click(cancelButton())
    const question = await latestAnswerQuestion()
    await answerQuestion(question, 'discard')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('lets go once the typed text is cleared again: Escape closes', async () => {
    mockSubmitApi()
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'مسودة')
    expect(unloadWouldPrompt()).toBe(true)
    type(textField(), '')
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the guard after a refusal that ends the session: the text stays to copy, closing still asks', async () => {
    mockSubmitApi(jsonResponse(409, { statusCode: 409, code: 'attempts_exhausted', maxAttempts: 1, attempts: 1, message: 'No attempt left' }))
    const { onClose } = renderModal()
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جوابي الذي لم يُقبل')
    await confirmSend()
    expect(await within(dialog()).findByText(ar.myAssignments.submit.stopped)).toBeInTheDocument()
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(closeIcon())
    expect(await latestAnswerQuestion()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('holds a browser back while an answer is typed: «keep editing» stays, «discard» goes back and closes', async () => {
    mockSubmitApi()
    const onClose = vi.fn()
    const { router } = renderInDataRouter(<SubmitAttemptModal item={makeMyAssignment()} onClose={onClose} onSubmitted={vi.fn()} onStale={vi.fn()} />, {
      auth: studentAuth(),
      path: '/my-assignments',
    })
    await screen.findByText(ar.myAssignments.submit.ok)
    type(textField(), 'جواب لم يُرسل')

    await goBack(router)
    const first = await latestAnswerQuestion()
    expect(router.state.location.pathname).toBe('/my-assignments')
    await answerQuestion(first, 'keep')
    expect(blockerStates(router)).toEqual(['unblocked'])
    expect(router.state.location.pathname).toBe('/my-assignments')
    expect(textField()).toHaveValue('جواب لم يُرسل')
    expect(onClose).not.toHaveBeenCalled()

    await goBack(router)
    await answerQuestion(await latestAnswerQuestion(), 'discard')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets a browser back through while nothing is typed', async () => {
    mockSubmitApi()
    const onClose = vi.fn()
    const { router } = renderInDataRouter(<SubmitAttemptModal item={makeMyAssignment()} onClose={onClose} onSubmitted={vi.fn()} onStale={vi.fn()} />, {
      auth: studentAuth(),
      path: '/my-assignments',
    })
    await screen.findByText(ar.myAssignments.submit.ok)
    await goBack(router)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(answerQuestionCount()).toBe(0)
  })
})
