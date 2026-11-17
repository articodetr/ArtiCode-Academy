// The month bars of the financial tab (API-161). jsdom lays nothing out, so this checks the configuration that leaves
// room for the amount above the tallest bar: each bar carries its share as `--rp-bar` (no inline height that would
// fill the whole column), and reports.css turns the share into a height less the room of the two labels.
import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeCollections, makeReceivables, makeRevenue } from '../test/reports'
import { FinancialTab } from './FinancialTab'

/** A file beside this test, read from disk: vitest empties every `.css` import, `?raw` included. */
async function readBeside(name: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  return fs.readFileSync(new URL(name, import.meta.url), 'utf8')
}

describe('FinancialTab — the collections per month', () => {
  it('gives each bar its share of the tallest month and leaves the height to reports.css, which keeps room for the amount', async () => {
    mockFetch((url) => {
      const { pathname } = new URL(url, 'http://localhost')
      if (pathname === '/api/reports/financial/collections') return jsonResponse(200, makeCollections())
      if (pathname === '/api/reports/financial/receivables') return jsonResponse(200, makeReceivables())
      if (pathname === '/api/reports/financial/revenue') return jsonResponse(200, makeRevenue())
      return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
    })
    const { container } = renderWithProviders(<FinancialTab period={{ from: '2026-10-01', to: '2026-11-30' }} />, {
      auth: makeAuth({ user: makeUser({ permissions: ['reports.financial.view'] }) }),
    })
    const bars = () => [...container.querySelectorAll<HTMLElement>('.rp-chart .db-chart__col > i')]
    await waitFor(() => expect(bars()).toHaveLength(2))
    // October 900, November 1500 (the tallest).
    expect(bars().map((bar) => bar.style.getPropertyValue('--rp-bar'))).toEqual(['0.6', '1'])
    expect(bars().map((bar) => bar.style.height)).toEqual(['', ''])

    const css = (await readBeside('./reports.css')).replace(/\s+/g, ' ')
    expect(css).toContain('.rp-chart .db-chart__col i { height: calc((100% - var(--rp-chart-labels)) * var(--rp-bar, 0));')
    expect(css).toContain('.rp-chart .db-chart__col small, .rp-chart .db-chart__col span { flex-shrink: 0; }')
    expect(css).toMatch(/\.rp-chart \{ height: 160px; --rp-chart-labels: \d+px; \}/)
  })
})
