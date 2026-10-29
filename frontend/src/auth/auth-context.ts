import { createContext, useContext } from 'react'
import type { Role } from './roles'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
}

export interface LoginInput {
  email: string
  role: Role
}

export interface AuthContextValue {
  user: AuthUser | null
  /** Mock login: accepts any credentials and stores the chosen role locally. */
  login: (input: LoginInput) => void
  logout: () => void
  /** Preview helper: changes the current role without re-authenticating. */
  switchRole: (role: Role) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return value
}
