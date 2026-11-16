import { createContext, useContext } from 'react'
import type { MfaChallenge, MfaFactor } from '../api/auth'
import type { SessionResponse } from '../api/client'
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
  /** From the session (CH-0226): when the current address was confirmed, null while not; undefined when the server does not say. */
  emailVerifiedAt?: string | null
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /**
   * Signs in with e-mail or username; rejects with ApiError (code) on failure.
   * Resolves to the user once signed in — or, for an account with two-step
   * verification, to the challenge of the second step (`isMfaChallenge()`):
   * then nobody is signed in yet and `completeMfaLogin` finishes the sign-in.
   */
  login: (identifier: string, password: string) => Promise<AuthUser | MfaChallenge>
  /**
   * The second step of a sign-in (API-211): the challenge string from `login`
   * (or from a confirmed password reset) with the authenticator's code or a
   * recovery code. Signs the user in; rejects with ApiError (code) on failure.
   */
  completeMfaLogin: (challenge: string, factor: MfaFactor) => Promise<AuthUser>
  /** Ends the session on this device. */
  logout: () => Promise<void>
  /** Ends the session on every device. */
  logoutAll: () => Promise<void>
  /** Re-reads the current user from the server (after a password change etc.). */
  reloadUser: () => Promise<void>
  /**
   * Makes a session the server just opened the current one (invitation accepted,
   * password reset confirmed — MOD-03-T12); the caller has already stored the access token.
   */
  adoptSession: (session: SessionResponse) => AuthUser
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
