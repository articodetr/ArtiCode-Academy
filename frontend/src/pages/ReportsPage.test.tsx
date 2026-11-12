import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequireAccess } from '../auth/RequireAuth'
import { ar } from '../i18n/ar'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { makeAcademy } from '../test/academy'
import { makeClass, makeClassList } from '../test/classes'
import { COURSE_ID, makeCourse, makeCourseList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import {
  ADMIN_REPORTS_PERMISSIONS,
  REPORT_GENERATED_AT,
  STAFF_REPORTS_PERMISSIONS,
  makeAttendanceClassRow,
  makeAttendanceClassesReport,
  makeAttendanceStudentsReport,
  makeCollectionsReport,
  makeReceivablesReport,
  makeReportClass,
  makeReportStudent,
  makeAttendanceStudentRow,
} from '../test/reports'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { formatDay } from '../users/users.format'
import { ReportsPage } from './ReportsPage'

type Answer = unknown
type Handler = Answer | ((query: URLSearchParams) => Answer)

/**
 * Serves the academy (its zone is «today» of the period rule), the two pickers' lists (API-042, API-050) and the
 * reports by path; `reports` records each report request (path + query), `urls` every request.
 */
function mockReportsApi(answers: Record<string, Handler>) {
  const reports: string[] = []
  const urls: string[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    urls.push(parsed.pathname + parsed.search)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/courses') return jsonResponse(200, makeCourseList([makeCourse({ status: 'published' })]))
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'running' })]))
    if (parsed.pathname.startsWith('/api/reports/')) {
      reports.push(parsed.pathname + parsed.search)
      const handler = answers[parsed.pathname]
      const answer = typeof handler === 'function' ? (handler as (query: URLSearchParams) => Answer)(parsed.searchParams) : handler
      if (answer === undefined) return jsonResponse(404, { statusCode: 404, message: 'nope' })
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { reports, urls }
}

function renderReports(route: string, permissions: string[] = ADMIN_REPORTS_PERMISSIONS, roles: string[] = ['academy_admin']) {
  return renderWithProviders(<ReportsPage />, { auth: makeAuth({ user: makeUser({ permissions, roles }) }), route, path: '/reports' })
}

function bodyRows(scope: HTMLElement = document.body) {
  return Array.from(scope.querySelectorAll<HTMLElement>('tbody tr.ant-table-row'))
}

function button(label: string): HTMLButtonElement {
  return screen.getByText(label).closest('button')!
}

async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

function changeDay(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('ReportsPage — the index', () => {
  it('lists the reports the keys open, by family, each linking to its address, and asks for none of them', async () => {
    const api = mockReportsApi({})
    renderReports('/reports')

    for (const family of Object.values(ar.reports.families)) expect(screen.getByText(family)).toBeInTheDocument()
    const links = screen.getAllByText(ar.reports.open).map((label) => label.closest('a')!)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/reports?report=attendance-classes',
      '/reports?report=attendance-students',
      '/reports?report=academic-classes',
      '/reports?report=academic-assignments',
      '/reports?report=academic-exams',
      '/reports?report=financial-collections',
      '/reports?report=financial-receivables',
      '/reports?report=financial-revenue',
    ])
    expect(screen.getByText(ar.reports.catalog.financialReceivables.name)).toBeInTheDocument()
    expect(screen.getByText(ar.reports.catalog.financialReceivables.description)).toBeInTheDocument()
    expect(api.urls).toEqual([])
  })

  it('shows staff (attendance + financial by seed) the five reports their keys open, and no academic family', () => {
    mockReportsApi({})
    renderReports('/reports', STAFF_REPORTS_PERMISSIONS, ['staff'])
    expect(screen.getAllByText(ar.reports.open)).toHaveLength(5)
    expect(screen.queryByText(ar.reports.families.academic)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.reports.catalog.academicExams.name)).not.toBeInTheDocument()
  })

  it('says so above the list for an address the keys do not open, or one it does not know — and sends nothing', () => {
    const api = mockReportsApi({})
    const { unmount } = renderReports('/reports?report=academic-exams', STAFF_REPORTS_PERMISSIONS, ['staff'])
    expect(screen.getByText(ar.reports.forbiddenReport)).toBeInTheDocument()
    expect(screen.getAllByText(ar.reports.open)).toHaveLength(5)
    unmount()

    renderReports('/reports?report=nope')
    expect(screen.getByText(ar.reports.unknownReport)).toBeInTheDocument()
    expect(screen.getAllByText(ar.reports.open)).toHaveLength(8)
    expect(api.urls).toEqual([])
  })

  it('stays behind the route gate: a teacher without a report key gets the 403 page and no request', () => {
    const api = mockReportsApi({})
    renderWithProviders(
      <RequireAccess navKey="reports">
        <ReportsPage />
      </RequireAccess>,
      { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: ['classes.read', 'grades.read_all', 'attendance.record'] }) }), route: '/reports' },
    )
    expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
    expect(api.urls).toEqual([])
  })
})

