import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyGradeList } from '../api/myGrades'
import { RequireAccess } from '../auth/RequireAuth'
import { ar } from '../i18n/ar'
import { ENROLLMENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { EXAM_TEACHER_PERMISSIONS } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { GUARDIAN_GRADES_PERMISSIONS, STUDENT_GRADES_PERMISSIONS, makeFinalGrade, makeGradeComponent, makeMyGradeItem, makeMyGradeList } from '../test/myGrades'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDateTime } from '../users/users.format'
import { MyGradesPage } from './MyGradesPage'

const otherClass = { ...makeMyGradeItem().class, id: 'class-ar', code: 'AR-201', name: { ar: 'عربي متقدم' }, course: { id: 'course-ar', code: 'AR', name: { ar: 'اللغة العربية' } } }
const open = makeMyGradeItem()
const finalized = makeMyGradeItem({ enrollmentId: ENROLLMENT_IDS[1], enrollmentStatus: 'completed', class: otherClass, components: [makeGradeComponent()], final: makeFinalGrade() })

const selfClass = makeMyClassItem({ student: SELF_STUDENT })
const childOneClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE })
const childTwoClass = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO })
const childTwoOther = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[2],
  relation: 'child',
  student: CHILD_TWO,
  class: { ...selfClass.class, id: 'class-ar', code: 'AR-201', name: { ar: 'عربي متقدم' } },
})

type GradesAnswer = MyGradeList | Response
type GradesHandler = GradesAnswer | ((query: URLSearchParams) => GradesAnswer)

const FORBIDDEN = () => jsonResponse(403, { statusCode: 403, error: 'Forbidden', code: 'permission_denied', message: 'Missing permission', missing: ['grades.read_own', 'grades.read_linked'] })

/** Serves API-129 (recording its queries) and API-060 (the filter options). */
function mockMyGradesApi(grades: GradesHandler, classes: MyClassList | Response = makeMyClassList([selfClass])) {
  const queries: URLSearchParams[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    paths.push(`${init?.method ?? 'GET'} ${parsed.pathname}`)
    if (parsed.pathname === '/api/me/grades') {
      queries.push(parsed.searchParams)
      const answer = typeof grades === 'function' ? grades(parsed.searchParams) : grades
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (parsed.pathname === '/api/me/classes') return classes instanceof Response ? classes.clone() : jsonResponse(200, classes)
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { queries, paths }
}

function renderPage(roles: string[] = ['student'], permissions: string[] = STUDENT_GRADES_PERMISSIONS) {
  const role = roles.includes('guardian') && !roles.includes('student') ? 'guardian' : 'student'
  return renderWithProviders(<MyGradesPage />, { auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role, roles, permissions }) }), route: '/my-grades' })
}

/** The page behind the router's own gate (`guarded('myGrades')` in app/router.tsx). */
function renderGuarded(user: ReturnType<typeof makeUser>) {
  return renderWithProviders(
    <RequireAccess navKey="myGrades">
      <MyGradesPage />
    </RequireAccess>,
    { auth: makeAuth({ user }), route: '/my-grades' },
  )
}

async function cardsOf(count: number) {
  return waitFor(() => {
    const cards = screen.queryAllByTestId('my-grade-card')
    expect(cards).toHaveLength(count)
    return cards
  })
}

const componentsOf = (card: HTMLElement) => within(card).getAllByTestId('my-grade-component')

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

