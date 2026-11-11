import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthContextValue } from '../auth/auth-context'
import { getAccessToken, setAccessToken } from '../auth/token-store'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { LocationProbe } from '../test/LocationProbe'
import type { FetchHandler } from '../test/http'
import { jsonResponse, mockFetch, sessionResponse } from '../test/http'
import { ADMIN_SESSION_PERMISSIONS, STUDENT_SESSION_PERMISSIONS } from '../test/profile'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoleList } from '../test/users'
import { ProfilePage } from './ProfilePage'

const ROUTES = { '/login': <LocationProbe /> }

/** Mounts the page at /profile with a fake auth context; /login renders the location probe. */
function renderProfile(auth: AuthContextValue) {
  return renderWithProviders(<ProfilePage />, { auth, route: '/profile', routes: ROUTES })
}

/** Mounts the page inside the real AuthProvider, which first restores the session through POST /api/auth/refresh. */
function renderProfileWithProvider() {
  return renderWithProviders(
    <AuthProvider>
      <ProfilePage />
    </AuthProvider>,
    { route: '/profile', routes: ROUTES },
  )
}

interface RecordedCall {
  request: string
  body: unknown
  authorization: string | null
}

/** Answers every request with `handler` and records method + path, the JSON body and the bearer header. */
function record(handler: FetchHandler = () => jsonResponse(404)) {
  const calls: RecordedCall[] = []
  mockFetch((url, init) => {
    calls.push({
      request: `${init?.method ?? 'GET'} ${url}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: new Headers(init?.headers).get('Authorization'),
    })
    return handler(url, init)
  })
  return calls
}

function card(title: string): HTMLElement {
  const element = screen.getByText(title).closest<HTMLElement>('.ant-card')
  if (!element) throw new Error(`No card titled ${title}`)
  return element
}

/** The button whose label is exactly `text` — a text query, cheaper than an accessible-name one (KI-044). */
async function findButton(text: string): Promise<HTMLElement> {
  const found = (await screen.findByText(text)).closest<HTMLElement>('button')
  if (!found) throw new Error(`No button ${text}`)
  return found
}

/** Headings and key counts of the permission areas, in screen order. */
function areasOf(permissions: HTMLElement) {
  return {
    titles: [...permissions.querySelectorAll('.ant-collapse-title')].map((node) => node.textContent),
    counts: [...permissions.querySelectorAll('.ant-collapse-extra')].map((node) => Number(node.textContent)),
  }
}

function areaHeader(permissions: HTMLElement, title: string): HTMLElement {
  const header = within(permissions).getByText(title).closest<HTMLElement>('[role="button"]')
  if (!header) throw new Error(`No area ${title}`)
  return header
}

function passwordForm() {
  const form = card(ar.profile.changePassword)
  return {
    form,
    current: within(form).getByLabelText(ar.profile.currentPassword),
    next: within(form).getByLabelText(ar.profile.newPassword),
    confirm: within(form).getByLabelText(ar.profile.confirmPassword),
    save: within(form).getByRole('button', { name: ar.common.save }),
  }
}

async function fillPasswords(current: string, next: string, confirm = next) {
  const user = userEvent.setup()
  const fields = passwordForm()
  await user.type(fields.current, current)
  await user.type(fields.next, next)
  await user.type(fields.confirm, confirm)
  return { user, fields }
}

describe('ProfilePage (J-F36)', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  describe('roles', () => {
    it('names the system roles as the users screen does and reads no role list', async () => {
      const calls = record()
      renderProfile(makeAuth({ user: makeUser({ roles: ['academy_admin', 'teacher'], permissions: ['users.read'] }) }))

      const identity = card(ar.profile.identity)
      expect(within(identity).getByText(ar.roles.admin)).toBeInTheDocument()
      expect(within(identity).getByText(ar.roles.teacher)).toBeInTheDocument()
      expect(within(identity).queryByText('academy_admin')).not.toBeInTheDocument()
      await act(async () => {})
      expect(calls).toEqual([])
    })

    it('keeps the key of a custom role when the user may not read the roles, asking nothing', async () => {
      const calls = record()
      renderProfile(makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher', 'librarian'], permissions: ['courses.read'] }) }))

      const identity = card(ar.profile.identity)
      expect(within(identity).getByText(ar.roles.teacher)).toBeInTheDocument()
      expect(within(identity).getByText('librarian')).toBeInTheDocument()
      await act(async () => {})
      expect(calls).toEqual([])
    })

    it('names a custom role by its server label with one GET /api/roles when the user holds users.read', async () => {
      const calls = record((url) => (url === '/api/roles' ? jsonResponse(200, makeRoleList()) : jsonResponse(404)))
      renderProfile(makeAuth({ user: makeUser({ role: 'staff', roles: ['staff', 'librarian'], permissions: ['users.read'] }) }))

      const identity = card(ar.profile.identity)
      expect(await within(identity).findByText('أمين المكتبة')).toBeInTheDocument()
      expect(within(identity).getByText(ar.roles.staff)).toBeInTheDocument()
      expect(within(identity).queryByText('librarian')).not.toBeInTheDocument()
      expect(calls.map((call) => call.request)).toEqual(['GET /api/roles'])
    })

    it('says so when the user holds no role and no permission', () => {
      record()
      renderProfile(makeAuth({ user: makeUser({ role: null, roles: [], permissions: [] }) }))

      expect(within(card(ar.profile.identity)).getByText(ar.profile.noRoles)).toBeInTheDocument()
      const permissions = card(i18n.t('profile.permissions', { count: 0 }))
      expect(within(permissions).getByText(ar.profile.noPermissions)).toBeInTheDocument()
      expect(permissions.querySelector('.ant-collapse')).toBeNull()
    })
  })

  describe('permissions', () => {
    it('folds the 57 keys of an academy admin into 23 closed areas with translated headings and counts', async () => {
      record()
      renderProfile(makeAuth({ user: makeUser({ permissions: ADMIN_SESSION_PERMISSIONS }) }))

      const permissions = card(i18n.t('profile.permissions', { count: 57 }))
      const { titles, counts } = areasOf(permissions)
      expect(titles).toEqual([
        ar.nav.settings,
        ar.nav.branches,
        ar.nav.users,
        ar.nav.roles,
        ar.profile.permissionModules.guardians,
        ar.nav.courses,
        ar.nav.classes,
        ar.profile.permissionModules.enrollments,
        ar.nav.schedule,
        ar.nav.lessons,
        ar.profile.permissionModules.recordings,
        ar.profile.permissionModules.attendance,
        ar.nav.assignments,
        ar.nav.exams,
        ar.profile.permissionModules.questions,
        ar.profile.permissionModules.grades,
        ar.nav.certificates,
        ar.profile.permissionModules.invoices,
        ar.nav.payments,
        ar.profile.permissionModules.fee_plans,
        ar.nav.notifications,
        ar.nav.reports,
        ar.nav.audit,
      ])
      expect(counts).toEqual([2, 1, 6, 1, 1, 2, 3, 3, 2, 2, 1, 2, 4, 4, 1, 4, 5, 4, 2, 1, 2, 3, 1])
      // No wall of tags: every area starts closed and no key is on the page yet.
      expect(permissions.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0)
      expect(permissions.querySelectorAll('code')).toHaveLength(0)

      const users = areaHeader(permissions, ar.nav.users)
      await userEvent.click(users)

      expect(users).toHaveAttribute('aria-expanded', 'true')
      const contact = await within(permissions).findByText('users.read_contact')
      expect(contact).toHaveAttribute('dir', 'ltr')
      expect(contact.closest('code')).not.toBeNull()
      expect([...permissions.querySelectorAll('code')].map((node) => node.textContent)).toEqual([
        'users.create',
        'users.deactivate',
        'users.read',
        'users.read_contact',
        'users.roles.assign',
        'users.update',
      ])
      expect(within(permissions).queryByText('roles.manage')).not.toBeInTheDocument()
    })

    it('shows a student only the areas they hold, and an area unknown to the catalog by its prefix', async () => {
      record()
      const permissionKeys = [...STUDENT_SESSION_PERMISSIONS, 'zeta.run']
      renderProfile(makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: permissionKeys }) }))

      const permissions = card(i18n.t('profile.permissions', { count: 11 }))
      expect(areasOf(permissions)).toEqual({
        titles: [
          ar.nav.courses,
          ar.nav.schedule,
          ar.nav.lessons,
          ar.nav.assignments,
          ar.nav.exams,
          ar.profile.permissionModules.grades,
          ar.nav.certificates,
          ar.profile.permissionModules.invoices,
          'zeta',
        ],
        counts: [1, 1, 1, 2, 2, 1, 1, 1, 1],
      })
      expect(within(permissions).getByText('zeta')).toHaveAttribute('dir', 'ltr')

      await userEvent.click(areaHeader(permissions, ar.profile.permissionModules.grades))
      expect(await within(permissions).findByText('grades.read_own')).toHaveAttribute('dir', 'ltr')
    })
  })

  describe('password change', () => {
    it('validates the three fields in Arabic before sending anything', async () => {
      const calls = record()
      renderProfile(makeAuth({ user: makeUser() }))

      const user = userEvent.setup()
      await user.click(passwordForm().save)
      // antd shows each field's message once that field's validation settles: the first can be on
      // screen before the other two (seen under load), so wait for all of them (KI-060).
      await waitFor(() => expect(within(passwordForm().form).getAllByText(ar.login.passwordRequired)).toHaveLength(3))

      const { fields } = await fillPasswords('OldSecret123', 'short', 'different')
      await waitFor(() => {
        expect(within(fields.form).getByText(i18n.t('profile.errors.password_weak', { min: 10 }))).toBeInTheDocument()
        expect(within(fields.form).getByText(ar.profile.errors.mismatch)).toBeInTheDocument()
      })
      await user.click(fields.save)
      await act(async () => {})
      expect(calls).toEqual([])
    })

    it('sends the current and the new password only, then confirms, clears the form and re-reads the user', async () => {
      const calls = record((url) => (url === '/api/auth/password' ? jsonResponse(204) : jsonResponse(404)))
      setAccessToken('access-1', 'user-1')
      const auth = makeAuth({ user: makeUser() })
      renderProfile(auth)

      const { user, fields } = await fillPasswords('OldSecret123', 'NewSecret4567')
      await user.click(fields.save)

      expect(await screen.findByText(ar.profile.passwordChanged)).toBeInTheDocument()
      expect(calls).toEqual([
        {
          request: 'POST /api/auth/password',
          body: { currentPassword: 'OldSecret123', newPassword: 'NewSecret4567' },
          authorization: 'Bearer access-1',
        },
      ])
      await waitFor(() => expect(auth.reloadUser).toHaveBeenCalledTimes(1))
      expect(passwordForm().current).toHaveValue('')
      expect(passwordForm().next).toHaveValue('')
      expect(passwordForm().confirm).toHaveValue('')
      expect(within(fields.form).queryByRole('alert')).not.toBeInTheDocument()
    })

    it("explains the server's refusals in the words of the auth dictionary and keeps the form", async () => {
      const answers = [
        jsonResponse(400, { statusCode: 400, code: 'password_invalid', message: 'Current password is incorrect' }),
        jsonResponse(400, { statusCode: 400, code: 'password_weak', message: 'New password does not meet the policy', problems: ['different from the current password'] }),
        jsonResponse(429, { statusCode: 429, code: 'rate_limited', message: 'Too many requests; try again later' }),
      ]
      const calls = record(() => answers.shift() ?? jsonResponse(500))
      const auth = makeAuth({ user: makeUser() })
      renderProfile(auth)

      const { user, fields } = await fillPasswords('OldSecret123', 'OldSecret123')
      await user.click(fields.save)
      expect(await within(fields.form).findByRole('alert')).toHaveTextContent(ar.profile.errors.password_invalid)

      await user.click(fields.save)
      await waitFor(() =>
        expect(within(fields.form).getByRole('alert')).toHaveTextContent(i18n.t('profile.errors.password_weak', { min: 10 })),
      )

      await user.click(fields.save)
      await waitFor(() => expect(within(fields.form).getByRole('alert')).toHaveTextContent(ar.login.errors.rate_limited))

      expect(calls.map((call) => call.request)).toEqual([
        'POST /api/auth/password',
        'POST /api/auth/password',
        'POST /api/auth/password',
      ])
      expect(fields.current).toHaveValue('OldSecret123')
      expect(auth.reloadUser).not.toHaveBeenCalled()
    })

    it('asks a user who must change the password to do it first', () => {
      record()
      renderProfile(makeAuth({ user: makeUser({ mustChangePassword: true }) }))

      expect(screen.getByRole('alert')).toHaveTextContent(ar.profile.mustChangePassword)
    })
  })

  describe('signing out', () => {
    it('logs out everywhere through POST /api/auth/logout-all with the session token and lands on the login page', async () => {
      const calls = record((url) => {
        if (url === '/api/auth/refresh') return jsonResponse(200, sessionResponse('access-1'))
        if (url === '/api/auth/logout-all') return jsonResponse(204)
        return jsonResponse(404)
      })
      renderProfileWithProvider()

      await userEvent.click(await findButton(ar.common.logoutAll))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
      expect(calls.map((call) => call.request)).toEqual(['POST /api/auth/refresh', 'POST /api/auth/logout-all'])
      expect(calls[1].authorization).toBe('Bearer access-1')
      expect(getAccessToken()).toBeNull()
    })

    it('still lands on the login page, signed out here, and says so when the server does not confirm', async () => {
      record((url) => {
        if (url === '/api/auth/refresh') return jsonResponse(200, sessionResponse('access-1'))
        if (url === '/api/auth/logout-all') return jsonResponse(503, { statusCode: 503, message: 'Service Unavailable' })
        return jsonResponse(404)
      })
      renderProfileWithProvider()

      await userEvent.click(await findButton(ar.common.logoutAll))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
      expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
      expect(getAccessToken()).toBeNull()
    })

    it('logs out of this device only with the plain sign-out button', async () => {
      record()
      const auth = makeAuth({ user: makeUser() })
      renderProfile(auth)

      await userEvent.click(await findButton(ar.common.logout))

      expect(await screen.findByTestId('location')).toHaveAttribute('data-pathname', '/login')
      expect(auth.logout).toHaveBeenCalledTimes(1)
      expect(auth.logoutAll).not.toHaveBeenCalled()
    })
  })
})
