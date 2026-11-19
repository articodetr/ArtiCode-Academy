import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AuditLogList } from '../api/audit'
import { ar } from '../i18n/ar'
import { ADMIN_ID, TARGET_ID, makeAuditItem, makeAuditList } from '../test/audit'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { forgetUserNames } from '../audit/useUserNames'
import { makeUserDetail } from '../test/users'
import { AuditLogPage } from './AuditLogPage'

const OTHER_ACTOR = '0192f0a0-0000-7000-8000-000000000009'

/** AuditLogPage.css read from disk, comments removed: vitest empties every `.css` import, `?raw` included. */
async function auditCss(): Promise<string> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
  // A variable, not a literal: Vite rewrites `new URL('./AuditLogPage.css', import.meta.url)` into the asset's served URL.
  const path = './AuditLogPage.css'
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of the `@supports <condition>` block of `css` ('' when there is none). */
function supportsBlock(css: string, condition: string): string {
  const start = css.indexOf(`@supports ${condition}`)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  return ''
}

/** The declarations of the plain rule written exactly with `selector` at the top level of `css`, as property → value. */
function declarationsOf(css: string, selector: string): Record<string, string> {
  const topLevel = css.replace(/@supports[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const declarations: Record<string, string> = {}
  for (const match of topLevel.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue
    for (const part of match[2]!.split(';')) {
      const colon = part.indexOf(':')
      if (colon > 0) declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
    }
  }
  return declarations
}

const suspended = makeAuditItem()
const bootstrap = makeAuditItem({ id: '0192f0a0-0000-7000-8000-0000000000a2', action: 'auth.bootstrap.admin_created', actorUserId: null, entityId: ADMIN_ID, metadata: null, userAgent: null, ipAddress: null, createdAt: '2026-10-29T08:00:00.000Z' })
const roleCreated = makeAuditItem({ id: '0192f0a0-0000-7000-8000-0000000000a3', action: 'roles.created', actorUserId: OTHER_ACTOR, entityType: 'roles', entityId: 'role-1', metadata: { key: 'librarian', permissions: ['users.read'] } })

/** Serves GET /api/audit-logs from `pages` keyed by cursor ('first' = no cursor) and records every query. */
function mockAuditApi(pages: Record<string, AuditLogList | Response>) {
  const queries: URLSearchParams[] = []
  const fetchMock = mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname !== '/api/audit-logs') return jsonResponse(404, { statusCode: 404, message: 'Not found' })
    queries.push(parsed.searchParams)
    const page = pages[parsed.searchParams.get('cursor') ?? 'first']
    if (page instanceof Response) return page
    return page ? jsonResponse(200, page) : jsonResponse(400, { statusCode: 400, message: ['cursor must be a nextCursor value of a previous page'] })
  })
  return { queries, fetchMock, lastQuery: () => queries[queries.length - 1] }
}

