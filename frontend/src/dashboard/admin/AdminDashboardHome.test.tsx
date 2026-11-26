import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReportsOverview } from '../../api/reports'
import { ar } from '../../i18n/ar'
import { DashboardPage } from '../../pages/DashboardPage'
import { makeAcademy } from '../../test/academy'
import { jsonResponse, mockFetch } from '../../test/http'
import { makeLesson } from '../../test/lessons'
import { makeNotification } from '../../test/notifications'
import { makeAuth, makeUser, renderWithProviders } from '../../test/render'
import { formatMoney } from '../dashboard.data'

const A = ar.dashboard.admin

/** The academy_admin seed's keys that the admin home reads or links with. */
const FULL_ADMIN = [
  'users.read',
  'users.create',
  'courses.read',
  'courses.manage',
  'classes.read',
  'classes.manage',
  'classes.teachers.assign',
  'lessons.read',
  'schedule.read',
  'enrollments.manage',
  'assignments.read',
  'exams.read',
  'invoices.read_all',
  'certificates.read_all',
  'reports.attendance.view',
  'reports.academic.view',
  'reports.financial.view',
]

const OVERVIEW: ReportsOverview = {
  asOf: '2026-11-22',
  timeZone: 'UTC',
  generatedAt: '2026-11-22T09:00:00.000Z',
  general: { activeStudents: 42, openClasses: 2, runningClasses: 3, lessonsToday: 7 },
  attendance: { period: { from: '2026-10-24', to: '2026-11-22' }, records: { present: 8, late: 1, absent: 1, excused: 0 }, attendanceRate: 90 },
  academic: { period: { from: '2026-10-24', to: '2026-11-22' }, finalGrades: 0, averagePercent: null, passRate: null, awaitingReview: 0 },
  financial: {
    period: { from: '2026-11-01', to: '2026-11-22' },
    collected: [],
    outstanding: [
      { currency: 'TRY', balance: 900, overdue: 0, studentsOverdue: 0 },
      { currency: 'USD', balance: 12.5, overdue: 0, studentsOverdue: 0 },
    ],
  },
}

/** A lesson an hour from now, so it is «coming» in the week view as well. */
function comingLesson() {
  const start = Date.now() + 60 * 60 * 1000
  return makeLesson({
    title: { ar: 'المتغيرات' },
    timeZone: 'UTC',
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 45 * 60 * 1000).toISOString(),
    meetingUrl: 'https://meet.example.test/py',
  })
}

interface Answers {
  overview?: () => Response
}

/** The admin home's server: the academy, the overview, the pending requests, the lessons and the notifications. */
function mockAdminApi(answers: Answers = {}) {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    const { pathname } = new URL(url, 'http://localhost')
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
    if (pathname === '/api/reports/overview') return answers.overview ? answers.overview() : jsonResponse(200, OVERVIEW)
    if (pathname === '/api/enrollment-requests') return jsonResponse(200, { items: [], nextCursor: null, pendingCount: 5 })
    if (pathname === '/api/lessons') return jsonResponse(200, { items: [comingLesson()], nextCursor: null })
    if (pathname === '/api/me/notifications') return jsonResponse(200, { items: [makeNotification({ title: 'طلب تسجيل جديد' })], nextCursor: null })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return urls
}

function renderHome(permissions: string[], overrides: Parameters<typeof makeUser>[0] = {}) {
  return renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ permissions, ...overrides }) }) })
}

/** The quick-action card titled `title` (its whole-card link). */
const actionLink = (title: string) => screen.getByText(title, { selector: '.admin-action__title' }).closest('a') as HTMLAnchorElement

