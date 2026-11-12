import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyAssignmentList, MySubmission } from '../api/myAssignments'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { dayStartIn } from '../assignments/assignments.zone'
import { RequireAccess } from '../auth/RequireAuth'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ID, ASSIGNMENT_ID_2, ASSIGNMENT_TEACHER_PERMISSIONS } from '../test/assignments'
import { ENROLLMENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import {
  FUTURE_DUE,
  GUARDIAN_LEARNER_PERMISSIONS,
  PAST_DUE,
  STUDENT_LEARNER_PERMISSIONS,
  SUBMISSION_ID,
  makeLatest,
  makeMyAssignment,
  makeMyAssignmentList,
  makeMySubmission,
} from '../test/myAssignments'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyAssignmentsPage } from './MyAssignmentsPage'

const todo = makeMyAssignment()
const graded = makeMyAssignment({
  id: ASSIGNMENT_ID_2,
  title: { ar: 'واجب الدوال' },
  attempts: 1,
  attemptsAllowed: 1,
  latest: makeLatest({ isLate: true, status: 'graded', score: 18, feedback: 'أحسنت، راجع التمرين الثاني', gradedAt: '2026-11-11T09:00:00.000Z' }),
  // The server's verdict (MOD-08-T07): no attempt left.
  submitBlocker: 'attempts_exhausted',
})

const selfClass = makeMyClassItem({ student: SELF_STUDENT })
const childOneClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE })
const childTwoClass = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO })
const childTwoOther = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[2],
  relation: 'child',
  student: CHILD_TWO,
  class: { ...selfClass.class, id: 'class-ar', code: 'AR-201', name: { ar: 'عربي متقدم' } },
})

type ListAnswer = MyAssignmentList | Response
type ListHandler = ListAnswer | ((query: URLSearchParams) => ListAnswer)

interface ApiOptions {
  classes?: MyClassList | Response
  submit?: Response
  submission?: MySubmission
}

/** Serves API-112 (recording its queries), API-060 (the filter options and the enrollments), the academy, API-109 and API-110. */
function mockMyAssignmentsApi(list: ListHandler, { classes = makeMyClassList([selfClass]), submit, submission = makeMySubmission() }: ApiOptions = {}) {
  const queries: URLSearchParams[] = []
  const paths: string[] = []
  const posts: { path: string; body: unknown }[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    paths.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname === '/api/me/assignments') {
      queries.push(parsed.searchParams)
      const answer = typeof list === 'function' ? list(parsed.searchParams) : list
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (parsed.pathname === '/api/me/classes') return classes instanceof Response ? classes.clone() : jsonResponse(200, classes)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (method === 'POST' && parsed.pathname.endsWith('/submissions')) {
      posts.push({ path: parsed.pathname, body: JSON.parse(String(init?.body)) })
      return submit ? submit.clone() : jsonResponse(201, makeMySubmission())
    }
    if (parsed.pathname.startsWith('/api/submissions/')) return jsonResponse(200, submission)
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { queries, paths, posts }
}

function renderPage(roles: string[] = ['student'], permissions: string[] = STUDENT_LEARNER_PERMISSIONS) {
  const role = roles.includes('guardian') && !roles.includes('student') ? 'guardian' : 'student'
  return renderWithProviders(<MyAssignmentsPage />, {
    auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role, roles, permissions }) }),
    route: '/my-assignments',
  })
}

/** The page behind the router's own gate (`guarded('myAssignments')` in app/router.tsx). */
function renderGuarded(user: ReturnType<typeof makeUser>) {
  return renderWithProviders(
    <RequireAccess navKey="myAssignments">
      <MyAssignmentsPage />
    </RequireAccess>,
    { auth: makeAuth({ user }), route: '/my-assignments' },
  )
}

/** The rows of the list (the drawer's bordered Descriptions is a table too, so not by role). */
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

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

const buttonIn = (row: HTMLElement, text: string) => within(row).queryByText(text)?.closest('button') ?? null

/** Sends one attempt through the modal: the answer, OK, then «send» in the D-R38 confirmation. */
async function sendAttempt(answer: string) {
  const dialog = (await screen.findByText(ar.myAssignments.submit.ok)).closest('[role="dialog"]') as HTMLElement
  fireEvent.change(within(dialog).getByLabelText(ar.myAssignments.submit.textAnswer), { target: { value: answer } })
  fireEvent.click(within(dialog).getByText(ar.myAssignments.submit.ok).closest('button')!)
  // antd renders a confirmation's title twice; the latest one belongs to this confirmation.
  const titles = await screen.findAllByText(ar.myAssignments.submit.confirm.title.replace('{{number}}', '1'))
  const confirm = titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
  fireEvent.click(within(confirm).getByText(ar.myAssignments.submit.confirm.ok, { selector: 'button span' }).closest('button')!)
  return dialog
}

