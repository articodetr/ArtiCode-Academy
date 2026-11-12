import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyExamList } from '../api/myExams'
import { formatZonedDateTime, formatZonedDay } from '../assignments/assignments.format'
import { dayEndIn, dayStartIn } from '../assignments/assignments.zone'
import { RequireAccess } from '../auth/RequireAuth'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ENROLLMENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { EXAM_ID_2, EXAM_LESSON, EXAM_TEACHER_PERMISSIONS } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { GUARDIAN_EXAM_PERMISSIONS, STUDENT_EXAM_PERMISSIONS, makeMyExam, makeMyExamList, makeMyExamResult, makePublishedMyExam } from '../test/myExams'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyExamsPage } from './MyExamsPage'

const scheduled = makeMyExam()
const published = makePublishedMyExam({ id: EXAM_ID_2, title: { ar: 'اختبار الحلقات' }, type: 'quiz', scheduledAt: '2026-11-12T07:00:00.000Z', durationMinutes: null })
const undated = makeMyExam({ id: 'exam-3', title: { ar: 'مشروع الوحدة' }, type: 'project', scheduledAt: null, durationMinutes: null, description: null, passScore: null })

const selfClass = makeMyClassItem({ student: SELF_STUDENT })
const childOneClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE })
const childTwoClass = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO })
const childTwoOther = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[2],
  relation: 'child',
  student: CHILD_TWO,
  class: { ...selfClass.class, id: 'class-ar', code: 'AR-201', name: { ar: 'عربي متقدم' } },
})

type ListAnswer = MyExamList | Response
type ListHandler = ListAnswer | ((query: URLSearchParams) => ListAnswer)

/** Serves API-121 (recording its queries), API-060 (the filter options) and the academy (Asia/Riyadh). */
function mockMyExamsApi(list: ListHandler, classes: MyClassList | Response = makeMyClassList([selfClass])) {
  const queries: URLSearchParams[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    paths.push(`${init?.method ?? 'GET'} ${parsed.pathname}`)
    if (parsed.pathname === '/api/me/exams') {
      queries.push(parsed.searchParams)
      const answer = typeof list === 'function' ? list(parsed.searchParams) : list
      return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
    }
    if (parsed.pathname === '/api/me/classes') return classes instanceof Response ? classes.clone() : jsonResponse(200, classes)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { queries, paths }
}

function renderPage(roles: string[] = ['student'], permissions: string[] = STUDENT_EXAM_PERMISSIONS) {
  const role = roles.includes('guardian') && !roles.includes('student') ? 'guardian' : 'student'
  return renderWithProviders(<MyExamsPage />, { auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role, roles, permissions }) }), route: '/my-exams' })
}

/** The page behind the router's own gate (`guarded('myExams')` in app/router.tsx). */
function renderGuarded(user: ReturnType<typeof makeUser>) {
  return renderWithProviders(
    <RequireAccess navKey="myExams">
      <MyExamsPage />
    </RequireAccess>,
    { auth: makeAuth({ user }), route: '/my-exams' },
  )
}

/** The rows of the list (the expanded row's Descriptions is a table too, so not by role). */
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

