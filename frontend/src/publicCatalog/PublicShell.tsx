// The frame of the academy's public pages (MOD-20, D-R138; PORTAL-04 #208):
// a header with the academy's logo and name (API-205 — the static product name
// after a failed read, nothing while it runs) leading to the public home page
// (/home), the main links («الرئيسية», «البرامج»), the language switch and one
// action that follows the session — «تسجيل الدخول» with the line that accounts
// come from the academy (no self-registration exists) for a visitor,
// «مدرستي» for a learner, «لوحة التحكم» for staff, nothing while the session is
// still being restored — then the page and a footer with the same links and
// the certificate check. A page that reads API-205 itself hands its reading in
// (`academy`), so the header never asks twice. `PublicOnly` keeps a page for
// visitors: a signed-in user goes (replace) to the signed-in catalog, and a
// spinner shows while the session is still being restored.
import { AppstoreOutlined, DashboardOutlined, LoginOutlined } from '@ant-design/icons'
import { Button, Spin, Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, useNavigate } from 'react-router'
import { brandLogoSrc } from '../academy/academy.brand'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { isCatalogPublic } from '../api/academy'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { isLearner, programsPathFor, showsProgramsLink, viewerOf } from './publicViewer'
import { useBrandName } from './useBrandName'
import type { PublicViewer } from './publicViewer'
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
  if (status === 'authenticated') return <Navigate to={isLearner(user) ? signedInTo : '/'} replace />
  return children
}

export function PublicShell({ children, academy }: { children: ReactNode; academy?: PublicAcademyReading }) {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const own = usePublicAcademy(academy === undefined)
  const reading = academy ?? own
  const name = useBrandName(reading)
  const logoSrc = brandLogoSrc(reading.academy?.logoUrl, window.location.origin)
  // A logo that failed to load stays hidden.
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const logo = logoSrc !== null && logoSrc !== brokenLogo ? logoSrc : null
  // The year of the footer's notice, taken once per mount.
  const [year] = useState(() => new Date().getFullYear())
  const viewer = viewerOf(status, user)
  const programs = showsProgramsLink(viewer, isCatalogPublic(reading.academy))

  return (
    <div className="public-catalog">
      <header className="public-catalog__header">
        <Link to="/home" className="public-catalog__brand" title={name || undefined}>
          {logo ? <img className="public-catalog__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} /> : null}
          <bdi dir="auto" className="public-catalog__name" data-testid="public-academy-name">
            {name}
          </bdi>
        </Link>
        <nav className="public-catalog__nav" aria-label={t('publicCatalog.header.navLabel')}>
          <NavLink to="/home" end className="public-catalog__nav-link">
            {t('publicCatalog.header.homeLink')}
          </NavLink>
          {programs ? (
            <NavLink to={programsPathFor(viewer)} className="public-catalog__nav-link">
              {t('publicCatalog.header.programsLink')}
            </NavLink>
          ) : null}
        </nav>
        <div className="public-catalog__language">
          <LanguageSwitcher />
        </div>
        <div className="public-catalog__actions">
          <ViewerAction viewer={viewer} />
        </div>
      </header>
      <main className="public-catalog__main">{children}</main>
      <footer className="public-catalog__footer" data-testid="public-footer">
        <div className="public-catalog__footer-inner">
          <nav className="public-catalog__footer-links" aria-label={t('publicCatalog.footer.navLabel')}>
            <Link to="/home">{t('publicCatalog.header.homeLink')}</Link>
            {programs ? <Link to={programsPathFor(viewer)}>{t('publicCatalog.header.programsLink')}</Link> : null}
            <Link to="/verify">{t('publicCatalog.footer.verifyCertificate')}</Link>
          </nav>
          {/* The academy's own name only — never the product name of a failed read (the site is the academy's). */}
          {reading.academy && name ? (
            <Typography.Text type="secondary" className="public-catalog__copyright">
              {t('publicCatalog.footer.copyright', { year, name })}
            </Typography.Text>
          ) : null}
        </div>
      </footer>
    </div>
  )
}

/** The header's one action: sign in (visitor), «مدرستي» (learner), the dashboard (staff), nothing while pending. */
function ViewerAction({ viewer }: { viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (viewer === 'pending') return null
  if (viewer === 'learner') {
    return (
      <Button type="primary" icon={<AppstoreOutlined />} onClick={() => navigate('/my-school')}>
        {t('publicCatalog.header.mySchool')}
      </Button>
    )
  }
  if (viewer === 'staff') {
    return (
      <Button type="primary" icon={<DashboardOutlined />} onClick={() => navigate('/')}>
        {t('publicCatalog.header.dashboard')}
      </Button>
    )
  }
  return (
    <div className="public-catalog__sign-in">
      <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
        {t('publicCatalog.header.signIn')}
      </Button>
      <Typography.Text type="secondary" className="public-catalog__note">
        {t('publicCatalog.header.accountsNote')}
      </Typography.Text>
    </div>
  )
}
