// Shell of the public token pages (MOD-03-T12): the same centred card as the
// login page with the app name, a purpose line and the language switcher, so
// the pages work in RTL and LTR alike (T12 AC4).
import { Alert, Button, Card, Flex, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import '../pages/LoginPage.css'

export function PublicCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="login-page">
      <Card className="login-card">
        <div className="login-header">
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {t('common.appName')}
          </Typography.Title>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        </div>
        {children}
        <div className="login-footer">
          <LanguageSwitcher />
        </div>
      </Card>
    </div>
  )
}

/** A link that can never work (invalid, used, expired): the reason and the way to the login page, no form. */
export function DeadLinkNotice({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <>
      <Alert type="warning" showIcon message={message} />
      <Flex justify="center" style={{ marginTop: 16 }}>
        <Link to="/login">
          <Button>{t('account.goToLogin')}</Button>
        </Link>
      </Flex>
    </>
  )
}
