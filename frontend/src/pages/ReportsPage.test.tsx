import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatMoney } from '../dashboard/dashboard.data'
import { ar } from '../i18n/ar'
import { defaultPeriod } from '../reports/reports.period'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import {
  makeAssignmentSubmissions,
  makeAttendanceClasses,
  makeAttendanceStudents,
  makeClassPerformance,
  makeCollections,
  makeExamResults,
  makeReceivables,
  makeRevenue,
} from '../test/reports'
import { calendarDateIn } from '../timetable/timetable.dates'
import { ReportsPage } from './ReportsPage'

const ANSWERS: Record<string, () => unknown> = {
  '/api/academy': () => makeAcademy({ timezone: 'UTC' }),
  '/api/reports/attendance/classes': makeAttendanceClasses,
  '/api/reports/attendance/students': makeAttendanceStudents,
  '/api/reports/academic/classes': makeClassPerformance,
  '/api/reports/academic/assignments': makeAssignmentSubmissions,
  '/api/reports/academic/exams': makeExamResults,
  '/api/reports/financial/collections': makeCollections,
  '/api/reports/financial/receivables': makeReceivables,
  '/api/reports/financial/revenue': makeRevenue,
}

function mockReportsApi(override: Record<string, () => Response> = {}) {
  const urls: URL[] = []
  const fetchMock = mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    urls.push(parsed)
    if (override[parsed.pathname]) return override[parsed.pathname]()
    const answer = ANSWERS[parsed.pathname]
    return answer ? jsonResponse(200, answer()) : jsonResponse(404, { code: 'not_found' })
  })
  return { urls, fetchMock, reportUrls: () => urls.filter((url) => url.pathname.startsWith('/api/reports')) }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<ReportsPage />, { auth: makeAuth({ user: makeUser({ permissions }) }) })
}

function tabLabels(container: HTMLElement) {
  return [...container.querySelectorAll('.rp-tabs > .ant-tabs-nav .ant-tabs-tab')].map((tab) => tab.textContent)
}

describe('ReportsPage', () => {
  it('shows a worded state and asks nothing without any report key', () => {
    const { fetchMock } = mockReportsApi()
    renderPage(['users.read'])
    expect(screen.getByText(ar.reports.noAccess.title)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows one tab per key held', async () => {
    mockReportsApi()
    const { container } = renderPage(['reports.attendance.view', 'reports.financial.view'])
    await waitFor(() => expect(tabLabels(container)).toEqual([ar.reports.tabs.attendance, ar.reports.tabs.financial]))
  })

  it('sends the default period (the last 30 academy days) as from/to and a changed day after it', async () => {
    const api = mockReportsApi()
    const { container } = renderPage(['reports.attendance.view'])
    const expected = defaultPeriod(calendarDateIn('UTC'))
    await waitFor(() => expect(api.reportUrls().some((url) => url.pathname === '/api/reports/attendance/classes')).toBe(true))
    for (const url of api.reportUrls()) {
      expect(url.searchParams.get('from')).toBe(expected.from)
      expect(url.searchParams.get('to')).toBe(expected.to)
    }
    expect(await screen.findByText(ar.reports.attendance.byClass)).toBeInTheDocument()
    expect(api.reportUrls().map((url) => url.pathname).sort()).toEqual(['/api/reports/attendance/classes', '/api/reports/attendance/students'])

    const from = container.querySelector<HTMLInputElement>('.rp-period input[type="date"]')!
    fireEvent.change(from, { target: { value: '2026-09-01' } })
    await waitFor(() => expect(api.reportUrls().some((url) => url.searchParams.get('from') === '2026-09-01')).toBe(true))
  })

  it('refuses an inverted or too long period locally, without a request', async () => {
    const api = mockReportsApi()
    const { container } = renderPage(['reports.attendance.view'])
    await screen.findByText(ar.reports.attendance.byClass)
    const before = api.reportUrls().length
    const [from, to] = container.querySelectorAll<HTMLInputElement>('.rp-period input[type="date"]')
    fireEvent.change(from, { target: { value: '2026-12-01' } })
    fireEvent.change(to, { target: { value: '2026-11-01' } })
    expect(await screen.findByText(ar.reports.period.order)).toBeInTheDocument()
    fireEvent.change(from, { target: { value: '2024-01-01' } })
    expect(await screen.findByText(ar.reports.period.tooLong.replace('{{max}}', '366'))).toBeInTheDocument()
    expect(api.reportUrls().length).toBe(before)
  })

  it('maps report_range_invalid from the server to its message', async () => {
    mockReportsApi({
      '/api/reports/attendance/classes': () => jsonResponse(400, { statusCode: 400, code: 'report_range_invalid', message: 'x', from: 'a', to: 'b', maxDays: 366 }),
    })
    renderPage(['reports.attendance.view'])
    expect(await screen.findByText(ar.reports.errors.rangeInvalid)).toBeInTheDocument()
  })

  it('renders the financial totals per currency, the aging and the revenue', async () => {
    const api = mockReportsApi()
    const { container } = renderPage(['reports.financial.view'])
    const kpis = () => [...container.querySelectorAll('.rp-kpis b')].map((cell) => cell.textContent)
    await waitFor(() => expect(kpis()).toContain(formatMoney(2400, 'TRY', 'ar')))
    await waitFor(() => expect(kpis()).toEqual(expect.arrayContaining([formatMoney(800, 'TRY', 'ar'), formatMoney(2300, 'TRY', 'ar')])))
    expect(screen.getByText(ar.reports.financial.collected.replace('{{currency}}', 'TRY'))).toBeInTheDocument()
    expect(await screen.findByText(ar.reports.financial.outstanding.replace('{{currency}}', 'TRY'))).toBeInTheDocument()
    expect(screen.getByText(ar.reports.financial.invoiced.replace('{{currency}}', 'TRY'))).toBeInTheDocument()
    expect(screen.getByText(ar.reports.financial.noCourse)).toBeInTheDocument()
    // API-162 takes no period.
    const receivables = api.reportUrls().find((url) => url.pathname === '/api/reports/financial/receivables')!
    expect(receivables.searchParams.has('from')).toBe(false)

    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(api.reportUrls().some((url) => url.pathname === '/api/reports/financial/receivables' && url.searchParams.get('overdueOnly') === 'true')).toBe(true))
  })

  it('shows the truncated note', async () => {
    mockReportsApi({ '/api/reports/attendance/classes': () => jsonResponse(200, makeAttendanceClasses({ truncated: true })) })
    renderPage(['reports.attendance.view'])
    expect(await screen.findByText(ar.reports.truncated.replace('{{max}}', '5,000'))).toBeInTheDocument()
  })

  it('reads the three academic reports through its sub-tabs', async () => {
    const api = mockReportsApi()
    renderPage(['reports.academic.view'])
    expect(await screen.findByText(ar.reports.academic.byCourse)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.reports.academic.exams))
    expect(await screen.findByText(ar.reports.academic.examsNote)).toBeInTheDocument()
    expect(api.reportUrls().map((url) => url.pathname)).toContain('/api/reports/academic/exams')
  })
})
