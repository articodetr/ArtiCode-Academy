// The CSV export of a report table (D-R71: the server answers JSON only; the screen writes the file). UTF-8 with a
// byte-order mark so Excel opens Arabic text, CRLF line ends (RFC 4180), the shown columns under their titles in
// the UI language, raw numbers. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
// leading `'` so a spreadsheet reads it as text, never as a formula. Pure but for downloadCsv().

import type { ReactNode } from 'react'

export const CSV_BOM = '﻿'
const LINE_END = '\r\n'
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

export type CsvValue = string | number | null | undefined

/** A report table's column: its title, its CSV cell and, unless `render` is given, its shown cell. */
export interface ReportColumn<T> {
  key: string
  title: string
  value: (row: T) => CsvValue
  render?: (row: T) => ReactNode
  /** Numbers are aligned to the end of the cell. */
  numeric?: boolean
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The whole file: the BOM, the header line, then one line per row. */
export function buildCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return CSV_BOM + [header, ...rows].map((cells) => cells.map(csvCell).join(',')).join(LINE_END) + LINE_END
}

/** The CSV of a table: its column titles, then one line per row, exactly the given columns and rows. */
export function tableCsv<T>(columns: readonly ReportColumn<T>[], rows: readonly T[]): string {
  return buildCsv(
    columns.map((column) => column.title),
    rows.map((row) => columns.map((column) => column.value(row))),
  )
}

/** Saves `content` through a temporary Blob link; nothing goes to the server. */
export function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
