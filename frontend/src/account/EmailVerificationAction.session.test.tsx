import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { mockFetch, jsonResponse } from '../test/http'
import { renderWithProviders } from '../test/render'
import { EmailVerificationAction } from './EmailVerificationAction'

describe('EmailVerificationAction — the state from the session (CH-0226)', () => {
  it('shows the request for an unconfirmed address without reading the user, and nothing to send once confirmed', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
    })
    const base = { id: 'u-1', email: 'a@example.com', permissions: ['users.read', 'users.read_contact'] }
    const { unmount } = renderWithProviders(<EmailVerificationAction user={{ ...base, emailVerifiedAt: null }} />)
    expect(await screen.findByText(ar.emailVerification.request.button)).toBeInTheDocument()
    unmount()
    renderWithProviders(<EmailVerificationAction user={{ ...base, emailVerifiedAt: '2026-11-12T09:30:00.000Z' }} />)
    expect(screen.queryByText(ar.emailVerification.request.button)).not.toBeInTheDocument()
    expect(urls).toEqual([])
  })
})
