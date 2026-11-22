import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExamAttemptDetail, ExamAttempts } from '../api/examAttempts'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { ar } from '../i18n/ar'
import { makeAttendanceStudent } from '../test/attendance'
import { clickWhenSettled } from '../test/drawer'
import {
  ATTEMPT_IDS,
  ATTEMPT_STUDENT_IDS,
  EXAM_QUESTION_IDS,
  fiveAttemptStudents,
  makeAttemptDetail,
  makeAttemptRow,
  makeAttemptsStats,
  makeAttemptsStudent,
  makeExamAttempts,
  makeRegradeSummary,
  makeScheduledOnlineExam,
} from '../test/examAttempts'
import { EXAM_ID, EXAM_READER_PERMISSIONS, EXAM_TEACHER_PERMISSIONS, EXAM_TIME_ZONE, makeOnlineExam } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { FAR_TIME_ZONE } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { ExamAttemptsTab } from './ExamAttemptsTab'

interface Call {
  method: string
  url: string
  body: unknown
}

interface AttemptsApi {
  /** GET /api/exams/:id/attempts — re-read on every call. */
  roster: () => ExamAttempts | Response
  /** GET /api/exam-attempts/:id. */
  detail?: (attemptId: string) => ExamAttemptDetail | Response
  /** POST /api/exams/:id/regrade. */
  regrade?: (body: unknown) => Response
}

const ROSTER_URL = `/api/exams/${EXAM_ID}/attempts`
const REGRADE_URL = `/api/exams/${EXAM_ID}/regrade`
const ATTEMPT_URL = /^\/api\/exam-attempts\/([^/]+)$/

/** The three routes of the tab; every request is recorded. */
function mockAttemptsApi({ roster, detail, regrade }: AttemptsApi) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    calls.push({ method, url, body })
    if (method === 'GET' && url === ROSTER_URL) {
      const answer = roster()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    const attempt = ATTEMPT_URL.exec(url)
    if (method === 'GET' && attempt && detail) {
      const answer = detail(attempt[1]!)
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'POST' && url === REGRADE_URL && regrade) return regrade(body)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

/** `setExam()` is the drawer handing the tab the exam it has just read again. */
function renderTab({ permissions = EXAM_TEACHER_PERMISSIONS, exam = makeScheduledOnlineExam() }: { permissions?: string[]; exam?: Exam } = {}) {
  const onChanged = vi.fn()
  const tab = (current: Exam) => <ExamAttemptsTab exam={current} onChanged={onChanged} />
  const view = renderWithProviders(tab(exam), { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/exams' })
  return { ...view, onChanged, setExam: (next: Exam) => view.rerender(tab(next)) }
}

const rosterReads = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.url === ROSTER_URL)
const regrades = (calls: Call[]) => calls.filter((call) => call.method === 'POST')
const findRow = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const attemptBlock = (index: number) => screen.getByTestId(`attempt-${ATTEMPT_IDS[index]}`)
const instant = (iso: string, zone: string = EXAM_TIME_ZONE) => formatZonedDateTime(iso, zone, 'ar')
/** The value of one figure, exactly as shown. */
const figure = (label: string) => within(screen.getByTestId('exam-attempts-stats')).getByText(label).closest('div')!.querySelector('dd')!
const regradeButton = () => screen.queryByText(ar.examAttempts.regrade.button)?.closest('button') ?? null
const REGRADE_TITLE = ar.examAttempts.regrade.title.replace('{{name}}', makeScheduledOnlineExam().title.ar)

async function chooseFilter(label: string) {
  fireEvent.mouseDown(screen.getByLabelText(ar.examAttempts.roster.filter))
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }))
}

/** Opens the regrade dialog and returns it with its reason field and its confirm button. */
async function openRegrade() {
  fireEvent.click(regradeButton()!)
  const dialog = (await screen.findByText(REGRADE_TITLE)).closest('[role="dialog"]') as HTMLElement
  return {
    dialog,
    reason: within(dialog).getByLabelText(ar.examAttempts.regrade.reason) as HTMLTextAreaElement,
    confirm: () => within(dialog).getByText(ar.examAttempts.regrade.submit).closest('button') as HTMLButtonElement,
  }
}

