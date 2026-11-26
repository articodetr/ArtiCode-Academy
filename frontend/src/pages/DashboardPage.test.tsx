import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReportsOverview } from '../api/reports'
import { formatMoney } from '../dashboard/dashboard.data'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeClass, makeClassTeacher } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson } from '../test/lessons'
import { makeNotification } from '../test/notifications'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { DashboardPage } from './DashboardPage'

const MANAGER = ['lessons.read', 'classes.read', 'classes.manage', 'reports.attendance.view', 'reports.academic.view', 'reports.financial.view']
const TEACHER = ['lessons.read', 'lessons.manage', 'classes.read', 'courses.read']

const OVERVIEW: ReportsOverview = {
  asOf: '2026-11-16',
  timeZone: 'UTC',
  generatedAt: '2026-11-16T10:00:00.000Z',
  general: { activeStudents: 42, openClasses: 1, runningClasses: 3, lessonsToday: 7 },
  attendance: { period: { from: '2026-10-18', to: '2026-11-16' }, records: { present: 9, late: 0, absent: 1, excused: 0 }, attendanceRate: 90 },
  academic: { period: { from: '2026-10-18', to: '2026-11-16' }, finalGrades: 0, averagePercent: null, passRate: null, awaitingReview: 5 },
  financial: {
    period: { from: '2026-11-01', to: '2026-11-16' },
    collected: [{ currency: 'TRY', payments: 3, amount: 1500 }],
    outstanding: [
      { currency: 'TRY', balance: 900, overdue: 600, studentsOverdue: 1 },
      { currency: 'USD', balance: 12.5, overdue: 0, studentsOverdue: 0 },
    ],
  },
}

interface Answers {
  overview?: () => Response
}

/** The dashboard's server: the academy, today's lessons, the running/open classes, the notifications and the overview. */
function mockDashboardApi(answers: Answers = {}) {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
    if (pathname === '/api/reports/overview') return answers.overview ? answers.overview() : jsonResponse(200, OVERVIEW)
    if (pathname === '/api/lessons') return jsonResponse(200, { items: [makeLesson({ title: { ar: 'المتغيرات' }, timeZone: 'UTC' })], nextCursor: null })
    if (pathname === '/api/classes') {
      const items = searchParams.get('status') === 'running' ? [makeClass({ status: 'running', enrolledCount: 12, teachers: [makeClassTeacher({ fullName: 'سارة المعلمة' })] })] : []
      return jsonResponse(200, { items, nextCursor: null })
    }
    if (pathname === '/api/me/notifications') return jsonResponse(200, { items: [makeNotification({ title: 'واجب جديد: المقالة الأولى' })], nextCursor: null })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return urls
}

/** The card whose title (or Statistic title) is `title`. */
const cardOf = (title: string) => screen.getByText(title).closest('.ant-card') as HTMLElement

