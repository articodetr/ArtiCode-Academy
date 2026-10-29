import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { canAccess } from '../layout/navigation'
import { ForbiddenPage } from '../pages/ForbiddenPage'
import { useAuth } from './auth-context'

/** Redirects signed-out visitors to the login page, remembering where they came from. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

/** UI-level gate only (not a security boundary): hides pages the current role should not see. */
export function RequireRole({
  navKey,
  children,
}: {
  navKey: string
  children: ReactNode
}) {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
  }
  if (!canAccess(user.role, navKey)) {
    return <ForbiddenPage />
  }
  return children
}
