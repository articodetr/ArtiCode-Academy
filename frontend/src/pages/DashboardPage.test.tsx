import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReportsOverview } from '../api/reports'
import { ar } from '../i18n/ar'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { jsonResponse, mockFetch } from '../test/http'
import { ADMIN_REPORTS_PERMISSIONS, REPORT_GENERATED_AT, STAFF_REPORTS_PERMISSIONS, makeReportsOverview } from '../test/reports'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDay } from '../users/users.format'
import { DashboardPage } from './DashboardPage'

type OverviewAnswer = ReportsOverview | Response | (() => ReportsOverview | Response)

/** Serves the server status card (API-002/004) and API-164; `paths` records every request. */
function mockDashboardApi(overview: OverviewAnswer = makeReportsOverview()) {
  const paths: string[] = []
  mockFetch((url) => {
    const { pathname } = new URL(url, 'http://localhost')
    paths.push(pathname)
    if (pathname === '/api/health') {
      return jsonResponse(200, { status: 'ok', service: 'articode-backend', version: '0.0.1', environment: 'test', timestamp: REPORT_GENERATED_AT, uptimeSeconds: 12 })
    }
    if (pathname === '/api/health/ready') return jsonResponse(200, { status: 'ready', checks: { database: { status: 'up', latencyMs: 2 } }, timestamp: REPORT_GENERATED_AT })
    if (pathname === '/api/reports/overview') {
      const answer = typeof overview === 'function' ? overview() : overview
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { paths }
}

function renderDashboard(user = makeUser({ permissions: ADMIN_REPORTS_PERMISSIONS })) {
  return renderWithProviders(<DashboardPage />, { auth: makeAuth({ user }), route: '/', path: '/' })
}

function card(title: string): HTMLElement {
  return screen.getByText(title).closest('.ant-card') as HTMLElement
}

function linkOf(scope: HTMLElement, label: string): string | null {
  return within(scope).getByText(label).closest('a')!.getAttribute('href')
}

describe('DashboardPage', () => {
  it('shows a holder of every report key the overview of API-164 as the server counted it, with links into the reports', async () => {
    const api = mockDashboardApi()
    renderDashboard()

    expect(await screen.findByText(ar.dashboard.general.activeStudents)).toBeInTheDocument()
    expect(api.paths.filter((path) => path === '/api/reports/overview')).toHaveLength(1)
    const tile = (key: keyof typeof ar.dashboard.general) => within(card(ar.dashboard.general[key])).getByText(/\d/).textContent
    expect(tile('activeStudents')).toBe('1,240')
    expect(tile('openClasses')).toBe('7')
    expect(tile('runningClasses')).toBe('31')
    expect(tile('lessonsToday')).toBe('18')

    const attendance = card(ar.dashboard.attendance.title)
    expect(within(attendance).getByText('93.1%')).toBeInTheDocument()
    expect(within(attendance).getByText('حاضر 1,800 · متأخر 90 · غائب 140 · معذور 20')).toBeInTheDocument()
    expect(within(attendance).getByText(`من ${formatDay('2026-10-13', 'ar')} إلى ${formatDay('2026-11-11', 'ar')}`)).toBeInTheDocument()
    expect(linkOf(attendance, ar.dashboard.attendance.byClass)).toBe('/reports?report=attendance-classes')
    expect(linkOf(attendance, ar.dashboard.attendance.byStudent)).toBe('/reports?report=attendance-students')

    const academic = card(ar.dashboard.academic.title)
    expect(within(academic).getByText('77.25%')).toBeInTheDocument()
    expect(within(academic).getByText('89.06%')).toBeInTheDocument()
    expect(within(academic).getByText('64')).toBeInTheDocument()
    expect(within(academic).getByText('23')).toBeInTheDocument()
    expect(linkOf(academic, ar.dashboard.academic.byClass)).toBe('/reports?report=academic-classes')
    expect(linkOf(academic, ar.dashboard.academic.assignments)).toBe('/reports?report=academic-assignments')

    const financial = card(ar.dashboard.financial.title)
    expect(within(financial).getByText('52,350.00 SAR')).toBeInTheDocument()
    expect(within(financial).getByText('الدفعات: 41')).toBeInTheDocument()
    expect(within(financial).getByText('18,400.00 SAR')).toBeInTheDocument()
    expect(within(financial).getByText('المتأخر: 6,200.00 SAR (طلاب متأخرون: 9)')).toBeInTheDocument()
    expect(within(financial).getByText(`من ${formatDay('2026-11-01', 'ar')} إلى ${formatDay('2026-11-11', 'ar')}`)).toBeInTheDocument()
    expect(linkOf(financial, ar.dashboard.financial.collections)).toBe('/reports?report=financial-collections')
    expect(linkOf(financial, ar.dashboard.financial.receivables)).toBe('/reports?report=financial-receivables')

    expect(screen.getByTestId('overview-as-of').textContent).toBe(
      `حتى ${formatDay('2026-11-11', 'ar')} بأيام منطقة الأكاديمية Asia/Riyadh · أُعدّت في ${formatLessonDateTime(REPORT_GENERATED_AT, 'ar', 'Asia/Riyadh')}`,
    )
    // No demo figure is left on the page.
    expect(screen.queryByText(ar.common.demoBanner)).not.toBeInTheDocument()
  })

  it('shows staff no academic card — the server sends that section null without its key', async () => {
    mockDashboardApi(makeReportsOverview({ academic: null }))
    renderDashboard(makeUser({ role: 'staff', roles: ['staff'], permissions: STAFF_REPORTS_PERMISSIONS }))
    expect(await screen.findByText(ar.dashboard.attendance.title)).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.financial.title)).toBeInTheDocument()
    expect(screen.queryByText(ar.dashboard.academic.title)).not.toBeInTheDocument()
  })

  it('says what an empty month and no balance mean, and shows a null rate as a dash', async () => {
    mockDashboardApi(
      makeReportsOverview({
        attendance: { period: { from: '2026-10-13', to: '2026-11-11' }, records: { recorded: 0, present: 0, late: 0, absent: 0, excused: 0 }, attendanceRate: null },
        academic: null,
        financial: { period: { from: '2026-11-01', to: '2026-11-11' }, collected: [], outstanding: [] },
      }),
    )
    renderDashboard()
    expect(await screen.findByText(ar.dashboard.financial.noCollections)).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.financial.noOutstanding)).toBeInTheDocument()
    expect(within(card(ar.dashboard.attendance.title)).getByText('—')).toBeInTheDocument()
  })

  it('reports a failed read with a retry that asks again', async () => {
    let calls = 0
    const api = mockDashboardApi(() => {
      calls += 1
      return calls === 1 ? jsonResponse(503, { statusCode: 503, message: 'down' }) : makeReportsOverview()
    })
    renderDashboard()
    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.dashboard.retry).closest('button')!)
    expect(await screen.findByText(ar.dashboard.general.activeStudents)).toBeInTheDocument()
    expect(api.paths.filter((path) => path === '/api/reports/overview')).toHaveLength(2)
    expect(screen.queryByText(ar.login.errors.server)).not.toBeInTheDocument()
  })

  it('sends no API-164 request for a student and offers the pages of their menu instead', async () => {
    const api = mockDashboardApi()
    renderDashboard(makeUser({ name: 'سارة', role: 'student', roles: ['student'], permissions: ['courses.read', 'schedule.read', 'lessons.read', 'assignments.read', 'exams.read'] }))

    expect(screen.getByText('مرحباً، سارة')).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.shortcutsSubtitle)).toBeInTheDocument()
    const shortcuts = card(ar.dashboard.shortcuts)
    expect(within(shortcuts).getByLabelText(ar.nav.myClasses)).toHaveAttribute('href', '/my-classes')
    expect(within(shortcuts).getByLabelText(ar.nav.myLessons)).toHaveAttribute('href', '/my-lessons')
    expect(within(shortcuts).getByLabelText(ar.nav.myAssignments)).toHaveAttribute('href', '/my-assignments')
    // The landing page itself and the screens of other roles are not offered.
    expect(within(shortcuts).queryByLabelText(ar.nav.dashboard)).not.toBeInTheDocument()
    expect(within(shortcuts).queryByLabelText(ar.nav.reports)).not.toBeInTheDocument()
    expect(within(shortcuts).queryByLabelText(ar.nav.users)).not.toBeInTheDocument()
    await waitFor(() => expect(api.paths).toContain('/api/health'))
    expect(api.paths.some((path) => path.startsWith('/api/reports'))).toBe(false)
    expect(screen.queryByText(ar.dashboard.general.activeStudents)).not.toBeInTheDocument()
  })

  it('treats a teacher without a report key the same way, and a key granted to a custom role opens the overview', async () => {
    const api = mockDashboardApi(makeReportsOverview({ attendance: null, financial: null }))
    const { unmount } = renderDashboard(makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['classes.read', 'lessons.read', 'grades.read_all', 'grades.manage'] }))
    expect(within(card(ar.dashboard.shortcuts)).getByLabelText(ar.nav.classes)).toHaveAttribute('href', '/classes')
    await waitFor(() => expect(api.paths).toContain('/api/health'))
    expect(api.paths).not.toContain('/api/reports/overview')
    unmount()

    renderDashboard(makeUser({ role: null, roles: ['academic_reader'], permissions: ['reports.academic.view'] }))
    expect(await screen.findByText(ar.dashboard.academic.title)).toBeInTheDocument()
    expect(screen.queryByText(ar.dashboard.shortcuts)).not.toBeInTheDocument()
    expect(api.paths.filter((path) => path === '/api/reports/overview')).toHaveLength(1)
  })
})
