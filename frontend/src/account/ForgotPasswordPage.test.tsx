import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, renderWithProviders } from '../test/render'
import { ForgotPasswordPage } from './ForgotPasswordPage'

const RESET_REQUEST = '/api/account/password-reset/request'

type Answer = () => Response | Promise<Response>

/** API-205 for the frame's academy name, and the reset request (API-021). */
function mockApi(request: Answer = () => jsonResponse(202)) {
  return mockFetch((url) => (url === '/api/academy/public' ? jsonResponse(200, makePublicAcademy()) : request()))
}

function requests(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([url]) => url === RESET_REQUEST)
}

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
  it('heads the card with its title, in the frame of the account pages', async () => {
    mockApi()
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.forgotPassword.title)
    expect(screen.getByText(ar.forgotPassword.intro)).toBeInTheDocument()
    expect(await screen.findByText('أكاديمية آرتي كود')).toBeInTheDocument()
  })

  it('sends the trimmed identifier on the public route and answers 202 with the neutral message', async () => {
    const fetchMock = mockApi()
    renderPage()

    await ask('  st@example.test ')

    expect(await screen.findByText(ar.forgotPassword.sent)).toBeInTheDocument()
    expect(ar.forgotPassword.sent).toContain('إن كان الحساب موجودًا')
    expect(screen.queryByLabelText(ar.forgotPassword.identifier)).not.toBeInTheDocument()
    expect(requests(fetchMock)).toHaveLength(1)
    const [, init] = requests(fetchMock)[0]!
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ identifier: 'st@example.test' })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(screen.getByRole('link', { name: ar.forgotPassword.backToLogin })).toHaveAttribute('href', '/login')
  })

  it('says plainly that self-service reset is not enabled yet on 403 reset_disabled, keeping the form', async () => {
    mockApi(() => jsonResponse(403, { statusCode: 403, code: 'reset_disabled' }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.forgotPassword.errors.reset_disabled)
    expect(ar.forgotPassword.errors.reset_disabled).toBe('استعادة كلمة المرور من الموقع غير مفعّلة بعد. تواصل مع إدارة الأكاديمية لإعادة ضبطها.')
    expect(screen.queryByText(ar.forgotPassword.sent)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.forgotPassword.identifier)).toBeInTheDocument()
  })

  it('shows the rate-limit message on 429', async () => {
    mockApi(() => jsonResponse(429, { statusCode: 429, code: 'rate_limited' }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.forgotPassword.errors.rate_limited)
  })

  it('says how long to wait on a 429 that names it', async () => {
    mockApi(
      () =>
        new Response(JSON.stringify({ statusCode: 429, code: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After-login': '600' },
        }),
    )
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('studentRegistration.errors.rateLimitedMinutes', { count: 10 }))
  })

  it('requires an identifier before sending anything', async () => {
    const fetchMock = mockApi()
    renderPage()

    await userEvent.click(submitButton())

    expect(await screen.findByText(ar.forgotPassword.identifierRequired)).toBeInTheDocument()
    expect(requests(fetchMock)).toHaveLength(0)
  })

  it('sends one request for a double press', async () => {
    let release: (response: Response) => void = () => {}
    const fetchMock = mockApi(() => new Promise<Response>((resolve) => (release = resolve)))
    renderPage()
    await userEvent.type(screen.getByLabelText(ar.forgotPassword.identifier), 'st')

    fireEvent.click(submitButton())
    fireEvent.click(submitButton())

    await waitFor(() => expect(requests(fetchMock)).toHaveLength(1))
    release(jsonResponse(202))
    expect(await screen.findByText(ar.forgotPassword.sent)).toBeInTheDocument()
    expect(requests(fetchMock)).toHaveLength(1)
  })

  it('reports a server failure without the neutral message', async () => {
    mockApi(() => jsonResponse(500, { statusCode: 500 }))
    renderPage()

    await ask('st')

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.login.errors.server)
  })
})
