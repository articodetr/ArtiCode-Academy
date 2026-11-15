import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeListItem } from '../test/users'
import { GlobalSearch } from './GlobalSearch'

function mockApi() {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/users') return jsonResponse(200, { items: [makeListItem({ id: 'u-lina', fullName: 'لينا السالم', email: 'lina@example.com', roles: ['student'] })], nextCursor: null })
    if (path === '/api/classes' || path === '/api/courses' || path === '/api/invoices' || path === '/api/payments' || path === '/api/certificates') return jsonResponse(200, { items: [], nextCursor: null })
    if (path === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return urls
}

describe('GlobalSearch (redesign)', () => {
  afterEach(() => localStorage.clear())

  it('opens with Ctrl+K, suggests the actions this viewer may take, and searches people with the typed text', async () => {
    const urls = mockApi()
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'users.create', 'payments.record', 'invoices.read_all'] }) }), route: '/' })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByText(ar.search.actions.addUser)).toBeInTheDocument()
    expect(screen.getByText(ar.search.actions.recordPayment)).toBeInTheDocument()
    expect(screen.queryByText(ar.search.actions.takeAttendance)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ar.search.placeholder), { target: { value: 'لينا' } })
    expect(await screen.findByText('لينا السالم')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/users?') && url.includes(encodeURIComponent('لينا')))).toBe(true)
    // A word is no invoice number: the finance lists are not asked.
    expect(urls.some((url) => url.startsWith('/api/invoices'))).toBe(false)
  })

  it('sends an invoice number to the invoices only and finds pages by their Arabic words with spelling variants', async () => {
    const urls = mockApi()
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'invoices.read_all'] }) }), route: '/' })
    fireEvent.click(screen.getByLabelText(ar.search.open))
    const input = await screen.findByLabelText(ar.search.placeholder)

    fireEvent.change(input, { target: { value: 'INV-2026' } })
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/invoices?'))).toBe(true))
    expect(urls.some((url) => url.startsWith('/api/users?'))).toBe(false)

    fireEvent.change(input, { target: { value: 'فاتوره' } })
    expect(await screen.findByText(ar.nav.payments)).toBeInTheDocument()
  })
})
