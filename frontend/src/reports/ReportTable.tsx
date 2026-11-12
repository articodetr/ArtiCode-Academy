// One table of a report (J-F53): the section's columns, one row per server row
// in the server's order, and the server's totals as summary lines at the foot
// of every page (reports.sections.ts builds them — nothing is computed here).
// Up to 5,000 rows come at once (D-R72), so the screen pages them locally; a
// print (`printing`) shows every row on one long table.
import { Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { formatCell, isNumericKind } from './reports.format'
import type { FormatContext } from './reports.format'
import type { ReportSection, SectionColumn, SectionRow } from './reports.sections'

const PAGE_SIZES = [50, 100, 200, 500]

interface ReportTableProps {
  section: ReportSection
  context: FormatContext
  loading: boolean
  printing: boolean
}

function cellClass(column: SectionColumn): string | undefined {
  return isNumericKind(column.kind) ? 'report-cell report-cell--number' : 'report-cell'
}

export function ReportTable({ section, context, loading, printing }: ReportTableProps) {
  const columns: TableProps<SectionRow>['columns'] = section.columns.map((column) => ({
    key: column.key,
    title: column.title,
    className: cellClass(column),
    render: (_: unknown, row: SectionRow) => formatCell(column.kind, row.cells[column.key] ?? null, context),
  }))

  return (
    <section className="report-section" aria-label={section.title ?? undefined}>
      {section.title ? (
        <Typography.Title level={5} style={{ marginTop: 16 }}>
          {section.title}
        </Typography.Title>
      ) : null}
      <Table<SectionRow>
        rowKey="key"
        size="small"
        bordered
        columns={columns}
        dataSource={section.rows}
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: section.emptyText }}
        pagination={printing ? false : { defaultPageSize: 100, pageSizeOptions: PAGE_SIZES, showSizeChanger: true, hideOnSinglePage: true }}
        summary={() =>
          section.totals.length > 0 ? (
            <Table.Summary>
              {section.totals.map((line) => (
                <Table.Summary.Row key={line.key} className="report-totals">
                  {section.columns.map((column, index) => {
                    // A column without a total stays blank; a null total (no denominator) is a dash, as in the rows.
                    const value = line.cells[column.key]
                    return (
                      <Table.Summary.Cell key={column.key} index={index} className={cellClass(column)}>
                        {value === undefined ? null : <Typography.Text strong>{formatCell(column.kind, value, context)}</Typography.Text>}
                      </Table.Summary.Cell>
                    )
                  })}
                </Table.Summary.Row>
              ))}
            </Table.Summary>
          ) : null
        }
      />
    </section>
  )
}
