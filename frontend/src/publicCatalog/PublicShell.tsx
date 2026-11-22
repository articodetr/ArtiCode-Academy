// The frame of the academy's public pages (MOD-20, D-R138; PORTAL-04 #208):
// a header with the academy's logo and name (API-205 — a neutral «الأكاديمية»
// after a failed read, nothing while it runs; a plain book badge stands in for a
// logo the academy has not set, never a product mark) leading to the public home
// page (/home), the main links («الرئيسية», «البرامج»), the language switch and
// one action that follows the session — «تسجيل الدخول» for a visitor, «مدرستي»
// for a learner, «لوحة التحكم» for staff, nothing while the session is still
// being restored — then the page and a footer with the academy's name, the same
// links, the certificate check and the copyright in the academy's name. A page
// that reads API-205 itself hands its reading in (`academy`), so the header never
// asks twice. `bleed` lets a page lay out full-width bands of its own (/home);
// the other pages sit in the centred column. `PublicOnly` keeps a page for
// visitors: a signed-in user goes (replace) to the signed-in catalog, and a
// spinner shows while the session is still being restored.
//
// The header is sticky from a tablet up; on a phone it is two rows — the brand
// and the action, then the links and the language switch. The colours are CSS
// custom properties on `.public-catalog` (publicCatalog.css), ready for an
// academy's own colours once the server offers them.
import { AppstoreOutlined, DashboardOutlined, LoginOutlined, ReadOutlined } from '@ant-design/icons'
import { Button, Spin } from 'antd'
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
import { PublicAcademyNameContext } from './pageTitle'
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

/**
 * `catalogOpen`: a page that knows better than API-205 whether the catalog answers (the home page reads API-236
 * itself) hands its answer in; null or absent = API-205's `catalogPublic`.
 */
export function PublicShell({
  children,
  academy,
  catalogOpen,
  bleed = false,
}: {
  children: ReactNode
  academy?: PublicAcademyReading
  catalogOpen?: boolean | null
  bleed?: boolean
}) {
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
  const programs = showsProgramsLink(viewer, catalogOpen ?? isCatalogPublic(reading.academy))

  return (
    <div className="public-catalog">
      <header className="public-catalog__header">
        <div className="public-catalog__header-inner">
          <Link to="/home" className="public-catalog__brand" title={name || undefined}>
            {logo ? (
              <img className="public-catalog__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} />
            ) : name ? (
              <span className="public-catalog__mark" aria-hidden="true">
                <ReadOutlined />
              </span>
            ) : null}
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
        </div>
      </header>
      <main className={bleed ? 'public-catalog__main public-catalog__main--bleed' : 'public-catalog__main'}>
        <PublicAcademyNameContext value={name}>{children}</PublicAcademyNameContext>
      </main>
      <footer className="public-catalog__footer" data-testid="public-footer">
        <div className="public-catalog__footer-inner">
          <div className="public-catalog__footer-top">
            {/* The academy's own name only — never a fallback or the product's name (the site is the academy's). */}
            {reading.academy && name ? (
              <bdi dir="auto" className="public-catalog__footer-name">
                {name}
              </bdi>
            ) : (
              <span />
            )}
            <nav className="public-catalog__footer-links" aria-label={t('publicCatalog.footer.navLabel')}>
              <Link to="/home">{t('publicCatalog.header.homeLink')}</Link>
              {programs ? <Link to={programsPathFor(viewer)}>{t('publicCatalog.header.programsLink')}</Link> : null}
              <Link to="/verify">{t('publicCatalog.footer.verifyCertificate')}</Link>
            </nav>
          </div>
          {reading.academy && name ? <div className="public-catalog__copyright">{t('publicCatalog.footer.copyright', { year, name })}</div> : null}
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
    <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
      {t('publicCatalog.header.signIn')}
    </Button>
  )
}