describe('ExamAttemptsTab', () => {
  it('reads the roster once and says where the server clock falls in the window, with the opening, the closing and the clock of the answer in the exam’s zone', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()

    const header = await screen.findByTestId('exam-window')
    expect(within(header).getByText(ar.examAttempts.window.state.open)).toBeInTheDocument()
    expect(screen.getByTestId('exam-window-opens')).toHaveTextContent(`${ar.examAttempts.window.opensAt} ${instant('2026-11-20T07:00:00.000Z')}`)
    expect(screen.getByTestId('exam-window-closes')).toHaveTextContent(`${ar.examAttempts.window.closesAt} ${instant('2026-11-20T09:00:00.000Z')}`)
    // Named because it is neither the CI runner's zone nor this machine's.
    expect(screen.getByTestId('exam-attempts-zone')).toHaveTextContent(`${ar.examAttempts.zone} (${EXAM_TIME_ZONE})`)
    // Nothing is polled: the tab says at which server clock what it shows was read.
    expect(screen.getByTestId('exam-attempts-read-at')).toHaveTextContent(ar.examAttempts.asOf.replace('{{time}}', instant('2026-11-20T07:35:00.000Z')))
    expect(calls).toEqual([{ method: 'GET', url: ROSTER_URL, body: undefined }])
  })

  it('follows the exam’s zone, not the browser’s, and names no zone that is this device’s own (D-R41)', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    const far = renderTab({ exam: makeScheduledOnlineExam({ timeZone: FAR_TIME_ZONE }) })
    await screen.findByTestId('exam-window')
    expect(screen.getByTestId('exam-window-opens')).toHaveTextContent(instant('2026-11-20T07:00:00.000Z', FAR_TIME_ZONE))
    expect(within(attemptBlock(1)).getByText(instant('2026-11-20T07:31:00.000Z', FAR_TIME_ZONE), { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('exam-attempts-zone')).toHaveTextContent(FAR_TIME_ZONE)
    far.unmount()

    renderTab({ exam: makeScheduledOnlineExam({ timeZone: deviceTimeZone() }) })
    await screen.findByTestId('exam-window')
    expect(screen.queryByTestId('exam-attempts-zone')).not.toBeInTheDocument()
  })

  it('words a window that has not opened, one that has closed, and instants that are not set yet', async () => {
    let roster = makeExamAttempts({ window: 'not_open' })
    mockAttemptsApi({ roster: () => roster })
    renderTab()
    expect(within(await screen.findByTestId('exam-window')).getByText(ar.examAttempts.window.state.not_open)).toBeInTheDocument()

    roster = makeExamAttempts({ window: 'closed', scheduledAt: null, closesAt: null })
    fireEvent.click(screen.getByText(ar.examAttempts.refresh).closest('button')!)
    expect(await within(screen.getByTestId('exam-window')).findByText(ar.examAttempts.window.state.closed)).toBeInTheDocument()
    expect(screen.getByTestId('exam-window-opens')).toHaveTextContent(`${ar.examAttempts.window.opensAt} ${ar.examAttempts.window.unset}`)
    expect(screen.getByTestId('exam-window-closes')).toHaveTextContent(`${ar.examAttempts.window.closesAt} ${ar.examAttempts.window.unset}`)
  })

  it('shows the server’s figures as they are — the fixture’s figures are not what the five rows add up to', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()
    await screen.findByTestId('exam-attempts-stats')

    expect(figure(ar.examAttempts.stats.students).textContent).toBe('18')
    expect(figure(ar.examAttempts.stats.started).textContent).toBe('15')
    expect(figure(ar.examAttempts.stats.inProgress).textContent).toBe('1')
    expect(figure(ar.examAttempts.stats.finished).textContent).toBe('14')
    expect(figure(ar.examAttempts.stats.notStarted).textContent).toBe('3')
    expect(figure(ar.examAttempts.stats.mean).textContent).toBe('7.25 من 10')
    expect(figure(ar.examAttempts.stats.highest).textContent).toBe('9.5 من 10')
    expect(figure(ar.examAttempts.stats.lowest).textContent).toBe('2.5 من 10')
    expect(figure(ar.examAttempts.stats.passScore).textContent).toBe('5 من 10')
    expect(figure(ar.examAttempts.stats.passed).textContent).toBe('11')
    expect(figure(ar.examAttempts.stats.failed).textContent).toBe('3')
    expect(figure(ar.examAttempts.stats.passRate).textContent).toBe('78.57%')
    // RTL: each number is its own left-to-right isolate, the word between them is not inside one.
    const mean = [...figure(ar.examAttempts.stats.mean).querySelectorAll('bdi[dir="ltr"]')].map((node) => node.textContent)
    expect(mean).toEqual(['7.25', '10'])
    expect(figure(ar.examAttempts.stats.passRate).querySelector('bdi[dir="ltr"]')).toHaveTextContent('78.57%')
    expect(screen.queryByText(ar.examAttempts.stats.noPassScore)).not.toBeInTheDocument()
  })

  it('shows a dash for a figure the server has none for, and says an exam without a pass score has no passes and no pass rate', async () => {
    let roster = makeExamAttempts({ stats: makeAttemptsStats({ started: 4, inProgress: 4, finished: 0, mean: null, highest: null, lowest: null, passed: null, failed: null, passRate: null }) })
    mockAttemptsApi({ roster: () => roster })
    renderTab()
    await screen.findByTestId('exam-attempts-stats')
    for (const label of [ar.examAttempts.stats.mean, ar.examAttempts.stats.highest, ar.examAttempts.stats.lowest, ar.examAttempts.stats.passed, ar.examAttempts.stats.failed, ar.examAttempts.stats.passRate]) {
      expect(figure(label).textContent).toBe('—')
    }
    expect(figure(ar.examAttempts.stats.finished).textContent).toBe('0')
    expect(figure(ar.examAttempts.stats.passScore).textContent).toBe('5 من 10')

    roster = makeExamAttempts({ passScore: null, stats: makeAttemptsStats({ passed: null, failed: null, passRate: null }) })
    fireEvent.click(screen.getByText(ar.examAttempts.refresh).closest('button')!)
    expect(await screen.findByText(ar.examAttempts.stats.noPassScore)).toBeInTheDocument()
    const stats = within(screen.getByTestId('exam-attempts-stats'))
    for (const label of [ar.examAttempts.stats.passScore, ar.examAttempts.stats.passed, ar.examAttempts.stats.failed, ar.examAttempts.stats.passRate]) {
      expect(stats.queryByText(label)).not.toBeInTheDocument()
    }
    expect(figure(ar.examAttempts.stats.mean).textContent).toBe('7.25 من 10')
  })

  it('lists each question with its points and the two counts the server sends — as counts, never a percentage', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()

    const questions = await screen.findByTestId('exam-attempts-questions')
    const cells = (number: number) => [...within(questions).getByText(`السؤال ${number}`).closest('tr')!.querySelectorAll('td')].map((cell) => cell.textContent)
    expect(cells(1)).toEqual(['السؤال 1', '2', '14', '12'])
    expect(cells(2)).toEqual(['السؤال 2', '2', '13', '8'])
    expect(cells(5)).toEqual(['السؤال 5', '2', '9', '5'])
    expect(within(questions).getAllByText(/^السؤال \d+$/)).toHaveLength(EXAM_QUESTION_IDS.length)
    expect(screen.getByText('5 أسئلة')).toBeInTheDocument()
    // What the two counts are read against: the server's number of students with a finished attempt.
    expect(screen.getByTestId('exam-attempts-counted')).toHaveTextContent(`${ar.examAttempts.questions.countedAttempts} 14`)
    expect(questions.textContent).not.toContain('%')
    const headers = [...questions.querySelectorAll('.ant-table-thead th')].map((cell) => cell.textContent)
    expect(headers).toEqual(Object.values(ar.examAttempts.questions.columns))
  })

  it('starts a long exam with its questions folded, so the roster stays within reach, and unfolds them on demand', async () => {
    const questions = Array.from({ length: 13 }, (_, sortOrder) => ({ examQuestionId: `q-${sortOrder}`, sortOrder, points: 1, answered: 3, correct: 2 }))
    mockAttemptsApi({ roster: () => makeExamAttempts({ questionCount: 13, questions }) })
    renderTab()
    await findRow('سارة الطالبة')
    expect(screen.queryByTestId('exam-attempts-questions')).not.toBeInTheDocument()
    // The folded header still says how many there are (the server's `questionCount`, in its Arabic plural).
    expect(screen.getByText('13 سؤالاً')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.examAttempts.questions.title))
    expect(await within(await screen.findByTestId('exam-attempts-questions')).findByText('السؤال 13')).toBeInTheDocument()
  })

  it('lists the students in the server’s order with the counted result, its source, and every attempt — the counted one marked', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()

    const sara = await findRow('سارة الطالبة')
    const roster = within(screen.getByTestId('exam-attempts-roster'))
    expect(roster.getAllByText(/^(سارة الطالبة|يوسف الطالب|ليلى المنسحبة|عمر الخريج|هند الطالبة)$/).map((node) => node.textContent)).toEqual([
      'سارة الطالبة',
      'يوسف الطالب',
      'ليلى المنسحبة',
      'عمر الخريج',
      'هند الطالبة',
    ])

    // سارة: two submitted attempts; the second one counts, and her result is that attempt's.
    const [, result] = sara.querySelectorAll('td')
    expect(result).toHaveTextContent('6 من 10')
    expect(within(result as HTMLElement).getByText(ar.examAttempts.source.online)).toBeInTheDocument()
    const first = within(attemptBlock(0))
    expect(first.getByText('المحاولة 1')).toBeInTheDocument()
    expect(first.getByText(ar.examAttempts.status.submitted)).toBeInTheDocument()
    expect(attemptBlock(0)).toHaveTextContent('4 من 10')
    expect(first.queryByText(ar.examAttempts.roster.counted)).not.toBeInTheDocument()
    expect(attemptBlock(0)).toHaveTextContent(`${ar.examAttempts.roster.startedAt} ${instant('2026-11-20T07:02:00.000Z')}`)
    expect(attemptBlock(0)).toHaveTextContent(`${ar.examAttempts.roster.submittedAt} ${instant('2026-11-20T07:15:00.000Z')}`)
    const second = within(attemptBlock(1))
    expect(second.getByText('المحاولة 2')).toBeInTheDocument()
    expect(second.getByText(ar.examAttempts.roster.counted)).toBeInTheDocument()
    expect(attemptBlock(1)).toHaveTextContent('6 من 10')
    expect(within(sara).getAllByText(ar.examAttempts.roster.counted)).toHaveLength(1)
    // An active enrollment needs no tag.
    expect(within(sara).queryByText(ar.labels.active)).not.toBeInTheDocument()

    // يوسف: still open on the server, nothing graded, no result.
    const yousef = row('يوسف الطالب')
    expect(within(yousef).getByText(ar.examAttempts.status.in_progress)).toBeInTheDocument()
    expect(within(yousef).getByText(ar.examAttempts.roster.noResult)).toBeInTheDocument()
    expect(attemptBlock(2)).toHaveTextContent(`${ar.examAttempts.roster.deadline} ${instant('2026-11-20T07:34:00.000Z')}`)
    // No score for an attempt the server has not graded.
    expect(attemptBlock(2).querySelector('bdi')).toBeNull()

    // ليلى: withdrawn after the exam, still listed; the server closed her attempt at its deadline.
    const layla = row('ليلى المنسحبة')
    expect(within(layla).getByText(ar.labels.withdrawn)).toBeInTheDocument()
    expect(within(layla).getByText(ar.examAttempts.status.timed_out)).toBeInTheDocument()
    expect(attemptBlock(3)).toHaveTextContent(`${ar.examAttempts.roster.closedAt} ${instant('2026-11-20T07:31:00.000Z')}`)
    expect(within(attemptBlock(3)).getByText(ar.examAttempts.roster.counted)).toBeInTheDocument()

    // عمر: never started; recorded absent on the results sheet.
    const omar = row('عمر الخريج')
    expect(within(omar).getByText(ar.labels.completed)).toBeInTheDocument()
    expect(within(omar).getByText(ar.exams.results.status.absent)).toBeInTheDocument()
    expect(within(omar).getByText(ar.examAttempts.source.manual)).toBeInTheDocument()
    expect(within(omar).getByText(ar.examAttempts.roster.notStarted)).toBeInTheDocument()
    expect(omar.querySelector('button')).toBeNull()

    // هند: never started, no result.
    const hind = row('هند الطالبة')
    expect(within(hind).getByText(ar.examAttempts.roster.noResult)).toBeInTheDocument()
    expect(within(hind).getByText(ar.examAttempts.roster.notStarted)).toBeInTheDocument()

    // One button per attempt, named by its number and its student.
    expect(screen.getAllByLabelText(/^عرض المحاولة \d+: /)).toHaveLength(4)
    const headers = [...screen.getByTestId('exam-attempts-roster').querySelectorAll('.ant-table-thead th')].map((cell) => cell.textContent)
    expect(headers).toEqual(Object.values(ar.examAttempts.roster.columns))
  })

  it('says an attempt’s time is up only where the server says so', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()
    await findRow('يوسف الطالب')
    expect(within(attemptBlock(2)).getByText(ar.examAttempts.roster.timeUp)).toBeInTheDocument()
    expect(screen.getAllByText(ar.examAttempts.roster.timeUp)).toHaveLength(1)
  })

  it('shows the contact a caller with users.read_contact gets, and nothing in its place for one without', async () => {
    const items = fiveAttemptStudents()
    items[0] = { ...items[0]!, student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0], displayName: 'سارة', email: 'sara@example.test', phone: '+966500000001' }) }
    mockAttemptsApi({ roster: () => makeExamAttempts({ items }) })
    renderTab()
    const sara = await findRow('سارة الطالبة')
    expect(within(sara).getByText('سارة')).toBeInTheDocument()
    expect(within(sara).getByText('sara@example.test').closest('bdi')).toHaveAttribute('dir', 'ltr')
    expect(within(sara).getByText('+966500000001').closest('bdi')).toHaveAttribute('dir', 'ltr')
    // The reduced projection: the server sent null, and the cell holds the name alone.
    expect(row('يوسف الطالب').querySelector('td')!.textContent).toBe('يوسف الطالب')
  })

  it('marks a student whose account was deleted and one without an enrollment row', async () => {
    const items = [
      makeAttemptsStudent({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[0], deletedAt: '2026-11-21T08:00:00.000Z' }), enrollmentStatus: 'cancelled', attempts: [makeAttemptRow()] }),
      makeAttemptsStudent({ student: makeAttendanceStudent({ id: ATTEMPT_STUDENT_IDS[1], fullName: 'يوسف الطالب' }), enrollmentStatus: null }),
    ]
    mockAttemptsApi({ roster: () => makeExamAttempts({ items }) })
    renderTab()
    const sara = await findRow('سارة الطالبة')
    expect(within(sara).getByText(ar.exams.results.deleted)).toBeInTheDocument()
    expect(within(sara).getByText(ar.labels.cancelled)).toBeInTheDocument()
    expect(within(row('يوسف الطالب')).getByText(ar.exams.results.enrollment.none)).toBeInTheDocument()
  })

  it('filters the loaded roster locally — did not start, in progress, finished — says how many are shown and asks the server for nothing', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts() })
    renderTab()
    await findRow('سارة الطالبة')
    expect(screen.getByText(ar.examAttempts.roster.filterLocal)).toBeInTheDocument()

    await chooseFilter(ar.examAttempts.roster.filters.notStarted)
    await waitFor(() => expect(screen.queryByText('سارة الطالبة')).not.toBeInTheDocument())
    expect(screen.getByText('عمر الخريج')).toBeInTheDocument()
    expect(screen.getByText('هند الطالبة')).toBeInTheDocument()
    expect(screen.getByText('يُعرض 2 من 5')).toBeInTheDocument()

    await chooseFilter(ar.examAttempts.roster.filters.inProgress)
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(screen.queryByText('عمر الخريج')).not.toBeInTheDocument()
    expect(screen.getByText('يُعرض 1 من 5')).toBeInTheDocument()

    await chooseFilter(ar.examAttempts.roster.filters.finished)
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(screen.getByText('ليلى المنسحبة')).toBeInTheDocument()
    expect(screen.queryByText('يوسف الطالب')).not.toBeInTheDocument()

    await chooseFilter(ar.examAttempts.roster.filters.all)
    expect(await screen.findByText('هند الطالبة')).toBeInTheDocument()
    expect(screen.queryByText(/^يُعرض /)).not.toBeInTheDocument()
    expect(rosterReads(calls)).toHaveLength(1)
  })

  it('says when nobody has started, when the filter keeps nobody, when the class has no students, and that a draft takes no attempt', async () => {
    const idle = fiveAttemptStudents().map((item) => ({ ...item, attempts: [], result: null }))
    let roster = makeExamAttempts({ examStatus: 'draft', window: 'not_open', items: idle, stats: makeAttemptsStats({ students: 5, started: 0, inProgress: 0, finished: 0, notStarted: 5, mean: null, highest: null, lowest: null, passed: null, failed: null, passRate: null }) })
    mockAttemptsApi({ roster: () => roster })
    renderTab({ exam: makeOnlineExam() })

    expect(await screen.findByText(ar.examAttempts.roster.nobodyStarted)).toBeInTheDocument()
    expect(screen.getByText(ar.examAttempts.draft)).toBeInTheDocument()
    expect(screen.getAllByText(ar.examAttempts.roster.notStarted)).toHaveLength(5)
    await chooseFilter(ar.examAttempts.roster.filters.finished)
    expect(await screen.findByText(ar.examAttempts.roster.emptyFiltered)).toBeInTheDocument()

    roster = makeExamAttempts({ items: [], stats: makeAttemptsStats({ students: 0, started: 0, notStarted: 0 }) })
    fireEvent.click(screen.getByText(ar.examAttempts.refresh).closest('button')!)
    expect(await screen.findByText(ar.examAttempts.roster.empty)).toBeInTheDocument()
    // «Nobody started» is about students who could have: an empty class says it has none.
    expect(screen.queryByText(ar.examAttempts.roster.nobodyStarted)).not.toBeInTheDocument()
  })

  it('reads the roster again on «refresh» and shows the newer answer — and the drawer re-reads the exam', async () => {
    let roster = makeExamAttempts()
    const calls = mockAttemptsApi({ roster: () => roster })
    const { onChanged } = renderTab()
    await findRow('يوسف الطالب')

    const items = fiveAttemptStudents()
    items[1] = { ...items[1]!, attempts: [makeAttemptRow({ id: ATTEMPT_IDS[2], attemptNo: 1, status: 'timed_out', submittedAt: '2026-11-20T07:34:00.000Z', score: 8, correctCount: 4 })], result: { status: 'scored', score: 8, source: 'online' } }
    roster = makeExamAttempts({ serverNow: '2026-11-20T07:36:00.000Z', items })
    fireEvent.click(screen.getByText(ar.examAttempts.refresh).closest('button')!)

    await waitFor(() => expect(within(row('يوسف الطالب')).getByText(ar.examAttempts.status.timed_out)).toBeInTheDocument())
    expect(row('يوسف الطالب').querySelectorAll('td')[1]).toHaveTextContent('8 من 10')
    expect(screen.queryByText(ar.examAttempts.roster.timeUp)).not.toBeInTheDocument()
    expect(screen.getByTestId('exam-attempts-read-at')).toHaveTextContent(instant('2026-11-20T07:36:00.000Z'))
    expect(rosterReads(calls)).toHaveLength(2)
    // Attempts finished while the drawer stayed open: its result counts must follow the roster just read.
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('reads the roster again when the exam changes in the drawer (published, its window moved), not when the drawer merely re-reads the same exam', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts() })
    const { setExam } = renderTab()
    await findRow('سارة الطالبة')

    // The drawer re-read the exam after a saved results sheet: the same server version.
    setExam(makeScheduledOnlineExam({ results: { students: 3, scored: 2, absent: 1, excused: 0 } }))
    await findRow('سارة الطالبة')
    expect(rosterReads(calls)).toHaveLength(1)

    // «Publish results» in the drawer closes every attempt still open: what was read is older than the exam on screen.
    setExam(makeScheduledOnlineExam({ status: 'published', publishedAt: '2026-11-20T09:30:00.000Z', updatedAt: '2026-11-20T09:30:00.000Z' }))
    await waitFor(() => expect(rosterReads(calls)).toHaveLength(2))
  })

  it('opens an attempt in the panel above the drawer, with the key and the student’s answers (API-275)', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts(), detail: () => makeAttemptDetail() })
    renderTab()
    await findRow('سارة الطالبة')

    fireEvent.click(screen.getByLabelText('عرض المحاولة 2: سارة الطالبة'))
    expect(await screen.findByText('بأي كلمة تُعرَّف الدالة؟')).toBeInTheDocument()
    expect(calls.at(-1)).toEqual({ method: 'GET', url: `/api/exam-attempts/${ATTEMPT_IDS[1]}`, body: undefined })
    expect(screen.getByText(ar.examAttempts.detail.titleOf.replace('{{name}}', 'سارة الطالبة'))).toBeInTheDocument()
    const question = within(screen.getByTestId('attempt-question-2'))
    expect(within(question.getByText('def').closest('li')!).getByText(ar.examAttempts.detail.key)).toBeInTheDocument()
    expect(within(question.getByText('func').closest('li')!).getByText(ar.examAttempts.detail.chosen)).toBeInTheDocument()
    expect(rosterReads(calls)).toHaveLength(1)
  })

  it('hands the focus back to the button that opened the panel, and to «regrade» after its dialog', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts(), detail: () => makeAttemptDetail() })
    renderTab()
    await findRow('سارة الطالبة')

    const opener = screen.getByLabelText('عرض المحاولة 2: سارة الطالبة')
    fireEvent.click(opener)
    await screen.findByTestId('attempt-details')
    expect(opener).not.toHaveFocus()
    await clickWhenSettled(() => document.querySelector('.ant-drawer-close')!)
    await waitFor(() => expect(screen.queryByTestId('attempt-details')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()

    const regrade = regradeButton()!
    const { dialog } = await openRegrade()
    expect(regrade).not.toHaveFocus()
    fireEvent.click(within(dialog).getByText(ar.common.cancel).closest('button')!)
    await waitFor(() => expect(screen.queryByText(REGRADE_TITLE)).not.toBeInTheDocument())
    expect(regrade).toHaveFocus()
  })

  it('closes the panel, says why and reads the roster again when the attempt is gone (404 attempt_not_found)', async () => {
    const calls = mockAttemptsApi({
      roster: () => makeExamAttempts(),
      detail: (attemptId) => jsonResponse(404, { statusCode: 404, code: 'attempt_not_found', attemptId, message: 'No attempt with this id' }),
    })
    renderTab()
    await findRow('سارة الطالبة')
    const title = ar.examAttempts.detail.titleOf.replace('{{name}}', 'سارة الطالبة')

    fireEvent.click(screen.getByLabelText('عرض المحاولة 1: سارة الطالبة'))
    // The panel opens, reads, fails and closes before the notice shows: more than findByText's default second on a
    // loaded machine (it failed once in the whole suite and passed alone — KI-044).
    expect(await screen.findByText(ar.examAttempts.errors.attempt_not_found, undefined, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument())
    await waitFor(() => expect(rosterReads(calls)).toHaveLength(2))
  })

  it('offers the regrade to a holder of exams.grade only, and not for a draft or an exam of a cancelled class', async () => {
    mockAttemptsApi({ roster: () => makeExamAttempts() })
    const teacher = renderTab()
    await findRow('سارة الطالبة')
    expect(regradeButton()).toBeInTheDocument()
    teacher.unmount()

    const reader = renderTab({ permissions: EXAM_READER_PERMISSIONS })
    await findRow('سارة الطالبة')
    expect(regradeButton()).toBeNull()
    // Reading is all there: the roster and the attempts open for a reader too.
    expect(screen.getByLabelText('عرض المحاولة 2: سارة الطالبة')).toBeInTheDocument()
    reader.unmount()

    const draft = renderTab({ exam: makeOnlineExam() })
    await findRow('سارة الطالبة')
    expect(regradeButton()).toBeNull()
    draft.unmount()

    renderTab({ exam: makeScheduledOnlineExam({ class: { ...makeScheduledOnlineExam().class, status: 'cancelled' } }) })
    await findRow('سارة الطالبة')
    expect(regradeButton()).toBeNull()
  })

  it('requires a reason, sends it trimmed as { reason }, words the server’s counts, reads the roster again and has the drawer re-read the exam', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts(), regrade: () => jsonResponse(200, makeRegradeSummary()) })
    const { onChanged } = renderTab()
    await findRow('سارة الطالبة')
    const { dialog, reason, confirm } = await openRegrade()
    expect(within(dialog).getByText(ar.examAttempts.regrade.what)).toBeInTheDocument()
    expect(within(dialog).getByText(ar.examAttempts.regrade.usual)).toBeInTheDocument()

    // No reason, then only spaces: nothing is sent.
    fireEvent.click(confirm())
    expect(await within(dialog).findByText(ar.examAttempts.regrade.reasonRequired)).toBeInTheDocument()
    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.click(confirm())
    expect(await within(dialog).findByText(ar.examAttempts.regrade.reasonRequired)).toBeInTheDocument()
    expect(regrades(calls)).toEqual([])

    fireEvent.change(reason, { target: { value: '  مراجعة بعد تصحيح مفتاح السؤال الثاني  ' } })
    fireEvent.click(confirm())

    expect(await screen.findByTestId('regrade-result')).toHaveTextContent('فُحصت 14 محاولة، وتغيّر تصحيح 3 منها، وتغيّرت نتيجة طالبين.')
    expect(regrades(calls)).toEqual([{ method: 'POST', url: REGRADE_URL, body: { reason: 'مراجعة بعد تصحيح مفتاح السؤال الثاني' } }])
    await waitFor(() => expect(rosterReads(calls)).toHaveLength(2))
    expect(onChanged).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText(REGRADE_TITLE)).not.toBeInTheDocument())
  })

  it('says «no change» when the regrade rewrote nothing: the roster is read again, the drawer is left alone', async () => {
    const calls = mockAttemptsApi({ roster: () => makeExamAttempts(), regrade: () => jsonResponse(200, makeRegradeSummary({ changedAttempts: 0, changedResults: 0 })) })
    const { onChanged } = renderTab()
    await findRow('سارة الطالبة')
    const { reason, confirm } = await openRegrade()
    fireEvent.change(reason, { target: { value: 'تحقق دوري' } })
    fireEvent.click(confirm())

    expect(await screen.findByTestId('regrade-result')).toHaveTextContent('فُحصت 14 محاولة — لا تغيير.')
    await waitFor(() => expect(rosterReads(calls)).toHaveLength(2))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('words grades_certified with the server’s count and keeps the dialog and the typed reason; nothing is re-read', async () => {
    const calls = mockAttemptsApi({
      roster: () => makeExamAttempts(),
      regrade: () => jsonResponse(409, { statusCode: 409, code: 'grades_certified', classId: 'c-1', certificateCount: 3, message: 'The class has issued certificates' }),
    })
    const { onChanged } = renderTab()
    await findRow('سارة الطالبة')
    const { dialog, reason, confirm } = await openRegrade()
    fireEvent.change(reason, { target: { value: 'مراجعة' } })
    fireEvent.click(confirm())

    expect(await within(dialog).findByText(ar.examAttempts.errors.grades_certified_few.replace('{{count}}', '3'))).toBeInTheDocument()
    expect(reason).toHaveValue('مراجعة')
    expect(regrades(calls)).toHaveLength(1)
    expect(screen.queryByTestId('regrade-result')).not.toBeInTheDocument()
    expect(rosterReads(calls)).toHaveLength(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('shows a failed read with a retry that reads the roster again', async () => {
    let fail = true
    const calls = mockAttemptsApi({ roster: () => (fail ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeExamAttempts()) })
    const { onChanged } = renderTab()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.login.errors.server)
    expect(screen.queryByTestId('exam-attempts-stats')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(within(alert).getByText(ar.examAttempts.retry).closest('button')!)
    expect(await screen.findByText('سارة الطالبة')).toBeInTheDocument()
    expect(screen.queryByText(ar.login.errors.server)).not.toBeInTheDocument()
    expect(rosterReads(calls)).toHaveLength(2)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('keeps the last roster under the error when a later read fails', async () => {
    let fail = false
    mockAttemptsApi({ roster: () => (fail ? jsonResponse(503, { statusCode: 503, message: 'down' }) : makeExamAttempts()) })
    renderTab()
    await findRow('سارة الطالبة')
    fail = true
    fireEvent.click(screen.getByText(ar.examAttempts.refresh).closest('button')!)
    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    expect(screen.getByText('سارة الطالبة')).toBeInTheDocument()
  })

  it('asks the drawer to re-read the exam when the roster answers 404', async () => {
    mockAttemptsApi({ roster: () => jsonResponse(404, { statusCode: 404, code: 'exam_not_found', examId: EXAM_ID, message: 'No exam with this id' }) })
    const { onChanged } = renderTab()
    expect(await screen.findByText(ar.exams.errors.exam_not_found)).toBeInTheDocument()
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })
})
