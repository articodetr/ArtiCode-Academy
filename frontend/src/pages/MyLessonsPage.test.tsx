import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import type { MyLessonList } from '../api/myLessons'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { RequireAccess } from '../auth/RequireAuth'
import { ar } from '../i18n/ar'
import { dayStartInstant, formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { todayStartInstant } from '../lessons/myLessons.view'
import { ENROLLMENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID_2, LESSON_LEARNER_PERMISSIONS, LESSON_TEACHER_PERMISSIONS } from '../test/lessons'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson, makeMyLessonList } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyLessonsPage } from './MyLessonsPage'

const FUTURE = { startsAt: '2030-01-15T09:00:00.000Z', endsAt: '2030-01-15T10:00:00.000Z' }

const attended = makeMyLesson({
  deliveryMode: 'live_online',
  status: 'completed',
  meetingUrl: 'https://meet.example.com/a',
  description: { ar: 'مراجعة الواجب ثم تمارين' },
  attendance: { status: 'late', minutesLate: 10, recordedAt: '2026-11-10T10:12:00.000Z' },
})
const cancelled = makeMyLesson({ id: LESSON_ID_2, title: { ar: 'الحلقات' }, status: 'cancelled', meetingUrl: 'https://meet.example.com/b', room: null, teacher: null, syllabusItem: null })

const selfClass = makeMyClassItem({ student: SELF_STUDENT })
const childOneClass = makeMyClassItem({ relation: 'child', student: CHILD_ONE })
const childTwoClass = makeMyClassItem({ enrollmentId: ENROLLMENT_IDS[1], relation: 'child', student: CHILD_TWO })
const childTwoOther = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[2],
  relation: 'child',
  student: CHILD_TWO,
  class: { ...selfClass.class, id: 'class-ar', code: 'AR-201', name: { ar: 'عربي متقدم' } },
})

type LessonsAnswer = MyLessonList | Response
type LessonsHandler = LessonsAnswer | ((query: URLSearchParams) => LessonsAnswer)

