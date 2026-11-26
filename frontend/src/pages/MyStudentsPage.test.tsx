// TEST-331 — «طلابي» (CH-0370): the list (API-301) and one student's page (API-302).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TeachingStudentDetail, TeachingStudentList, TeachingStudentListItem } from '../api/teachingStudents'
import { ar } from '../i18n/ar'
import { rateColor } from '../teaching/myStudents.view'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyStudentPage, MyStudentsPage } from './MyStudentsPage'

const TEACHER = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['enrollments.read', 'attendance.read', 'grades.read_all'] })
const CLASS_A = { id: 'class-a', code: 'PY-A', name: { ar: 'فصل بايثون' }, status: 'running' as const, course: { id: 'course-py', code: 'PY', name: { ar: 'أساسيات بايثون' } } }

function item(over: Partial<TeachingStudentListItem> = {}): TeachingStudentListItem {
  return {
    student: { id: 'st-ahmed', fullName: 'أحمد علي', displayName: null, avatarUrl: null, email: 'ahmed@example.test', phone: '+90 555 000 1111' },
    classes: [{ enrollmentId: 'en-1', enrollmentStatus: 'active', class: CLASS_A }],
    attendance: { present: 1, late: 1, absent: 1, excused: 0, rate: 67 },
    ...over,
  }
}

const DETAIL: TeachingStudentDetail = {
  student: item().student,
  guardians: [{ id: 'gd-1', fullName: 'علي حسن', displayName: null, relationship: 'father', isPrimary: true, email: null, phone: '+90 555 000 2222' }],
  classes: [
    {
      enrollmentId: 'en-1',
      enrollmentStatus: 'active',
      class: CLASS_A,
      attendance: {
        present: 1,
        late: 1,
        absent: 1,
        excused: 0,
        rate: 67,
        lessons: [
          { lessonId: 'l3', title: { ar: 'الدرس الثالث' }, startsAt: '2026-11-20T10:00:00.000Z', lessonStatus: 'completed', status: 'absent', minutesLate: null },
          { lessonId: 'l2', title: { ar: 'الدرس الثاني' }, startsAt: '2026-11-19T10:00:00.000Z', lessonStatus: 'completed', status: 'late', minutesLate: 10 },
        ],
      },
      grades: {
        components: [{ kind: 'exam', id: 'ex-1', title: { ar: 'اختبار قصير' }, weight: 100, maxScore: 20, latePenaltyPercent: null, status: 'published', counted: true }],
        cells: [{ kind: 'exam', id: 'ex-1', status: 'scored', score: 15, effectiveScore: 15, late: false }],
        current: 75,
        projected: 75,
        final: null,
      },
    },
  ],
}

function serveList(answer: (query: URLSearchParams) => TeachingStudentList | Response) {
  const queries: URLSearchParams[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/teaching/students') {
      queries.push(parsed.searchParams)
      const result = answer(parsed.searchParams)
      return result instanceof Response ? result : jsonResponse(200, result)
    }
    return jsonResponse(404, { statusCode: 404 })
  })
  return queries
}

