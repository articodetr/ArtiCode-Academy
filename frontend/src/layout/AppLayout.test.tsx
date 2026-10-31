import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AppLayout } from './AppLayout'

function menuLabels(): string[] {
  return within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '')
}

describe('AppLayout navigation', () => {
  it('shows a custom role holding users.read only the dashboard and the users page (AC1)', () => {
    const custom = makeUser({ role: null, roles: ['auditor'], permissions: ['users.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: custom }), route: '/users' })
    expect(menuLabels()).toEqual([ar.nav.dashboard, ar.nav.users])
  })

  it('adds the roles and audit entries for their permission holders and hides them from a student', () => {
    const { unmount } = renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'roles.manage', 'audit.read', 'academy.settings.read'] }) }),
      route: '/',
    })
    const admin = menuLabels()
    expect(admin).toContain(ar.nav.roles)
    expect(admin).toContain(ar.nav.audit)
    expect(admin.indexOf(ar.nav.roles)).toBe(admin.indexOf(ar.nav.users) + 1)
    expect(admin.indexOf(ar.nav.audit)).toBe(admin.indexOf(ar.nav.settings) - 1)
    unmount()

    const student = makeUser({ role: 'student', roles: ['student'], permissions: ['courses.read'] })
    renderWithProviders(<AppLayout />, { auth: makeAuth({ user: student }), route: '/' })
    const labels = menuLabels()
    expect(labels).toContain(ar.nav.courses)
    expect(labels).not.toContain(ar.nav.users)
    expect(labels).not.toContain(ar.nav.roles)
    expect(labels).not.toContain(ar.nav.audit)
  })

  it('selects the roles entry on /settings/roles rather than the settings entry', () => {
    renderWithProviders(<AppLayout />, {
      auth: makeAuth({ user: makeUser({ permissions: ['roles.manage'] }) }),
      route: '/settings/roles',
    })
    const selected = document.querySelectorAll('.ant-menu-item-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent(ar.nav.roles)
  })
})
