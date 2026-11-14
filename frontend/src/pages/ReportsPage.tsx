// Reports (MOD-13 — API-156..163, redesign 2026-11-14): a period in the academy's days and up to three tabs,
// each shown only to holders of its key (the server checks the same keys). A caller with none of the three keys
// gets a worded state and the page asks the server nothing. Every number is the server's; the page formats,
// exports (CSV, built here) and prints.
import { PrinterOutlined } from '@ant-design/icons'
import { Alert, Button, Result, Skeleton, Tabs } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReportPeriod } from '../api/reports'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useAcademyZone } from '../lessons/useAcademyZone'
import { AcademicTab } from '../reports/AcademicTab'
import { AttendanceTab } from '../reports/AttendanceTab'
import { FinancialTab } from '../reports/FinancialTab'
import type { ReportTab } from '../reports/reports.tabs'
import { visibleReportTabs } from '../reports/reports.tabs'
import { MAX_PERIOD_DAYS, defaultPeriod, periodProblem } from '../reports/reports.period'
import { calendarDateIn } from '../timetable/timetable.dates'
import '../dashboard/dashboard.css'
import '../reports/reports.css'

export function ReportsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const tabs = visibleReportTabs(hasPermission)

  if (!tabs.length) {
    return (
      <>
        <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
        <Result status="info" title={t('reports.noAccess.title')} subTitle={t('reports.noAccess.body')} />
      </>
    )
  }
  return <ReportsScreen tabs={tabs} />
}

function ReportsScreen({ tabs }: { tabs: ReportTab[] }) {
  const { t } = useTranslation()
  const zone = useAcademyZone()
  const [draft, setDraft] = useState<ReportPeriod | null>(null)
  const [active, setActive] = useState<ReportTab>(tabs[0])
  const period = draft ?? defaultPeriod(calendarDateIn(zone.timeZone))
  const problem = periodProblem(period)

  const picker = (
    <div className="rp-period rp-noprint">
      <label>
        <span>{t('reports.period.from')}</span>
        <input type="date" value={period.from} max={period.to || undefined} aria-invalid={problem !== null} onChange={(event) => setDraft({ ...period, from: event.target.value })} />
      </label>
      <label>
        <span>{t('reports.period.to')}</span>
        <input type="date" value={period.to} min={period.from || undefined} aria-invalid={problem !== null} onChange={(event) => setDraft({ ...period, to: event.target.value })} />
      </label>
      <Button onClick={() => setDraft(null)} disabled={draft === null}>
        {t('reports.period.reset')}
      </Button>
      <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
        {t('reports.print')}
      </Button>
    </div>
  )

  const content = (key: ReportTab) => {
    if (!zone.settled) return <Skeleton active paragraph={{ rows: 4 }} title={false} />
    if (problem) return null
    if (key === 'attendance') return <AttendanceTab period={period} />
    if (key === 'academic') return <AcademicTab period={period} />
    return <FinancialTab period={period} />
  }

  return (
    <div className="rp">
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} extra={picker} />
      <p className="rp-print-period">{t('reports.period.printed', { from: period.from, to: period.to })}</p>
      {problem ? <Alert className="rp-period-error" type="error" showIcon title={t(`reports.period.${problem}`, { max: MAX_PERIOD_DAYS })} /> : null}
      {zone.settled ? <p className="db-muted rp-note rp-noprint">{t('reports.period.zone', { zone: zone.timeZone })}</p> : null}
      <Tabs
        className="rp-tabs"
        activeKey={active}
        onChange={(key) => setActive(key as ReportTab)}
        destroyOnHidden
        items={tabs.map((key) => ({ key, label: t(`reports.tabs.${key}`), children: content(key) }))}
      />
    </div>
  )
}
