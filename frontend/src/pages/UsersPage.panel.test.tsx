import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ADMIN_PERMISSIONS, makeListItem, makeRoleList, makeUserDetail, makeUserList } from '../test/users'
import { UsersPage } from './UsersPage'

// Redesign (2026-11-14): on a wide screen a user opens in a side panel beside the table, not over it.
const SARA_ID = '0192f0a0-0000-7000-8000-0000000000a1'
const OMAR_ID = '0192f0a0-0000-7000-8000-0000000000a2'
const sara = makeListItem({ id: SARA_ID, fullName: 'سارة أحمد' })
const omar = makeListItem({ id: OMAR_ID, fullName: 'عمر خالد', roles: ['student'] })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/users') return jsonResponse(200, makeUserList([sara, omar]))
    if (path === '/api/roles') return jsonResponse(200, makeRoleList())
    if (path === `/api/users/${SARA_ID}`) return jsonResponse(200, makeUserDetail({ id: SARA_ID, fullName: 'سارة أحمد' }))
    if (path === `/api/users/${OMAR_ID}`) return jsonResponse(200, makeUserDetail({ id: OMAR_ID, fullName: 'عمر خالد' }))
    return jsonResponse(200, { items: [], nextCursor: null })
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

const dockedDrawer = () => document.querySelector('.record-drawer--docked .ant-drawer-body')

describe('UsersPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a user inside the panel beside the table, without a mask, keeps three columns, and switches user on another row', async () => {
    renderWithProviders(<UsersPage />, { auth: makeAuth({ user: makeUser({ permissions: ADMIN_PERMISSIONS }) }), route: '/users' })

    fireEvent.click(await screen.findByText('سارة أحمد'))
    await waitFor(() => expect(dockedDrawer()).toHaveTextContent('سارة أحمد'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.common.name, ar.users.columns.roles, ar.common.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('عمر خالد'))
    await waitFor(() => expect(dockedDrawer()).toHaveTextContent('عمر خالد'))
  })
})
