// Financial (reports.financial.view): API-161 collections per month × method with a bar per month and totals per
// currency, API-162 receivables now (aging bar like the dashboard, per-student rows, an «overdue only» switch
// the server applies), API-163 revenue per course × month. Amounts are the server's, per currency — never summed
// across currencies.
import { Empty, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionRow, ReceivableRow, ReportPeriod, RevenueRow } from '../api/reports'
import { getCollections, getReceivables, getRevenue } from '../api/reports'
import { formatMoney, labelIn } from '../dashboard/dashboard.data'
import { useLoad } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay } from '../users/users.format'
import type { ReportColumn } from './ReportParts'
import { KpiStrip, ReportLoad, ReportPanel, ReportSection } from './ReportParts'
import { formatMonth, namedCode, studentName } from './reports.format'
import { monthsOf } from './reports.period'

export function FinancialTab({ period }: { period: ReportPeriod }) {
  return (
    <div className="db-stack">
      <CollectionsView period={period} />
      <ReceivablesView />
      <RevenueView period={period} />
    </div>
  )
}

function suffixOf(period: ReportPeriod) {
  return `${period.from}_${period.to}`
}

function CollectionsView({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const loaded = useLoad(`financial:collections:${period.from}:${period.to}`, true, (signal) => getCollections(period, signal))
  const months = monthsOf(period)
  const columns: ReportColumn<CollectionRow>[] = [
    { key: 'month', title: t('reports.columns.month'), value: (row) => row.month, render: (row) => formatMonth(row.month, language) },
    { key: 'method', title: t('reports.columns.method'), value: (row) => t(`reports.methods.${row.method}`, { defaultValue: row.method }) },
    { key: 'payments', title: t('reports.columns.payments'), numeric: true, value: (row) => row.payments },
    { key: 'currency', title: t('reports.columns.currency'), value: (row) => row.currency },
    { key: 'amount', title: t('reports.columns.amount'), numeric: true, value: (row) => row.amount, render: (row) => formatMoney(row.amount, row.currency, language) },
  ]
  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <>
          <KpiStrip
            cells={
              report.totals.length
                ? report.totals.flatMap((total) => [
                    { key: `collected:${total.currency}`, label: t('reports.financial.collected', { currency: total.currency }), value: formatMoney(total.amount, total.currency, language) },
                    { key: `payments:${total.currency}`, label: t('reports.financial.payments'), value: String(total.payments) },
                    ...(total.reversedPayments > 0
                      ? [{ key: `reversed:${total.currency}`, label: t('reports.financial.reversed', { count: total.reversedPayments }), value: formatMoney(total.reversedAmount, total.currency, language), tone: 'bad' as const }]
                      : []),
                  ])
                : [{ key: 'none', label: t('reports.financial.collectedNone'), value: '0' }]
            }
          />
          <ReportPanel title={t('reports.financial.byMonth')}>
            {report.totals.length ? (
              report.totals.map((total) => {
                const sums = months.map((month) => report.rows.filter((row) => row.month === month && row.currency === total.currency).reduce((sum, row) => sum + row.amount, 0))
                const top = Math.max(1, ...sums)
                return (
                  <div key={total.currency} className="db-chart rp-chart tabular-nums" role="img" aria-label={t('reports.financial.byMonthOf', { currency: total.currency })}>
                    {months.map((month, index) => (
                      <div key={month} className="db-chart__col">
                        <small>{formatMoney(sums[index], total.currency, language)}</small>
                        <i style={{ height: `${Math.max(2, (sums[index] / top) * 100)}%` }} />
                        <span>{formatMonth(month, language)}</span>
                      </div>
                    ))}
                  </div>
                )
              })
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reports.financial.collectedNone')} />
            )}
          </ReportPanel>
          <ReportSection title={t('reports.financial.collections')} fileName={`collections_${suffixOf(period)}`} columns={columns} rows={report.rows} rowKey={(row) => `${row.month}:${row.method}:${row.currency}`} />
        </>
      )}
    </ReportLoad>
  )
}

