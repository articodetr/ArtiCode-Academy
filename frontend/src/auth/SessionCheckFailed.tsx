import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SessionCheckProblem } from './sessionCheck'

interface SessionCheckFailedProps {
  problem: SessionCheckProblem
  /** Asks the server again (the same bounded retries). */
  onRetry: () => void
  /** Gives up on the stored session: the visitor is treated as signed out and reaches the sign-in form. */
  onContinue: () => void
}

/**
 * Shown by AuthProvider instead of the app when the start-up session check
 * could not tell whether the visitor is signed in (rate-limited, offline or a
 * server error after its retries) — never the sign-in form, which would sign
 * out a visitor whose session is still valid.
 */
export function SessionCheckFailed({ problem, onRetry, onContinue }: SessionCheckFailedProps) {
  const { t } = useTranslation()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Result
        status="warning"
        title={t('login.sessionCheck.title')}
        subTitle={t(`login.sessionCheck.${problem}`)}
        extra={[
          <Button key="retry" type="primary" onClick={onRetry}>
            {t('login.sessionCheck.retry')}
          </Button>,
          <Button key="continue" onClick={onContinue}>
            {t('login.sessionCheck.continue')}
          </Button>,
        ]}
      />
    </div>
  )
}
