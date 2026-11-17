import { App } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as authApi from '../api/auth'
import type { MfaFactor, SessionResponse, SessionUser } from '../api/auth'
import { isSessionRejected } from '../api/client'
import { AuthContext } from './auth-context'
import type { AuthContextValue, AuthStatus, AuthUser } from './auth-context'
import { primaryRole } from './roles'
import { SessionCheckFailed } from './SessionCheckFailed'
import { SESSION_CHECK_RETRIES, sessionCheckDelay, sessionCheckProblem } from './sessionCheck'
import type { SessionCheckProblem } from './sessionCheck'
import { onSessionLost, onSessionSwitched, setAccessToken } from './token-store'

// Real authentication (MOD-01): the access token lives in memory only
// (token-store.ts) and the refresh token in an httpOnly cookie set by the
// server. On load the provider asks the server for a fresh access token; when
// the server answers that there is no session (a 401) the visitor is anonymous.
// Any other failure — a 429 (the refresh limit counts per IP, and a school
// network shares one), a network error, a 5xx — says nothing about the cookie:
// the check stays 'loading' and is asked again a bounded number of times, then
// SessionCheckFailed says so instead of showing the sign-in form (CH-0296).

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
    emailVerifiedAt: user.emailVerifiedAt,
  }
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
  // Bumped by «try again» to run the start-up check once more.
  const [checkRun, setCheckRun] = useState(0)
  // Set when the start-up check still could not tell after its retries.
  const [checkProblem, setCheckProblem] = useState<SessionCheckProblem | null>(null)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const attempt = (retry: number) => {
      // Every attempt goes through refreshSession(): the Web Lock and the session-switch rule hold (KI-046/KI-047).
      authApi.refreshSession().then(
        (session) => {
          if (!cancelled) setState({ status: 'authenticated', user: toAuthUser(session.user) })
        },
        (error: unknown) => {
          if (cancelled) return
          if (isSessionRejected(error)) setState({ status: 'anonymous', user: null })
          else if (retry < SESSION_CHECK_RETRIES) {
            retryTimer = setTimeout(() => attempt(retry + 1), sessionCheckDelay(error, retry))
          } else setCheckProblem(sessionCheckProblem(error))
        },
      )
    }
    attempt(0)
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [checkRun])

  const retryCheck = useCallback(() => {
    setCheckProblem(null)
    setCheckRun((run) => run + 1)
  }, [])

  // The sign-in stays reachable: give up on the stored session and go on signed out.
  const continueSignedOut = useCallback(() => {
    setCheckProblem(null)
    setState({ status: 'anonymous', user: null })
  }, [])

  // A refresh the server refused anywhere in the app (a 401: expired cookie, revoked session) signs the user out;
  // a rate-limited or unreachable refresh does not (refreshSession() announces the 401 only).
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
    const result = await authApi.login(identifier, password)
    // Two-step verification: a correct password opens no session. The visitor stays
    // signed out until the second step (completeMfaLogin) succeeds.
    if (authApi.isMfaChallenge(result)) return result
    const user = toAuthUser(result.user)
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const completeMfaLogin = useCallback(async (challenge: string, factor: MfaFactor) => {
    const session = await authApi.completeMfaLogin(challenge, factor)
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
      completeMfaLogin,
      logout,
      logoutAll,
      reloadUser,
      adoptSession,
      hasPermission: (key) => state.user?.permissions.includes(key) ?? false,
    }),
    [state, login, completeMfaLogin, logout, logoutAll, reloadUser, adoptSession],
  )

  return (
    <AuthContext value={value}>
      {checkProblem && state.status === 'loading' ? (
        <SessionCheckFailed problem={checkProblem} onRetry={retryCheck} onContinue={continueSignedOut} />
      ) : (
        children
      )}
    </AuthContext>
  )
}
