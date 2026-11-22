// MOD-09 phase 2 (OEX-T07) — «اختباراتي» for an ONLINE exam: the row shows the
// window, the limit, the questions and the attempts, and offers what the
// SERVER's state allows — start (behind a confirmation of the rules), resume
// (with the server's time left) or the reason in words. A guardian's row never
// starts and links no attempt. The rows of manual exams are covered, unchanged,
// by MyExamsPage.test.tsx.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyAttempt } from '../api/myAttempts'
import { TAKE_BLOCKERS } from '../api/myExams'
import type { MyExamList, TakeBlocker } from '../api/myExams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { EXAM_ID, EXAM_ID_2 } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { ATTEMPT_ID, ATTEMPT_ID_2, makeAttemptSummary, makeMyAttempt } from '../test/myAttempts'
import { GUARDIAN_EXAM_PERMISSIONS, STUDENT_EXAM_PERMISSIONS, makeMyExam, makeMyExamList, makeMyExamResult, makeOnlineMyExam } from '../test/myExams'
import { CHILD_ONE, SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyExamsPage } from './MyExamsPage'

const take = ar.takeExam
const ZONE = 'Asia/Riyadh'
const OPENS_AT = '2026-11-20T07:00:00.000Z'
const CLOSES_AT = '2026-11-20T09:00:00.000Z'
const when = (iso: string) => formatZonedDateTime(iso, ZONE, 'ar')

type StartAnswer = MyAttempt | Response
type ListAnswer = MyExamList | ((read: number) => MyExamList)

interface ApiOptions {
  list: ListAnswer
  /** API-276: the answer to each start (0-based call number); throwing fails the request like a dead network. */
  start?: (call: number) => StartAnswer | Promise<StartAnswer>
  classes?: MyClassList
}

interface StartCall {
  examId: string
  body: unknown
}

/** Serves API-121 (counting its reads), API-276 (recording what is sent), API-060 and the academy. */
function mockApi({ list, start, classes = makeMyClassList([makeMyClassItem({ student: SELF_STUDENT })]) }: ApiOptions) {
  const starts: StartCall[] = []
  const other: string[] = []
  let reads = 0
  let startCalls = 0
  mockFetch(async (url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && parsed.pathname === '/api/me/exams') return jsonResponse(200, typeof list === 'function' ? list(reads++) : (reads++, list))
    if (method === 'GET' && parsed.pathname === '/api/me/classes') return jsonResponse(200, classes)
    if (method === 'GET' && parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    const match = parsed.pathname.match(/^\/api\/me\/exams\/([^/]+)\/attempts$/)
    if (method === 'POST' && match) {
      starts.push({ examId: match[1]!, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
      const answer = start ? await start(startCalls++) : makeMyAttempt()
      return answer instanceof Response ? answer.clone() : jsonResponse(201, answer)
    }
    other.push(`${method} ${parsed.pathname}`)
    return jsonResponse(404, { statusCode: 404, message: 'not served' })
  })
  return { starts, other, listReads: () => reads }
}

function refusal(status: number, code: string, details: Record<string, unknown> = {}) {
  return jsonResponse(status, { statusCode: status, code, message: 'refused', ...details })
}

function renderPage(roles: string[] = ['student'], permissions: string[] = STUDENT_EXAM_PERMISSIONS) {
  const role = roles.includes('guardian') && !roles.includes('student') ? 'guardian' : 'student'
  return renderWithProviders(<MyExamsPage />, {
    auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role, roles, permissions }) }),
    route: '/my-exams',
    routes: { '/take-exam/:attemptId': <LocationProbe /> },
  })
}

function bodyRows() {
  return Array.from(document.querySelectorAll<HTMLElement>('.ant-table-tbody tr.ant-table-row'))
}

async function rowsOf(count: number) {
  return waitFor(() => {
    const rows = bodyRows()
    expect(rows).toHaveLength(count)
    return rows
  })
}