describe('MyExamsPage', () => {
  it('shows a student their exams: the date in the exam zone with its duration, title, type, class and course, status, and the result only once published', async () => {
    const api = mockMyExamsApi(makeMyExamList([published, scheduled, undated]))
    renderPage()

    const [first, second, third] = (await rowsOf(3)) as [HTMLElement, HTMLElement, HTMLElement]
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ order: 'asc', limit: '20' })

    // The published exam: its own zone (not this device's — the fixtures live in Asia/Riyadh), the result and the feedback.
    expect(within(first).getByText(formatZonedDateTime('2026-11-12T07:00:00.000Z', 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(first).getByText('Asia/Riyadh')).toBeInTheDocument()
    expect(within(first).getByText('اختبار الحلقات')).toBeInTheDocument()
    expect(within(first).getByText(ar.exams.types.quiz)).toBeInTheDocument()
    expect(within(first).getByText(EXAM_LESSON.title.ar)).toBeInTheDocument()
    expect(within(first).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(first).getByText('بايثون — الفصل أ · أساسيات بايثون')).toBeInTheDocument()
    expect(within(first).getByText(ar.labels.published)).toBeInTheDocument()
    expect(within(first).getByText(ar.exams.results.status.scored)).toBeInTheDocument()
    expect(within(first).getByText('41.5 / 50')).toBeInTheDocument()
    expect(within(first).getByText('أحسنت في السؤال الثالث')).toBeInTheDocument()

    // The scheduled exam: date and duration, no result before the publication (the server sends none — D-R47).
    expect(within(second).getByText(formatZonedDateTime('2026-11-20T07:00:00.000Z', 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(second).getByText('60 دقيقة')).toBeInTheDocument()
    expect(within(second).getByText(ar.exams.types.midterm)).toBeInTheDocument()
    expect(within(second).getByText(ar.labels.scheduled)).toBeInTheDocument()
    expect(within(second).getByText(ar.myExams.result.awaiting)).toBeInTheDocument()

    // An undated exam says so, and no zone is named for it.
    expect(within(third).getByText(ar.exams.drawer.noDate)).toBeInTheDocument()
    expect(within(third).queryByText('Asia/Riyadh')).not.toBeInTheDocument()

    // A student alone needs neither the student column nor the student filter.
    expect(screen.queryByRole('columnheader', { name: ar.myExams.columns.student })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myExams.filters.student)).not.toBeInTheDocument()
  })

  it('shows the description, the maximum, the informational pass score, the duration, the lesson, the publication and the whole feedback in the expanded row', async () => {
    const withLesson = makePublishedMyExam({ result: makeMyExamResult({ feedback: 'أحسنت في السؤال الثالث، وراجع الرابع' }) })
    mockMyExamsApi(makeMyExamList([withLesson]))
    renderPage()
    const [row] = await rowsOf(1)
    expect(screen.queryByText('الفصول 1 إلى 4')).not.toBeInTheDocument()
    fireEvent.click(row!.querySelector('button.ant-table-row-expand-icon')!)

    expect(await screen.findByText('الفصول 1 إلى 4')).toBeInTheDocument()
    const details = screen.getByText(ar.myExams.details.maxScore).closest('.ant-descriptions') as HTMLElement
    expect(within(details).getByText('50')).toBeInTheDocument()
    expect(within(details).getByText(ar.myExams.details.passScore)).toBeInTheDocument()
    expect(within(details).getByText('25')).toBeInTheDocument()
    expect(within(details).getByText('60 دقيقة')).toBeInTheDocument()
    expect(within(details).getByText(`${EXAM_LESSON.title.ar} · ${formatZonedDay(EXAM_LESSON.startsAt, 'Asia/Riyadh', 'ar')}`)).toBeInTheDocument()
    expect(within(details).getByText(formatZonedDateTime('2026-11-22T09:00:00.000Z', 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    expect(within(details).getByText('أحسنت في السؤال الثالث، وراجع الرابع')).toBeInTheDocument()
  })

  it('shows the absent and excused results with their tags, and a published exam without a result as such', async () => {
    const absent = makePublishedMyExam({ result: makeMyExamResult({ status: 'absent', score: null, feedback: null }) })
    const excused = makePublishedMyExam({ id: EXAM_ID_2, result: makeMyExamResult({ status: 'excused', score: null, feedback: null }) })
    const none = makePublishedMyExam({ id: 'exam-3', result: null })
    mockMyExamsApi(makeMyExamList([absent, excused, none]))
    renderPage()
    const [first, second, third] = (await rowsOf(3)) as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText(ar.exams.results.status.absent)).toBeInTheDocument()
    expect(within(first).queryByText(/\/ 50/)).not.toBeInTheDocument()
    expect(within(second).getByText(ar.exams.results.status.excused)).toBeInTheDocument()
    expect(within(third).getByText(ar.myExams.result.none)).toBeInTheDocument()
  })

  it('gives a guardian one row per child with the relation tag, and the student, class and status filters', async () => {
    const one = makePublishedMyExam({ relation: 'child', student: CHILD_ONE })
    const two = makePublishedMyExam({ relation: 'child', student: CHILD_TWO, result: makeMyExamResult({ score: 30, feedback: null }) })
    const api = mockMyExamsApi(makeMyExamList([one, two]), makeMyClassList([childOneClass, childTwoClass, childTwoOther]))
    renderPage(['guardian'], GUARDIAN_EXAM_PERMISSIONS)

    const [first, second] = (await rowsOf(2)) as [HTMLElement, HTMLElement]
    expect(screen.getByRole('columnheader', { name: ar.myExams.columns.student })).toBeInTheDocument()
    expect(within(first).getByText('عمر')).toBeInTheDocument()
    expect(within(first).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(first).getByText('41.5 / 50')).toBeInTheDocument()
    expect(within(second).getByText('ليلى الأحمد')).toBeInTheDocument()
    expect(within(second).getByText('30 / 50')).toBeInTheDocument()
    expect(screen.getByText(ar.myExams.limitNote)).toBeInTheDocument()

    await pick(ar.myExams.filters.class, 'AR-201 — عربي متقدم')
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe('class-ar'))
    await pick(ar.myExams.filters.student, 'ليلى الأحمد')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_TWO.id))
    expect(api.queries.at(-1)?.get('classId')).toBe('class-ar') // Layla is enrolled there: kept
    await pick(ar.myExams.filters.student, 'عمر')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_ONE.id))
    expect(api.queries.at(-1)?.get('classId')).toBeNull() // Omar is not: dropped
    await pick(ar.myExams.filters.status, ar.labels.published)
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('published'))
    expect(api.queries.at(-1)?.get('cursor')).toBeNull()
  })

  it('reads the date range in the academy zone and says so, warns that undated exams fall out, and flips the order — each from the first page', async () => {
    const api = mockMyExamsApi(makeMyExamList([]))
    renderPage()
    expect(await screen.findByText(ar.myExams.empty.all)).toBeInTheDocument()
    // The academy (makeAcademy) lives in Asia/Riyadh: the days are read there, and the page says so.
    expect(await screen.findByTestId('my-exams-filter-zone')).toHaveTextContent('Asia/Riyadh')
    expect(screen.queryByText(ar.exams.filters.undatedHint)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ar.exams.filters.from), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBe(dayStartIn('2026-11-01', 'Asia/Riyadh')!))
    fireEvent.change(screen.getByLabelText(ar.exams.filters.to), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).toBe(dayEndIn('2026-11-30', 'Asia/Riyadh')!))
    expect(screen.getByText(ar.exams.filters.undatedHint)).toBeInTheDocument()

    await pick(ar.exams.filters.order, ar.exams.filters.orderDesc)
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))
    const last = api.queries.at(-1)!
    expect(last.get('from')).toBe('2026-10-31T21:00:00.000Z')
    expect(last.get('to')).toBe('2026-11-30T20:59:59.999Z')
    expect(last.get('cursor')).toBeNull()
    expect(await screen.findByText(ar.myExams.empty.filtered)).toBeInTheDocument()
  })

  it('pages with the server cursor (limit counts exams), back to the first page, and restarts after cursor_invalid', async () => {
    const api = mockMyExamsApi((query) => {
      if (query.get('cursor') === 'stale') return jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor is invalid' })
      return query.get('cursor') === 'cursor-2' ? makeMyExamList([published], 'stale') : makeMyExamList([scheduled], 'cursor-2')
    })
    renderPage()
    await rowsOf(1)
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    await pick(ar.exams.pagination.pageSizeLabel, '50 في الصفحة')
    await waitFor(() => expect(api.queries.at(-1)?.get('limit')).toBe('50'))
    fireEvent.click(screen.getByText(ar.exams.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(await screen.findByText('اختبار الحلقات')).toBeInTheDocument()
    expect(screen.getByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.exams.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('اختبار منتصف الفصل')).toBeInTheDocument()

    // Page 2, then a «next» whose cursor the server no longer accepts: the message, then «refresh» starts over.
    fireEvent.click(screen.getByText(ar.exams.pagination.next).closest('button')!)
    await screen.findByText('اختبار الحلقات')
    await waitFor(() => expect(screen.getByText(ar.exams.pagination.next).closest('button')).toBeEnabled())
    fireEvent.click(screen.getByText(ar.exams.pagination.next).closest('button')!)
    const alert = await screen.findByText(ar.exams.errors.cursor_invalid)
    fireEvent.click(within(alert.closest('.ant-alert') as HTMLElement).getByText(ar.myExams.refresh).closest('button')!)
    await waitFor(() => expect(screen.queryByText(ar.exams.errors.cursor_invalid)).not.toBeInTheDocument())
    expect(api.queries.at(-1)?.get('cursor')).toBeNull()
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()
  })

  it('tells a student without any enrollment that there is nothing yet, and warns when «my classes» cannot be read', async () => {
    const api = mockMyExamsApi(makeMyExamList([]), makeMyClassList([]))
    const { unmount } = renderPage()
    expect(await screen.findByText(ar.myExams.empty.noEnrollment)).toBeInTheDocument()
    expect(api.queries).toHaveLength(1)
    expect(screen.queryByText(ar.myExams.optionsFailed)).not.toBeInTheDocument()
    unmount()

    mockMyExamsApi(makeMyExamList([scheduled]), jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage()
    expect(await screen.findByText(ar.myExams.optionsFailed)).toBeInTheDocument()
    await rowsOf(1)
  })

  it('keeps /my-exams closed to a user without the student or guardian role — the 403 page and no request; a teacher who is also a guardian gets in', async () => {
    const api = mockMyExamsApi(makeMyExamList([scheduled]))
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: EXAM_TEACHER_PERMISSIONS })
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['exams.read', 'exams.take'] })
    for (const user of [teacher, makeUser(), custom]) {
      const { unmount } = renderGuarded(user)
      expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
      expect(screen.queryByText(ar.myExams.title)).not.toBeInTheDocument()
      unmount()
    }
    expect(api.paths).toEqual([])

    // The gate reads the server role keys, not the single UI role (the API-060 rule).
    renderGuarded(makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: EXAM_TEACHER_PERMISSIONS }))
    expect(await screen.findByText('اختبار منتصف الفصل')).toBeInTheDocument()
    expect(screen.queryByText(ar.errors.forbidden)).not.toBeInTheDocument()
    expect(api.paths).toContain('GET /api/me/exams')
  })
})
