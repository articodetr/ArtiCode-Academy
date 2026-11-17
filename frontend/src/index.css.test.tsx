// The `.list-primary` cell of index.css: a main line and a muted second line (KI-108). jsdom applies no stylesheet and
// Vitest blanks imported CSS, so this reads the muting selectors from the file's text and checks them against the
// cells the real screens render: the first line of every cell — an invoice or receipt number in its <bdi> — is never
// muted, every later line is. `.list-primary bdi` once muted the main number of every payments row.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PaymentsPage } from './pages/PaymentsPage'
import { ReportsPage } from './pages/ReportsPage'
import { makeAcademy } from './test/academy'
import { jsonResponse, mockFetch } from './test/http'
import { CASHIER_PERMISSIONS, INVOICE_ID, makeInvoice, makeInvoiceSummary, makeMyInvoice, makePayment } from './test/payments'
import { makeAuth, makeUser, renderWithProviders } from './test/render'
import { makeAttendanceClasses, makeAttendanceStudents } from './test/reports'

/** A file of src/ read from disk: vitest empties every `.css` import, `?raw` included. */
async function readSource(path: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  // A variable, not a literal: Vite rewrites `new URL('./index.css', import.meta.url)` into the asset's served URL.
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8')
}

const indexCss = () => readSource('./index.css')

/** The selectors of index.css that mute a `.list-primary` line, as one selector list. */
async function mutedSelectors(): Promise<string> {
  const css = (await indexCss()).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => rule[1]!.includes('.list-primary') && rule[2]!.includes('var(--c-muted)'))
  return rules.flatMap((rule) => rule[1]!.split(',').map((selector) => selector.trim())).join(', ')
}

/** Every `.list-primary` cell on screen keeps its first line in full colour and mutes the lines after it. */
async function expectMainLinesUnmuted(mainTexts: string[]) {
  const muted = await mutedSelectors()
  expect(muted).toContain('.list-primary')
  const cells = [...document.querySelectorAll<HTMLElement>('.list-primary')]
  expect(cells.length).toBeGreaterThan(0)
  for (const cell of cells) {
    const [main, ...rest] = [...cell.children]
    expect(main).toBeDefined()
    for (const element of [main!, ...main!.querySelectorAll('*')]) expect(element.matches(muted), `${cell.innerHTML}: ${element.outerHTML}`).toBe(false)
    for (const line of rest) expect(line.matches(muted), `${cell.innerHTML}: ${line.outerHTML}`).toBe(true)
  }
  // The main numbers named by the test are among those first lines.
  const firstLines = cells.map((cell) => cell.firstElementChild?.textContent ?? '')
  for (const text of mainTexts) expect(firstLines).toContain(text)
}

function mockPaymentsApi() {
  mockFetch((url, init) => {
    const { pathname } = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/invoices' && method === 'GET') return jsonResponse(200, { items: [makeInvoiceSummary()], nextCursor: null })
    if (pathname === `/api/invoices/${INVOICE_ID}`) return jsonResponse(200, makeInvoice())
    if (pathname === '/api/payments') return jsonResponse(200, { items: [makePayment()], nextCursor: null })
    if (pathname === '/api/me/invoices') return jsonResponse(200, { items: [makeMyInvoice()] })
    return jsonResponse(404, { statusCode: 404, message: `unexpected ${pathname}` })
  })
}

function renderPayments(permissions: string[], roles: string[], route = '/payments') {
  return renderWithProviders(<PaymentsPage />, { auth: makeAuth({ user: makeUser({ permissions, roles }) }), route })
}

describe('index.css — the main line of a .list-primary cell keeps its colour (KI-108)', () => {
  it('the office invoices list and the invoice drawer: the invoice and receipt numbers are not muted, the class and the time under them are', async () => {
    mockPaymentsApi()
    renderPayments(CASHIER_PERMISSIONS, ['staff'])
    fireEvent.click(await screen.findByText('INV-2026-00057'))
    await screen.findByText('RCPT-2026-00031')
    await expectMainLinesUnmuted(['INV-2026-00057', 'RCPT-2026-00031'])
  })

  it('the recorded payments list: the receipt number is not muted, its time is', async () => {
    mockPaymentsApi()
    renderPayments(['payments.record'], ['staff'], '/payments?tab=payments')
    await screen.findByText('RCPT-2026-00032')
    await expectMainLinesUnmuted(['RCPT-2026-00032'])
  })

  it('«my invoices»: the invoice number is not muted, the class under it is', async () => {
    mockPaymentsApi()
    renderPayments(['invoices.read_own'], ['student'])
    await screen.findByText('INV-2026-00057')
    await expectMainLinesUnmuted(['INV-2026-00057'])
  })

  it('the attendance report still mutes a class code written as a <bdi> under the class name', async () => {
    mockFetch((url) => {
      const { pathname } = new URL(url, 'http://localhost')
      if (pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
      if (pathname === '/api/reports/attendance/classes') return jsonResponse(200, makeAttendanceClasses())
      if (pathname === '/api/reports/attendance/students') return jsonResponse(200, makeAttendanceStudents())
      return jsonResponse(404, { statusCode: 404, message: `unexpected ${pathname}` })
    })
    renderWithProviders(<ReportsPage />, { auth: makeAuth({ user: makeUser({ permissions: ['reports.attendance.view'] }) }), route: '/reports' })
    await screen.findAllByText('PY-A')
    await expectMainLinesUnmuted([])
    const code = [...document.querySelectorAll('.list-primary > bdi')].find((element) => element.textContent === 'PY-A')
    expect(code).toBeDefined()
    expect(code!.matches(await mutedSelectors())).toBe(true)
  })
})
