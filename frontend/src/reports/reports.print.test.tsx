// The print rules of the reports page (reports.css, `@media print`) — jsdom applies no print media, so this checks
// that every selector they name meets an element of the page as the router mounts it inside the layout: a rule
// whose selector meets nothing (the side menu once had no `app-sider` class) prints the side menu and squeezes the
// tables off the page.
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { AppLayout } from '../layout/AppLayout'
import { ReportsPage } from '../pages/ReportsPage'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeAttendanceClasses, makeAttendanceStudents } from '../test/reports'

/** A file beside this test, read from disk: vitest empties every `.css` import, `?raw` included. */
async function readBeside(name: string): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  return fs.readFileSync(new URL(name, import.meta.url), 'utf8')
}

/** The selectors of every rule inside `@media print { … }` of a stylesheet. */
function printSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = text.indexOf('@media print')
  if (start < 0) return []
  const open = text.indexOf('{', start)
  let depth = 1
  let end = open + 1
  while (depth > 0 && end < text.length) {
    if (text[end] === '{') depth += 1
    if (text[end] === '}') depth -= 1
    end += 1
  }
  const block = text.slice(open + 1, end - 1)
  return [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) => match[1]!.split(',').map((selector) => selector.trim())).filter(Boolean)
}

/** Selectors whose element is there only in another state: the academic tab's sub-tabs, a table of more than 50 rows. */
const CONDITIONAL = ['.rp-subtabs > .ant-tabs-nav', '.ant-pagination']

describe('reports — the print rules (reports.css)', () => {
  it('names only elements the page and its layout render — the side menu, the header and the controls are left out on paper', async () => {
    mockFetch((url) => {
      const { pathname } = new URL(url, 'http://localhost')
      if (pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
      if (pathname === '/api/reports/attendance/classes') return jsonResponse(200, makeAttendanceClasses())
      if (pathname === '/api/reports/attendance/students') return jsonResponse(200, makeAttendanceStudents())
      if (pathname === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
      return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
    })
    renderWithProviders(
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      </Routes>,
      { auth: makeAuth({ user: makeUser({ permissions: ['reports.attendance.view'] }) }), route: '/reports', path: '/*' },
    )
    expect(await screen.findByText(ar.reports.attendance.byClass)).toBeInTheDocument()
    await screen.findAllByRole('table')

    const selectors = printSelectors(await readBeside('./reports.css'))
    // The side menu and the header of the layout are among them.
    expect(selectors).toEqual(expect.arrayContaining(['.app-sider', '.app-header', '.app-content', '.rp-noprint']))
    const unmatched = selectors.filter((selector) => !CONDITIONAL.includes(selector) && document.querySelector(selector) === null)
    expect(unmatched).toEqual([])
    // The side menu is the layout's Sider.
    expect(document.querySelector('.app-sider')).toHaveClass('ant-layout-sider')
  })
})
