import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MyAssignmentItem, MySubmission } from '../api/myAssignments'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { GUARDIAN_LEARNER_PERMISSIONS, STUDENT_LEARNER_PERMISSIONS, SUBMISSION_ID, SUBMISSION_ID_2, makeLatest, makeMyAssignment, makeMySubmission, mySummaryOf } from '../test/myAssignments'
import { CHILD_ONE, SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MySubmissionDrawer } from './MySubmissionDrawer'
import { formatZonedDateTime } from './assignments.format'

const GRADED = makeMySubmission({
  isLate: true,
  status: 'graded',
  score: 18,
  feedback: 'أحسنت\nراجع التمرين الثاني',
  gradedBy: { fullName: 'خالد المعلم', displayName: null },
  gradedAt: '2026-11-11T09:00:00.000Z',
})

/** Serves GET /api/submissions/:id (one answer per call, the last repeats) and records the paths read. */
function mockSubmissionApi(...answers: (MySubmission | Response)[]) {
  const paths: string[] = []
  mockFetch((url) => {
    paths.push(url)
    const answer = answers[Math.min(paths.length - 1, answers.length - 1)]!
    return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
  })
  return { paths }
}

function renderDrawer(item: MyAssignmentItem | null, guardian = false) {
  const onLoaded = vi.fn()
  const onClose = vi.fn()
  const user = guardian
    ? makeUser({ id: 'guardian-1', role: 'guardian', roles: ['guardian'], permissions: GUARDIAN_LEARNER_PERMISSIONS })
    : makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_LEARNER_PERMISSIONS })
  renderWithProviders(<MySubmissionDrawer item={item} onClose={onClose} onLoaded={onLoaded} />, { auth: makeAuth({ user }), route: '/my-assignments' })
  return { onLoaded, onClose }
}

const drawer = () => document.querySelector<HTMLElement>('.ant-drawer-body')!

