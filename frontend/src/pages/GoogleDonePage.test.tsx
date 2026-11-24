// /auth/google/done (PORTAL-04): waits for the session the callback opened, then goes on where a sign-in goes; without a
// session it says so. The real AuthProvider block proves the restore of the cookie the callback set.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { setAccessToken } from '../auth/token-store'
import { ar } from '../i18n/ar'
import { KEPT_COURSE_KEY, keepCourse } from '../studentRegistration/keptCourse'
import { makePublicAcademy } from '../test/academy'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import type { AuthContextValue } from '../auth/auth-context'
import { GoogleDonePage } from './GoogleDonePage'

const COURSE = '0192f0a0-0000-7000-8000-00000000c001'
const INTENT = `/catalog/${COURSE}?intent=enroll`
const done = ar.login.google.done

function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>
}

function renderDone(search: string, auth: AuthContextValue) {
  return renderWithProviders(<GoogleDonePage />, {
    auth,
    route: { pathname: '/auth/google/done', search },
    path: '/auth/google/done',
    routes: { '*': <Where /> },
  })
}

describe('GoogleDonePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockFetch((url) => (url === '/api/academy/public' ? jsonResponse(200, makePublicAcademy()) : jsonResponse(404, { statusCode: 404 })))
  })
  afterEach(() => window.localStorage.clear())

  it('waits while the session is being restored', () => {
    renderDone('', makeAuth({ status: 'loading' }))
    expect(screen.getByTestId('auth-loading')).toHaveTextContent(done.waiting)
    expect(screen.queryByTestId('where')).not.toBeInTheDocument()
  })

  it('goes on (replace) to the return path once the session is there', async () => {
    renderDone(`?returnTo=${encodeURIComponent(INTENT)}`, makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))
    expect((await screen.findByTestId('where')).textContent).toBe(INTENT)
  })

  it('never follows a return path that leaves the site', async () => {
    renderDone(`?returnTo=${encodeURIComponent('https://evil.example/x')}`, makeAuth({ user: makeUser() }))
    expect((await screen.findByTestId('where')).textContent).toBe('/')
  })

  it('takes a student without a return path to the course kept on this device, and uses it up', async () => {
    keepCourse(COURSE)
    renderDone('?returnTo=%2F', makeAuth({ user: makeUser({ role: 'student', roles: ['student'] }) }))
    expect((await screen.findByTestId('where')).textContent).toBe(INTENT)
    await waitFor(() => expect(window.localStorage.getItem(KEPT_COURSE_KEY)).toBeNull())
  })

  it('sends a user who must change the password to the profile page first', async () => {
    renderDone(`?returnTo=${encodeURIComponent(INTENT)}`, makeAuth({ user: makeUser({ mustChangePassword: true }) }))
    expect((await screen.findByTestId('where')).textContent).toBe('/profile')
  })

  it('says so when no session appeared, with the way back to the sign-in page', async () => {
    renderDone(`?returnTo=${encodeURIComponent(INTENT)}`, makeAuth())
    expect(screen.getByRole('alert')).toHaveTextContent(done.failedTitle)
    expect(screen.getByRole('alert')).toHaveTextContent(done.failedText)

    await userEvent.click(screen.getByText(done.backToLogin).closest('button')!)

    expect((await screen.findByTestId('where')).textContent).toBe(`/login?returnTo=${encodeURIComponent(INTENT)}`)
  })

  it('restores the cookie the callback set through the real provider, then goes on', async () => {
    setAccessToken(null)
    mockFetch((url) => (url === '/api/auth/refresh' ? jsonResponse(200, sessionResponse('access-google')) : jsonResponse(404, { statusCode: 404 })))
    renderWithProviders(
      <AuthProvider>
        <GoogleDonePage />
      </AuthProvider>,
      { route: { pathname: '/auth/google/done', search: '?returnTo=%2Fusers' }, path: '/auth/google/done', routes: { '*': <Where /> } },
    )
    expect((await screen.findByTestId('where')).textContent).toBe('/users')
  })
})