function renderPage() {
  return renderWithProviders(<AuditLogPage />, { auth: makeAuth({ user: makeUser({ id: ADMIN_ID, permissions: ['audit.read'] }) }), route: '/audit-logs' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  // Ant Design renders a measurement row before the data rows; keep the rows that carry text.
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

async function applyFilters() {
  await userEvent.click(screen.getByText(ar.audit.apply).closest('button') as HTMLButtonElement)
}

describe('AuditLogPage', () => {
  it('lists the events of GET /api/audit-logs newest first with time, event, summary, actor, entity and IP; the first request asks for the default page size', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended, bootstrap, roleCreated]) })
    renderPage()

    expect(await screen.findByText('users.status.changed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ar.audit.title })).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('action: suspend · from: active · to: suspended · reason: late fees · …')).toBeInTheDocument()
    expect(within(rows[0]).getByText(ar.audit.you)).toBeInTheDocument()
    expect(within(rows[0]).getByText('users')).toBeInTheDocument()
    expect(within(rows[0]).getByText('0192f0a0…')).toBeInTheDocument()
    expect(within(rows[0]).getByText('127.0.0.1')).toBeInTheDocument()
    expect(within(rows[1]).getByText(ar.audit.system)).toBeInTheDocument()
    expect(within(rows[1]).getByText('auth.bootstrap.admin_created')).toBeInTheDocument()
    expect(within(rows[2]).getByText('roles')).toBeInTheDocument()
    expect(within(rows[2]).getByText('role-1')).toBeInTheDocument()
    expect(within(rows[2]).getByText('key: librarian')).toBeInTheDocument()

    expect(api.queries).toHaveLength(1)
    expect(Object.fromEntries(api.queries[0])).toEqual({ limit: '50' })
  })

  it('sends the filters as the query of API-011 (before as ISO 8601) and restarts from the first page', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended]) })
    renderPage()
    await screen.findByText('users.status.changed')

    await userEvent.type(screen.getByLabelText(ar.audit.filters.action), 'users.')
    await userEvent.type(screen.getByLabelText(ar.audit.filters.actor), OTHER_ACTOR)
    await userEvent.type(screen.getByLabelText(ar.audit.filters.entityType), 'users')
    await userEvent.type(screen.getByLabelText(ar.audit.filters.entityId), TARGET_ID)
    fireEvent.change(screen.getByLabelText(ar.audit.filters.before), { target: { value: '2026-10-30T12:00' } })
    await applyFilters()

    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.lastQuery())).toEqual({
      limit: '50',
      action: 'users.',
      actorUserId: OTHER_ACTOR,
      entityType: 'users',
      entityId: TARGET_ID,
      before: new Date('2026-10-30T12:00').toISOString(),
    })
  })

  it('suggests the syllabus event of MOD-04 and filters the list by it (O7-F, WF-05 step 7)', async () => {
    const syllabusChanged = makeAuditItem({
      id: '0192f0a0-0000-7000-8000-0000000000a4',
      action: 'courses.syllabus.changed',
      entityType: 'courses',
      entityId: '0193a000-0000-7000-8000-00000000c001',
      metadata: { code: 'PY101', added: 1, updated: 1, removed: 0, reordered: false, items: 3 },
    })
    const queries: URLSearchParams[] = []
    mockFetch((url) => {
      const { searchParams } = new URL(url, 'http://localhost')
      queries.push(searchParams)
      return jsonResponse(200, makeAuditList(searchParams.get('action') === 'courses.syllabus.changed' ? [syllabusChanged] : [suspended]))
    })
    renderPage()
    await screen.findByText('users.status.changed')

    await userEvent.type(screen.getByLabelText(ar.audit.filters.action), 'courses.sy')
    const option = await waitFor(() => {
      const found = [...document.querySelectorAll('.ant-select-item-option-content')].find((node) => node.textContent === 'courses.syllabus.changed')
      expect(found).toBeDefined()
      return found as HTMLElement
    })
    fireEvent.click(option)
    await applyFilters()

    await waitFor(() => expect(queries).toHaveLength(2))
    expect(Object.fromEntries(queries[1]!)).toEqual({ limit: '50', action: 'courses.syllabus.changed' })
    const [row] = bodyRows()
    expect(within(row!).getByText('courses.syllabus.changed')).toBeInTheDocument()
    expect(within(row!).getByText('code: PY101 · added: 1 · updated: 1 · removed: 0 · …')).toBeInTheDocument()
  })

  it('refuses locally a filter the server would reject and sends nothing', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended]) })
    renderPage()
    await screen.findByText('users.status.changed')

    await userEvent.type(screen.getByLabelText(ar.audit.filters.action), 'Users!')
    await userEvent.type(screen.getByLabelText(ar.audit.filters.entityId), TARGET_ID)
    await applyFilters()

    expect(await screen.findByText(ar.audit.validation.action)).toBeInTheDocument()
    expect(screen.getByText(ar.audit.validation.entityTypeRequired)).toBeInTheDocument()
    expect(api.queries).toHaveLength(1)
  })

  it('pages forward with the cursor and back to the previous page', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended], 'cursor-2'), 'cursor-2': makeAuditList([bootstrap], null) })
    renderPage()
    await screen.findByText('users.status.changed')

    const previous = screen.getByText(ar.audit.pagination.previous).closest('button') as HTMLButtonElement
    expect(previous).toBeDisabled()
    await userEvent.click(screen.getByText(ar.audit.pagination.next).closest('button') as HTMLButtonElement)

    expect(await screen.findByText('auth.bootstrap.admin_created')).toBeInTheDocument()
    expect(screen.queryByText('users.status.changed')).not.toBeInTheDocument()
    expect(api.lastQuery().get('cursor')).toBe('cursor-2')
    expect(screen.getByText(ar.audit.pagination.page.replace('{{page}}', '2'))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(ar.audit.pagination.next).closest('button')).toBeDisabled())

    await userEvent.click(screen.getByText(ar.audit.pagination.previous).closest('button') as HTMLButtonElement)
    expect(await screen.findByText('users.status.changed')).toBeInTheDocument()
    expect(api.lastQuery().has('cursor')).toBe(false)
  })

  it('expands a row to show the identifiers, the user agent and the metadata JSON', async () => {
    mockAuditApi({ first: makeAuditList([suspended, bootstrap]) })
    renderPage()
    await screen.findByText('users.status.changed')

    const [expand] = document.querySelectorAll<HTMLButtonElement>('.ant-table-row-expand-icon')
    await userEvent.click(expand)

    expect(await screen.findByText(suspended.id)).toBeInTheDocument()
    expect(screen.getByText('Mozilla/5.0 (test)')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && (element.textContent ?? '').includes('"reason": "late fees"'))).toBeInTheDocument()
    expect(screen.queryByText(ar.audit.details.noMetadata)).not.toBeInTheDocument()
  })

  it('keeps the table in its own scroll box and an opened row inside it, so a phone never scrolls the page sideways (QA 2026-11-17: 889 px at 390 px)', async () => {
    mockAuditApi({ first: makeAuditList([suspended, bootstrap]) })
    renderPage()
    await screen.findByText('users.status.changed')

    // jsdom has no layout: assert the configuration. `x: true` (not 'max-content') keeps the table at its box's width
    // wherever it fits and scrolls it in that box on a phone (KI-094).
    const table = screen.getByRole('table')
    expect(table.closest('.ant-table')).toHaveClass('ant-table-scroll-horizontal')
    expect(table.style.width).toBe('auto')
    expect(table.style.minWidth).toBe('100%')
    // The filter buttons wrap: one 321 px row widened the page to 438 px at 390 px (CH-0297, real browser).
    expect(screen.getByTestId('audit-filter-actions')).toHaveStyle({ flexWrap: 'wrap' })

    // The details take their width from AuditLogPage.css (KI-099, KI-120 — the next test reads it), never from their
    // text: no inline width of their own, and they sit in the scroll box the stylesheet makes a size container.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.ant-table-row-expand-icon')!)
    const box = await screen.findByTestId('audit-event-details')
    expect(box.closest('tr')).toHaveClass('ant-table-expanded-row')
    expect(box).toHaveClass('audit-event-details')
    expect(box.getAttribute('style')).toBeNull()
    const scrollBox = document.querySelector('.audit-table .ant-table-content')
    expect(scrollBox).not.toBeNull()
    expect(scrollBox).toContainElement(table)
    expect(scrollBox).toContainElement(box)
    expect(within(box).getByText(suspended.id)).toBeInTheDocument()
    expect(table.style.width).toBe('auto')
  })

  it('wraps an opened event at the width of the table’s visible box, not of the whole scrolled table, and keeps it in view while the table scrolls (KI-120, 390 px)', async () => {
    const css = await auditCss()
    // Without container queries: the KI-099 box — no width of its own, the cell's at least.
    expect(declarationsOf(css, '.audit-table .audit-event-details')).toMatchObject({ width: '0', 'min-width': '100%', 'overflow-wrap': 'anywhere' })
    // With them: the scroll box is a size container and the details take its visible width less the cell's two 8 px
    // paddings (`size="middle"`), sticking to its start edge — the right edge in Arabic — as the table scrolls.
    const supported = supportsBlock(css, '(width: 1cqi)')
    expect(declarationsOf(supported, '.audit-table .ant-table-content')).toEqual({ 'container-type': 'inline-size' })
    expect(declarationsOf(supported, '.audit-table .audit-event-details')).toEqual({
      position: 'sticky',
      'inset-inline-start': '8px',
      'box-sizing': 'border-box',
      'min-width': '0',
      width: 'calc(100cqi - 16px)',
    })
  })

  it('narrows the list to the clicked actor and fills the filter', async () => {
    const api = mockAuditApi({ first: makeAuditList([roleCreated]) })
    renderPage()
    await screen.findByText('roles.created')

    const row = bodyRows()[0]
    await userEvent.click(within(row).getByTitle(OTHER_ACTOR))

    await waitFor(() => expect(api.lastQuery().get('actorUserId')).toBe(OTHER_ACTOR))
    expect(screen.getByLabelText(ar.audit.filters.actor)).toHaveValue(OTHER_ACTOR)
  })

  it('shows the permission message when the list is refused', async () => {
    mockAuditApi({ first: jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['audit.read'] }) })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ليست لديك الصلاحية اللازمة لقراءة سجل التدقيق (audit.read)')
  })

  it('shows the empty text when no event matches, and reset sends the bare query again', async () => {
    const api = mockAuditApi({ first: makeAuditList([]) })
    renderPage()
    expect(await screen.findByText(ar.audit.empty)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(ar.audit.filters.entityType), 'roles')
    await applyFilters()
    await waitFor(() => expect(api.lastQuery().get('entityType')).toBe('roles'))

    await userEvent.click(screen.getByText(ar.audit.reset).closest('button') as HTMLButtonElement)
    await waitFor(() => expect(api.queries).toHaveLength(3))
    expect(Object.fromEntries(api.lastQuery())).toEqual({ limit: '50' })
    expect(screen.getByLabelText(ar.audit.filters.entityType)).toHaveValue('')
  })
})