describe('MySubmissionDrawer (API-110)', () => {
  it('shows the student their latest attempt: number, time in the assignment zone with the late mark, status, score, feedback, reviewer by name, and the answer', async () => {
    const { paths } = mockSubmissionApi(GRADED)
    const { onLoaded } = renderDrawer(makeMyAssignment({ attempts: 1, latest: makeLatest({ status: 'graded', score: 18 }) }))

    expect(await screen.findByText('تسليمي — تمارين الحلقات')).toBeInTheDocument()
    const panel = drawer()
    expect(await within(panel).findByText('رقم 1 — 1 من 1 محاولة مسموحة')).toBeInTheDocument()
    expect(within(panel).getByText(formatZonedDateTime(GRADED.submittedAt, 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.submission.late)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.submission.graded)).toBeInTheDocument()
    expect(within(panel).getByText('18 / 20')).toBeInTheDocument()
    expect(within(panel).getByText(/راجع التمرين الثاني/)).toBeInTheDocument()
    expect(within(panel).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(panel).getByText(formatZonedDateTime(GRADED.gradedAt!, 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(panel).getByTestId('my-submission-text')).toHaveTextContent('الحلقة for تكرر الأوامر')
    const link = within(panel).getByText('https://docs.example.com/answer').closest('a')!
    expect(link).toHaveAttribute('href', 'https://docs.example.com/answer')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // The zone is named when it is not this device's (the fixture zone is neither CI's nor the developers').
    expect(within(panel).getByText('Asia/Riyadh')).toBeInTheDocument()
    // One attempt: no list of attempts; the student's own name is not repeated.
    expect(within(panel).queryByTestId('my-submission-history')).not.toBeInTheDocument()
    expect(within(panel).queryByText(ar.myAssignments.drawer.student)).not.toBeInTheDocument()

    expect(paths).toEqual([`/api/submissions/${SUBMISSION_ID}`])
    expect(onLoaded).toHaveBeenCalledWith(GRADED)
    // Nothing the contract hides, and no id on screen.
    expect(panel.textContent).not.toContain(SUBMISSION_ID)
    expect(panel.textContent).not.toContain(SELF_STUDENT.id)
  })

  it('names the child for a guardian, and says when an attempt is not reviewed yet', async () => {
    mockSubmissionApi(makeMySubmission({ student: CHILD_ONE, textAnswer: null }))
    renderDrawer(makeMyAssignment({ relation: 'child', student: CHILD_ONE, attempts: 1, latest: makeLatest() }), true)

    expect(await screen.findByText('تسليم عمر — تمارين الحلقات')).toBeInTheDocument()
    const panel = drawer()
    expect(await within(panel).findByText(ar.myAssignments.drawer.student)).toBeInTheDocument()
    expect(within(panel).getByText('عمر')).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.submission.submitted)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.notGraded)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.drawer.notReviewed)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.drawer.noFeedback)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.drawer.noText)).toBeInTheDocument()
  })

  it('says the reviewer’s account is gone when a reviewed attempt names nobody', async () => {
    mockSubmissionApi(makeMySubmission({ id: SUBMISSION_ID_2, attemptNo: 2, attempts: 2, attemptsAllowed: 2, status: 'returned', feedback: 'أعد الحل', gradedAt: '2026-11-12T09:00:00.000Z', linkUrl: null }))
    renderDrawer(makeMyAssignment({ attempts: 2, attemptsAllowed: 2, latest: makeLatest({ id: SUBMISSION_ID_2, attemptNo: 2, status: 'returned', feedback: 'أعد الحل' }) }))

    const panel = await waitFor(() => {
      const found = drawer()
      expect(within(found).getByText(ar.myAssignments.drawer.reviewerGone)).toBeInTheDocument()
      return found
    })
    expect(within(panel).getAllByText(ar.myAssignments.submission.returned).length).toBeGreaterThan(0)
    expect(within(panel).getByText(ar.myAssignments.notGraded)).toBeInTheDocument()
    expect(within(panel).getByText(ar.myAssignments.drawer.noLink)).toBeInTheDocument()
  })

  it('lists every attempt of the student (MOD-08-T07) and opens an earlier one through API-110 — the row keeps its latest', async () => {
    const first = makeMySubmission({ status: 'graded', score: 12, feedback: 'جيد', gradedAt: '2026-11-10T12:00:00.000Z', attempts: 2, attemptsAllowed: 2 })
    const second = makeMySubmission({ id: SUBMISSION_ID_2, attemptNo: 2, submittedAt: '2026-11-11T08:00:00.000Z', isLate: true, textAnswer: 'محاولتي الثانية', attempts: 2, attemptsAllowed: 2 })
    const history = [mySummaryOf(first), mySummaryOf(second)]
    const answers: Record<string, MySubmission> = { [SUBMISSION_ID]: { ...first, history }, [SUBMISSION_ID_2]: { ...second, history } }
    const paths: string[] = []
    mockFetch((url) => {
      paths.push(url)
      const id = url.split('/').at(-1)!
      return answers[id] ? jsonResponse(200, answers[id]) : jsonResponse(404, { statusCode: 404, code: 'submission_not_found', message: 'No submission' })
    })
    const onLoaded = vi.fn()
    renderWithProviders(
      <MySubmissionDrawer item={makeMyAssignment({ attempts: 2, attemptsAllowed: 2, latest: makeLatest({ id: SUBMISSION_ID_2, attemptNo: 2, isLate: true }) })} onClose={vi.fn()} onLoaded={onLoaded} />,
      { auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role: 'student', roles: ['student'], permissions: STUDENT_LEARNER_PERMISSIONS }) }), route: '/my-assignments' },
    )

    expect(await screen.findByTestId('my-submission-text')).toHaveTextContent('محاولتي الثانية')
    const list = screen.getByTestId('my-submission-history')
    expect(within(list).getByText(ar.myAssignments.drawer.history.title)).toBeInTheDocument()
    const one = within(list).getByTestId('my-history-attempt-1')
    expect(within(one).getByText(ar.myAssignments.submission.graded)).toBeInTheDocument()
    expect(within(one).getByText('12 / 20')).toBeInTheDocument()
    const two = within(list).getByTestId('my-history-attempt-2')
    expect(within(two).getByText(ar.myAssignments.submission.late)).toBeInTheDocument()
    expect(within(two).getByText(ar.myAssignments.drawer.history.current)).toBeInTheDocument()

    fireEvent.click(within(list).getByLabelText('عرض المحاولة 1'))
    await waitFor(() => expect(screen.getByTestId('my-submission-text')).toHaveTextContent('الحلقة for تكرر الأوامر'))
    expect(within(drawer()).getByText('رقم 1 — 2 من 2 محاولة مسموحة')).toBeInTheDocument()
    expect(within(drawer()).getByText('جيد')).toBeInTheDocument()
    expect(paths).toEqual([`/api/submissions/${SUBMISSION_ID_2}`, `/api/submissions/${SUBMISSION_ID}`])
    // Both reads reach the page, which keeps the row's latest attempt (applySubmission()).
    expect(onLoaded).toHaveBeenCalledTimes(2)
    expect(onLoaded).toHaveBeenLastCalledWith({ ...first, history })
  })

  it('shows submission_not_found without the old details and reads again on «refresh»', async () => {
    const { paths } = mockSubmissionApi(jsonResponse(404, { statusCode: 404, code: 'submission_not_found', message: 'No submission with this id' }), GRADED)
    const { onLoaded } = renderDrawer(makeMyAssignment({ attempts: 1, latest: makeLatest() }))

    expect(await screen.findByText(ar.myAssignments.errors.submission_not_found)).toBeInTheDocument()
    expect(onLoaded).not.toHaveBeenCalled()
    fireEvent.click(within(drawer()).getByText(ar.myAssignments.refresh).closest('button')!)
    expect(await within(drawer()).findByText('18 / 20')).toBeInTheDocument()
    expect(paths).toHaveLength(2)
    expect(onLoaded).toHaveBeenCalledWith(GRADED)
  })

  it('stays closed and reads nothing for a row without an attempt', () => {
    const { paths } = mockSubmissionApi(GRADED)
    renderDrawer(makeMyAssignment())
    expect(document.querySelector('.ant-drawer-body')).toBeNull()
    expect(paths).toEqual([])
  })
})