/** Serves API-101 (recording its queries) and API-060 (the filter options); `paths` records every request. */
function mockMyLessonsApi(lessons: LessonsHandler, classes: MyClassList | Response = makeMyClassList([selfClass])) {
  const queries: URLSearchParams[] = []
  const paths: string[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    paths.push(parsed.pathname)
    if (parsed.pathname === '/api/me/lessons') {
      queries.push(parsed.searchParams)
      const answer = typeof lessons === 'function' ? lessons(parsed.searchParams) : lessons
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (parsed.pathname === '/api/me/classes') return classes instanceof Response ? classes : jsonResponse(200, classes)
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { queries, paths }
}

function renderPage(roles: string[], permissions: string[] = LESSON_LEARNER_PERMISSIONS) {
  const role = roles.includes('guardian') ? 'guardian' : 'student'
  return renderWithProviders(<MyLessonsPage />, {
    auth: makeAuth({ user: makeUser({ id: SELF_STUDENT.id, role, roles, permissions }) }),
    route: '/my-lessons',
  })
}

/** The page behind the router's own gate (`guarded('myLessons')` in app/router.tsx). */
function renderGuarded(user: ReturnType<typeof makeUser>) {
  return renderWithProviders(
    <RequireAccess navKey="myLessons">
      <MyLessonsPage />
    </RequireAccess>,
    { auth: makeAuth({ user }), route: '/my-lessons' },
  )
}

function bodyRows() {
  return Array.from(screen.getByRole('table').querySelectorAll<HTMLElement>('tbody tr.ant-table-row'))
}

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

describe('MyLessonsPage', () => {
  it('shows a student their lessons from today on: day, times, lesson, class, teacher by name, place, status and their own attendance', async () => {
    const api = mockMyLessonsApi(makeMyLessonList([attended, cancelled]))
    renderPage(['student'])

    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ from: todayStartInstant(), order: 'asc', limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    const [first, second] = rows as [HTMLElement, HTMLElement]
    expect(within(first).getByText(formatLessonDay(attended.startsAt, 'ar'))).toBeInTheDocument()
    expect(within(first).getByText(formatLessonTimes(attended.startsAt, attended.endsAt, 'ar'))).toBeInTheDocument()
    expect(within(first).getByText('1. المتغيرات')).toBeInTheDocument()
    expect(within(first).getByText(ar.labels.live_online)).toBeInTheDocument()
    expect(within(first).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(first).getByText('بايثون — الفصل أ · أساسيات بايثون')).toBeInTheDocument()
    expect(within(first).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(first).getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(within(first).getByText(ar.labels.completed)).toBeInTheDocument()
    // The attendance tag takes the colour of the lesson drawer and the attendance sheet (one map — J-F25).
    expect(within(first).getByText(`${ar.lessons.attendance.late} · 10 د`)).toHaveClass(`ant-tag-${ATTENDANCE_STATUS_COLORS.late}`)
    const link = within(first).getByText(ar.lessons.drawer.openMeeting).closest('a')!
    expect(link).toHaveAttribute('href', 'https://meet.example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // A cancelled lesson keeps its row and status, loses its meeting link and has no attendance.
    expect(within(second).getByText(ar.labels.cancelled)).toBeInTheDocument()
    expect(within(second).getByText('—')).toHaveAttribute('title', ar.myLessons.attendance.cancelled)
    expect(within(second).getByText(ar.lessons.drawer.noTeacher)).toBeInTheDocument()
    expect(within(second).getByText(ar.lessons.drawer.noRoom)).toBeInTheDocument()
    expect(within(second).queryByText(ar.lessons.drawer.openMeeting)).not.toBeInTheDocument()
    // A student alone needs neither the student column nor the student filter.
    expect(screen.queryByRole('columnheader', { name: ar.myLessons.columns.student })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.myLessons.filters.student)).not.toBeInTheDocument()
  })

  it('shows the description of a lesson in its expanded row', async () => {
    mockMyLessonsApi(makeMyLessonList([attended]))
    renderPage(['student'])
    const [row] = await waitFor(() => {
      const rows = bodyRows()
      expect(rows).toHaveLength(1)
      return rows
    })
    expect(screen.queryByText('مراجعة الواجب ثم تمارين')).not.toBeInTheDocument()
    fireEvent.click(row!.querySelector('button.ant-table-row-expand-icon')!)
    expect(await screen.findByText('مراجعة الواجب ثم تمارين')).toBeInTheDocument()
  })

  it('gives a guardian with two children in one class one row per child, and the student filter narrows to one of them', async () => {
    const one = makeMyLesson({ ...FUTURE, relation: 'child', student: CHILD_ONE, attendance: { status: 'present', minutesLate: null, recordedAt: '2030-01-15T09:05:00.000Z' } })
    const two = makeMyLesson({ ...FUTURE, relation: 'child', student: CHILD_TWO })
    const api = mockMyLessonsApi(makeMyLessonList([one, two]), makeMyClassList([childOneClass, childTwoClass, childTwoOther]))
    renderPage(['guardian'], ['attendance.read', 'schedule.read'])

    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    const [first, second] = bodyRows() as [HTMLElement, HTMLElement]
    expect(screen.getByRole('columnheader', { name: ar.myLessons.columns.student })).toBeInTheDocument()
    expect(within(first).getByText('عمر')).toBeInTheDocument()
    expect(within(first).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(first).getByText(ar.lessons.attendance.present)).toBeInTheDocument()
    expect(within(second).getByText('ليلى الأحمد')).toBeInTheDocument()
    expect(within(second).getByText(ar.myLessons.attendance.notStarted)).toBeInTheDocument()
    expect(screen.getByText(ar.myLessons.limitNote)).toBeInTheDocument()

    await pick(ar.myLessons.filters.class, 'AR-201 — عربي متقدم')
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe('class-ar'))
    await pick(ar.myLessons.filters.student, 'ليلى الأحمد')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_TWO.id))
    expect(api.queries.at(-1)?.get('classId')).toBe('class-ar') // Layla is enrolled there: kept
    await pick(ar.myLessons.filters.student, 'عمر')
    await waitFor(() => expect(api.queries.at(-1)?.get('studentId')).toBe(CHILD_ONE.id))
    expect(api.queries.at(-1)?.get('classId')).toBeNull() // Omar is not: dropped
  })

  it('keeps /my-lessons closed to a user without the student or guardian role — the 403 page and no request; a teacher who is also a guardian gets in (J-F11)', async () => {
    const api = mockMyLessonsApi(makeMyLessonList([attended]))
    // A teacher holding lessons.read (the lessons they teach are on /lessons), an admin, and a custom role holding the read keys.
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: LESSON_TEACHER_PERMISSIONS })
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['lessons.read', 'attendance.read'] })
    for (const user of [teacher, makeUser(), custom]) {
      const { unmount } = renderGuarded(user)
      expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
      expect(screen.queryByText(ar.myLessons.title)).not.toBeInTheDocument()
      unmount()
    }
    expect(api.paths).toEqual([])

    // The gate reads the server role keys, not the single UI role (the API-060 rule).
    renderGuarded(makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: LESSON_TEACHER_PERMISSIONS }))
    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(screen.queryByText(ar.errors.forbidden)).not.toBeInTheDocument()
    expect(api.paths).toContain('/api/me/lessons')
  })

  it('tells a student without any enrollment that there is nothing yet — no error and no options warning', async () => {
    const api = mockMyLessonsApi(makeMyLessonList([]), makeMyClassList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myLessons.empty.noEnrollment)).toBeInTheDocument()
    expect(api.queries).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.myLessons.optionsFailed)).not.toBeInTheDocument()
  })

  it('switches views and filters: past, a custom range and a status re-query from the first page', async () => {
    const api = mockMyLessonsApi(makeMyLessonList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myLessons.empty.upcoming)).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.myLessons.views.past))
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))
    expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ to: new Date(new Date(todayStartInstant()).getTime() - 1).toISOString(), order: 'desc', limit: '20' })
    expect(await screen.findByText(ar.myLessons.empty.past)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.lessons.filters.from)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.myLessons.views.range))
    await waitFor(() => expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ order: 'asc', limit: '20' }))
    expect(await screen.findByText(ar.myLessons.empty.all)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(ar.lessons.filters.from), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBe(dayStartInstant('2026-11-01')!))

    await pick(ar.myLessons.filters.status, ar.labels.cancelled)
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('cancelled'))
    await pick(ar.myLessons.filters.class, 'PY-101-A — بايثون — الفصل أ')
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe(selfClass.class.id))
    const last = api.queries.at(-1)!
    expect(last.get('from')).toBe(dayStartInstant('2026-11-01')!)
    expect(last.get('cursor')).toBeNull()
    expect(await screen.findByText(ar.myLessons.empty.filtered)).toBeInTheDocument()
  })

  it('treats a malformed day as no day: the list stays unfiltered and nothing is sent (J-F25)', async () => {
    const api = mockMyLessonsApi(makeMyLessonList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myLessons.empty.upcoming)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.myLessons.views.range))
    await waitFor(() => expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ order: 'asc', limit: '20' }))
    expect(await screen.findByText(ar.myLessons.empty.all)).toBeInTheDocument()

    // A browser without a native date field hands the typed text over as it is.
    const from = screen.getByLabelText(ar.lessons.filters.from) as HTMLInputElement
    from.type = 'text'
    fireEvent.change(from, { target: { value: '2026-02-30' } })
    expect(from).toHaveValue('')
    expect(screen.getByText(ar.myLessons.empty.all)).toBeInTheDocument()
    expect(screen.queryByText(ar.myLessons.empty.filtered)).not.toBeInTheDocument()
    expect(Object.fromEntries(api.queries.at(-1)!)).toEqual({ order: 'asc', limit: '20' })
  })

  it('pages with the server cursor (limit counts lessons) and back to the first page', async () => {
    const api = mockMyLessonsApi((query) =>
      query.get('cursor') === 'cursor-2' ? makeMyLessonList([makeMyLesson({ id: LESSON_ID_2, title: { ar: 'الحلقات' } })]) : makeMyLessonList([attended], 'cursor-2'),
    )
    renderPage(['student'])
    await screen.findByText('المتغيرات وأنواع البيانات')
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    await pick(ar.lessons.pagination.pageSizeLabel, '50 في الصفحة')
    await waitFor(() => expect(api.queries.at(-1)?.get('limit')).toBe('50'))
    fireEvent.click(screen.getByText(ar.lessons.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(api.queries.at(-1)?.get('limit')).toBe('50')
    expect(await screen.findByText('الحلقات')).toBeInTheDocument()
    expect(screen.getByText('الصفحة 2')).toBeInTheDocument()
    expect(screen.getByText(ar.lessons.pagination.next).closest('button')).toBeDisabled()

    fireEvent.click(screen.getByText(ar.lessons.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()
  })

  it('restarts from the first page after cursor_invalid, and retries a failed list', async () => {
    let failOnce = true
    const api = mockMyLessonsApi((query) => {
      if (query.get('cursor')) return jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor is invalid' })
      if (query.get('status') === 'completed' && failOnce) {
        failOnce = false
        return jsonResponse(500, { statusCode: 500, message: 'boom' })
      }
      return makeMyLessonList([attended], 'stale')
    })
    renderPage(['student'])
    await screen.findByText('المتغيرات وأنواع البيانات')

    fireEvent.click(screen.getByText(ar.lessons.pagination.next).closest('button')!)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.lessons.errors.cursor_invalid)).toBeInTheDocument()
    fireEvent.click(within(alert).getByText(ar.myLessons.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('الصفحة 1')).toBeInTheDocument()

    await pick(ar.myLessons.filters.status, ar.labels.completed)
    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    const before = api.queries.length
    fireEvent.click(within(screen.getByRole('alert')).getByText(ar.myLessons.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.length).toBe(before + 1))
    await waitFor(() => expect(screen.queryByText(ar.login.errors.server)).not.toBeInTheDocument())
  })

  it('warns when «my classes» fails: the lessons still load, the filters have no options', async () => {
    mockMyLessonsApi(makeMyLessonList([attended]), jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage(['guardian', 'student'])
    expect(await screen.findByText(ar.myLessons.optionsFailed)).toBeInTheDocument()
    expect(screen.getByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
  })
})
