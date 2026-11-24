// The calm answer whenever the academy is not taking registrations: the reason and the way to sign in (carrying the
// return path as `?returnTo=`), and no form.
import { Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { withReturnTo } from '../auth/returnPath'

export function RegistrationClosedNotice({ from = null }: { from?: string | null }) {
  const { t } = useTranslation()
  return (
    <>
      <Alert type="info" showIcon title={t('studentRegistration.closed.title')} description={t('studentRegistration.closed.text')} />
      <div className="auth-layout__links">
        <Link to={withReturnTo('/login', from)}>{t('studentRegistration.closed.signIn')}</Link>
      </div>
    </>
  )
}
