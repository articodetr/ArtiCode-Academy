// The frame of the public catalog pages (MOD-20, D-R138): a simple header with
// the academy's logo and name (API-205 — the static product name after a failed
// read, nothing while it runs), the language switch and «تسجيل الدخول» with the
// line that accounts come from the academy (no self-registration exists), then
// the page. `PublicOnly` keeps the pages for visitors: a signed-in user goes
// (replace) to the signed-in catalog, and a spinner shows while the session is
// still being restored.
import { LoginOutlined } from '@ant-design/icons'
import { Button, Spin, Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { academyBrandName, brandLogoSrc } from '../academy/academy.brand'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useLocalized } from '../i18n/useLocalized'
import './publicCatalog.css'

export function PublicOnly({ signedInTo, children }: { signedInTo: string; children: ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') {
    return (
      <div className="public-catalog__loading" data-testid="public-session-loading">
        <Spin size="large" />
      </div>
    )
  }
  // The signed-in catalog is the learners' screen (nav entry `catalog`: the `student`/`guardian` role keys); anyone else goes home rather than to a 403.
  if (status === 'authenticated') {
    const learner = user?.roles.some((role) => role === 'student' || role === 'guardian') ?? false
    return <Navigate to={learner ? signedInTo : '/'} replace />
  }
  return children
}

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const reading = usePublicAcademy()
  const name = academyBrandName(reading.academy, language) ?? (reading.loading ? '' : t('common.appName'))
  const logoSrc = brandLogoSrc(reading.academy?.logoUrl, window.location.origin)
  // A logo that failed to load stays hidden.
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const logo = logoSrc !== null && logoSrc !== brokenLogo ? logoSrc : null

  return (
    <div className="public-catalog">
      <header className="public-catalog__header">
        <Link to="/explore" className="public-catalog__brand" title={name || undefined}>
          {logo ? <img className="public-catalog__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} /> : null}
          <bdi dir="auto" className="public-catalog__name" data-testid="public-academy-name">
            {name}
          </bdi>
        </Link>
        <div className="public-catalog__actions">
          <LanguageSwitcher />
          <div className="public-catalog__sign-in">
            <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
              {t('publicCatalog.header.signIn')}
            </Button>
            <Typography.Text type="secondary" className="public-catalog__note">
              {t('publicCatalog.header.accountsNote')}
            </Typography.Text>
          </div>
        </div>
      </header>
      <main className="public-catalog__main">{children}</main>
    </div>
  )
}
