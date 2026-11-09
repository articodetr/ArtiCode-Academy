import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MyAssignmentItem } from '../api/myAssignments'
import { ar } from '../i18n/ar'
import { ASSIGNMENT_ID, ASSIGNMENT_ID_2 } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { PAST_DUE, STUDENT_LEARNER_PERMISSIONS, makeLatest, makeMyAssignment, makeMySubmission } from '../test/myAssignments'
import { SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SubmitAttemptModal } from './SubmitAttemptModal'
import { formatZonedDateTime } from './assignments.format'

type Answer = Response | (() => Response)

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

function renderModal(item: MyAssignmentItem | null = makeMyAssignment()) {
  const onSubmitted = vi.fn()
  const onClose = vi.fn()
  const onStale = vi.fn()
  const auth = makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_LEARNER_PERMISSIONS }) })
  const view = renderWithProviders(<SubmitAttemptModal item={item} onClose={onClose} onSubmitted={onSubmitted} onStale={onStale} />, { auth, route: '/my-assignments' })
  const rerender = (next: MyAssignmentItem | null) => view.rerender(<SubmitAttemptModal item={next} onClose={onClose} onSubmitted={onSubmitted} onStale={onStale} />)
  return { onSubmitted, onClose, onStale, rerender }
}

const dialog = () => screen.getByText(ar.myAssignments.submit.ok).closest('[role="dialog"]') as HTMLElement
const okButton = () => within(dialog()).getByText(ar.myAssignments.submit.ok).closest('button')!
const textField = () => within(dialog()).getByLabelText(ar.myAssignments.submit.textAnswer)
const linkField = () => within(dialog()).getByLabelText(ar.myAssignments.submit.linkUrl)

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
}

/**
 * Clicks the modal's OK and returns the D-R38 confirmation it opens. A confirmation closed earlier stays in the DOM
 * (jsdom never ends antd's closing animation), so this waits for one more title than before the click.
 */
async function openConfirm(number = 1): Promise<HTMLElement> {
  const title = ar.myAssignments.submit.confirm.title.replace('{{number}}', String(number))
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
    expect(screen.queryByText(ar.myAssignments.submit.confirm.title.replace('{{number}}', '1'))).not.toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('confirms that the attempt cannot be edited (D-R38) — «back» sends nothing, «send» posts the trimmed answer and hands the stored attempt back', async () => {
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
    expect(posts).toEqual([{ url: `/api/assignments/${ASSIGNMENT_ID}/submissions`, body: { textAnswer: 'الحلقة for تكرر الأوامر', linkUrl: 'https://docs.example.com/answer' } }])
    expect(onStale).not.toHaveBeenCalled()
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
    expect(posts[0]!.body).toEqual({ linkUrl: 'https://docs.example.com/v2' })
  })

  it('warns that a late attempt is marked late, with the penalty the grades module applies later', async () => {
    mockSubmitApi()
    renderModal(makeMyAssignment({ dueAt: PAST_DUE, allowLate: true, latePenaltyPercent: 10 }))
    expect(await screen.findByText(ar.myAssignments.submit.latePenalty.replace('{{percent}}', '10'))).toBeInTheDocument()
  })

  it('puts submission_invalid on the answer field and lets the student try again', async () => {
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
    expect(posts).toHaveLength(2)
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