describe('AuditLogPage — the event prefix field (KI-092)', () => {
  const actionField = () => screen.getByLabelText(ar.audit.filters.action) as HTMLInputElement
  const activeOption = () => document.querySelector('.ant-select-item-option-active .ant-select-item-option-content')?.textContent ?? null
  /** rc-select reads `which`/`keyCode`, which user-event leaves at 0 — so its list would ignore `userEvent.keyboard()`. */
  const press = (key: 'Enter' | 'ArrowDown', keyCode: number) => {
    fireEvent.keyDown(actionField(), { key, code: key, keyCode, which: keyCode })
    fireEvent.keyUp(actionField(), { key, code: key, keyCode, which: keyCode })
  }

  it('Enter keeps the typed prefix and applies it, as the apply button does', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended]) })
    renderPage()
    await screen.findByText('users.status.changed')

    await userEvent.type(actionField(), 'auth.mfa.')
    // rc-select highlights the first suggestion that starts with the typed text — Enter must not take it.
    await waitFor(() => expect(activeOption()).toBe('auth.mfa.enabled'))
    press('Enter', 13)

    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.lastQuery())).toEqual({ limit: '50', action: 'auth.mfa.' })
    expect(actionField()).toHaveValue('auth.mfa.')
  })

  it('arrow-down then Enter still takes the highlighted suggestion (and sends nothing until applied)', async () => {
    const api = mockAuditApi({ first: makeAuditList([suspended]) })
    renderPage()
    await screen.findByText('users.status.changed')

    await userEvent.type(actionField(), 'auth.mfa.')
    await waitFor(() => expect(activeOption()).toBe('auth.mfa.enabled'))
    press('ArrowDown', 40)
    await waitFor(() => expect(activeOption()).toBe('auth.mfa.disabled'))
    press('Enter', 13)

    await waitFor(() => expect(actionField()).toHaveValue('auth.mfa.disabled'))
    expect(api.queries).toHaveLength(1)
    await applyFilters()
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.lastQuery())).toEqual({ limit: '50', action: 'auth.mfa.disabled' })
  })
})

