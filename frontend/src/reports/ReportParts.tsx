// The building blocks every report tab shares: a panel with its title and a CSV button, a table whose columns
// also write the CSV (so the file holds exactly the shown columns and rows), a rate bar, and the loading /
// error / truncated states of one read.
import { DownloadOutlined } from '@ant-design/icons'
import { Alert, Button, Skeleton, Table } from 'antd'
import type { TableProps } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Loaded } from '../dashboard/useLoad'
import { useLocalized } from '../i18n/useLocalized'
import type { ReportColumn } from './reports.csv'
import { downloadCsv, tableCsv } from './reports.csv'
import { reportFailureKey } from './reports.errors'
import { formatNumber, formatPercent } from './reports.format'

export type { ReportColumn } from './reports.csv'

export function ReportPanel({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="db-panel rp-panel">
      <header className="db-panel__head rp-panel__head">
        <h2>{title}</h2>
        {extra ? <div className="rp-panel__extra rp-noprint">{extra}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function CsvButton<T>({ fileName, columns, rows }: { fileName: string; columns: readonly ReportColumn<T>[]; rows: readonly T[] }) {
  const { t } = useTranslation()
  return (
    <Button size="small" icon={<DownloadOutlined />} disabled={rows.length === 0} onClick={() => downloadCsv(`${fileName}.csv`, tableCsv(columns, rows))}>
      {t('reports.csv')}
    </Button>
  )
}

export function ReportTable<T>({ columns, rows, rowKey, emptyText }: { columns: readonly ReportColumn<T>[]; rows: readonly T[]; rowKey: (row: T) => string; emptyText?: string }) {
  const { t } = useTranslation()
  const antdColumns: TableProps<T>['columns'] = columns.map((column) => ({
    key: column.key,
    title: column.title,
    align: column.numeric ? 'end' : undefined,
    render: (_: unknown, row: T) => (column.render ? column.render(row) : (column.value(row) ?? '—')),
  }))
  return (
    <Table<T>
      className="rp-table tabular-nums"
      size="small"
      columns={antdColumns}
      dataSource={rows as T[]}
      rowKey={rowKey}
      scroll={{ x: 'max-content' }}
      pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
      locale={{ emptyText: emptyText ?? t('reports.empty') }}
    />
  )
}

/** A table section: the panel, its CSV button and the table. */
export function ReportSection<T>(props: { title: string; fileName: string; columns: readonly ReportColumn<T>[]; rows: readonly T[]; rowKey: (row: T) => string; extra?: ReactNode; before?: ReactNode }) {
  return (
    <ReportPanel
      title={props.title}
      extra={
        <>
          {props.extra}
          <CsvButton fileName={props.fileName} columns={props.columns} rows={props.rows} />
        </>
      }
    >
      {props.before}
      <ReportTable columns={props.columns} rows={props.rows} rowKey={props.rowKey} />
    </ReportPanel>
  )
}

/** A percentage with a small bar; chalk yellow when below `lowBelow`. */
export function RateBar({ value, lowBelow }: { value: number | null; lowBelow?: number }) {
  const { language } = useLocalized()
  const low = value !== null && lowBelow !== undefined && value < lowBelow
  return (
    <span className={low ? 'rp-rate rp-rate--low' : 'rp-rate'}>
      <span className="rp-rate__bar" aria-hidden="true">
        <i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </span>
      <span className="rp-rate__value">{formatPercent(value, language)}</span>
    </span>
  )
}

export function Num({ value }: { value: number | null | undefined }) {
  const { language } = useLocalized()
  return <>{formatNumber(value, language)}</>
}

/** One report read: a skeleton while it runs, the mapped error, else the children and the truncated note. */
export function ReportLoad<T extends { truncated?: boolean }>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (loaded.loading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />
  if (loaded.error || loaded.data === null) return <Alert type="error" showIcon title={t(reportFailureKey(loaded.error))} />
  return (
    <>
      {loaded.data.truncated ? <Alert className="rp-truncated" type="info" showIcon title={t('reports.truncated', { max: '5,000' })} /> : null}
      {children(loaded.data)}
    </>
  )
}

/** A strip of headline numbers (the dashboard's KPI strip). */
export function KpiStrip({ cells }: { cells: Array<{ key: string; label: string; value: ReactNode; tone?: 'bad' | 'mark' }> }) {
  return (
    <div className="db-kpis rp-kpis tabular-nums">
      {cells.map((cell) => (
        <div key={cell.key}>
          <b className={cell.tone === 'bad' ? 'db-bad' : cell.tone === 'mark' ? 'rp-mark' : undefined}>{cell.value}</b>
          <small>{cell.label}</small>
        </div>
      ))}
    </div>
  )
}