// Since J-F59 this is the teacher's home (the UI role `teacher`); the academy's admins and staff get the admin home —
// dashboard/admin/AdminDashboardHome.test.tsx. A teacher may hold report keys through a custom role, so the cards stay tested.
describe('DashboardPage — the teacher’s dashboard (the classic staff dashboard) on the server’s data', () => {
  it('shows the overview’s numbers, today’s lessons, the classes and the notifications from the server', async () => {
    const urls = mockDashboardApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: MANAGER }) }) })

    await waitFor(() => expect(within(cardOf(ar.dashboard.stats.activeStudents)).getByText('42')).toBeInTheDocument())
    expect(within(cardOf(ar.dashboard.stats.lessonsToday)).getByText('7')).toBeInTheDocument()
    // No «running classes» number (classes are an internal mechanism since 2026-11-26): the three cards share the row.
    expect(screen.queryByText('الفصول الجارية')).toBeNull()
    const numberCols = Array.from(document.querySelectorAll('.ant-statistic')).map((card) => card.closest('.ant-col') as HTMLElement)
    expect(numberCols).toHaveLength(3)
    for (const col of numberCols) expect(col).toHaveClass('ant-col-sm-8')
    // The money still owed, per currency, as the server summed it.
    const owed = screen.getByTestId('dashboard-outstanding')
    expect(owed.textContent).toContain(formatMoney(900, 'TRY', 'ar'))
    expect(owed.textContent).toContain(formatMoney(12.5, 'USD', 'ar'))

    expect(await within(cardOf(ar.dashboard.todayLessons)).findByText('المتغيرات')).toBeInTheDocument()
    const classes = cardOf(ar.dashboard.classes.title)
    expect(await within(classes).findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(classes).getByText('سارة المعلمة')).toBeInTheDocument()
    expect(within(classes).getByText(ar.dashboard.classes.seats.replace('{{enrolled}}', '12').replace('{{capacity}}', '20'))).toBeInTheDocument()
    // A teacher-only viewer's «الدورات» is the classes page (J-F72): the card links there for them, under that name.
    expect(within(classes).getByRole('link', { name: ar.nav.classesForTeacher })).toHaveAttribute('href', '/classes')
    expect(await within(cardOf(ar.dashboard.recentNotifications)).findByText('واجب جديد: المقالة الأولى')).toBeInTheDocument()

    expect(urls.filter((url) => url.startsWith('/api/reports/overview'))).toHaveLength(1)
    expect(urls.some((url) => url.startsWith('/api/lessons?') && url.includes('from=') && url.includes('to='))).toBe(true)
    expect(urls.some((url) => url.startsWith('/api/classes?') && url.includes('status=running'))).toBe(true)
    expect(urls.some((url) => url.startsWith('/api/classes?') && url.includes('status=open'))).toBe(true)
    // Nothing on the page is invented: the prototype's demo banner is gone.
    expect(screen.queryByText(/بيانات تجريبية/)).toBeNull()
  })

  it('sends no overview request and shows no number card to a caller without a reports key', async () => {
    const urls = mockDashboardApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: TEACHER }) }) })

    expect(await within(cardOf(ar.dashboard.todayLessons)).findByText('المتغيرات')).toBeInTheDocument()
    expect(await within(cardOf(ar.dashboard.classes.title)).findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(screen.queryByText(ar.dashboard.stats.activeStudents)).toBeNull()
    expect(screen.queryByText(ar.dashboard.stats.outstanding)).toBeNull()
    expect(urls.some((url) => url.startsWith('/api/reports'))).toBe(false)
  })

  it('leaves out the lessons, classes and money cards when the caller cannot read them', async () => {
    const urls = mockDashboardApi({ overview: () => jsonResponse(200, { ...OVERVIEW, attendance: null, financial: null, academic: null }) })
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['reports.academic.view'] }) }) })

    await waitFor(() => expect(within(cardOf(ar.dashboard.stats.activeStudents)).getByText('42')).toBeInTheDocument())
    expect(screen.queryByText(ar.dashboard.stats.outstanding)).toBeNull()
    // Without the money card the two number cards share the row by halves.
    const numberCols = Array.from(document.querySelectorAll('.ant-statistic')).map((card) => card.closest('.ant-col') as HTMLElement)
    expect(numberCols).toHaveLength(2)
    for (const col of numberCols) expect(col).toHaveClass('ant-col-sm-12')
    expect(screen.queryByText(ar.dashboard.todayLessons)).toBeNull()
    expect(screen.queryByText(ar.dashboard.classes.title)).toBeNull()
    expect(screen.getByText(ar.dashboard.recentNotifications)).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/lessons') || url.startsWith('/api/classes'))).toBe(false)
  })

  it('shows a teacher no assignment card, number or link — not the overview’s «awaiting review» either, even with the assignments keys — and keeps the other cards (2026-11-26)', async () => {
    const urls = mockDashboardApi()
    const permissions = [...MANAGER, 'exams.read', 'assignments.read', 'assignments.manage', 'assignments.grade']
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions }) }) })

    await waitFor(() => expect(within(cardOf(ar.dashboard.stats.activeStudents)).getByText('42')).toBeInTheDocument())
    expect(await within(cardOf(ar.dashboard.todayLessons)).findByText('المتغيرات')).toBeInTheDocument()
    expect(await within(cardOf(ar.dashboard.classes.title)).findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.recentNotifications)).toBeInTheDocument()
    // The number row holds the students, today's lessons and the money — three equal cards, no fourth slot.
    const numberCols = Array.from(document.querySelectorAll('.ant-statistic')).map((card) => card.closest('.ant-col') as HTMLElement)
    expect(numberCols).toHaveLength(3)
    for (const col of numberCols) expect(col).toHaveClass('ant-col-sm-8')
    // The overview's 5 submissions waiting for review are not shown, and nothing names or links to the assignments.
    expect(screen.queryByText('5')).toBeNull()
    expect(screen.queryByText(ar.nav.assignments)).toBeNull()
    expect(document.querySelector('a[href^="/assignments"]')).toBeNull()
    expect(urls.some((url) => url.startsWith('/api/assignments') || url.startsWith('/api/me/assignments') || url.startsWith('/api/submissions'))).toBe(false)
  })

  it('shows a failed overview as a short error with a retry, and the other cards still load', async () => {
    let calls = 0
    mockDashboardApi({
      overview: () => {
        calls += 1
        return calls === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, OVERVIEW)
      },
    })
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: MANAGER }) }) })

    const failure = (await screen.findByText(ar.dashboard.cardFailed)).closest('.ant-card') as HTMLElement
    expect(screen.queryByText(ar.dashboard.stats.activeStudents)).toBeNull()
    expect(await within(cardOf(ar.dashboard.todayLessons)).findByText('المتغيرات')).toBeInTheDocument()

    fireEvent.click(within(failure).getByText(ar.dashboard.retry).closest('button')!)
    await waitFor(() => expect(within(cardOf(ar.dashboard.stats.activeStudents)).getByText('42')).toBeInTheDocument())
    expect(calls).toBe(2)
    expect(screen.queryByText(ar.dashboard.cardFailed)).toBeNull()
  })
})