/** The confirmation dialog of «ابدأ الاختبار». */
async function startDialog() {
  return (await screen.findByText(take.start.title)).closest('[role="dialog"]') as HTMLElement
}

const buttonIn = (scope: HTMLElement, label: string) => within(scope).getByText(label).closest('button') as HTMLButtonElement

/** Lets the mocked requests and the renders they cause finish (fake timers). */
async function flush() {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MyExamsPage — an online exam', () => {
  it('tags the row «إلكتروني» and shows its window in the exam’s zone, the time limit, the questions and the attempts — and offers to start', async () => {
    const api = mockApi({ list: makeMyExamList([makeOnlineMyExam({}, { attemptsAllowed: 2, attemptsUsed: 0 })]) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]

    expect(within(row).getByText('اختبار قصير: أساسيات بايثون')).toBeInTheDocument()
    expect(within(row).getByText(take.list.onlineTag)).toBeInTheDocument()
    expect(within(row).getByText(ar.exams.types.quiz)).toBeInTheDocument()
    const window = within(row).getByTestId('online-when')
    expect(window).toHaveTextContent(`${take.list.opensAt} ${when(OPENS_AT)}`)
    expect(window).toHaveTextContent(`${take.list.closesAt} ${when(CLOSES_AT)}`)
    expect(within(window).getByText(i18n.t('takeExam.list.attemptMinutes', { count: 30 }))).toBeInTheDocument()
    expect(within(window).getByText(ZONE)).toBeInTheDocument() // the exam's zone is not this device's
    const online = within(row).getByTestId('online-take')
    expect(online).toHaveTextContent(i18n.t('takeExam.list.questions', { count: 3 }))
    expect(online).toHaveTextContent(i18n.t('takeExam.list.attemptsUsed', { used: 0, allowed: 2 }))
    expect(buttonIn(online, take.list.start)).toBeEnabled()
    expect(within(online).queryByText(take.list.resume)).not.toBeInTheDocument()
    expect(within(row).queryByTestId('take-blocked')).not.toBeInTheDocument()
    // Results on publication: the same wait as a manual exam's.
    expect(within(row).getByText(ar.myExams.result.awaiting)).toBeInTheDocument()
    // Looking at the list starts nothing.
    expect(api.starts).toHaveLength(0)
    expect(api.other).toEqual([])
  })

  it('confirms the rules in plain words, then starts with the attempt number the row showed and opens the exam page', async () => {
    const item = makeOnlineMyExam({}, { attemptsAllowed: 2, attemptsUsed: 1, attempts: [makeAttemptSummary({ id: ATTEMPT_ID, status: 'submitted', submittedAt: '2026-11-20T07:20:00.000Z' })] })
    const api = mockApi({ list: makeMyExamList([item]), start: () => makeMyAttempt({ id: ATTEMPT_ID_2, attemptNo: 2 }) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))

    const dialog = await startDialog()
    expect(within(dialog).getByText(i18n.t('takeExam.start.intro', { title: 'اختبار قصير: أساسيات بايثون' }))).toBeInTheDocument()
    // The time limit, and that it never runs past the closing of the window.
    expect(within(dialog).getByText(i18n.t('takeExam.start.rules.duration', { count: 30 }))).toBeInTheDocument()
    expect(within(dialog).getByText(i18n.t('takeExam.start.rules.closes', { date: when(CLOSES_AT) }))).toBeInTheDocument()
    expect(within(dialog).getByText(i18n.t('takeExam.start.rules.questions', { count: 3 }))).toBeInTheDocument()
    // The clock is the server's and does not stop; answers save themselves; the submit is final.
    expect(within(dialog).getByText(take.start.rules.clock)).toBeInTheDocument()
    expect(within(dialog).getByText(take.start.rules.autosave)).toBeInTheDocument()
    expect(within(dialog).getByText(take.start.rules.final)).toBeInTheDocument()
    // Attempts allowed and used: this is the second of two, the last — and the highest counts.
    expect(dialog).toHaveTextContent(i18n.t('takeExam.start.rules.lastAttempt', { number: 2, allowed: 2 }))
    expect(dialog).toHaveTextContent(take.start.rules.highestCounts)
    expect(within(dialog).getByText('الفصول 1 إلى 4')).toBeInTheDocument() // the exam's instructions, before the clock starts
    expect(api.starts).toHaveLength(0) // nothing is started by opening the dialog

    fireEvent.click(buttonIn(dialog, take.start.ok))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', `/take-exam/${ATTEMPT_ID_2}`)
    expect(api.starts).toEqual([{ examId: EXAM_ID, body: { attemptNo: 2 } }])
  })

  it('starts nothing when the confirmation is declined', async () => {
    const api = mockApi({ list: makeMyExamList([makeOnlineMyExam({}, { attemptsAllowed: 1 })]) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))
    const dialog = await startDialog()
    // One attempt allowed: it is the last, and «the highest counts» has nothing to say.
    expect(dialog).toHaveTextContent(i18n.t('takeExam.start.rules.lastAttempt', { number: 1, allowed: 1 }))
    expect(dialog).not.toHaveTextContent(take.start.rules.highestCounts)
    fireEvent.click(buttonIn(dialog, take.start.cancel))
    await waitFor(() => expect(screen.queryByText(take.start.rules.clock)).not.toBeInTheDocument())
    expect(api.starts).toHaveLength(0)
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
  })

  it('re-reads the list instead of retrying when the server holds another attempt number (409 attempt_conflict)', async () => {
    const before = makeOnlineMyExam({}, { attemptsAllowed: 2, attemptsUsed: 0 })
    // Meanwhile the first attempt was started elsewhere: the list now shows it in progress.
    const after = makeOnlineMyExam(
      {},
      { attemptsAllowed: 2, attemptsUsed: 1, inProgress: { id: ATTEMPT_ID, attemptNo: 1, expiresAt: '2026-11-20T08:00:00.000Z', remainingSeconds: 1500 }, attempts: [makeAttemptSummary()], serverNow: '2026-11-20T07:35:00.000Z' },
    )
    const api = mockApi({ list: (read) => makeMyExamList([read === 0 ? before : after]), start: () => refusal(409, 'attempt_conflict', { expected: 1, next: 2 }) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))
    const dialog = await startDialog()
    fireEvent.click(buttonIn(dialog, take.start.ok))

    const failure = await within(dialog).findByTestId('start-failure')
    expect(failure).toHaveTextContent(take.errors.attempt_conflict)
    expect(failure).toHaveTextContent(take.start.refreshed)
    // No second try is offered: only «إغلاق».
    expect(within(dialog).queryByText(take.start.ok)).not.toBeInTheDocument()
    await waitFor(() => expect(api.listReads()).toBe(2))
    expect(api.starts).toEqual([{ examId: EXAM_ID, body: { attemptNo: 1 } }])
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()

    fireEvent.click(buttonIn(dialog, take.start.close))
    // The row behind now offers what the server holds: the attempt in progress.
    await waitFor(() => expect(within(bodyRows()[0]!).getByText(take.list.resume)).toBeInTheDocument())
    expect(api.starts).toHaveLength(1)
  })

  it.each([
    ['exam_not_found', refusal(404, 'exam_not_found', { examId: EXAM_ID }), take.errors.exam_not_found],
    ['enrollment_required', refusal(403, 'enrollment_required', { enrollmentStatus: 'withdrawn' }), i18n.t('takeExam.errors.enrollment_required_status', { status: ar.labels.withdrawn })],
    ['exam_not_open (not yet)', refusal(409, 'exam_not_open', { reason: 'not_open_yet', opensAt: OPENS_AT, closesAt: CLOSES_AT }), i18n.t('takeExam.errors.not_open_yet_at', { date: when(OPENS_AT) })],
    ['exam_not_open (closed)', refusal(409, 'exam_not_open', { reason: 'closed', opensAt: OPENS_AT, closesAt: CLOSES_AT }), i18n.t('takeExam.errors.closed_at', { date: when(CLOSES_AT) })],
    ['exam_not_open (results published)', refusal(409, 'exam_not_open', { reason: 'results_published', opensAt: OPENS_AT, closesAt: CLOSES_AT }), take.errors.results_published],
    ['attempts_exhausted', refusal(409, 'attempts_exhausted', { attemptsAllowed: 2, attempts: 2 }), i18n.t('takeExam.errors.attempts_exhausted_count', { attempts: '2', allowed: '2' })],
    ['class_closed', refusal(409, 'class_closed', { classId: 'c', status: 'cancelled' }), take.errors.class_closed],
    ['permission_denied', refusal(403, 'permission_denied', { missing: ['exams.take'] }), take.errors.permission_denied],
  ])('words the refusal %s of the start and re-reads the list', async (_code, answer, message) => {
    const api = mockApi({ list: makeMyExamList([makeOnlineMyExam()]), start: () => answer })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))
    const dialog = await startDialog()
    fireEvent.click(buttonIn(dialog, take.start.ok))

    expect(await within(dialog).findByTestId('start-failure')).toHaveTextContent(message)
    expect(within(dialog).queryByText(take.start.ok)).not.toBeInTheDocument()
    await waitFor(() => expect(api.listReads()).toBe(2))
    expect(api.starts).toHaveLength(1)
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
  })

  it('asks to wait on a 429 and keeps «ابدأ الآن»: the next try sends the same attempt number', async () => {
    const api = mockApi({ list: makeMyExamList([makeOnlineMyExam()]), start: (call) => (call === 0 ? refusal(429, 'rate_limited') : makeMyAttempt()) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))
    const dialog = await startDialog()
    fireEvent.click(buttonIn(dialog, take.start.ok))
    const failure = await within(dialog).findByTestId('start-failure')
    expect(failure).toHaveTextContent(take.errors.rate_limited)
    expect(failure).toHaveTextContent(take.start.retryHint)

    await waitFor(() => expect(buttonIn(dialog, take.start.ok)).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(buttonIn(dialog, take.start.ok))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', `/take-exam/${ATTEMPT_ID}`)
    expect(api.starts).toEqual([
      { examId: EXAM_ID, body: { attemptNo: 1 } },
      { examId: EXAM_ID, body: { attemptNo: 1 } },
    ])
  })

  it('keeps «ابدأ الآن» after a network failure — without re-reading the list — and never uses a second attempt on the retry', async () => {
    const api = mockApi({
      list: makeMyExamList([makeOnlineMyExam({}, { attemptsUsed: 1, attempts: [makeAttemptSummary({ status: 'timed_out', submittedAt: '2026-11-20T07:20:00.000Z' })] })]),
      start: (call) => {
        if (call === 0) throw new TypeError('Failed to fetch')
        return makeMyAttempt({ id: ATTEMPT_ID_2, attemptNo: 2 })
      },
    })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    fireEvent.click(buttonIn(row, take.list.start))
    const dialog = await startDialog()
    fireEvent.click(buttonIn(dialog, take.start.ok))

    const failure = await within(dialog).findByTestId('start-failure')
    expect(failure).toHaveTextContent(ar.login.errors.network)
    expect(failure).toHaveTextContent(take.start.retryHint)
    expect(api.listReads()).toBe(1) // not a refusal: the row is not out of date

    await waitFor(() => expect(buttonIn(dialog, take.start.ok)).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(buttonIn(dialog, take.start.ok))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', `/take-exam/${ATTEMPT_ID_2}`)
    // The same number both times: had the first request reached the server, the second would resume that attempt.
    expect(api.starts.map((call) => call.body)).toEqual([{ attemptNo: 2 }, { attemptNo: 2 }])
  })

  it('offers «متابعة الاختبار» for the attempt in progress, with the server’s time left counted down — never the device’s date', async () => {
    vi.useFakeTimers()
    // The device's clock says the exam closed a day ago; the server says 12:34 are left.
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'))
    // A server with a clock of its own: 754 seconds at the first read, less by what has passed at every later one.
    const startedAt = performance.now()
    const itemNow = () => {
      const elapsed = performance.now() - startedAt
      return makeOnlineMyExam(
        {},
        {
          attemptsAllowed: 1,
          attemptsUsed: 1,
          inProgress: { id: ATTEMPT_ID, attemptNo: 1, expiresAt: '2026-11-20T08:00:00.000Z', remainingSeconds: Math.ceil((754_000 - elapsed) / 1000) },
          attempts: [makeAttemptSummary()],
          serverNow: new Date(Date.UTC(2026, 10, 20, 7, 47, 26) + elapsed).toISOString(),
        },
      )
    }
    const api = mockApi({ list: () => makeMyExamList([itemNow()]) })
    renderPage()
    await flush()
    const [row] = bodyRows() as [HTMLElement]

    const resume = within(row).getByText(take.list.resume).closest('a') as HTMLAnchorElement
    expect(resume).toHaveAttribute('href', `/take-exam/${ATTEMPT_ID}`)
    expect(within(row).getByTestId('resume-time-left')).toHaveTextContent(`${take.list.timeLeft} 12:34`)
    expect(within(row).queryByText(take.list.start)).not.toBeInTheDocument()
    // The attempt in progress is listed, and reached by the button — not linked a second time.
    const attempts = within(row).getByTestId('attempts-list')
    expect(within(attempts).getByText(take.list.attemptStatus.in_progress)).toBeInTheDocument()
    expect(within(attempts).queryByRole('link')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(within(row).getByTestId('resume-time-left')).toHaveTextContent('12:30')
    expect(api.listReads()).toBe(1)
    // The device's date jumps back a week: the time left does not follow it. The device's clocks no longer agreeing,
    // the list is read again and the server's own number goes on (it rounds up, so a second may show twice).
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flush()
    expect(api.listReads()).toBe(2)
    expect(within(bodyRows()[0]!).getByTestId('resume-time-left')).toHaveTextContent(/12:(29|30)$/)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(within(bodyRows()[0]!).getByTestId('resume-time-left')).toHaveTextContent(/12:(19|20)$/)
    expect(api.listReads()).toBe(2)

    fireEvent.click(within(bodyRows()[0]!).getByText(take.list.resume).closest('a')!)
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', `/take-exam/${ATTEMPT_ID}`)
    expect(api.starts).toHaveLength(0) // resuming opens the attempt; it starts nothing
  })

  it('says when the time of the attempt in progress has run out and reads the list again', async () => {
    vi.useFakeTimers()
    const running = makeOnlineMyExam(
      {},
      { attemptsAllowed: 1, attemptsUsed: 1, inProgress: { id: ATTEMPT_ID, attemptNo: 1, expiresAt: '2026-11-20T08:00:00.000Z', remainingSeconds: 2 }, attempts: [makeAttemptSummary()] },
    )
    const over = makeOnlineMyExam({}, { attemptsAllowed: 1, attemptsUsed: 1, canStart: false, blocker: 'attempts_exhausted', inProgress: null, attempts: [makeAttemptSummary()], serverNow: '2026-11-20T08:00:01.000Z' })
    const api = mockApi({ list: (read) => makeMyExamList([read === 0 ? running : over]) })
    renderPage()
    await flush()
    expect(within(bodyRows()[0]!).getByTestId('resume-time-left')).toHaveTextContent('00:02')
    expect(api.listReads()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await flush()
    expect(api.listReads()).toBe(2)
    const row = bodyRows()[0]!
    expect(within(row).queryByText(take.list.resume)).not.toBeInTheDocument()
    expect(within(row).getByTestId('take-blocked')).toHaveTextContent(i18n.t('takeExam.list.blocked.attempts_exhausted', { used: 1, allowed: 1 }))
    // The attempt whose time is up is still open on the server for a moment: opening it closes it.
    expect(within(row).getByRole('link', { name: i18n.t('takeExam.list.openAttemptOf', { number: 1 }) })).toHaveAttribute('href', `/take-exam/${ATTEMPT_ID}`)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(api.listReads()).toBe(2) // once
  })

  it('says in words why the exam cannot be taken now — one sentence per reason of the server', async () => {
    const reasons: Record<TakeBlocker, string> = {
      not_self: take.list.blocked.not_self,
      not_permitted: take.list.blocked.not_permitted,
      results_published: take.list.blocked.results_published,
      not_enrolled: take.list.blocked.not_enrolled,
      class_closed: take.list.blocked.class_closed,
      not_open_yet: i18n.t('takeExam.list.blocked.not_open_yet_at', { date: when(OPENS_AT) }),
      closed: i18n.t('takeExam.list.blocked.closed_at', { date: when(CLOSES_AT) }),
      attempts_exhausted: i18n.t('takeExam.list.blocked.attempts_exhausted', { used: 2, allowed: 2 }),
    }
    const items = TAKE_BLOCKERS.map((blocker, index) =>
      makeOnlineMyExam({ id: `exam-blocked-${index}`, title: { ar: `اختبار ${blocker}` } }, { canStart: false, blocker, attemptsUsed: blocker === 'attempts_exhausted' ? 2 : 0 }),
    )
    const api = mockApi({ list: makeMyExamList(items) })
    renderPage()
    const rows = await rowsOf(TAKE_BLOCKERS.length)
    TAKE_BLOCKERS.forEach((blocker, index) => {
      const row = rows[index]!
      expect(within(row).getByTestId('take-blocked'), blocker).toHaveTextContent(reasons[blocker])
      expect(within(row).queryByText(take.list.start)).not.toBeInTheDocument()
      expect(within(row).queryByText(take.list.resume)).not.toBeInTheDocument()
    })
    expect(api.starts).toHaveLength(0)
  })

  it('lists the student’s attempts: number, status, a score only when the server sent one, and a link to a finished attempt', async () => {
    const item = makeOnlineMyExam(
      { result: makeMyExamResult({ score: 8, feedback: null }) },
      {
        attemptsAllowed: 3,
        attemptsUsed: 2,
        resultsRelease: 'on_submit',
        attempts: [
          makeAttemptSummary({ id: ATTEMPT_ID, attemptNo: 1, status: 'submitted', submittedAt: '2026-11-20T07:20:00.000Z', score: 8 }),
          makeAttemptSummary({ id: ATTEMPT_ID_2, attemptNo: 2, status: 'timed_out', submittedAt: '2026-11-20T07:50:00.000Z', score: null }),
        ],
      },
    )
    mockApi({ list: makeMyExamList([item]) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]

    // The result the exam released on submit shows as for any exam: the counted score out of the maximum.
    expect(within(row).getByText(ar.exams.results.status.scored)).toBeInTheDocument()
    const entries = within(within(row).getByTestId('attempts-list')).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent(i18n.t('takeExam.list.attempt', { number: 1 }))
    expect(entries[0]).toHaveTextContent(take.list.attemptStatus.submitted)
    expect(entries[0]).toHaveTextContent('8 / 10')
    expect(within(entries[0]!).getByRole('link', { name: i18n.t('takeExam.list.viewAttemptOf', { number: 1 }) })).toHaveAttribute('href', `/take-exam/${ATTEMPT_ID}`)
    // No score was sent for the second attempt: none is shown, and none is made up.
    expect(entries[1]).toHaveTextContent(take.list.attemptStatus.timed_out)
    expect(entries[1]).not.toHaveTextContent(/\d+\s*\/\s*\d+/)
    expect(within(entries[1]!).getByRole('link', { name: i18n.t('takeExam.list.viewAttemptOf', { number: 2 }) })).toHaveAttribute('href', `/take-exam/${ATTEMPT_ID_2}`)

    fireEvent.click(within(entries[0]!).getByRole('link'))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', `/take-exam/${ATTEMPT_ID}`)
  })

  it('says a result released on submit appears on submit — not «after the publication»', async () => {
    mockApi({ list: makeMyExamList([makeOnlineMyExam({}, { resultsRelease: 'on_submit' })]) })
    renderPage()
    const [row] = (await rowsOf(1)) as [HTMLElement]
    expect(within(row).getByText(take.list.result.afterSubmit)).toBeInTheDocument()
    expect(within(row).queryByText(ar.myExams.result.awaiting)).not.toBeInTheDocument()
  })

  it('gives a guardian the child’s row without a start, a resume or an attempt link', async () => {
    const item = makeOnlineMyExam(
      { relation: 'child', student: CHILD_ONE, result: makeMyExamResult({ score: 8, feedback: null }) },
      {
        resultsRelease: 'on_submit',
        canStart: false,
        blocker: 'not_self',
        attemptsUsed: 2,
        // The child's second attempt is in progress right now: still nothing a guardian can open.
        attempts: [makeAttemptSummary({ status: 'submitted', submittedAt: '2026-11-20T07:20:00.000Z', score: 8 }), makeAttemptSummary({ id: ATTEMPT_ID_2, attemptNo: 2 })],
      },
    )
    const api = mockApi({ list: makeMyExamList([item]), classes: makeMyClassList([makeMyClassItem({ relation: 'child', student: CHILD_ONE })]) })
    renderPage(['guardian'], GUARDIAN_EXAM_PERMISSIONS)
    const [row] = (await rowsOf(1)) as [HTMLElement]

    expect(within(row).getByText(take.list.onlineTag)).toBeInTheDocument()
    expect(within(row).getByTestId('take-blocked')).toHaveTextContent(take.list.blocked.not_self)
    expect(within(row).queryByText(take.list.start)).not.toBeInTheDocument()
    expect(within(row).queryByText(take.list.resume)).not.toBeInTheDocument()
    // The attempts are listed with what the server released…
    const attempts = within(row).getByTestId('attempts-list')
    expect(within(attempts).getAllByRole('listitem')).toHaveLength(2)
    expect(attempts).toHaveTextContent('8 / 10')
    expect(attempts).toHaveTextContent(take.list.attemptStatus.in_progress)
    // …and nothing leads to an attempt.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(row.querySelector('a[href^="/take-exam"]')).toBeNull()
    expect(api.starts).toHaveLength(0)
  })

  it('leaves the row of a manual exam exactly as it is, alone or beside an online one', async () => {
    const manual = makeMyExam({ id: EXAM_ID_2, title: { ar: 'اختبار ورقي' } })
    mockApi({ list: makeMyExamList([manual]) })
    const alone = renderPage()
    const [only] = (await rowsOf(1)) as [HTMLElement]
    const html = only.innerHTML
    expect(within(only).queryByText(take.list.onlineTag)).not.toBeInTheDocument()
    expect(within(only).queryByTestId('online-take')).not.toBeInTheDocument()
    expect(within(only).queryByTestId('online-when')).not.toBeInTheDocument()
    expect(within(only).queryByTestId('attempts-list')).not.toBeInTheDocument()
    expect(only.querySelector('button:not(.ant-table-row-expand-icon), a')).toBeNull() // nothing to press but the expander
    alone.unmount()

    mockApi({ list: makeMyExamList([makeOnlineMyExam(), manual]) })
    renderPage()
    const [online, beside] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(within(online).getByText(take.list.onlineTag)).toBeInTheDocument()
    expect(beside.innerHTML).toBe(html)
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(
      expect.arrayContaining([ar.myExams.columns.when, ar.myExams.columns.exam, ar.myExams.columns.class, ar.myExams.columns.status, ar.myExams.columns.result]),
    )
  })
})
