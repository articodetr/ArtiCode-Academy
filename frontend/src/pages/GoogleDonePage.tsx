// /auth/google/done?returnTo=… (PORTAL-04 — the shared contract B): Google's callback set the session cookie exactly as
// a password sign-in sets it and sent the browser here. The page is a full load, so the AuthProvider restores that
// session as on any start; this page waits for it, then goes on (replace) where a sign-in goes (returnPath.ts): the
// return path when it names a page, else for a student the course kept on this device while registering, else the home
// page (the profile page first while the password must be changed). When no session appears, it says so with the way
// back to the sign-in page. It reads nothing itself and stores nothing.
import { Alert, Button } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { AuthLayout, AuthLoading } from '../auth/AuthLayout'
import { returnToOf, signInTarget, withReturnTo } from '../auth/returnPath'
import { clearKeptCourse, readKeptCourse } from '../studentRegistration/keptCourse'

export function GoogleDonePage() {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = returnToOf(location.search)
  // Read once, so the redirect names one destination even after the course is cleared.
  const [keptCourse] = useState(() => readKeptCourse())
  const target = status === 'authenticated' && user ? signInTarget(user, returnTo, keptCourse) : null
  const usedKeptCourse = target?.usesKeptCourse === true

  // The kept course is offered once.
  useEffect(() => {
    if (usedKeptCourse) clearKeptCourse()
  }, [usedKeptCourse])

  if (status === 'loading') return <AuthLoading label={t('login.google.done.waiting')} />
  if (target) return <Navigate to={target.path} state={target.state} replace />

  return (
    <AuthLayout title={t('login.google.done.subtitle')}>
      <Alert type="error" showIcon title={t('login.google.done.failedTitle')} description={t('login.google.done.failedText')} />
      <div className="auth-layout__links">
        <Button type="primary" onClick={() => navigate(withReturnTo('/login', returnTo))}>
          {t('login.google.done.backToLogin')}
        </Button>
      </div>
    </AuthLayout>
  )
}
