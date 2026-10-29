import { Spin } from 'antd'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { canAccess } from '../layout/navigation'
import { ForbiddenPage } from '../pages/ForbiddenPage'
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
 * hides pages the current role should not see.
 */
export function RequireRole({ navKey, children }: { navKey: string; children: ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') return <SessionLoading />
  if (!user) return <Navigate to="/login" replace />
  if (!canAccess(user.role, navKey)) return <ForbiddenPage />
  return children
}
