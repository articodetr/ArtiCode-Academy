import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './auth-context'
import type { AuthContextValue, AuthUser } from './auth-context'
import { isRole } from './roles'

// Mock authentication only. No backend call is made; the session is kept in
// localStorage so a page reload keeps the preview going. Replaced by MOD-01.
const STORAGE_KEY = 'aca.mockUser'

function readStoredUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthUser>
    if (typeof parsed.email === 'string' && isRole(parsed.role)) {
      return {
        id: typeof parsed.id === 'string' ? parsed.id : 'demo-user',
        name: typeof parsed.name === 'string' ? parsed.name : parsed.email,
        email: parsed.email,
        role: parsed.role,
      }
    }
  } catch {
    // Corrupt or unavailable storage: start signed out.
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser)

  useEffect(() => {
    try {
      if (user) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // Persistence is best-effort.
    }
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login: ({ email, role }) =>
        setUser({
          id: 'demo-user',
          name: email.split('@')[0] || email,
          email,
          role,
        }),
      logout: () => setUser(null),
      switchRole: (role) =>
        setUser((current) => (current ? { ...current, role } : current)),
    }),
    [user],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
