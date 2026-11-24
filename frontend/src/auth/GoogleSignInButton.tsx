// «المتابعة باستخدام Google» (PORTAL-04 — the shared contract B), on the sign-in and the registration cards. A white
// button with a light border and Google's own multi-colour «G», as Google's branding guidelines ask. One press asks the
// server to start (POST /api/auth/google/start with the return path) and the page then leaves for Google's address with
// a full navigation; while that runs the button waits, and a refusal (503 google_unavailable, no network) is worded
// under it and the button works again. Off — disabled, with a short reason under it — whenever the server does not say
// Google is configured (API-205 `googleSignIn`) or, on the registration card, that a new account may come through it
// (`googleSignUp`). Nothing is stored: the server keeps the state of the sign-in in its own short-lived cookie.
import { Alert, Button } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { browserNavigation, startGoogleSignIn } from '../api/google'
import { describeGoogleStartFailure } from './google.signIn'
import { namesAPage } from './returnPath'
import './GoogleSignInButton.css'

interface GoogleSignInButtonProps {
  /** The server says the way through Google is open. */
  enabled: boolean
  /** Why the button is off, shown under it; null while the academy is still being read. */
  disabledHint?: string | null
  /** Where to come back to after Google, checked by the server's rule (returnPath.ts); null or `/` sends none. */
  returnTo: string | null
}

export function GoogleSignInButton({ enabled, disabledHint = null, returnTo }: GoogleSignInButtonProps) {
  const { t } = useTranslation()
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // A second press lands before React has re-rendered the waiting button: one start per press.
  const busy = useRef(false)
  const hintId = useId()

  // Back from Google with the browser's back button, the page may come out of the back-forward cache with the button
  // still waiting: it works again.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      busy.current = false
      setWaiting(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const start = async () => {
    if (busy.current || !enabled) return
    busy.current = true
    setFailure(null)
    setWaiting(true)
    let url: string
    try {
      url = await startGoogleSignIn(namesAPage(returnTo) ? returnTo : null)
    } catch (error) {
      busy.current = false
      setWaiting(false)
      setFailure(describeGoogleStartFailure(error))
      return
    }
    // The page leaves now; the button keeps waiting until it does.
    browserNavigation.assign(url)
  }

  const showsHint = !enabled && Boolean(disabledHint)
  return (
    <div className="google-sign-in">
      <Button
        block
        className="google-sign-in__button"
        icon={<GoogleMark />}
        disabled={!enabled}
        loading={waiting}
        aria-describedby={showsHint ? hintId : undefined}
        onClick={() => void start()}
      >
        {waiting ? t('login.google.redirecting') : t('login.google.button')}
      </Button>
      {showsHint ? (
        <div id={hintId} className="google-sign-in__hint" data-testid="google-sign-in-hint">
          {disabledHint}
        </div>
      ) : null}
      {failure ? <Alert type="error" showIcon title={t(failure)} className="google-sign-in__failure" /> : null}
    </div>
  )
}

/** Google's «G» in its four colours (the standard mark of Google's sign-in branding), decorative: the label names it. */
export function GoogleMark() {
  return (
    <svg className="google-sign-in__mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )
}
