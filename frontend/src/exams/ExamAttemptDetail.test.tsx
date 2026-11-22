import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExamAttemptDetail as AttemptDetail } from '../api/examAttempts'
import { formatZonedDateTime } from '../assignments/assignments.format'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { makeAttendanceStudent } from '../test/attendance'
import { clickWhenSettled } from '../test/drawer'
import { ATTEMPT_IDS, ATTEMPT_STUDENT_IDS, fiveAttemptQuestions, makeAttemptDetail, makeOpenAttemptDetail } from '../test/examAttempts'
import { EXAM_READER_PERMISSIONS, EXAM_TIME_ZONE } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { FAR_TIME_ZONE } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { ExamAttemptDetail } from './ExamAttemptDetail'

const ATTEMPT_ID = ATTEMPT_IDS[1]
const TITLE = ar.examAttempts.detail.titleOf.replace('{{name}}', 'سارة الطالبة')
const D = ar.examAttempts.detail

/** GET /api/exam-attempts/:id answers `detail()` (re-read on every call); every URL is recorded. */
function mockDetailApi(detail: () => AttemptDetail | Response) {
  const urls: string[] = []
  mockFetch((url, init) => {
    urls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === `/api/exam-attempts/${ATTEMPT_ID}`) {
      const answer = detail()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return urls
}

/** Reading needs `exams.read` only: the panel is the same for a reader and a teacher. */
function renderPanel({ timeZone = EXAM_TIME_ZONE, timeUp = false }: { timeZone?: string; timeUp?: boolean } = {}) {
  const onClose = vi.fn()
  const onStale = vi.fn()
  const view = renderWithProviders(<ExamAttemptDetail attemptId={ATTEMPT_ID} studentName="سارة الطالبة" timeZone={timeZone} timeUp={timeUp} onClose={onClose} onStale={onStale} />, {
    auth: makeAuth({ user: makeUser({ permissions: EXAM_READER_PERMISSIONS }) }),
    route: '/exams',
  })
  return { ...view, onClose, onStale }
}

const details = () => screen.getByTestId('attempt-details')
/** The cell of one line of the attempt's header, by its label. */
const field = (label: string) => within(details()).getByText(label).closest('tr')!.querySelector('td') as HTMLElement
const question = (number: number) => screen.getByTestId(`attempt-question-${number}`)
const option = (number: number, text: string) => within(question(number)).getByText(text).closest('li') as HTMLElement
const instant = (iso: string, zone: string = EXAM_TIME_ZONE) => formatZonedDateTime(iso, zone, 'ar')

describe('ExamAttemptDetail (API-275)', () => {
  it('reads the attempt once and shows its header: the student, number, status, instants in the exam’s zone, score, correct answers, counting and last grading', async () => {
    const urls = mockDetailApi(() => makeAttemptDetail())
    renderPanel()

    expect(await screen.findByTestId('attempt-details')).toBeInTheDocument()
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(field(D.fields.student)).toHaveTextContent('سارة الطالبة')
    expect(field(D.fields.attempt)).toHaveTextContent('رقم 2')
    expect(within(field(D.fields.status)).getByText(ar.examAttempts.status.submitted)).toBeInTheDocument()
    expect(field(D.fields.startedAt)).toHaveTextContent(instant('2026-11-20T07:20:00.000Z'))
    expect(field(D.fields.submittedAt)).toHaveTextContent(instant('2026-11-20T07:31:00.000Z'))
    expect(field(D.fields.score).textContent).toBe('6 من 10')
    expect(field(D.fields.correctCount).textContent).toBe('3 من 5')
    // The counted attempt: the short mark of the roster, and what it means beside it.
    expect(within(field(D.fields.counted)).getByText(ar.examAttempts.roster.counted)).toBeInTheDocument()
    expect(within(field(D.fields.counted)).getByText(D.counted)).toBeInTheDocument()
    expect(field(D.fields.gradedAt)).toHaveTextContent(instant('2026-11-20T07:31:00.000Z'))
    // A finished attempt has no deadline line, and nothing says «in progress».
    expect(within(details()).queryByText(D.fields.deadline)).not.toBeInTheDocument()
    expect(screen.queryByTestId('attempt-in-progress')).not.toBeInTheDocument()
    // The zone is named because it is neither the CI runner's nor this machine's.
    expect(screen.getByTestId('attempt-zone')).toHaveTextContent(`${ar.examAttempts.zone} (${EXAM_TIME_ZONE})`)
    // The panel carries the key: it says so.
    expect(screen.getByText(D.keyNote)).toBeInTheDocument()
    expect(urls).toEqual([`GET /api/exam-attempts/${ATTEMPT_ID}`])
  })

  it('shows every question in the exam’s order with THE KEY marked, the student’s answer marked, the server’s verdict and the points earned', async () => {
    mockDetailApi(() => makeAttemptDetail())
    renderPanel()
    await screen.findByTestId('attempt-details')

    expect(screen.getAllByTestId(/^attempt-question-\d+$/).map((card) => card.getAttribute('data-testid'))).toEqual([1, 2, 3, 4, 5].map((number) => `attempt-question-${number}`))

    // 1 — she chose the key.
    expect(within(question(1)).getByText('ما ناتج 3 + 4 في بايثون؟')).toBeInTheDocument()
    expect(within(question(1)).getByText(D.outcome.correct)).toBeInTheDocument()
    expect(within(option(1, '7')).getByText(D.key)).toBeInTheDocument()
    expect(within(option(1, '7')).getByText(D.chosen)).toBeInTheDocument()
    expect(within(option(1, '34')).queryByText(D.key)).not.toBeInTheDocument()
    expect(within(option(1, '34')).queryByText(D.chosen)).not.toBeInTheDocument()
    expect(question(1)).toHaveTextContent(`${D.earned} 2 من 2`)
    expect(within(question(1)).getByText(D.type.single_choice)).toBeInTheDocument()

    // 2 — a wrong answer: the key and her choice are two different options; the explanation follows.
    expect(within(question(2)).getByText(D.outcome.wrong)).toBeInTheDocument()
    expect(within(option(2, 'def')).getByText(D.key)).toBeInTheDocument()
    expect(within(option(2, 'def')).queryByText(D.chosen)).not.toBeInTheDocument()
    expect(within(option(2, 'func')).getByText(D.chosen)).toBeInTheDocument()
    expect(within(option(2, 'func')).queryByText(D.key)).not.toBeInTheDocument()
    expect(question(2)).toHaveTextContent(`${D.earned} 0 من 2`)
    expect(within(question(2)).getByText('تُعرَّف الدالة بالكلمة def.')).toBeInTheDocument()

    // 4 — left unanswered: the key is still marked, nothing is hers.
    expect(within(question(4)).getByText(D.outcome.unanswered)).toBeInTheDocument()
    expect(within(question(4)).getByText(D.unanswered)).toBeInTheDocument()
    expect(within(option(4, 'for')).getByText(D.key)).toBeInTheDocument()
    expect(within(question(4)).queryByText(D.chosen)).not.toBeInTheDocument()
    expect(question(4)).toHaveTextContent(`${D.earned} 0 من 2`)

    // 5 — true/false: the two values, the key and her answer on «true».
    expect(within(question(5)).getByText(D.type.true_false)).toBeInTheDocument()
    expect(within(option(5, D.trueFalse.true)).getByText(D.key)).toBeInTheDocument()
    expect(within(option(5, D.trueFalse.true)).getByText(D.chosen)).toBeInTheDocument()
    expect(option(5, D.trueFalse.false).textContent).toBe(D.trueFalse.false)
    expect(within(question(5)).getByText(D.outcome.correct)).toBeInTheDocument()

    // One key per question, one answer per answered question.
    expect(screen.getAllByText(D.key)).toHaveLength(5)
    expect(screen.getAllByText(D.chosen)).toHaveLength(4)
    // A question is a named group for a screen reader.
    expect(question(3)).toHaveAttribute('role', 'group')
    expect(question(3)).toHaveAttribute('aria-label', 'السؤال 3')
  })

  it('takes right and wrong from the server: an answer on the key the server marked wrong is shown wrong, with its points', async () => {
    const [first] = fiveAttemptQuestions()
    mockDetailApi(() => makeAttemptDetail({ score: 0, correctCount: 0, questionCount: 1, questions: [{ ...first!, isCorrect: false, pointsAwarded: 0 }] }))
    renderPanel()
    await screen.findByTestId('attempt-details')
    expect(within(question(1)).getByText(D.outcome.wrong)).toBeInTheDocument()
    expect(within(question(1)).queryByText(D.outcome.correct)).not.toBeInTheDocument()
    expect(question(1)).toHaveTextContent(`${D.earned} 0 من 2`)
    expect(field(D.fields.score).textContent).toBe('0 من 10')
    expect(field(D.fields.correctCount).textContent).toBe('0 من 1')
  })

  it('says nothing is graded while the attempt is in progress: no score, no verdict, the answers saved so far, and the server’s deadline', async () => {
    mockDetailApi(() => makeOpenAttemptDetail({ id: ATTEMPT_ID }))
    renderPanel()

    expect(await screen.findByTestId('attempt-in-progress')).toHaveTextContent(D.inProgressNote)
    expect(within(field(D.fields.status)).getByText(ar.examAttempts.status.in_progress)).toBeInTheDocument()
    expect(field(D.fields.deadline)).toHaveTextContent(instant('2026-11-20T07:34:00.000Z'))
    expect(within(details()).queryByText(D.fields.submittedAt)).not.toBeInTheDocument()
    expect(field(D.fields.score)).toHaveTextContent(D.notGraded)
    expect(field(D.fields.correctCount)).toHaveTextContent(D.notGraded)
    expect(field(D.fields.gradedAt)).toHaveTextContent(D.notGraded)
    expect(field(D.fields.counted)).toHaveTextContent(D.notCountedYet)
    // The roster did not say its time was up.
    expect(screen.queryByText(ar.examAttempts.roster.timeUp)).not.toBeInTheDocument()

    for (const text of Object.values(D.outcome)) expect(screen.queryByText(text)).not.toBeInTheDocument()
    expect(screen.queryByText(D.earned, { exact: false })).not.toBeInTheDocument()
    // What he has saved is marked; the key is there for the teacher all the same.
    expect(within(option(1, '7')).getByText(D.chosen)).toBeInTheDocument()
    expect(within(option(2, 'def')).getByText(D.key)).toBeInTheDocument()
    expect(within(question(2)).getByText(D.unansweredYet)).toBeInTheDocument()
    expect(question(2)).toHaveTextContent(`${D.points} 2`)
    expect(screen.getAllByText(D.chosen)).toHaveLength(2)
  })

  it('repeats the roster’s «time is up» for an attempt that is still open, and drops it once the server has closed it', async () => {
    let detail = makeOpenAttemptDetail({ id: ATTEMPT_ID })
    mockDetailApi(() => detail)
    const open = renderPanel({ timeUp: true })
    await screen.findByTestId('attempt-details')
    expect(within(field(D.fields.status)).getByText(ar.examAttempts.roster.timeUp)).toBeInTheDocument()
    open.unmount()

    // Read a moment later: the server has closed it at its deadline with what was saved.
    detail = makeAttemptDetail({ status: 'timed_out', submittedAt: '2026-11-20T07:50:00.000Z', counted: false })
    renderPanel({ timeUp: true })
    await screen.findByTestId('attempt-details')
    expect(within(field(D.fields.status)).getByText(ar.examAttempts.status.timed_out)).toBeInTheDocument()
    expect(screen.queryByText(ar.examAttempts.roster.timeUp)).not.toBeInTheDocument()
    expect(field(D.fields.closedAt)).toHaveTextContent(instant('2026-11-20T07:50:00.000Z'))
    expect(field(D.fields.counted)).toHaveTextContent(D.notCounted)
    expect(within(field(D.fields.counted)).queryByText(ar.examAttempts.roster.counted)).not.toBeInTheDocument()
  })

  it('shows the instants in the exam’s zone, not the browser’s, and names no zone that is this device’s own (D-R41)', async () => {
    mockDetailApi(() => makeAttemptDetail())
    const far = renderPanel({ timeZone: FAR_TIME_ZONE })
    await screen.findByTestId('attempt-details')
    expect(field(D.fields.startedAt)).toHaveTextContent(instant('2026-11-20T07:20:00.000Z', FAR_TIME_ZONE))
    expect(screen.getByTestId('attempt-zone')).toHaveTextContent(FAR_TIME_ZONE)
    far.unmount()

    renderPanel({ timeZone: deviceTimeZone() })
    await screen.findByTestId('attempt-details')
    expect(screen.queryByTestId('attempt-zone')).not.toBeInTheDocument()
  })

  it('shows the student’s contact only when the server sends it (users.read_contact)', async () => {
    let student = makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0], displayName: 'سارة', email: 'sara@example.test', phone: '+966500000001' })
    mockDetailApi(() => makeAttemptDetail({ student }))
    const full = renderPanel()
    await screen.findByTestId('attempt-details')
    expect(field(D.fields.student)).toHaveTextContent('سارة الطالبة (سارة)')
    expect(within(field(D.fields.student)).getByText('sara@example.test').closest('bdi')).toHaveAttribute('dir', 'ltr')
    expect(within(field(D.fields.student)).getByText('+966500000001').closest('bdi')).toHaveAttribute('dir', 'ltr')
    full.unmount()

    student = makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0] })
    renderPanel()
    await screen.findByTestId('attempt-details')
    expect(field(D.fields.student).textContent).toBe('سارة الطالبة')
  })

  it('reads in English with the question in its English text when it has one', async () => {
    mockDetailApi(() => makeAttemptDetail())
    try {
      await act(() => i18n.changeLanguage('en'))
      renderPanel()
      await screen.findByTestId('attempt-details')
      expect(screen.getByText('Attempt of سارة الطالبة')).toBeInTheDocument()
      expect(field('Score').textContent).toBe('6 of 10')
      expect(within(question(5)).getByText('Python lists are mutable.')).toBeInTheDocument()
      expect(within(option(5, 'True')).getByText('Correct answer')).toBeInTheDocument()
      // No English text: the mandatory Arabic.
      expect(within(question(1)).getByText('ما ناتج 3 + 4 في بايثون؟')).toBeInTheDocument()
    } finally {
      await act(() => i18n.changeLanguage('ar'))
    }
  })

  it('says the attempt is gone, has the roster read again and closes (404 attempt_not_found) — once', async () => {
    mockDetailApi(() => jsonResponse(404, { statusCode: 404, code: 'attempt_not_found', attemptId: ATTEMPT_ID, message: 'No attempt with this id' }))
    const { onClose, onStale } = renderPanel()

    expect(await screen.findByText(ar.examAttempts.errors.attempt_not_found)).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onStale).toHaveBeenCalledTimes(1)
    // Said in the toast only: no second copy with a retry inside the panel.
    expect(screen.getAllByText(ar.examAttempts.errors.attempt_not_found)).toHaveLength(1)
    expect(screen.queryByText(ar.examAttempts.retry)).not.toBeInTheDocument()
  })

  it('shows any other failed read with a retry that reads the attempt again', async () => {
    let fail = true
    const urls = mockDetailApi(() => (fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeAttemptDetail()))
    const { onClose, onStale } = renderPanel()

    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    // The title falls back to the name the roster showed.
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByText(ar.examAttempts.retry).closest('button')!)
    expect(await screen.findByTestId('attempt-details')).toBeInTheDocument()
    expect(screen.queryByText(ar.login.errors.server)).not.toBeInTheDocument()
    expect(urls).toHaveLength(2)
    expect(onClose).not.toHaveBeenCalled()
    expect(onStale).not.toHaveBeenCalled()
  })

  it('closes from its own close button', async () => {
    mockDetailApi(() => makeAttemptDetail())
    const { onClose } = renderPanel()
    await screen.findByTestId('attempt-details')
    await clickWhenSettled(() => document.querySelector('.ant-drawer-close')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
