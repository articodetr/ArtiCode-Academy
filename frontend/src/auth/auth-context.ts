import { createContext, useContext } from 'react'
import type { Role } from './roles'

export interface AuthUser {
  id: string
  /** Display name (falls back to the full name). */
  name: string
  email: string | null
  username: string | null
  /** UI role derived from the server roles; null when the user holds no known role. */
  role: Role | null
  /** Server role keys, e.g. `academy_admin`. */
  roles: string[]
  /** Permission keys granted through the roles (ADR-023). */
  permissions: string[]
  mustChangePassword: boolean
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** Signs in with e-mail or username; rejects with ApiError (code) on failure. */
  login: (identifier: string, password: string) => Promise<AuthUser>
  /** Ends the session on this device. */
  logout: () => Promise<void>
  /** Ends the session on every device. */
  logoutAll: () => Promise<void>
  /** Re-reads the current user from the server (after a password change etc.). */
  reloadUser: () => Promise<void>
  hasPermission: (key: string) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return value
}