describe('AuditLogPage — identifiers read left to right in the Arabic UI (KI-093)', () => {
  /** The value sits in a plain `<bdi dir="ltr">` — an antd Typography/Tag would override `dir` with its RTL class. */
  const expectLtrIsolate = (text: string) => {
    const element = screen.getByText(text)
    expect(element.tagName).toBe('BDI')
    expect(element).toHaveAttribute('dir', 'ltr')
    expect(element.className).not.toMatch(/ant-(typography|tag)/)
  }

  it('wraps the IP, the ids, the entity type, the event name, the summary and the expanded details in a plain LTR isolate', async () => {
    const event = makeAuditItem({ action: 'auth.login.succeeded', ipAddress: '::1', entityType: 'courses', entityId: '0193a000-0000-7000-8000-00000000c001', metadata: { familyId: 'f-1' } })
    mockAuditApi({ first: makeAuditList([event]) })
    renderPage()
    await screen.findByText('auth.login.succeeded')

    expectLtrIsolate('::1')
    expectLtrIsolate('auth.login.succeeded')
    expectLtrIsolate('familyId: f-1')
    expectLtrIsolate('courses')
    expectLtrIsolate('0193a000…')
    expectLtrIsolate(ADMIN_ID)

    await userEvent.click(document.querySelector<HTMLButtonElement>('.ant-table-row-expand-icon') as HTMLButtonElement)
    expect(await screen.findByText(event.id)).toBeInTheDocument()
    expectLtrIsolate(event.id)
    expectLtrIsolate('courses / 0193a000-0000-7000-8000-00000000c001')
    expectLtrIsolate('Mozilla/5.0 (test)')
    // No antd Typography or Tag carries `dir` any more: its `-rtl` class would beat the attribute.
    expect(document.querySelectorAll('.ant-typography[dir], .ant-tag[dir]')).toHaveLength(0)
  })

  it('marks every filter field that holds a left-to-right value for the LTR rule of AuditLogPage.css (KI-096)', async () => {
    mockAuditApi({ first: makeAuditList([suspended]) })
    renderPage()
    await screen.findByText(suspended.action)

    // jsdom applies no stylesheet: assert what the rule targets. antd's `-rtl` classes set `direction: rtl` on the
    // select root and on the inputs; `.audit-filters .audit-ltr-field` (two classes) outranks them in a browser.
    const form = document.querySelector('form.audit-filters') as HTMLFormElement
    expect(form).not.toBeNull()
    const fields = form.querySelectorAll('.audit-ltr-field')
    // The event AutoComplete, the actor id, the entity type, the entity id and the «before» date-time.
    expect(fields).toHaveLength(5)
    expect(form.querySelector('.ant-select.audit-ltr-field input')).not.toBeNull()
    expect(form.querySelector('input[type="datetime-local"].audit-ltr-field')).not.toBeNull()
  })
})

describe('AuditLogPage — names instead of ids (redesign)', () => {
  it('reads each actor once for a holder of users.read and shows the name; without the key it keeps the short id', async () => {
    forgetUserNames()
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/audit-logs') return jsonResponse(200, makeAuditList([roleCreated, { ...roleCreated, id: '0192f0a0-0000-7000-8000-0000000000a4' }]))
      if (path === `/api/users/${OTHER_ACTOR}`) return jsonResponse(200, makeUserDetail({ id: OTHER_ACTOR, fullName: 'نورة المسؤولة', displayName: null }))
      return jsonResponse(404, { statusCode: 404, message: 'Not found' })
    })
    renderWithProviders(<AuditLogPage />, { auth: makeAuth({ user: makeUser({ id: ADMIN_ID, permissions: ['audit.read', 'users.read'] }) }), route: '/audit-logs' })
    expect((await screen.findAllByText('نورة المسؤولة')).length).toBe(2)
    expect(urls.filter((url) => url.startsWith(`/api/users/${OTHER_ACTOR}`))).toHaveLength(1)
  })
})
