// Shell of the public token pages (MOD-03-T12; redesigned 2026-11-14): the
// sign-in page's brand block and white form side, centred on its own, with a
// purpose line and the language switcher, so the pages work in RTL and LTR alike (T12 AC4).
import { Alert, Button, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import '../pages/LoginPage.css'
import './PublicCard.css'

export function PublicCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="login-page public-page">
      <main className="login-form-side">
        <div className="login-form-box">
          <div className="login-brand">
            <span className="login-brand__mark" aria-hidden="true" />
            <span className="login-brand__name">{t('common.appName')}</span>
          </div>
          <Typography.Title level={2} className="login-title">
            {subtitle}
          </Typography.Title>
          <div className="public-page__body">{children}</div>
          <div className="login-footer">
            <LanguageSwitcher />
          </div>
        </div>
      </main>
    </div>
  )
}

/** A link that can never work (invalid, used, expired): the reason and the way to the login page, no form. */
export function DeadLinkNotice({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <>
      <Alert type="warning" showIcon title={message} />
      <div className="public-page__actions">
        <Link to="/login">
          <Button>{t('account.goToLogin')}</Button>
        </Link>
      </div>
    </>
  )
}