describe('ReportsPage — one report', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a report from its address with the server defaults, and shows its rows, totals and period/zone/time line as sent', async () => {
    const api = mockReportsApi({ '/api/reports/attendance/classes': makeAttendanceClassesReport() })
    renderReports('/reports?report=attendance-classes')

    expect(await screen.findByText('ENG-A1-2026-1 — فصل الصباح')).toBeInTheDocument()
    expect(api.reports).toEqual(['/api/reports/attendance/classes'])
    expect(screen.getByText(ar.reports.catalog.attendanceClasses.name, { selector: 'h4' })).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(1)
    const cells = Array.from(rows[0]!.querySelectorAll('td')).map((cell) => cell.textContent)
    expect(cells).toEqual(['ENG-A1-2026-1 — فصل الصباح', 'ENG-A1 — الإنجليزية — المستوى الأول', ar.labels.running, '12', '10', '9', '1', '150', '12', '18', '6', '186', '90%'])
    const totals = Array.from(document.querySelectorAll('.report-totals td')).map((cell) => cell.textContent)
    expect(totals).toEqual(['الإجمالي (الفصول: 1)', '', '', '12', '10', '9', '1', '150', '12', '18', '6', '186', '90%'])
    const meta = screen.getByTestId('report-meta').textContent
    expect(meta).toContain(`من ${formatDay('2026-10-13', 'ar')} إلى ${formatDay('2026-11-11', 'ar')}`)
    expect(meta).toContain('Asia/Riyadh')
    expect(meta).toContain(formatLessonDateTime(REPORT_GENERATED_AT, 'ar', 'Asia/Riyadh'))
    expect(screen.queryByText(/طابق التقرير أكثر من/)).not.toBeInTheDocument()
    // This report takes no thresholds of the absences report.
    expect(screen.queryByLabelText(ar.reports.filters.minAbsences)).not.toBeInTheDocument()
  })

  it('sends the period the user picks and holds back one the server would refuse, with the message under the days', async () => {
    const api = mockReportsApi({ '/api/reports/attendance/classes': makeAttendanceClassesReport() })
    renderReports('/reports?report=attendance-classes')
    await screen.findByText('ENG-A1-2026-1 — فصل الصباح')

    changeDay(ar.reports.filters.to, '2026-10-31')
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/classes?to=2026-10-31'))
    changeDay(ar.reports.filters.from, '2026-10-01')
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/classes?from=2026-10-01&to=2026-10-31'))
    await waitFor(() => expect(button(ar.reports.actions.exportCsv)).toBeEnabled())

    const sent = api.reports.length
    changeDay(ar.reports.filters.from, '2026-11-05')
    expect(await screen.findByText(ar.reports.validation.period.order)).toBeInTheDocument()
    changeDay(ar.reports.filters.from, '2025-10-01')
    expect(await screen.findByText(ar.reports.validation.period.tooLong.replace('{{maxDays}}', '366'))).toBeInTheDocument()
    expect(api.reports).toHaveLength(sent)
    // The table stays (its own period in the line above), but the file and the paper wait for a period the server takes.
    expect(screen.getByText('ENG-A1-2026-1 — فصل الصباح')).toBeInTheDocument()
    expect(button(ar.reports.actions.exportCsv)).toBeDisabled()
    expect(button(ar.reports.actions.print)).toBeDisabled()

    changeDay(ar.reports.filters.from, '2025-11-01')
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/classes?from=2025-11-01&to=2026-10-31'))
    expect(screen.queryByText(ar.reports.validation.period.order)).not.toBeInTheDocument()
  })

  it('shows the server’s refusal of a period with its days', async () => {
    mockReportsApi({
      '/api/reports/attendance/classes': jsonResponse(400, {
        statusCode: 400,
        error: 'Bad Request',
        code: 'report_range_invalid',
        message: 'A report period starts no later than it ends and lasts at most 366 days',
        from: '2026-11-20',
        to: '2026-11-12',
        maxDays: 366,
      }),
    })
    renderReports('/reports?report=attendance-classes')
    expect(await screen.findByText('رفض الخادم الفترة من 2026-11-20 إلى 2026-11-12: اليوم الأول لا يقع بعد الأخير، والفترة 366 يوماً على الأكثر.')).toBeInTheDocument()
    expect(button(ar.reports.actions.exportCsv)).toBeDisabled()
  })

  it('sends the thresholds of the absences report as numbers, and refuses one its DTO would refuse', async () => {
    const api = mockReportsApi({ '/api/reports/attendance/students': makeAttendanceStudentsReport() })
    renderReports('/reports?report=attendance-students')
    expect(await screen.findByText('سارة أحمد')).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.reports.filters.classStatus)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ar.reports.filters.minAbsences), { target: { value: '3' } })
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/students?minAbsences=3'))
    fireEvent.change(screen.getByLabelText(ar.reports.filters.minAbsenceRate), { target: { value: '20.5' } })
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/students?minAbsences=3&minAbsenceRate=20.5'))

    const sent = api.reports.length
    fireEvent.change(screen.getByLabelText(ar.reports.filters.minAbsenceRate), { target: { value: '12.345' } })
    expect(await screen.findByText(ar.reports.validation.minAbsenceRate)).toBeInTheDocument()
    expect(api.reports).toHaveLength(sent)
  })

  it('warns when the rows were cut at 5,000 — the totals still cover everything', async () => {
    mockReportsApi({ '/api/reports/attendance/students': makeAttendanceStudentsReport({ truncated: true }) })
    renderReports('/reports?report=attendance-students')
    expect(await screen.findByText(ar.reports.truncated.replace('{{cap}}', '5,000'))).toBeInTheDocument()
  })

  it('reads the receivables «now»: no period, «overdue only» sent as overdueOnly=true, the line says «as of»', async () => {
    const api = mockReportsApi({ '/api/reports/financial/receivables': makeReceivablesReport() })
    renderReports('/reports?report=financial-receivables', STAFF_REPORTS_PERMISSIONS, ['staff'])
    expect(await screen.findByText('سارة أحمد')).toBeInTheDocument()
    expect(api.reports).toEqual(['/api/reports/financial/receivables'])
    expect(screen.queryByLabelText(ar.reports.filters.from)).not.toBeInTheDocument()
    expect(screen.getByTestId('report-meta').textContent).toContain(`الأرصدة حتى اليوم ${formatDay('2026-11-11', 'ar')}`)
    const cells = Array.from(bodyRows()[0]!.querySelectorAll('td')).map((cell) => cell.textContent)
    expect(cells).toEqual(['سارة أحمد', 'SAR', '2', '3,000.00', '1,200.00', '1,800.00', '900.00', formatDay('2026-09-30', 'ar'), '42', '300.00', '600.00', '0.00', '0.00'])

    fireEvent.click(screen.getByText(ar.reports.filters.overdueOnly))
    await waitFor(() => expect(api.reports).toContain('/api/reports/financial/receivables?overdueOnly=true'))
  })

  it('shows the collections and the reversed payments as two tables, each with the totals of its currency', async () => {
    mockReportsApi({ '/api/reports/financial/collections': makeCollectionsReport() })
    renderReports('/reports?report=financial-collections', STAFF_REPORTS_PERMISSIONS, ['staff'])
    const completed = (await screen.findByText(ar.reports.sections.completed)).closest('section')!
    const reversed = screen.getByText(ar.reports.sections.reversed).closest('section')!
    expect(bodyRows(completed)).toHaveLength(2)
    expect(within(completed).getByText('9,000.00')).toBeInTheDocument()
    expect(within(completed).getByText('13,500.50')).toBeInTheDocument()
    expect(bodyRows(reversed)).toHaveLength(1)
    expect(within(reversed).getByText(ar.reports.methods.card)).toBeInTheDocument()
    expect(Array.from(reversed.querySelectorAll('.report-totals td')).map((cell) => cell.textContent)).toEqual(['الإجمالي', '', 'SAR', '1', '100.00'])
  })

  it('narrows by a course and asks the class picker for that course’s classes; «clear the filters» drops them', async () => {
    const api = mockReportsApi({ '/api/reports/attendance/classes': makeAttendanceClassesReport() })
    renderReports('/reports?report=attendance-classes')
    await screen.findByText('ENG-A1-2026-1 — فصل الصباح')

    await pick(ar.reports.filters.course, 'PY-101 — أساسيات بايثون')
    await waitFor(() => expect(api.reports).toContain(`/api/reports/attendance/classes?courseId=${COURSE_ID}`))
    await waitFor(() => expect(api.urls).toContain(`/api/classes?courseId=${COURSE_ID}&limit=20`))
    await pick(ar.reports.filters.classStatus, ar.labels.completed)
    await waitFor(() => expect(api.reports).toContain(`/api/reports/attendance/classes?courseId=${COURSE_ID}&classStatus=completed`))

    fireEvent.click(button(ar.reports.filters.reset))
    await waitFor(() => expect(api.reports.at(-1)).toBe('/api/reports/attendance/classes'))
  })

  it('offers no course or class filter to a caller who may not read them (the report itself needs neither)', async () => {
    const api = mockReportsApi({ '/api/reports/financial/collections': makeCollectionsReport() })
    renderReports('/reports?report=financial-collections', ['reports.financial.view'], ['accountant'])
    await screen.findByText(ar.reports.sections.completed)
    expect(screen.getByLabelText(ar.reports.filters.method)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.reports.filters.course)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.reports.filters.class)).not.toBeInTheDocument()
    expect(api.urls.some((url) => url.startsWith('/api/courses') || url.startsWith('/api/classes'))).toBe(false)
    await pick(ar.reports.filters.method, ar.reports.methods.bank_transfer)
    await waitFor(() => expect(api.reports).toContain('/api/reports/financial/collections?method=bank_transfer'))
  })

  it('switches to another report with the same period, and goes back to the list', async () => {
    const api = mockReportsApi({
      '/api/reports/attendance/classes': makeAttendanceClassesReport(),
      '/api/reports/attendance/students': makeAttendanceStudentsReport({ rows: [makeAttendanceStudentRow({ student: makeReportStudent({ fullName: 'ليلى حسن' }) })] }),
    })
    renderReports('/reports?report=attendance-classes')
    await screen.findByText('ENG-A1-2026-1 — فصل الصباح')
    changeDay(ar.reports.filters.to, '2026-10-31')
    await waitFor(() => expect(api.reports).toContain('/api/reports/attendance/classes?to=2026-10-31'))

    await pick(ar.reports.picker, ar.reports.catalog.attendanceStudents.name)
    expect(await screen.findByText('ليلى حسن')).toBeInTheDocument()
    expect(api.reports.at(-1)).toBe('/api/reports/attendance/students?to=2026-10-31')
    expect(screen.getByText(ar.reports.catalog.attendanceStudents.name, { selector: 'h4' })).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.reports.back))
    expect(await screen.findByText(ar.reports.families.attendance)).toBeInTheDocument()
    expect(screen.getAllByText(ar.reports.open)).toHaveLength(8)
  })

  it('exports the visible tables as a UTF-8 CSV with a BOM, the UI-language titles, numbers unformatted and guarded texts', async () => {
    const data = makeAttendanceStudentsReport({ rows: [makeAttendanceStudentRow({ student: makeReportStudent({ fullName: '@SUM(1+1)' }) })] })
    mockReportsApi({ '/api/reports/attendance/students': data })
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:report'
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    try {
      renderReports('/reports?report=attendance-students')
      await screen.findByText('@SUM(1+1)')
      await waitFor(() => expect(button(ar.reports.actions.exportCsv)).toBeEnabled())
      fireEvent.click(button(ar.reports.actions.exportCsv))

      expect(names).toEqual(['attendance-students_2026-10-13_2026-11-11.csv'])
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobs[0]!.arrayBuffer())
      const lines = text.split('\r\n')
      expect(lines[0]).toBe(
        `﻿${[ar.reports.columns.student, ar.reports.columns.class, ar.reports.columns.course, ar.reports.columns.enrollmentStatus, ar.reports.columns.present, ar.reports.columns.late, ar.reports.columns.absent, ar.reports.columns.excused, ar.reports.columns.recorded, ar.reports.columns.attendanceRate, ar.reports.columns.absenceRate].join(',')}`,
      )
      expect(lines[1]).toBe(`'@SUM(1+1),ENG-A1-2026-1 — فصل الصباح,ENG-A1 — الإنجليزية — المستوى الأول,${ar.labels.active},6,1,3,0,10,70,30`)
      expect(lines[2]).toBe('الإجمالي (الصفوف: 1، الطلاب: 1),,,,6,1,3,0,10,70,30')
    } finally {
      // The object URL is let go in a timer after the click: wait for it before removing the stubs.
      await new Promise((resolve) => setTimeout(resolve, 10))
      delete (URL as { createObjectURL?: unknown }).createObjectURL
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('prints the report with every row on one table, then the pager comes back', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => makeAttendanceClassRow({ class: makeReportClass({ id: `class-${index}`, code: `C-${String(index).padStart(3, '0')}` }) }))
    mockReportsApi({ '/api/reports/attendance/classes': makeAttendanceClassesReport({ rows }) })
    let printedRows = 0
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      printedRows = bodyRows().length
    })
    renderReports('/reports?report=attendance-classes')
    await screen.findByText('C-000 — فصل الصباح')
    expect(bodyRows()).toHaveLength(100)
    await waitFor(() => expect(button(ar.reports.actions.print)).toBeEnabled())

    fireEvent.click(button(ar.reports.actions.print))
    expect(print).toHaveBeenCalledTimes(1)
    expect(printedRows).toBe(120)
    await waitFor(() => expect(bodyRows()).toHaveLength(100))
    // The printed filters line says what was asked.
    expect(screen.getByText(ar.reports.print.noFilters)).toHaveClass('report-print-only')
  })
})