describe('AdminDashboardHome — the admin home (J-F59)', () => {
  it('greets the admin and links the eleven quick actions to the existing pages, the creation forms through ?create=', async () => {
    mockAdminApi()
    renderHome(FULL_ADMIN)

    expect(screen.getByRole('heading', { level: 1, name: A.title })).toBeInTheDocument()
    expect(screen.getByText(A.intro)).toBeInTheDocument()
    const expected: Record<string, string> = {
      addStudent: '/users?create=student',
      addTeacher: '/users?create=teacher',
      createCourse: '/courses?create=course',
      // Teachers are assigned from the course drawer; classes management is no section of the interface (2026-11-26).
      assignTeacher: '/courses',
      lessons: '/lessons',
      schedule: '/schedule',
      enrollmentRequests: '/enrollment-requests',
      assignments: '/assignments',
      exams: '/exams',
      payments: '/payments',
      certificates: '/certificates',
    }
    for (const [key, href] of Object.entries(expected)) {
      expect(actionLink(A.actions[key as keyof typeof A.actions])).toHaveAttribute('href', href)
    }
    // Exactly these cards: none opens /classes, and no «manage classes» card is left.
    const cards = Array.from(document.querySelectorAll('.admin-action__link'))
    expect(cards).toHaveLength(Object.keys(expected).length)
    expect(cards.some((card) => card.getAttribute('href')?.startsWith('/classes'))).toBe(false)
    expect(screen.queryByText('إدارة الفصول')).toBeNull()
    // The rows are balanced for the eleven cards (admin.layout.ts → admin.css): 6 + 5 on a wide screen, 4 + 4 + 3 below.
    const grid = document.querySelector('.admin-actions__grid') as HTMLElement
    expect(grid.style.getPropertyValue('--admin-actions-cols-6')).toBe('6')
    expect(grid.style.getPropertyValue('--admin-actions-cols-4')).toBe('4')
    // Six cards a phone shows, then «show more» for the other five (CSS hides them on a phone only).
    const more = screen.getByText(A.showMore.replace('{{n}}', '5')).closest('button') as HTMLButtonElement
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(screen.getByText(A.showLess).closest('button')).toHaveAttribute('aria-expanded', 'true')
    await screen.findByTestId('stat-activeStudents')
  })

  it('shows the academy’s figures from the server: the overview, the attendance rate, the money owed per currency and the pending requests', async () => {
    const urls = mockAdminApi()
    renderHome(FULL_ADMIN)

    await waitFor(() => expect(within(screen.getByTestId('stat-activeStudents')).getByText('42')).toBeInTheDocument())
    // No class figures: the running and open classes the server still counts are not shown (2026-11-26).
    expect(screen.queryByTestId('stat-runningClasses')).toBeNull()
    expect(screen.queryByTestId('stat-openClasses')).toBeNull()
    expect(screen.queryByText('الفصول الجارية')).toBeNull()
    expect(screen.queryByText('الفصول المفتوحة')).toBeNull()
    expect(within(screen.getByTestId('stat-lessonsToday')).getByText('7')).toBeInTheDocument()
    expect(within(screen.getByTestId('stat-attendanceRate')).getByText(/90/)).toBeInTheDocument()
    // Each currency on its own line, never summed.
    const owed = screen.getByTestId('stat-outstanding').textContent ?? ''
    expect(owed).toContain(formatMoney(900, 'TRY', 'ar'))
    expect(owed).toContain(formatMoney(12.5, 'USD', 'ar'))
    await waitFor(() => expect(within(screen.getByTestId('stat-pendingRequests')).getByText('5')).toBeInTheDocument())
    expect(within(screen.getByTestId('stat-pendingRequests')).getByText(A.stats.review).closest('a')).toHaveAttribute('href', '/enrollment-requests')
    // Five tiles, balanced so no row ends on a gap: 5 on a wide section, 3 + 2 below.
    const tiles = document.querySelector('.admin-stats__grid') as HTMLElement
    expect(tiles.children).toHaveLength(5)
    expect(tiles.style.getPropertyValue('--admin-stats-cols-5')).toBe('5')
    expect(tiles.style.getPropertyValue('--admin-stats-cols-4')).toBe('3')

    expect(urls.filter((url) => url.startsWith('/api/reports/overview'))).toHaveLength(1)
    expect(urls.some((url) => url.startsWith('/api/enrollment-requests') && url.includes('limit=1'))).toBe(true)
  })

  it('lists today’s lessons with their link and details, then reads the week when asked; and the latest notifications', async () => {
    const urls = mockAdminApi()
    renderHome(FULL_ADMIN)

    const lesson = await screen.findByTestId('admin-lesson')
    expect(within(lesson).getByText('المتغيرات')).toBeInTheDocument()
    expect(within(lesson).getByText(A.schedule.join).closest('a')).toHaveAttribute('href', 'https://meet.example.test/py')
    expect(within(lesson).getByText(A.schedule.details).closest('a')?.getAttribute('href')).toMatch(/^\/lessons\?open=/)
    expect(await screen.findByText('طلب تسجيل جديد')).toBeInTheDocument()
    expect(screen.getByText(A.allNotifications).closest('a')).toHaveAttribute('href', '/notifications')

    const lessonReads = () => urls.filter((url) => url.startsWith('/api/lessons?'))
    const before = lessonReads().length
    fireEvent.click(screen.getByText(A.schedule.weekView))
    await waitFor(() => expect(lessonReads().length).toBeGreaterThan(before))
    // The week is seven academy days: the range ends a week after it starts.
    const week = new URL(lessonReads().at(-1)!, 'http://localhost').searchParams
    const span = Date.parse(week.get('to')!) - Date.parse(week.get('from')!)
    expect(Math.round(span / 86_400_000)).toBe(7)
    expect(await screen.findByTestId('admin-lesson')).toBeInTheDocument()
  })

  it('gives a read-only admin no «add» cards and no figures, and asks nothing it may not read', async () => {
    const urls = mockAdminApi()
    renderHome(['users.read', 'courses.read', 'classes.read'])

    // classes.read opens no card (no «manage classes» since 2026-11-26): nothing here creates, so no action at all.
    expect(document.querySelectorAll('.admin-action__link')).toHaveLength(0)
    expect(screen.getByText(A.noActions)).toBeInTheDocument()
    expect(screen.queryByText(A.actions.addStudent)).toBeNull()
    expect(screen.queryByText(A.actions.createCourse)).toBeNull()
    expect(screen.queryByText(A.actions.assignTeacher)).toBeNull()
    expect(screen.queryByText(A.statistics)).toBeNull()
    expect(screen.queryByText(A.schedule.title, { selector: 'h2' })).toBeNull()
    expect(await screen.findByText('طلب تسجيل جديد')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/reports') || url.startsWith('/api/lessons') || url.startsWith('/api/enrollment-requests'))).toBe(false)
  })

  it('shows a failed overview as a short error with a retry while the other sections load; the refresh button reads everything again', async () => {
    let calls = 0
    const urls = mockAdminApi({
      overview: () => {
        calls += 1
        return calls === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, OVERVIEW)
      },
    })
    renderHome(FULL_ADMIN)

    const failure = await screen.findByTestId('stats-failure')
    expect(screen.queryByTestId('stat-activeStudents')).toBeNull()
    expect(await screen.findByTestId('admin-lesson')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByTestId('stat-pendingRequests')).getByText('5')).toBeInTheDocument())

    fireEvent.click(within(failure).getByText(ar.dashboard.retry).closest('button')!)
    await waitFor(() => expect(within(screen.getByTestId('stat-activeStudents')).getByText('42')).toBeInTheDocument())
    expect(calls).toBe(2)

    const notificationReads = () => urls.filter((url) => url.startsWith('/api/me/notifications')).length
    const before = notificationReads()
    const refresh = screen.getByText(A.refresh).closest('button')!
    // antd ignores clicks until a button's loading state has cleared (an effect after the render).
    await waitFor(() => expect(refresh).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(refresh)
    await waitFor(() => expect(calls).toBe(3))
    await waitFor(() => expect(notificationReads()).toBe(before + 1))
  })
})

describe('DashboardPage — three homes kept apart (J-F59)', () => {
  it('keeps a teacher on the teacher’s dashboard, without the admin home', async () => {
    mockAdminApi()
    renderHome(['lessons.read', 'classes.read'], { role: 'teacher', roles: ['teacher'] })
    expect(await screen.findByText(ar.dashboard.todayLessons)).toBeInTheDocument()
    expect(screen.queryByText(A.title)).toBeNull()
    expect(screen.queryByText(A.quickActions)).toBeNull()
  })

  it('gives the academy’s staff the admin home, and a learner never sees it', async () => {
    mockAdminApi()
    const { unmount } = renderHome(['reports.financial.view', 'payments.record'], { role: 'staff', roles: ['staff'] })
    expect(screen.getByText(A.title)).toBeInTheDocument()
    expect(actionLink(A.actions.payments)).toHaveAttribute('href', '/payments')
    unmount()

    renderHome(['courses.read', 'lessons.read'], { role: 'student', roles: ['student'] })
    expect(screen.queryByText(A.title)).toBeNull()
    expect(screen.queryByText(A.quickActions)).toBeNull()
  })
})