describe('MyGradesPage', () => {
  it('shows a student one card per enrollment: the class and course, its assignments and published exams with weights, maximums and the server’s scores, and the final grade or «not fixed yet»', async () => {
    const api = mockMyGradesApi(makeMyGradeList([open, finalized]))
    renderPage()

    const [first, second] = (await cardsOf(2)) as [HTMLElement, HTMLElement]
    expect(api.queries).toHaveLength(1)
    expect(api.queries[0]!.toString()).toBe('')
    expect(within(first).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(first).getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(first).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(first).getByText(ar.myGrades.enrollment.active)).toBeInTheDocument()

    // Not finalized: no percentage of any kind (D-R48).
    const pending = within(first).getByTestId('my-final-grade')
    expect(within(pending).getByText(ar.myGrades.final.pending)).toBeInTheDocument()
    expect(within(pending).getByText(ar.myGrades.final.pendingHint)).toBeInTheDocument()
    expect(within(first).queryByText(/%/)).not.toBeInTheDocument()

    const [late, awaiting, missing, scored, absent, excused] = componentsOf(first) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    // A late graded attempt: the score, and the score after the penalty exactly as the server sent it.
    expect(within(late).getByText(ar.myGrades.kind.assignment)).toBeInTheDocument()
    expect(within(late).getByText('تمارين الحلقات')).toBeInTheDocument()
    expect(within(late).getByText('الوزن 10')).toBeInTheDocument()
    expect(within(late).getByText(ar.myGrades.status.graded)).toBeInTheDocument()
    expect(within(late).getByText(ar.myGrades.late)).toBeInTheDocument()
    expect(within(late).getByText('18 / 20')).toBeInTheDocument()
    expect(within(late).getByText(ar.myGrades.afterPenalty)).toBeInTheDocument()
    expect(within(late).getByText('16.2 / 20')).toBeInTheDocument()
    // Waiting for review without a graded attempt: the state and the maximum only.
    expect(within(awaiting).getByText(ar.myGrades.status.awaiting_review)).toBeInTheDocument()
    expect(within(awaiting).getByText('من 20')).toBeInTheDocument()
    // Never submitted, and informational (no weight).
    expect(within(missing).getByText(ar.myGrades.status.missing_assignment)).toBeInTheDocument()
    expect(within(missing).getByText(ar.myGrades.informational)).toBeInTheDocument()
    expect(within(missing).getByText('من 10')).toBeInTheDocument()
    // The published exams: a score, an absence counted as the server's 0, an excused oral left out.
    expect(within(scored).getByText(ar.myGrades.kind.exam)).toBeInTheDocument()
    expect(within(scored).getByText('اختبار منتصف الفصل')).toBeInTheDocument()
    expect(within(scored).getByText('الوزن 30')).toBeInTheDocument()
    expect(within(scored).getByText(ar.myGrades.status.scored)).toBeInTheDocument()
    expect(within(scored).getByText('41.5 / 50')).toBeInTheDocument()
    expect(within(scored).queryByText(ar.myGrades.afterPenalty)).not.toBeInTheDocument()
    expect(within(absent).getByText(ar.myGrades.status.absent)).toBeInTheDocument()
    expect(within(absent).getByText('0 / 10')).toBeInTheDocument()
    expect(within(excused).getByText(ar.myGrades.status.excused)).toBeInTheDocument()
    expect(within(excused).getByText('من 5')).toBeInTheDocument()
    expect(within(excused).getByText(ar.myGrades.excusedNote)).toBeInTheDocument()

    // The finalized class: the fixed percentage, band and letter, pass, and when.
    expect(within(second).getByText('AR-201')).toBeInTheDocument()
    expect(within(second).getByText(ar.myGrades.enrollment.completed)).toBeInTheDocument()
    const final = within(second).getByTestId('my-final-grade')
    expect(within(final).getByText('86.4%')).toBeInTheDocument()
    expect(within(final).getByText('جيد جداً (B)')).toBeInTheDocument()
    expect(within(final).getByText(ar.myGrades.final.pass)).toBeInTheDocument()
    expect(within(final).getByText(ar.myGrades.final.finalizedAt.replace('{{date}}', formatDateTime('2026-12-21T10:00:00.000Z', 'ar')))).toBeInTheDocument()
    expect(componentsOf(second)).toHaveLength(1)

    // A student alone needs neither the student names nor the student filter.
    expect(screen.queryByText(SELF_STUDENT.fullName)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myGrades.filters.student)).not.toBeInTheDocument()
  })

  it('says «fail» for a failing final grade, the score of an earlier graded attempt while a newer one waits, and an enrollment without components', async () => {
    const failing = makeMyGradeItem({
      components: [makeGradeComponent({ status: 'awaiting_review', score: 12, effectiveScore: 12 })],
      final: makeFinalGrade({ percent: 48.25, label: { ar: 'ضعيف' }, letter: null, isPass: false }),
    })
    const empty = makeMyGradeItem({ enrollmentId: ENROLLMENT_IDS[1], class: otherClass, components: [] })
    mockMyGradesApi(makeMyGradeList([failing, empty]))
    renderPage()
    const [first, second] = (await cardsOf(2)) as [HTMLElement, HTMLElement]
    const final = within(first).getByTestId('my-final-grade')
    expect(within(final).getByText('48.25%')).toBeInTheDocument()
    expect(within(final).getByText(ar.myGrades.final.fail)).toBeInTheDocument()
    const [component] = componentsOf(first) as [HTMLElement]
    expect(within(component).getByText(ar.myGrades.status.awaiting_review)).toBeInTheDocument()
    expect(within(component).getByText('12 / 20')).toBeInTheDocument()
    expect(within(component).getByText(ar.myGrades.earlierAttempt)).toBeInTheDocument()
    expect(within(second).getByText(ar.myGrades.noComponents)).toBeInTheDocument()
  })

  it('gives a guardian one card per child with the relation tag, and the student and class filters', async () => {
    const one = makeMyGradeItem({ relation: 'child', student: CHILD_ONE })
    const two = makeMyGradeItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO, components: [makeGradeComponent()] })
    const api = mockMyGradesApi(makeMyGradeList([one, two]), makeMyClassList([childOneClass, childTwoClass, childTwoOther]))
    renderPage(['guardian'], GUARDIAN_GRADES_PERMISSIONS)

    const [first, second] = (await cardsOf(2)) as [HTMLElement, HTMLElement]
    expect(within(first).getByText('عمر')).toBeInTheDocument()
    expect(within(first).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(second).getByText('ليلى الأحمد')).toBeInTheDocument()
    expect(screen.queryByText(ar.myGrades.hidden.child)).not.toBeInTheDocument()

    await pick(ar.myGrades.filters.class, 'AR-201 — عربي متقدم')
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe('class-ar'))
    await pick(ar.myGrades.filters.student, 'ليلى الأحمد')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_TWO.id))
    expect(api.queries.at(-1)?.get('classId')).toBe('class-ar') // Layla is enrolled there: kept
    await pick(ar.myGrades.filters.student, 'عمر')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_ONE.id))
    expect(api.queries.at(-1)?.get('classId')).toBeNull() // Omar is not: dropped
  })

  it('words the refusal of a caller holding neither grades key in place of the grades — no filters, no cards', async () => {
    mockMyGradesApi(FORBIDDEN())
    renderPage(['student'], ['courses.read', 'exams.read'])
    expect(await screen.findByText(ar.myGrades.errors.permission_denied)).toBeInTheDocument()
    expect(screen.queryAllByTestId('my-grade-card')).toHaveLength(0)
    expect(screen.queryByLabelText(ar.myGrades.filters.class)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.myGrades.empty.none)).not.toBeInTheDocument()
  })

  it('says which relation one grades key leaves out (D-R48) — a student who is also a guardian holding grades.read_linked only', async () => {
    mockMyGradesApi(makeMyGradeList([makeMyGradeItem({ relation: 'child', student: CHILD_ONE })]), makeMyClassList([selfClass, childOneClass]))
    renderPage(['student', 'guardian'], GUARDIAN_GRADES_PERMISSIONS)
    await cardsOf(1)
    expect(screen.getByText(ar.myGrades.hidden.self)).toBeInTheDocument()
    expect(screen.queryByText(ar.myGrades.hidden.child)).not.toBeInTheDocument()
  })

  it('tells a student without any enrollment that there is nothing yet, a narrowed list that nothing matches, and retries a failed read', async () => {
    const empty = mockMyGradesApi(makeMyGradeList([]), makeMyClassList([]))
    const first = renderPage()
    expect(await screen.findByText(ar.myGrades.empty.noEnrollment)).toBeInTheDocument()
    expect(empty.queries).toHaveLength(1)
    first.unmount()

    mockMyGradesApi((query) => makeMyGradeList(query.get('classId') ? [] : [open]))
    const second = renderPage()
    await cardsOf(1)
    await pick(ar.myGrades.filters.class, 'PY-101-A — بايثون — الفصل أ')
    expect(await screen.findByText(ar.myGrades.empty.filtered)).toBeInTheDocument()
    second.unmount()

    let calls = 0
    const api = mockMyGradesApi(() => {
      calls += 1
      return calls === 1 ? jsonResponse(503, { statusCode: 503, message: 'unavailable' }) : makeMyGradeList([open])
    })
    renderPage()
    const alert = await screen.findByText(ar.login.errors.server)
    fireEvent.click(within(alert.closest('.ant-alert') as HTMLElement).getByText(ar.myGrades.refresh).closest('button')!)
    await cardsOf(1)
    expect(screen.queryByText(ar.login.errors.server)).not.toBeInTheDocument()
    expect(api.queries).toHaveLength(2)
  })

  it('keeps /my-grades closed to a user without the student or guardian role — the 403 page and no request; a teacher who is also a guardian gets in', async () => {
    const api = mockMyGradesApi(makeMyGradeList([makeMyGradeItem({ relation: 'child', student: CHILD_ONE })]))
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: [...EXAM_TEACHER_PERMISSIONS, 'grades.read_all', 'grades.manage'] })
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['grades.read_own', 'grades.read_linked'] })
    for (const user of [teacher, makeUser(), custom]) {
      const { unmount } = renderGuarded(user)
      expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
      expect(screen.queryByText(ar.myGrades.title)).not.toBeInTheDocument()
      unmount()
    }
    expect(api.paths).toEqual([])

    // The gate reads the server role keys, not the single UI role (the API-060 rule).
    renderGuarded(makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: [...EXAM_TEACHER_PERMISSIONS, ...GUARDIAN_GRADES_PERMISSIONS] }))
    await cardsOf(1)
    expect(screen.queryByText(ar.errors.forbidden)).not.toBeInTheDocument()
    expect(api.paths).toContain('GET /api/me/grades')
  })
})
