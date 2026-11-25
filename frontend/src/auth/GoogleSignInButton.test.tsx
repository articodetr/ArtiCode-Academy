import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_PATHS, browserNavigation } from '../api/google'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { GoogleSignInButton } from './GoogleSignInButton'

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=s'
const google = ar.login.google

function button(): HTMLButtonElement {
  return (screen.queryByText(google.button) ?? screen.getByText(google.redirecting)).closest('button') as HTMLButtonElement
}

describe('GoogleSignInButton', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is a white button with Google’s four-colour «G» before the label, and the label names it', () => {
    renderWithProviders(<GoogleSignInButton enabled returnTo={null} />)
    const mark = button().querySelector('svg.google-sign-in__mark')!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect([...mark.querySelectorAll('path[fill]')].map((path) => path.getAttribute('fill'))).toEqual([
      '#EA4335',
      '#4285F4',
      '#FBBC05',
      '#34A853',
      'none',
    ])
    expect(button()).toHaveClass('google-sign-in__button')
    expect(button()).toHaveTextContent(google.button)
  })

  it('does nothing while disabled, and ties its reason to it', () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { url: GOOGLE_URL }))
    renderWithProviders(<GoogleSignInButton enabled={false} disabledHint={google.notEnabled} returnTo="/users" />)

    fireEvent.click(button())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(button()).toBeDisabled()
    const hint = screen.getByTestId('google-sign-in-hint')
    expect(hint).toHaveTextContent(google.notEnabled)
    expect(button().getAttribute('aria-describedby')).toBe(hint.id)
  })

  it('works again when the browser brings the page back from its cache after leaving for Google', async () => {
    mockFetch((url) => (url === GOOGLE_PATHS.start ? jsonResponse(200, { url: GOOGLE_URL }) : jsonResponse(404, {})))
    const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
    renderWithProviders(<GoogleSignInButton enabled returnTo="/users" />)

    fireEvent.click(button())
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(screen.getByText(google.redirecting)).toBeInTheDocument()

    await act(async () => {
      const event = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })

    expect(screen.getByText(google.button)).toBeInTheDocument()
    fireEvent.click(button())
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2))
  })
})
