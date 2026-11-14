import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, renderWithProviders } from '../test/render'
import { ForgotPasswordPage } from './ForgotPasswordPage'

function renderPage() {
  return renderWithProviders(<ForgotPasswordPage />, {
    auth: makeAuth(),
    route: '/forgot-password',
    path: '/forgot-password',
    routes: { '/login': <LocationProbe /> },
  })
}

function submitButton(): HTMLElement {
  const button = screen.getByText(ar.forgotPassword.submit).closest<HTMLElement>('button')
  if (!button) throw new Error('No submit button')
  return button
}

async function ask(identifier: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(ar.forgotPassword.identifier), identifier)
  await user.click(submitButton())
}

describe('ForgotPasswordPage', () => {
  it('sends the trimmed identifier on the public route and answers 202 with the neutral message', async () => {
    const fetchMock = mockFetch(() => jsonResponse(202))
    renderPage()

    await ask('  st@example.test ')

    expect(await screen.findByText(ar.forgotPassword.sent)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.forgotPassword.identifier)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/account/password-reset/request')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ identifier: 'st@example.test' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(screen.getByRole('link', { name: ar.forgotPassword.backToLogin })).toHaveAttribute('href', '/login')
  })

  it('says plainly that self-service reset is not available yet on 403 reset_disabled, keeping the form', async () => {
    mockFetch(() => jsonResponse(403, { statusCode: 403, code: 'reset_disabled' }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.forgotPassword.errors.reset_disabled)
    expect(screen.queryByText(ar.forgotPassword.sent)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.forgotPassword.identifier)).toBeInTheDocument()
  })

  it('shows the rate-limit message on 429', async () => {
    mockFetch(() => jsonResponse(429, { statusCode: 429, code: 'rate_limited' }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.forgotPassword.errors.rate_limited)
  })

  it('requires an identifier before sending anything', async () => {
    const fetchMock = mockFetch(() => jsonResponse(202))
    renderPage()

    await userEvent.click(submitButton())

    expect(await screen.findByText(ar.forgotPassword.identifierRequired)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a server failure without the neutral message', async () => {
    mockFetch(() => jsonResponse(500, { statusCode: 500 }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.server)
  })
})