describe('MyAssignmentsPage', () => {
  it('shows a student the open assignments: due date in the assignment zone, title, class and course, the class teacher by name, status, their own submission, attempts and score', async () => {
    const api = mockMyAssignmentsApi(makeMyAssignmentList([todo, graded]))
    renderPage()

    const [first, second] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ status: 'open', order: 'asc', limit: '20' })
    expect(within(first).getByText(formatZonedDateTime(FUTURE_DUE, 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(first).getByText('Asia/Riyadh')).toBeInTheDocument()
    expect(within(first).getByText('تمارين الحلقات')).toBeInTheDocument()
    expect(within(first).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(first).getByText('بايثون — الفصل أ · أساسيات بايثون')).toBeInTheDocument()
    await waitFor(() => expect(within(first).getByText('خالد المعلم')).toBeInTheDocument())
    expect(within(first).getByText(ar.labels.open)).toBeInTheDocument()
    expect(within(first).getByText(ar.myAssignments.submission.none)).toBeInTheDocument()
    expect(within(first).getByText('0 / 1')).toBeInTheDocument()
    expect(buttonIn(first, ar.myAssignments.actions.submit)).toBeEnabled()
    expect(buttonIn(first, ar.myAssignments.actions.viewMine)).toBeNull()

    // A graded attempt: the server's late mark, its number, the score and the feedback; no attempt left, so no button.
    expect(within(second).getByText(ar.myAssignments.submission.graded)).toBeInTheDocument()
    expect(within(second).getByText(ar.myAssignments.submission.late)).toBeInTheDocument()
    expect(within(second).getByText('المحاولة 1')).toBeInTheDocument()
    expect(within(second).getByText('1 / 1')).toBeInTheDocument()
    expect(within(second).getByText('18 / 20')).toBeInTheDocument()
    expect(within(second).getByText('أحسنت، راجع التمرين الثاني')).toBeInTheDocument()
    expect(within(second).getByText(ar.myAssignments.blocked.attempts_exhausted)).toBeInTheDocument()
    expect(buttonIn(second, ar.myAssignments.actions.submit)).toBeNull()
    expect(buttonIn(second, ar.myAssignments.actions.viewMine)).toBeEnabled()

    // A student alone needs neither the student column nor the student filter.
    expect(screen.queryByRole('columnheader', { name: ar.myAssignments.columns.student })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myAssignments.filters.student)).not.toBeInTheDocument()
  })

  it('shows the instructions and grading rules in the expanded row (learners never read API-103)', async () => {
    mockMyAssignmentsApi(makeMyAssignmentList([makeMyAssignment({ allowLate: true, latePenaltyPercent: 10, maxAttempts: 2, attemptsAllowed: 2 })]))
    renderPage()
    const [row] = await rowsOf(1)
    expect(screen.queryByText('حلّ تمارين الصفحة 12')).not.toBeInTheDocument()
    fireEvent.click(row!.querySelector('button.ant-table-row-expand-icon')!)
    expect(await screen.findByText('حلّ تمارين الصفحة 12')).toBeInTheDocument()
    expect(screen.getByText(ar.myAssignments.details.lateAllowedWithPenalty.replace('{{percent}}', '10'))).toBeInTheDocument()
    expect(screen.getByText(ar.myAssignments.details.maxAttemptsValue.replace('{{count}}', '2'))).toBeInTheDocument()
  })

  it('tells a past-due row that still takes a late attempt from one that missed the due date — as the server says', async () => {
    const late = makeMyAssignment({ dueAt: PAST_DUE, allowLate: true, submitsLate: true })
    const missed = makeMyAssignment({ id: ASSIGNMENT_ID_2, title: { ar: 'واجب الدوال' }, dueAt: PAST_DUE, submitBlocker: 'past_due' })
    mockMyAssignmentsApi(makeMyAssignmentList([late, missed]))
    renderPage()
    const [first, second] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(within(first).getByText(ar.myAssignments.submission.lateOpen)).toBeInTheDocument()
    expect(buttonIn(first, ar.myAssignments.actions.submit)).toBeEnabled()
    expect(within(second).getByText(ar.myAssignments.submission.missed)).toBeInTheDocument()
    expect(within(second).getByText(ar.myAssignments.blocked.past_due)).toBeInTheDocument()
    expect(buttonIn(second, ar.myAssignments.actions.submit)).toBeNull()
  })

  it('follows the server’s verdict, never this device’s clock: a due date already past here still offers «submit» while the server takes it (#109 note 1)', async () => {
    // A device clock minutes ahead puts the due date in the past; the server, which decides, still takes an attempt on time.
    const onTime = makeMyAssignment({ dueAt: PAST_DUE, submitBlocker: null, submitsLate: false })
    // And the other way round: the server says past due while the due date is still ahead on this device.
    const shut = makeMyAssignment({ id: ASSIGNMENT_ID_2, title: { ar: 'واجب الدوال' }, dueAt: FUTURE_DUE, submitBlocker: 'past_due' })
    mockMyAssignmentsApi(makeMyAssignmentList([onTime, shut]))
    renderPage()
    const [first, second] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(buttonIn(first, ar.myAssignments.actions.submit)).toBeEnabled()
    expect(within(first).getByText(ar.myAssignments.submission.none)).toBeInTheDocument()
    expect(within(first).queryByText(ar.myAssignments.submission.lateOpen)).not.toBeInTheDocument()
    expect(within(first).queryByText(ar.myAssignments.blocked.past_due)).not.toBeInTheDocument()
    expect(buttonIn(second, ar.myAssignments.actions.submit)).toBeNull()
    expect(within(second).getByText(ar.myAssignments.blocked.past_due)).toBeInTheDocument()
    expect(within(second).getByText(ar.myAssignments.submission.missed)).toBeInTheDocument()
  })

  it('gives a guardian one row per child with the relation tag, never a submit button, and the student filter', async () => {
    const one = makeMyAssignment({ relation: 'child', student: CHILD_ONE, attempts: 1, latest: makeLatest({ status: 'graded', score: 15 }) })
    const two = makeMyAssignment({ relation: 'child', student: CHILD_TWO })
    const api = mockMyAssignmentsApi(makeMyAssignmentList([one, two]), { classes: makeMyClassList([childOneClass, childTwoClass, childTwoOther]) })
    renderPage(['guardian'], GUARDIAN_LEARNER_PERMISSIONS)

    const [first, second] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(screen.getByRole('columnheader', { name: ar.myAssignments.columns.student })).toBeInTheDocument()
    expect(within(first).getByText('عمر')).toBeInTheDocument()
    expect(within(first).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(first).getByText('15 / 20')).toBeInTheDocument()
    expect(buttonIn(first, ar.myAssignments.actions.viewChild)).toBeEnabled()
    expect(within(second).getByText('ليلى الأحمد')).toBeInTheDocument()
    expect(within(second).getByText(ar.myAssignments.submission.none)).toBeInTheDocument()
    // A guardian reads and never submits (D-R40) — no button and no hint on either row.
    for (const row of [first, second]) {
      expect(buttonIn(row, ar.myAssignments.actions.submit)).toBeNull()
      expect(within(row).queryByText(ar.myAssignments.blocked.noPermission)).not.toBeInTheDocument()
    }
    expect(screen.getByText(ar.myAssignments.limitNote)).toBeInTheDocument()

    await pick(ar.myAssignments.filters.class, 'AR-201 — عربي متقدم')
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe('class-ar'))
    await pick(ar.myAssignments.filters.student, 'ليلى الأحمد')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_TWO.id))
    expect(api.queries.at(-1)?.get('classId')).toBe('class-ar') // Layla is enrolled there: kept
    await pick(ar.myAssignments.filters.student, 'عمر')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_ONE.id))
    expect(api.queries.at(-1)?.get('classId')).toBeNull() // Omar is not: dropped
  })

  it('switches views — not submitted yet, closed, all with due days in the academy zone and an order — each from the first page', async () => {
    const api = mockMyAssignmentsApi(makeMyAssignmentList([]))
    renderPage()
    expect(await screen.findByText(ar.myAssignments.empty.open)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.myAssignments.views.pending))
    await waitFor(() => expect(api.queries.at(-1)?.get('pending')).toBe('true'))
    expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ status: 'open', pending: 'true', order: 'asc', limit: '20' })
    // D-R49 (6): the hint names the returned attempts the view now keeps.
    expect(screen.getByText(ar.myAssignments.views.pendingHint)).toHaveTextContent('أُعيدت محاولتها الأخيرة للتعديل')
    expect(await screen.findByText(ar.myAssignments.empty.pending)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.myAssignments.views.closed))
    await waitFor(() => expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ status: 'closed', order: 'desc', limit: '20' }))
    expect(await screen.findByText(ar.myAssignments.empty.closed)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.assignments.filters.dueFrom)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.myAssignments.views.all))
    await waitFor(() => expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ order: 'asc', limit: '20' }))
    expect(await screen.findByText(ar.myAssignments.empty.all)).toBeInTheDocument()
    // The academy (makeAcademy) lives in Asia/Riyadh: the days are read there, and the page says so.
    expect(await screen.findByTestId('my-assignments-filter-zone')).toHaveTextContent('Asia/Riyadh')
    fireEvent.change(screen.getByLabelText(ar.assignments.filters.dueFrom), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('dueFrom')).toBe(dayStartIn('2026-11-01', 'Asia/Riyadh')!))
    await pick(ar.assignments.filters.order, ar.assignments.filters.orderDesc)
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))
    const last = api.queries.at(-1)!
    expect(last.get('dueFrom')).toBe('2026-10-31T21:00:00.000Z')
    expect(last.get('cursor')).toBeNull()
    expect(last.get('status')).toBeNull()
    expect(await screen.findByText(ar.myAssignments.empty.filtered)).toBeInTheDocument()
  })

  it('pages with the server cursor (limit counts assignments) and back to the first page', async () => {
    const api = mockMyAssignmentsApi((query) => (query.get('cursor') === 'cursor-2' ? makeMyAssignmentList([graded]) : makeMyAssignmentList([todo], 'cursor-2')))
    renderPage()
    await screen.findByText('تمارين الحلقات')
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    await pick(ar.assignments.pagination.pageSizeLabel, '50 في الصفحة')
    await waitFor(() => expect(api.queries.at(-1)?.get('limit')).toBe('50'))
    fireEvent.click(screen.getByText(ar.assignments.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(api.queries.at(-1)?.get('limit')).toBe('50')
    expect(await screen.findByText('واجب الدوال')).toBeInTheDocument()
    expect(screen.getByText('الصفحة 2')).toBeInTheDocument()
    expect(screen.getByText(ar.assignments.pagination.next).closest('button')).toBeDisabled()

    fireEvent.click(screen.getByText(ar.assignments.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('تمارين الحلقات')).toBeInTheDocument()
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()
  })

  it('restarts from the first page after cursor_invalid', async () => {
    const api = mockMyAssignmentsApi((query) =>
      query.get('cursor') ? jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor is invalid' }) : makeMyAssignmentList([todo], 'stale'),
    )
    renderPage()
    await screen.findByText('تمارين الحلقات')
    fireEvent.click(screen.getByText(ar.assignments.pagination.next).closest('button')!)
    const alert = await screen.findByText(ar.myAssignments.errors.cursor_invalid)
    fireEvent.click(within(alert.closest('.ant-alert') as HTMLElement).getByText(ar.myAssignments.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    await waitFor(() => expect(screen.queryByText(ar.myAssignments.errors.cursor_invalid)).not.toBeInTheDocument())
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()
  })

  it('tells a student without any enrollment that there is nothing yet — no error and no options warning', async () => {
    const api = mockMyAssignmentsApi(makeMyAssignmentList([]), { classes: makeMyClassList([]) })
    renderPage()
    expect(await screen.findByText(ar.myAssignments.empty.noEnrollment)).toBeInTheDocument()
    expect(api.queries).toHaveLength(1)
    expect(screen.queryByText(ar.myAssignments.optionsFailed)).not.toBeInTheDocument()
  })

  it('sends an attempt and the row follows the server’s answer — no second read of the list', async () => {
    const stored = makeMySubmission({ textAnswer: 'حلّي' })
    const api = mockMyAssignmentsApi(makeMyAssignmentList([todo]), { submit: jsonResponse(201, stored) })
    renderPage()
    const [row] = await rowsOf(1)
    fireEvent.click(buttonIn(row!, ar.myAssignments.actions.submit)!)
    await sendAttempt('  حلّي  ')

    expect(await screen.findByText('أُرسلت المحاولة 1 للواجب «تمارين الحلقات»')).toBeInTheDocument()
    expect(api.posts).toEqual([{ path: `/api/assignments/${ASSIGNMENT_ID}/submissions`, body: { textAnswer: 'حلّي', attemptNo: 1 } }])
    const [updated] = await waitFor(() => {
      const rows = bodyRows()
      expect(within(rows[0]!).getByText(ar.myAssignments.submission.submitted)).toBeInTheDocument()
      return rows
    })
    expect(within(updated!).getByText('1 / 1')).toBeInTheDocument()
    expect(within(updated!).getByText(ar.myAssignments.notGraded)).toBeInTheDocument()
    expect(buttonIn(updated!, ar.myAssignments.actions.submit)).toBeNull()
    expect(buttonIn(updated!, ar.myAssignments.actions.viewMine)).toBeEnabled()
    expect(api.queries).toHaveLength(1)
  })

  it('reads the list and «my classes» again when the server refuses the attempt for good (attempts used up elsewhere)', async () => {
    const api = mockMyAssignmentsApi(makeMyAssignmentList([todo]), { submit: jsonResponse(409, { statusCode: 409, code: 'attempts_exhausted', message: 'No attempt left', maxAttempts: 1, attempts: 1 }) })
    renderPage()
    const [row] = await rowsOf(1)
    await waitFor(() => expect(api.paths.filter((path) => path === 'GET /api/me/classes')).toHaveLength(1))
    fireEvent.click(buttonIn(row!, ar.myAssignments.actions.submit)!)
    const dialog = await sendAttempt('جواب')
    expect(await within(dialog).findByText('استُنفدت محاولاتك لهذا الواجب (1 من 1).')).toBeInTheDocument()
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(api.queries[1]!.get('cursor')).toBeNull()
    // The enrollment may have moved on too (not_enrolled is terminal as well): API-060 is read again.
    await waitFor(() => expect(api.paths.filter((path) => path === 'GET /api/me/classes')).toHaveLength(2))
  })

  it('opens the student’s latest attempt (API-110) and the row follows what the server holds now', async () => {
    const waiting = makeMyAssignment({ attempts: 1, latest: makeLatest() })
    const reviewed = makeMySubmission({ status: 'graded', score: 17.5, feedback: 'جيد', gradedBy: { fullName: 'خالد المعلم', displayName: null }, gradedAt: '2026-11-11T09:00:00.000Z' })
    const api = mockMyAssignmentsApi(makeMyAssignmentList([waiting]), { submission: reviewed })
    renderPage()
    const [row] = await rowsOf(1)
    expect(within(row!).getByText(ar.myAssignments.submission.submitted)).toBeInTheDocument()

    fireEvent.click(buttonIn(row!, ar.myAssignments.actions.viewMine)!)
    expect(await screen.findByText('تسليمي — تمارين الحلقات')).toBeInTheDocument()
    expect(api.paths).toContain(`GET /api/submissions/${SUBMISSION_ID}`)
    await waitFor(() => expect(within(bodyRows()[0]!).getByText('17.5 / 20')).toBeInTheDocument())
    expect(within(bodyRows()[0]!).getByText(ar.myAssignments.submission.graded)).toBeInTheDocument()
    expect(api.queries).toHaveLength(1)
  })

  it('offers no attempt where the enrollment is no longer active (API-112 says so), or without assignments.submit, and says why', async () => {
    mockMyAssignmentsApi(makeMyAssignmentList([makeMyAssignment({ enrollmentStatus: 'completed', submitBlocker: 'not_enrolled' })]))
    const { unmount } = renderPage()
    const [row] = await rowsOf(1)
    expect(within(row!).getByText(ar.myAssignments.blocked.not_enrolled)).toBeInTheDocument()
    expect(within(row!).getByText(ar.myAssignments.submission.missed)).toBeInTheDocument()
    expect(buttonIn(row!, ar.myAssignments.actions.submit)).toBeNull()
    unmount()

    mockMyAssignmentsApi(makeMyAssignmentList([todo]))
    renderPage(['student'], STUDENT_LEARNER_PERMISSIONS.filter((key) => key !== 'assignments.submit'))
    const [again] = await rowsOf(1)
    expect(within(again!).getByText(ar.myAssignments.blocked.noPermission)).toBeInTheDocument()
    expect(buttonIn(again!, ar.myAssignments.actions.submit)).toBeNull()
  })

  it('keeps /my-assignments closed to a user without the student or guardian role — the 403 page and no request; a teacher who is also a guardian gets in', async () => {
    const api = mockMyAssignmentsApi(makeMyAssignmentList([todo]))
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ASSIGNMENT_TEACHER_PERMISSIONS })
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['assignments.read', 'assignments.submit'] })
    for (const user of [teacher, makeUser(), custom]) {
      const { unmount } = renderGuarded(user)
      expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
      expect(screen.queryByText(ar.myAssignments.title)).not.toBeInTheDocument()
      unmount()
    }
    expect(api.paths).toEqual([])

    // The gate reads the server role keys, not the single UI role (the API-060 rule).
    renderGuarded(makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: ASSIGNMENT_TEACHER_PERMISSIONS }))
    expect(await screen.findByText('تمارين الحلقات')).toBeInTheDocument()
    expect(screen.queryByText(ar.errors.forbidden)).not.toBeInTheDocument()
    expect(api.paths).toContain('GET /api/me/assignments')
  })
})
