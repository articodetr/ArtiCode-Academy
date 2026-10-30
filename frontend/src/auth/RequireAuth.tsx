import { Spin } from 'antd'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { ForbiddenPage } from '../pages/ForbiddenPage'
import { isAllowed } from './access'
import type { AccessRule } from './access'
import { useAuth } from './auth-context'

function SessionLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  )
}

/** Waits for the session check, then redirects signed-out visitors to the login page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionLoading />
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

/**
 * UI-level gate (not a security boundary — the server enforces permissions):
 * shows the 403 page instead of a screen the user may not open. Accepts a
 * navigation key (its entry decides by permission or by the role matrix), a
 * permission key, a role, or several of them together (MOD-03-T15).
 */
export function RequireAccess({ navKey, permission, role, children }: AccessRule & { children: ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') return <SessionLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!isAllowed(user, { navKey, permission, role })) return <ForbiddenPage />
  return children
}
