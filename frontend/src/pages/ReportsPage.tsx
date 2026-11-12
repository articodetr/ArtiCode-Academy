// Reports (MOD-13-T06 — J-F53): the eight read-only reports of API-156..API-163
// for a holder of their keys (D-R68 — the `reports` entry and its route open
// with any of the three). Without `?report=` the page lists the reports the
// caller's keys open; with it, it shows that one (the address is the link to
// share or bookmark). An unknown report, or one the caller's keys do not open,
// is said above the list — no request is sent for it. One set of filters is
// kept for the visit, so a period chosen for one report carries over to the
// next; the server is the security boundary.
import { Alert } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { ReportView } from '../reports/ReportView'
import { ReportsIndex } from '../reports/ReportsIndex'
import { EMPTY_REPORT_FILTERS, availableReports, reportDefinitionOf } from '../reports/reports.catalog'
import type { ReportFilters, ReportKey } from '../reports/reports.catalog'

export function ReportsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS)

  const available = availableReports(user?.permissions ?? [])
  const requested = params.get('report')
  const definition = reportDefinitionOf(requested)
  const selected = definition && available.some((report) => report.key === definition.key) ? definition : null

  // The course and class pickers name a choice only while they stay mounted: back on the list, the chosen ones are
  // dropped (the period and the other filters stay). Reset during render — oxlint refuses the effect form.
  if (!selected && (filters.courseId || filters.classId)) {
    setFilters({ ...filters, courseId: undefined, courseLabel: undefined, classId: undefined, classLabel: undefined })
  }

  const select = (key: ReportKey) => setParams({ report: key })

  return (
    <>
      <div className="report-no-print">
        <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      </div>
      {selected ? (
        <ReportView report={selected} available={available} filters={filters} onFiltersChange={setFilters} onSelect={select} />
      ) : (
        <>
          {requested !== null ? (
            <Alert type="warning" showIcon title={t(definition ? 'reports.forbiddenReport' : 'reports.unknownReport')} style={{ marginBottom: 16 }} />
          ) : null}
          <ReportsIndex reports={available} />
        </>
      )}
    </>
  )
}
