import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { DashboardPage } from './DashboardPage'

const MANAGER = ['lessons.read', 'classes.read', 'classes.manage', 'reports.attendance.view', 'reports.academic.view', 'reports.financial.view']

/** A lesson that started an hour ago and has no attendance yet — it needs the user. */
function startedLesson() {
  const start = new Date(Date.now() - 60 * 60_000)
  const end = new Date(Date.now() + 30 * 60_000)
  return {
    id: 'l1',
    class: { id: 'k1', code: 'PY-A', name: { ar: 'بايثون A', en: 'Python A' }, status: 'running', course: { id: 'c1', code: 'PY', name: { ar: 'بايثون' } } },
    title: { ar: 'المتغيرات' },
    description: null,
    deliveryMode: 'in_person',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    status: 'scheduled',
    room: { id: 'r1', code: 'R1', name: null, branch: null },
    timeZone: 'UTC',
    teacher: { userId: 't1', fullName: 'سارة' },
    syllabusItem: null,
    scheduleId: null,
    meetingUrl: null,
    cancellationReason: null,
    attendanceTakenAt: null,
    attendance: { present: 0, late: 0, absent: 0, excused: 0 },
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
  }
}

const OVERVIEW = {
  asOf: '2026-11-14',
  timeZone: 'UTC',
  generatedAt: '2026-11-14T10:00:00.000Z',
  general: { activeStudents: 42, openClasses: 1, runningClasses: 3, lessonsToday: 1 },
  attendance: { period: { from: '2026-10-16', to: '2026-11-14' }, records: { present: 9, late: 0, absent: 1, excused: 0 }, attendanceRate: 90 },
  academic: { period: { from: '2026-10-16', to: '2026-11-14' }, finalGrades: 0, averagePercent: null, passRate: null, awaitingReview: 5 },
  financial: { period: { from: '2026-11-01', to: '2026-11-14' }, collected: [{ currency: 'TRY', payments: 3, amount: 1500 }], outstanding: [{ currency: 'TRY', balance: 900, overdue: 600, studentsOverdue: 1 }] },
}

function mockDashboardApi() {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    const path = url.split('?')[0]
    if (path === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
    if (path === '/api/lessons') return jsonResponse(200, { items: [startedLesson()], nextCursor: null })
    if (path === '/api/classes') return jsonResponse(200, { items: [], nextCursor: null })
    if (path === '/api/reports/overview') return jsonResponse(200, OVERVIEW)
    if (path === '/api/reports/financial/collections') return jsonResponse(200, { period: { from: '', to: '' }, timeZone: 'UTC', truncated: false, rows: [], reversed: [], totals: [] })
    if (path === '/api/reports/financial/receivables') return jsonResponse(200, { asOf: '', timeZone: 'UTC', truncated: false, rows: [], totals: [] })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${url}` })
  })
  return urls
}

describe('DashboardPage (redesign — the day timeline and its views)', () => {
  it('shows a viewer without any key only the Today view, no tabs, and asks the server for nothing but the academy', async () => {
    const urls = mockDashboardApi()
    // A custom role without keys (a student or guardian gets the learner home instead — LearnerHome.test.tsx).
    const viewer = makeUser({ role: null, roles: ['observer'], permissions: [] })
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: viewer }) })

    expect(await screen.findByText(ar.dashboard.noLessonsAccess, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.allClear)).toBeInTheDocument()
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/academy'))).toBe(true))
    expect(urls.filter((url) => !url.startsWith('/api/academy'))).toEqual([])
  })

  it('draws today’s lessons on the timeline and lists what needs the manager, from the server’s answers', async () => {
    mockDashboardApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ permissions: MANAGER }) }) })

    const tabs = await screen.findByRole('tablist')
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+/g, ''))).toEqual(
      Object.values(ar.dashboard.views),
    )
    const block = await screen.findByTitle(new RegExp(ar.dashboard.state.needsAttendance))
    expect(block).toHaveAttribute('href', '/lessons')
    expect(within(block).getByText('بايثون A')).toBeInTheDocument()

    expect(await screen.findByText(ar.dashboard.attention.attendance)).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.attention.review)).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.attention.overdue)).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
  })

  it('opens the finance view from its tab with this month’s collection and the outstanding amounts', async () => {
    mockDashboardApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ permissions: MANAGER }) }) })

    const tabs = await screen.findByRole('tablist')
    fireEvent.click(within(tabs).getByText(ar.dashboard.views.finance))
    expect(await screen.findByText(ar.dashboard.finance.outstanding)).toBeInTheDocument()
    expect(screen.getAllByText(ar.dashboard.finance.collected).length).toBeGreaterThan(0)
    expect(await screen.findByText(ar.dashboard.finance.noPayments)).toBeInTheDocument()
  })
})
