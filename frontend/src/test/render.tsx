import { render } from '@testing-library/react'
import type { RenderOptions, RenderResult } from '@testing-library/react'
import { App as AntdApp, ConfigProvider } from 'antd'
import arEG from 'antd/locale/ar_EG'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { InitialEntry } from 'react-router'
import { vi } from 'vitest'
import { AuthContext } from '../auth/auth-context'
import type { AuthContextValue, AuthUser } from '../auth/auth-context'

/** A signed-in academy admin unless overridden. */
export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    name: 'مدير الاختبار',
    email: 'admin@test.local',
    username: 'admin',
    role: 'admin',
    roles: ['academy_admin'],
    permissions: ['users.read', 'users.read_contact'],
    mustChangePassword: false,
    ...overrides,
  }
}

/**
 * Stand-in for AuthProvider: anonymous by default, authenticated when `user`
 * is given. Every action is a spy the test can program (`vi.mocked(auth.login)…`).
 */
export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user ?? null
  return {
    status: user ? 'authenticated' : 'anonymous',
    user,
    login: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    reloadUser: vi.fn(),
    hasPermission: (key) => user?.permissions.includes(key) ?? false,
    ...overrides,
  }
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Auth state seen by `useAuth()`; defaults to an anonymous visitor. */
  auth?: AuthContextValue
  /** Where the in-memory router starts (`'/users'` or `{ pathname, state }`); `ui` is mounted there. */
  route?: InitialEntry
  /** Additional routes (path → element), e.g. a `LocationProbe` at a redirect target. */
  routes?: Record<string, ReactNode>
}

/**
 * Renders `ui` inside the providers the app uses (Ant Design, auth context,
 * router). The real i18n instance is loaded once per file by src/test/setup.ts.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { auth = makeAuth(), route = '/', routes = {}, ...renderOptions } = options
  const pathname = typeof route === 'string' ? (route.split(/[?#]/)[0] ?? '/') : (route.pathname ?? '/')

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ConfigProvider direction="rtl" locale={arEG}>
        <AntdApp>
          <AuthContext value={auth}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path={pathname} element={children} />
                {Object.entries(routes).map(([path, element]) => (
                  <Route key={path} path={path} element={element} />
                ))}
              </Routes>
            </MemoryRouter>
          </AuthContext>
        </AntdApp>
      </ConfigProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}