function ReceivablesView() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [overdueOnly, setOverdueOnly] = useState(false)
  const loaded = useLoad(`financial:receivables:${overdueOnly}`, true, (signal) => getReceivables(overdueOnly, signal))
  const columns: ReportColumn<ReceivableRow>[] = [
    { key: 'student', title: t('reports.columns.student'), value: (row) => studentName(row.student) },
    { key: 'invoices', title: t('reports.columns.invoices'), numeric: true, value: (row) => row.invoices },
    { key: 'currency', title: t('reports.columns.currency'), value: (row) => row.currency },
    { key: 'total', title: t('reports.columns.total'), numeric: true, value: (row) => row.total, render: (row) => formatMoney(row.total, row.currency, language) },
    { key: 'paid', title: t('reports.columns.paid'), numeric: true, value: (row) => row.paid, render: (row) => formatMoney(row.paid, row.currency, language) },
    { key: 'balance', title: t('reports.columns.balance'), numeric: true, value: (row) => row.balance, render: (row) => formatMoney(row.balance, row.currency, language) },
    {
      key: 'overdue',
      title: t('reports.columns.overdue'),
      numeric: true,
      value: (row) => row.overdue,
      render: (row) => <span className={row.overdue > 0 ? 'db-bad' : undefined}>{formatMoney(row.overdue, row.currency, language)}</span>,
    },
    { key: 'oldest', title: t('reports.columns.oldestDue'), value: (row) => row.oldestOverdueDueOn, render: (row) => (row.oldestOverdueDueOn ? formatDay(row.oldestOverdueDueOn, language) : '—') },
    {
      key: 'days',
      title: t('reports.columns.daysOverdue'),
      numeric: true,
      value: (row) => row.daysOverdue,
      render: (row) => (row.daysOverdue ? <span className={row.daysOverdue > 60 ? 'db-pill db-pill--bad' : 'db-pill'}>{t('reports.financial.days', { days: row.daysOverdue })}</span> : '—'),
    },
  ]
  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <>
          <ReportPanel title={t('reports.financial.aging', { date: formatDay(report.asOf, language) })}>
            {report.totals.length ? (
              report.totals.map((total) => {
                const parts = [
                  ['aging1', total.aging.days1To30, 'db-age1'],
                  ['aging2', total.aging.days31To60, 'db-age2'],
                  ['aging3', total.aging.days61To90, 'db-age3'],
                  ['aging4', total.aging.days91Plus, 'db-age4'],
                ] as const
                return (
                  <div key={total.currency} className="rp-aging">
                    <KpiStrip
                      cells={[
                        { key: 'balance', label: t('reports.financial.outstanding', { currency: total.currency }), value: formatMoney(total.balance, total.currency, language) },
                        { key: 'overdue', label: t('reports.financial.overdue'), value: formatMoney(total.overdue, total.currency, language), tone: total.overdue > 0 ? 'bad' : undefined },
                        { key: 'students', label: t('reports.financial.students'), value: String(total.students) },
                      ]}
                    />
                    {total.overdue > 0 ? (
                      <>
                        <div className="db-aging" aria-hidden="true">
                          {parts.map(([key, amount, tone]) => (amount > 0 ? <i key={key} className={tone} style={{ flexGrow: amount }} /> : null))}
                        </div>
                        <ul className="db-legend tabular-nums">
                          {parts.map(([key, amount, tone]) => (
                            <li key={key}>
                              <i className={tone} />
                              {t(`reports.financial.${key}`)}: {formatMoney(amount, total.currency, language)}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="db-clear">{t('reports.financial.noOverdue')}</p>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="db-clear">{t('reports.financial.noReceivables')}</p>
            )}
          </ReportPanel>
          <ReportSection
            title={t('reports.financial.receivables')}
            fileName={`receivables_${report.asOf}${overdueOnly ? '_overdue' : ''}`}
            columns={columns}
            rows={report.rows}
            rowKey={(row) => `${row.student.id}:${row.currency}`}
            extra={
              <label className="rp-switch">
                <Switch size="small" checked={overdueOnly} onChange={setOverdueOnly} />
                {t('reports.financial.overdueOnly')}
              </label>
            }
          />
        </>
      )}
    </ReportLoad>
  )
}

function RevenueView({ period }: { period: ReportPeriod }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const loaded = useLoad(`financial:revenue:${period.from}:${period.to}`, true, (signal) => getRevenue(period, signal))
  const columns: ReportColumn<RevenueRow>[] = [
    { key: 'course', title: t('reports.columns.course'), value: (row) => (row.course ? namedCode(row.course, language) : t('reports.financial.noCourse')), render: (row) => (row.course ? labelIn(row.course.name, language) : <span className="db-muted">{t('reports.financial.noCourse')}</span>) },
    { key: 'month', title: t('reports.columns.month'), value: (row) => row.month, render: (row) => formatMonth(row.month, language) },
    { key: 'currency', title: t('reports.columns.currency'), value: (row) => row.currency },
    { key: 'invoices', title: t('reports.columns.invoices'), numeric: true, value: (row) => row.invoices },
    { key: 'invoiced', title: t('reports.columns.invoiced'), numeric: true, value: (row) => row.invoiced, render: (row) => formatMoney(row.invoiced, row.currency, language) },
    { key: 'discounts', title: t('reports.columns.discounts'), numeric: true, value: (row) => row.discounts, render: (row) => formatMoney(row.discounts, row.currency, language) },
    { key: 'collected', title: t('reports.columns.collected'), numeric: true, value: (row) => row.collected, render: (row) => formatMoney(row.collected, row.currency, language) },
    {
      key: 'share',
      title: t('reports.columns.collectedShare'),
      value: (row) => (row.invoiced > 0 ? Math.round((row.collected / row.invoiced) * 10000) / 100 : null),
      render: (row) => (
        <span className="rp-pair" aria-hidden="true">
          <i className="rp-pair__invoiced" style={{ width: '100%' }} />
          <i className="rp-pair__collected" style={{ width: `${row.invoiced > 0 ? Math.min(100, (row.collected / row.invoiced) * 100) : row.collected > 0 ? 100 : 0}%` }} />
        </span>
      ),
    },
  ]
  return (
    <ReportLoad loaded={loaded}>
      {(report) => (
        <ReportSection
          title={t('reports.financial.revenue')}
          fileName={`revenue_${suffixOf(period)}`}
          columns={columns}
          rows={report.rows}
          rowKey={(row) => `${row.course?.id ?? 'none'}:${row.month}:${row.currency}`}
          before={
            report.totals.length ? (
              <KpiStrip
                cells={report.totals.flatMap((total) => [
                  { key: `invoiced:${total.currency}`, label: t('reports.financial.invoiced', { currency: total.currency }), value: formatMoney(total.invoiced, total.currency, language) },
                  { key: `collected:${total.currency}`, label: t('reports.financial.collectedOf', { currency: total.currency }), value: formatMoney(total.collected, total.currency, language) },
                  { key: `discounts:${total.currency}`, label: t('reports.financial.discounts'), value: formatMoney(total.discounts, total.currency, language) },
                ])}
              />
            ) : null
          }
        />
      )}
    </ReportLoad>
  )
}