describe('MyStudentsPage (CH-0370)', () => {
  it('shows the teacher’s students as cards with the phone, the classes and the attendance rate, and opens a student', async () => {
    serveList(() => ({ items: [item()], truncated: false }))
    renderWithProviders(<MyStudentsPage />, { auth: makeAuth({ user: TEACHER }), route: '/my-students', routes: { '/my-students/:studentId': <LocationProbe /> } })
    const card = await screen.findByTestId('student-card-st-ahmed')
    expect(within(card).getByText('أحمد علي')).toBeInTheDocument()
    expect(within(card).getByText('+90 555 000 1111')).toBeInTheDocument()
    expect(within(card).getByText('فصل بايثون')).toBeInTheDocument()
    expect(within(card).getByText(ar.myStudents.attendanceRate.replace('{{rate}}', '67'))).toBeInTheDocument()
    expect(screen.getByText(ar.myStudents.count_one)).toBeInTheDocument()
    fireEvent.click(within(card).getByText(ar.myStudents.open))
    expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/my-students/st-ahmed')
  })

  it('searches by name or phone after a short pause and filters by what they study, without the default status', async () => {
    const queries = serveList((query) => (query.get('q') === 'زيد' ? { items: [], truncated: false } : { items: [item()], truncated: false }))
    renderWithProviders(<MyStudentsPage />, { auth: makeAuth({ user: TEACHER }), route: '/my-students' })
    await screen.findByTestId('student-card-st-ahmed')
    // The first two reads: the list (active by default — no status sent) and the class options (all).
    expect(queries.map((query) => query.toString()).sort()).toEqual(['', 'status=all'])
    fireEvent.change(screen.getByLabelText(ar.myStudents.search), { target: { value: 'زيد' } })
    expect(await screen.findByText(ar.myStudents.emptyFiltered)).toBeInTheDocument()
    expect(queries.some((query) => query.get('q') === 'زيد')).toBe(true)
    fireEvent.click(screen.getByText(ar.myStudents.show.withdrawn))
    await waitFor(() => expect(queries.some((query) => query.get('status') === 'withdrawn' && query.get('q') === 'زيد')).toBe(true))
  })

  it('says plainly when there are no students and when the list cannot be read', async () => {
    serveList(() => jsonResponse(500, { statusCode: 500 }))
    renderWithProviders(<MyStudentsPage />, { auth: makeAuth({ user: TEACHER }), route: '/my-students' })
    expect(await screen.findByText(ar.myStudents.loadError)).toBeInTheDocument()
    expect(screen.getByText(ar.myStudents.retry)).toBeInTheDocument()
  })

  it('colours a rate green from 80 %, gold from 60 %, else red', () => {
    expect([rateColor(null), rateColor(95), rateColor(80), rateColor(67), rateColor(40)]).toEqual(['default', 'green', 'green', 'gold', 'red'])
  })
})

describe('MyStudentPage (CH-0370)', () => {
  function serveDetail(answer: TeachingStudentDetail | Response) {
    mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === '/api/teaching/students/st-ahmed') return answer instanceof Response ? answer : jsonResponse(200, answer)
      return jsonResponse(404, { statusCode: 404, code: 'student_not_found' })
    })
  }

  it('shows the contact, the guardian, the attendance counts with each lesson, and the marks of each class', async () => {
    serveDetail(DETAIL)
    renderWithProviders(<MyStudentPage />, { auth: makeAuth({ user: TEACHER }), route: '/my-students/st-ahmed', path: '/my-students/:studentId' })
    expect(await screen.findByRole('heading', { name: 'أحمد علي' })).toBeInTheDocument()
    expect(screen.getByText('ahmed@example.test')).toBeInTheDocument()
    expect(screen.getByText(ar.myStudents.student.call).closest('a')).toHaveAttribute('href', 'tel:+905550001111')
    expect(screen.getByText('علي حسن')).toBeInTheDocument()
    expect(screen.getByText(ar.users.relationships.father)).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('الدرس الثالث')).toBeInTheDocument()
    expect(screen.getByText(`${ar.myStudents.attendanceSection.late} (${ar.myStudents.attendanceSection.minutesLate.replace('{{count}}', '10')})`)).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText(ar.myStudents.gradesSection.noFinal)).toBeInTheDocument()
    expect(screen.getByText('اختبار قصير')).toBeInTheDocument()
    expect(screen.getByText(`15 ${ar.myGrades.outOf.replace('{{max}}', '20')}`)).toBeInTheDocument()
  })

  it('says the student is not in the teacher’s classes on a 404, with the way back', async () => {
    serveDetail(jsonResponse(404, { statusCode: 404, code: 'student_not_found', studentId: 'st-ahmed' }))
    renderWithProviders(<MyStudentPage />, { auth: makeAuth({ user: TEACHER }), route: '/my-students/st-ahmed', path: '/my-students/:studentId' })
    expect(await screen.findByText(ar.myStudents.student.notFound)).toBeInTheDocument()
    expect(screen.getByText(ar.myStudents.student.back)).toBeInTheDocument()
  })

  it('tells a teacher without the marks key that marks are hidden', async () => {
    serveDetail({ ...DETAIL, classes: [{ ...DETAIL.classes[0]!, grades: null }] })
    const noMarks = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['enrollments.read', 'attendance.read'] })
    renderWithProviders(<MyStudentPage />, { auth: makeAuth({ user: noMarks }), route: '/my-students/st-ahmed', path: '/my-students/:studentId' })
    expect(await screen.findByText(ar.myStudents.gradesSection.hidden)).toBeInTheDocument()
  })
})
