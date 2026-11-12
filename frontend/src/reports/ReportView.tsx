// One report of the /reports page (J-F53, MOD-13-T06): its filters, the
// server's period / zone / time line, a notice when the rows were cut at
// 5,000 (D-R72), and its tables — the server's rows and totals as they are.
// The screen writes the CSV and prints (D-R71): both follow the visible tables,
// and both wait until the shown answer is the one the current filters asked for.
import { ArrowLeftOutlined, ArrowRightOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Flex, Select, Space, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { REPORT_ROW_CAP } from '../api/reports'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { academyZoneOf, formatLessonDateTime, todayIn } from '../lessons/lessons.format'
import { formatDay } from '../users/users.format'
import { buildCsv, downloadCsv } from './csv'
import { ReportFilterBar } from './ReportFilterBar'
import { ReportTable } from './ReportTable'
import { reportFileName, reportMetaOf } from './reports.catalog'
import type { ReportDefinition, ReportFilters, ReportKey, ReportMeta } from './reports.catalog'
import { describeReportsFailure, failureMessage } from './reports.errors'
import { formatNumber } from './reports.format'
import { hasFilterIssues, reportFilterIssues } from './reports.period'
import { csvBlocksOf, filtersSummary, reportSections } from './reports.sections'
import { useReport } from './useReport'
import './reports.css'

interface ReportViewProps {
  report: ReportDefinition
  /** The reports the caller may open, for the switcher. */
  available: readonly ReportDefinition[]
  filters: ReportFilters
  onFiltersChange: (next: ReportFilters) => void
  onSelect: (key: ReportKey) => void
}

function MetaLine({ meta }: { meta: ReportMeta }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const when = meta.period
    ? t('reports.meta.period', { from: formatDay(meta.period.from, language), to: formatDay(meta.period.to, language) })
    : t('reports.meta.asOf', { date: formatDay(meta.asOf, language) })
  const parts = [when, t('reports.meta.zone', { zone: meta.timeZone }), t('reports.meta.generatedAt', { time: formatLessonDateTime(meta.generatedAt, language, meta.timeZone) })]
  return (
    <Typography.Paragraph type="secondary" className="report-meta" data-testid="report-meta">
      {parts.join(' · ')}
    </Typography.Paragraph>
  )
}

export function ReportView({ report, available, filters, onFiltersChange, onSelect }: ReportViewProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const { academy } = useAcademy()
  const [printing, setPrinting] = useState(false)

  // «Today» of the period rule is the academy's (D-R69); without its zone the one-sided check is the server's alone.
  const zone = academyZoneOf(academy)
  const today = zone.source === 'academy' ? todayIn(zone.timeZone) : null
  const issues = reportFilterIssues(report, filters, today)
  const state = useReport(report.key, filters, !hasFilterIssues(issues))

  // A print from the browser's own menu shows every row too, not the page the pager is on.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const loaded = state.report
  const meta = loaded ? reportMetaOf(loaded) : null
  const sections = loaded ? reportSections(loaded, { t, language }) : []
  const context = { language, timeZone: meta?.timeZone ?? zone.timeZone }
  const failure = state.error ? describeReportsFailure(state.error) : null
  // The file and the paper carry the answer to the current filters only — not one still loading, refused or held back.
  const current = loaded !== null && !state.loading && !failure && !hasFilterIssues(issues)
  const summary = filtersSummary(report, filters, t)

  const exportCsv = () => {
    if (!loaded || !meta) return
    downloadCsv(reportFileName(loaded.key, meta), buildCsv(csvBlocksOf(sections, meta.timeZone)))
  }

  const print = () => {
    flushSync(() => setPrinting(true))
    window.print()
    setPrinting(false)
  }

  return (
    <Card className="report-print">
      <Flex className="report-no-print" justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Space wrap>
          <Link to="/reports">
            {/* «Back» points to where a line starts: the right in Arabic. */}
            {language === 'ar' ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} {t('reports.back')}
          </Link>
          <Select<ReportKey>
            aria-label={t('reports.picker')}
            value={report.key}
            onChange={onSelect}
            options={available.map((item) => ({ value: item.key, label: t(`reports.catalog.${item.i18nId}.name`) }))}
            style={{ minWidth: 240 }}
          />
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={state.reload} disabled={state.path === null} loading={state.loading}>
            {t('reports.actions.refresh')}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!current}>
            {t('reports.actions.exportCsv')}
          </Button>
          <Button icon={<PrinterOutlined />} onClick={print} disabled={!current}>
            {t('reports.actions.print')}
          </Button>
        </Space>
      </Flex>

      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t(`reports.catalog.${report.i18nId}.name`)}
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="report-no-print">
        {t(`reports.catalog.${report.i18nId}.description`)}
      </Typography.Paragraph>

      <ReportFilterBar
        report={report}
        filters={filters}
        issues={issues}
        onChange={onFiltersChange}
        canPickCourse={hasPermission('courses.read')}
        canPickClass={hasPermission('classes.read')}
      />

      {meta ? <MetaLine meta={meta} /> : null}
      <Typography.Paragraph className="report-print-only">
        {summary.length > 0 ? t('reports.print.filters', { list: summary.join(' · ') }) : t('reports.print.noFilters')}
      </Typography.Paragraph>

      {meta?.truncated ? (
        <Alert type="warning" showIcon title={t('reports.truncated', { cap: formatNumber(REPORT_ROW_CAP, language) })} style={{ marginBottom: 16 }} />
      ) : null}
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={state.reload}>
              {t('reports.actions.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {loaded ? (
        sections.map((section) => <ReportTable key={section.key} section={section} context={context} loading={state.loading} printing={printing} />)
      ) : state.loading ? (
        <Flex justify="center" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      ) : null}
    </Card>
  )
}
