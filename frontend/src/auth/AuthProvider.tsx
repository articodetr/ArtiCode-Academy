import { App } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as authApi from '../api/auth'
import type { SessionResponse, SessionUser } from '../api/auth'
import { AuthContext } from './auth-context'
import type { AuthContextValue, AuthStatus, AuthUser } from './auth-context'
import { primaryRole } from './roles'
import { onSessionLost, onSessionSwitched, setAccessToken } from './token-store'

// Real authentication (MOD-01): the access token lives in memory only
// (token-store.ts) and the refresh token in an httpOnly cookie set by the
// server. On load the provider asks the server for a fresh access token; when
// that fails the visitor is anonymous.

function toAuthUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    name: user.displayName?.trim() || user.fullName,
    email: user.email,
    username: user.username,
    role: primaryRole(user.roles),
    roles: user.roles,
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
  }
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  useEffect(() => {
    let cancelled = false
    authApi
      .refreshSession()
      .then((session) => {
        if (!cancelled) setState({ status: 'authenticated', user: toAuthUser(session.user) })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anonymous', user: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A failed refresh anywhere in the app (expired cookie, revoked session) signs the user out.
  useEffect(() => onSessionLost(() => setState({ status: 'anonymous', user: null })), [])

  // The refresh cookie is shared by every tab: when another tab signed in as
  // someone else, this tab now runs as that user. Show who it is (the guards
  // re-evaluate) and say why; the request that hit the switch was not replayed (KI-046).
  const { message } = App.useApp()
  const { t } = useTranslation()
  useEffect(
    () =>
      onSessionSwitched((session) => {
        const user = toAuthUser(session.user)
        setState({ status: 'authenticated', user })
        message.warning({ content: t('login.sessionSwitched', { name: user.name }), duration: 10 })
      }),
    [message, t],
  )

  const login = useCallback(async (identifier: string, password: string) => {
    const session = await authApi.login(identifier, password)
    const user = toAuthUser(session.user)
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setState({ status: 'anonymous', user: null })
  }, [])

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll()
    } finally {
      setAccessToken(null)
      setState({ status: 'anonymous', user: null })
    }
  }, [])

  const reloadUser = useCallback(async () => {
    const user = toAuthUser(await authApi.fetchMe())
    setState({ status: 'authenticated', user })
  }, [])

  // The public account pages (invitation, password reset) receive a session
  // from the server exactly like login; the access token is already stored.
  const adoptSession = useCallback((session: SessionResponse) => {
    const user = toAuthUser(session.user)
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      login,
      logout,
      logoutAll,
      reloadUser,
      adoptSession,
      hasPermission: (key) => state.user?.permissions.includes(key) ?? false,
    }),
    [state, login, logout, logoutAll, reloadUser, adoptSession],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
