// The calm answer whenever the academy is not taking registrations: the reason and the way to sign in, and no form.
import { Alert, Flex } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function RegistrationClosedNotice({ from = null }: { from?: string | null }) {
  const { t } = useTranslation()
  return (
    <>
      <Alert
        type="info"
        showIcon
        title={t('studentRegistration.closed.title')}
        description={t('studentRegistration.closed.text')}
      />
      <Flex justify="center" style={{ marginTop: 16 }}>
        <Link to="/login" state={from ? { from } : undefined}>
          {t('studentRegistration.closed.signIn')}
        </Link>
      </Flex>
    </>
  )
}
