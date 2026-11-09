import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Submission } from '../api/submissions'
import { ar } from '../i18n/ar'
import { ASSIGNMENT_READER_PERMISSIONS, ASSIGNMENT_TEACHER_PERMISSIONS } from '../test/assignments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SUBMISSION_IDS, makeGradedSubmission, makeSubmission, makeSubmissionAssignment } from '../test/submissions'
import { formatZonedDateTime } from './assignments.format'
import { SubmissionReviewPanel } from './SubmissionReviewPanel'

const ZONE = 'Asia/Riyadh'
const SUBMISSION_ID = SUBMISSION_IDS[0]

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET answers `detail()` (re-read on every call); the review answers `review(body)`; every request is recorded. */
function mockSubmissionApi(detail: () => Submission | Response, review?: (body: Record<string, unknown>) => Response) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    if (method === 'GET' && url === `/api/submissions/${SUBMISSION_ID}`) {
      const answer = detail()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'POST' && url === `/api/submissions/${SUBMISSION_ID}/review` && review && body) return review(body)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderPanel({ permissions = ASSIGNMENT_TEACHER_PERMISSIONS, allowLate = true }: { permissions?: string[]; allowLate?: boolean } = {}) {
  const onClose = vi.fn()
  const onReviewed = vi.fn()
  const onStale = vi.fn()
  renderWithProviders(
    <SubmissionReviewPanel submissionId={SUBMISSION_ID} assignment={{ timeZone: ZONE, allowLate }} studentName="سارة الطالبة" onClose={onClose} onReviewed={onReviewed} onStale={onStale} />,
    { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/assignments' },
  )
  return { onClose, onReviewed, onStale }
}

const reviews = (calls: Call[]) => calls.filter((call) => call.method === 'POST')
const details = () => screen.getByTestId('submission-details')
const scoreInput = () => screen.getByLabelText('الدرجة (من 20)')
const feedbackInput = () => screen.getByLabelText(ar.assignments.review.form.feedback)
const submitButton = (action: 'grade' | 'return') => screen.getByText(ar.assignments.review.form.submit[action]).closest('button') as HTMLButtonElement
const chooseReturn = () => fireEvent.click(screen.getByLabelText(ar.assignments.review.form.actions.return))
/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!

async function openDiscardDialog(): Promise<HTMLElement> {
  fireEvent.click(closeButton())
  const titles = await screen.findAllByText(ar.assignments.review.discard.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('SubmissionReviewPanel', () => {
  it('reads the attempt: the student, the attempt counts, the time in the assignment zone, the answer text and its https link; nothing reviewed yet', async () => {
    const calls = mockSubmissionApi(() => makeSubmission())
    renderPanel()

    expect(await screen.findByTestId('submission-text')).toHaveTextContent('الحلقة for تكرّر الأوامر')
    const panel = details()
    expect(within(panel).getByText('سارة الطالبة')).toBeInTheDocument()
    expect(within(panel).getByText('رقم 1 — 1 من 2 محاولة مسموحة')).toBeInTheDocument()
    expect(within(panel).getByText(ar.assignments.submissionStatus.submitted)).toBeInTheDocument()
    expect(within(panel).getByText(formatZonedDateTime('2026-11-18T07:30:00.000Z', ZONE, 'ar'))).toBeInTheDocument()
    expect(within(panel).getByText(ZONE)).toBeInTheDocument()
    expect(within(panel).queryByText(ar.assignments.roster.late)).not.toBeInTheDocument()
    const link = within(panel).getByRole('link')
    expect(link).toHaveAttribute('href', 'https://docs.example.com/sara-loops')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(panel).getByText(ar.assignments.review.notReviewed)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.assignments.review.form.actions.grade)).toBeChecked()
    expect(screen.queryByText(/لا يتيح الخادم بعد قراءة المحاولات السابقة/)).not.toBeInTheDocument()
    expect(calls).toEqual([{ method: 'GET', url: `/api/submissions/${SUBMISSION_ID}`, body: undefined }])
  })

  it('grades with the smallest body (no feedback key for an empty one), then shows the server answer in a new form session', async () => {
    const answer = makeGradedSubmission({ feedback: null })
    const calls = mockSubmissionApi(() => makeSubmission(), () => jsonResponse(200, answer))
    const { onReviewed, onClose } = renderPanel()
    await screen.findByTestId('submission-text')

    await userEvent.type(scoreInput(), '17.5')
    fireEvent.click(submitButton('grade'))

    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith(answer))
    expect(reviews(calls)).toEqual([{ method: 'POST', url: `/api/submissions/${SUBMISSION_ID}/review`, body: { action: 'grade', score: 17.5 } }])
    expect(await screen.findByText(ar.assignments.review.done.grade)).toBeInTheDocument()
    const panel = details()
    expect(within(panel).getByText('17.5 / 20')).toBeInTheDocument()
    expect(within(panel).getByText(ar.assignments.submissionStatus.graded)).toBeInTheDocument()
    expect(within(panel).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(panel).getByText(formatZonedDateTime('2026-11-21T09:00:00.000Z', ZONE, 'ar'))).toBeInTheDocument()
    // The new session starts from the answer: the stored score, nothing unsaved — Escape closes at once.
    expect(scoreInput()).toHaveValue('17.5')
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends the trimmed feedback with a grade', async () => {
    const calls = mockSubmissionApi(() => makeSubmission(), () => jsonResponse(200, makeGradedSubmission()))
    renderPanel()
    await screen.findByTestId('submission-text')
    await userEvent.type(scoreInput(), '17.5')
    await userEvent.type(feedbackInput(), '  عمل جيد؛ راجع شرط التوقف  ')
    fireEvent.click(submitButton('grade'))
    await waitFor(() => expect(reviews(calls)).toHaveLength(1))
    expect(reviews(calls)[0]!.body).toEqual({ action: 'grade', score: 17.5, feedback: 'عمل جيد؛ راجع شرط التوقف' })
  })

  it('returns for rework: the feedback is required locally, the body carries no score, and the answer grants the attempt', async () => {
    const answer = makeSubmission({ status: 'returned', feedback: 'أكمل التمرين الثالث', gradedBy: { fullName: 'خالد المعلم', displayName: null }, gradedAt: '2026-11-21T09:00:00.000Z', attemptsAllowed: 3 })
    const calls = mockSubmissionApi(() => makeSubmission(), () => jsonResponse(200, answer))
    const { onReviewed } = renderPanel()
    await screen.findByTestId('submission-text')

    chooseReturn()
    expect(screen.queryByLabelText('الدرجة (من 20)')).not.toBeInTheDocument()
    expect(screen.getByTestId('review-effects')).toHaveTextContent(ar.assignments.review.effects.grantsAttempt)
    fireEvent.click(submitButton('return'))
    expect(await screen.findByText(ar.assignments.review.validation.feedbackRequired)).toBeInTheDocument()
    expect(reviews(calls)).toEqual([])

    await userEvent.type(feedbackInput(), 'أكمل التمرين الثالث')
    fireEvent.click(submitButton('return'))
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith(answer))
    expect(reviews(calls)).toEqual([{ method: 'POST', url: `/api/submissions/${SUBMISSION_ID}/review`, body: { action: 'return', feedback: 'أكمل التمرين الثالث' } }])
    expect(await screen.findByText(ar.assignments.review.done.return)).toBeInTheDocument()
    expect(within(details()).getByText('رقم 1 — 1 من 3 محاولة مسموحة')).toBeInTheDocument()
    expect(within(details()).getByText(ar.assignments.submissionStatus.returned)).toBeInTheDocument()
  })

  it('announces what a review does: a return clears a grade, and warns when the granted attempt cannot be used (closed, or no late submissions)', async () => {
    mockSubmissionApi(() => makeGradedSubmission({ assignment: makeSubmissionAssignment({ status: 'closed' }) }))
    renderPanel({ allowLate: false })
    await screen.findByTestId('submission-text')
    expect(screen.queryByTestId('review-effects')).not.toBeInTheDocument()
    chooseReturn()
    const effects = screen.getByTestId('review-effects')
    expect(effects).toHaveTextContent(ar.assignments.review.effects.grantsAttempt)
    expect(effects).toHaveTextContent(ar.assignments.review.effects.clearsScore)
    expect(effects).toHaveTextContent(ar.assignments.review.effects.closed)
    expect(effects).toHaveTextContent(ar.assignments.review.effects.noLate)
  })

  it('warns that grading a returned attempt takes back its extra attempt', async () => {
    mockSubmissionApi(() => makeSubmission({ status: 'returned', feedback: 'أكمل التمرين الثالث', gradedAt: '2026-11-20T08:00:00.000Z', attemptsAllowed: 3 }))
    renderPanel()
    await screen.findByTestId('submission-text')
    // A returned attempt opens on its stored review (return); switching to grade shows the effect.
    expect(screen.getByLabelText(ar.assignments.review.form.actions.return)).toBeChecked()
    fireEvent.click(screen.getByLabelText(ar.assignments.review.form.actions.grade))
    expect(screen.getByTestId('review-effects')).toHaveTextContent(ar.assignments.review.effects.withdrawsAttempt)
  })

  it('sends nothing when the review equals the stored one', async () => {
    const calls = mockSubmissionApi(() => makeGradedSubmission())
    renderPanel()
    await screen.findByTestId('submission-text')
    expect(scoreInput()).toHaveValue('17.5')
    expect(feedbackInput()).toHaveValue('عمل جيد؛ راجع شرط التوقف')
    fireEvent.click(submitButton('grade'))
    expect(await screen.findByText(ar.assignments.review.nothingChanged)).toBeInTheDocument()
    expect(reviews(calls)).toEqual([])
  })

  it('refuses a score above the max or with three decimals before any request', async () => {
    const calls = mockSubmissionApi(() => makeSubmission())
    renderPanel()
    await screen.findByTestId('submission-text')
    await userEvent.type(scoreInput(), '25')
    fireEvent.click(submitButton('grade'))
    expect(await screen.findByText('الدرجة من 0 إلى 20 بمنزلتين عشريتين على الأكثر')).toBeInTheDocument()
    await userEvent.clear(scoreInput())
    await userEvent.type(scoreInput(), '17.555')
    fireEvent.click(submitButton('grade'))
    expect(await screen.findByText('الدرجة من 0 إلى 20 بمنزلتين عشريتين على الأكثر')).toBeInTheDocument()
    expect(reviews(calls)).toEqual([])
  })

  it('puts score_out_of_range back on the score field with the max the server names', async () => {
    mockSubmissionApi(
      () => makeSubmission(),
      () => jsonResponse(400, { statusCode: 400, code: 'score_out_of_range', score: 15, maxScore: 10, message: 'The score must be between 0 and 10' }),
    )
    renderPanel()
    await screen.findByTestId('submission-text')
    await userEvent.type(scoreInput(), '15')
    fireEvent.click(submitButton('grade'))
    const message = await screen.findByText('الدرجة من 0 إلى 10.')
    expect(message.closest('.ant-form-item')).toContainElement(scoreInput())
  })

  it('puts feedback_required back on the feedback field', async () => {
    mockSubmissionApi(
      () => makeSubmission(),
      () => jsonResponse(400, { statusCode: 400, code: 'feedback_required', message: 'Returning a submission needs feedback' }),
    )
    renderPanel()
    await screen.findByTestId('submission-text')
    chooseReturn()
    await userEvent.type(feedbackInput(), 'أكمل')
    fireEvent.click(submitButton('return'))
    const message = await screen.findByText(ar.assignments.errors.feedback_required)
    expect(message.closest('.ant-form-item')).toContainElement(feedbackInput())
  })

  it('closes and has the roster re-read when the submission is gone at review time (404)', async () => {
    mockSubmissionApi(
      () => makeSubmission(),
      () => jsonResponse(404, { statusCode: 404, code: 'submission_not_found', submissionId: SUBMISSION_ID, message: 'No submission' }),
    )
    const { onClose, onStale } = renderPanel()
    await screen.findByTestId('submission-text')
    await userEvent.type(scoreInput(), '12')
    fireEvent.click(submitButton('grade'))
    expect(await screen.findByText(ar.assignments.errors.submission_not_found)).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('shows a 404 on read and has the roster re-read', async () => {
    mockSubmissionApi(() => jsonResponse(404, { statusCode: 404, code: 'submission_not_found', submissionId: SUBMISSION_ID, message: 'No submission' }))
    const { onStale } = renderPanel()
    expect(await screen.findByText(ar.assignments.errors.submission_not_found)).toBeInTheDocument()
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('review-form')).not.toBeInTheDocument()
  })

  it('shows a reader without assignments.grade the attempt read-only', async () => {
    mockSubmissionApi(() => makeGradedSubmission({ attemptNo: 2, attempts: 2, attemptsAllowed: 3 }))
    renderPanel({ permissions: ASSIGNMENT_READER_PERMISSIONS })
    expect(await screen.findByText(ar.assignments.review.readOnly)).toBeInTheDocument()
    expect(screen.queryByTestId('review-form')).not.toBeInTheDocument()
    expect(within(details()).getByText('عمل جيد؛ راجع شرط التوقف')).toBeInTheDocument()
    expect(screen.getByText('هذه المحاولة رقم 2؛ لا يتيح الخادم بعد قراءة المحاولات السابقة.')).toBeInTheDocument()
  })

  it('closes at once on Escape while nothing is typed', async () => {
    mockSubmissionApi(() => makeSubmission())
    const { onClose } = renderPanel()
    await screen.findByTestId('submission-text')
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(ar.assignments.review.discard.title)).not.toBeInTheDocument()
  })

  it('keeps typed feedback on Escape and on a mask click; the close button asks — keep reviewing stays, discard closes', async () => {
    const calls = mockSubmissionApi(() => makeSubmission())
    const { onClose } = renderPanel()
    await screen.findByTestId('submission-text')
    await userEvent.type(feedbackInput(), 'ملاحظة لم تُحفظ')

    pressEscape()
    pressEscape()
    fireEvent.click(mask())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText(ar.assignments.review.discard.title)).not.toBeInTheDocument()
    expect(feedbackInput()).toHaveValue('ملاحظة لم تُحفظ')

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.assignments.review.discard.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.assignments.review.discard.cancel).closest('button')!)
    await waitFor(() => expect(feedbackInput()).toHaveValue('ملاحظة لم تُحفظ'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.assignments.review.discard.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(reviews(calls)).toEqual([])
  })
})
