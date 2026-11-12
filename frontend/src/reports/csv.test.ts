import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSV_BOM, CSV_MIME_TYPE, buildCsv, csvCell, csvLine, downloadCsv } from './csv'

describe('csvCell — the formula-injection guard (D-R71)', () => {
  it('prefixes a text that starts with =, +, -, @ (or a tab or carriage return) with an apostrophe', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvCell('+966500000000')).toBe("'+966500000000")
    expect(csvCell('-2+3')).toBe("'-2+3")
    expect(csvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)")
    expect(csvCell('\tcmd')).toBe("'\tcmd")
    // A carriage return also needs the quotes.
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`)
  })

  it('leaves other texts alone, a sign inside a text included', () => {
    expect(csvCell('سارة أحمد')).toBe('سارة أحمد')
    expect(csvCell('ENG-A1 — الإنجليزية')).toBe('ENG-A1 — الإنجليزية')
    expect(csvCell('a=b')).toBe('a=b')
  })

  it('writes numbers unformatted and never guards them; nothing is an empty cell', () => {
    expect(csvCell(31500.5)).toBe('31500.5')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes a text holding a comma, a quote, a line break or spaces at either end (RFC 4180), doubling inner quotes', () => {
    expect(csvCell('B — جيد جداً: 7, C — جيد: 2')).toBe('"B — جيد جداً: 7, C — جيد: 2"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(' padded ')).toBe('" padded "')
    expect(csvLine(['a', 1, null, '=x'])).toBe("a,1,,'=x")
  })
})

describe('buildCsv', () => {
  it('starts with the UTF-8 BOM, ends lines with CRLF and puts blocks apart by an empty line, a title only when given', () => {
    const csv = buildCsv([
      { title: null, header: ['الفصل', 'نسبة الحضور'], rows: [['ENG-A1-2026-1', 87.5], ['الإجمالي', 90]] },
      { title: 'حسب الدورة', header: ['الدورة'], rows: [['=evil']] },
    ])
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv).toBe(`${CSV_BOM}الفصل,نسبة الحضور\r\nENG-A1-2026-1,87.5\r\nالإجمالي,90\r\n\r\nحسب الدورة\r\nالدورة\r\n'=evil\r\n`)
  })
})

describe('downloadCsv', () => {
  const realCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const realRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

  afterEach(() => {
    if (realCreate) Object.defineProperty(URL, 'createObjectURL', realCreate)
    else delete (URL as { createObjectURL?: unknown }).createObjectURL
    if (realRevoke) Object.defineProperty(URL, 'revokeObjectURL', realRevoke)
    else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
    vi.useRealTimers()
  })

  it('saves the content through a temporary Blob link named after the file, then lets the object URL go', async () => {
    vi.useFakeTimers()
    const blobs: Blob[] = []
    const create = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:report-1'
    })
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke })
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    downloadCsv('attendance-classes_2026-10-13_2026-11-11.csv', `${CSV_BOM}الفصل\r\n`)

    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.download).toBe('attendance-classes_2026-10-13_2026-11-11.csv')
    expect(clicked[0]!.getAttribute('href')).toBe('blob:report-1')
    // The link leaves the page at once; the URL is revoked after the click has handed the file over.
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:report-1')

    expect(blobs[0]!.type).toBe(CSV_MIME_TYPE)
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer())
    // UTF-8 BOM, so Excel reads the Arabic text as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })
})
