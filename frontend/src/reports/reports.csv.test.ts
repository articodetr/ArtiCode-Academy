import { describe, expect, it } from 'vitest'
import type { AttendanceClassRow } from '../api/reports'
import { makeAttendanceClasses } from '../test/reports'
import type { ReportColumn } from './reports.csv'
import { CSV_BOM, buildCsv, csvCell, tableCsv } from './reports.csv'

describe('reports.csv', () => {
  it('quotes separators and quotes, guards formulas, writes numbers raw and nothing as empty', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell(87.5)).toBe('87.5')
    expect(csvCell(null)).toBe('')
  })

  it('starts with the UTF-8 BOM and ends lines with CRLF', () => {
    expect(buildCsv(['أ', 'ب'], [[1, 'ج']])).toBe(`${CSV_BOM}أ,ب\r\n1,ج\r\n`)
  })

  it('writes exactly the columns and rows of a table', () => {
    const columns: ReportColumn<AttendanceClassRow>[] = [
      { key: 'class', title: 'الفصل', value: (row) => `${row.class.name.ar} (${row.class.code})` },
      { key: 'lessons', title: 'الدروس', value: (row) => row.lessons },
      { key: 'rate', title: 'نسبة الحضور', value: (row) => row.attendanceRate },
    ]
    const rows = makeAttendanceClasses().rows
    expect(tableCsv(columns, rows)).toBe(`${CSV_BOM}الفصل,الدروس,نسبة الحضور\r\nبايثون أ (PY-A),4,70\r\n`)
  })
})
