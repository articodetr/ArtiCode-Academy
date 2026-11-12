// The CSV export of a report (MOD-13-T06 — J-F53, D-R71): the server answers
// JSON only and the screen writes the file — UTF-8 with a byte-order mark so
// Excel opens Arabic text correctly, CRLF line ends (RFC 4180), the visible
// columns under their titles in the UI language, numbers unformatted, and the
// formula-injection guard: a text cell that starts with `=`, `+`, `-` or `@` (or
// a tab or a carriage return, which spreadsheets treat the same way) gets a
// leading `'`, so a name or a code typed as `=HYPERLINK(…)` is read as text. A
// number is never guarded — its digits cannot carry a formula, and no report
// sends a negative one. Downloaded through a Blob link; nothing is sent to the
// server. Pure but for downloadCsv(); unit-tested in csv.test.ts.

/** The UTF-8 byte-order mark Excel needs to read the file as UTF-8. */
export const CSV_BOM = '﻿'
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8'

const LINE_END = '\r\n'
/** The first characters a spreadsheet may read as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/
/** A cell that needs quotes: a separator, a quote or a line break inside, or spaces at either end. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

export type CsvValue = string | number | null | undefined

/** One cell: a finite number as is, a text guarded against formulas and quoted when needed, nothing as an empty cell. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function csvLine(cells: readonly CsvValue[]): string {
  return cells.map(csvCell).join(',')
}

/** One table of the file: an optional title line, the header line, then the rows (totals included). */
export interface CsvBlock {
  title: string | null
  header: readonly string[]
  rows: readonly (readonly CsvValue[])[]
}

/** The whole file: the BOM, then each block, blocks apart by an empty line. */
export function buildCsv(blocks: readonly CsvBlock[]): string {
  const text = blocks
    .map((block) => [...(block.title ? [csvLine([block.title])] : []), csvLine(block.header), ...block.rows.map(csvLine)].join(LINE_END))
    .join(LINE_END + LINE_END)
  return `${CSV_BOM}${text}${LINE_END}`
}

/** Saves `content` as a file through a temporary Blob link (no request to the server). */
export function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: CSV_MIME_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked once the click has handed the file to the browser; revoking at once can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
