import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { CLASS_ADMIN_PERMISSIONS, makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ClassesPage } from './ClassesPage'

// Redesign (2026-11-14): on a wide screen a class opens in a side panel beside the table, not over it.
const pyA = makeClass({ id: 'k-a', code: 'PY-A', name: { ar: 'بايثون أ' } })
const webB = makeClass({ id: 'k-b', code: 'WEB-B', name: { ar: 'الويب ب' } })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/classes') return jsonResponse(200, makeClassList([pyA, webB]))
    if (path === '/api/classes/k-a') return jsonResponse(200, pyA)
    if (path === '/api/classes/k-b') return jsonResponse(200, webB)
    if (path === '/api/courses' || path === '/api/users') return jsonResponse(200, { items: [], nextCursor: null })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
}

/** A window wide enough for the docked panel: only that one media query matches. */
function wideScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1360px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

const drawerTitle = () => document.querySelector('.record-drawer--docked .ant-drawer-title')

describe('ClassesPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a class inside the panel beside the table, without a mask, keeps four columns, and switches class on another row', async () => {
    renderWithProviders(<ClassesPage />, { auth: makeAuth({ user: makeUser({ permissions: CLASS_ADMIN_PERMISSIONS }) }), route: '/classes' })

    fireEvent.click(await screen.findByText('بايثون أ'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('بايثون أ'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.common.name, ar.classes.columns.teachers, ar.classes.columns.seats, ar.common.status])

    fireEvent.click(screen.getByText('الويب ب'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('الويب ب'))
  })
})
