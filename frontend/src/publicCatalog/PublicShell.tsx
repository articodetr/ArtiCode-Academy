// The frame of the academy's public pages (MOD-20, D-R138; PORTAL-04 #208):
// a header with the academy's logo and name (API-205 — a neutral «الأكاديمية»
// after a failed read, nothing while it runs; a plain book badge stands in for a
// logo the academy has not set, never a product mark) leading to the public home
// page (/home), the main links («الرئيسية», «البرامج», «الشهادات», «من نحن»), the
// language switch and one action that follows the session — «تسجيل الدخول» for a
// visitor, «فصولي» for a learner, «لوحة التحكم» for staff, nothing while the
// session is still being restored; while the server says the academy lets a visitor
// register (`selfRegistration`), a visitor also gets a quiet «إنشاء حساب» beside the
// sign-in from desktop widths and in the phone menu — then the page and a turquoise footer with the
// academy's name, a line about it, the same links and the copyright in the
// academy's name. There is no blog, contact or social link: the server holds none.
// A page that reads API-205 itself hands its reading in (`academy`), so the
// header never asks twice. `bleed` lets a page lay out full-width bands of its own
// (/home); the other pages sit in the centred column. `PublicOnly` keeps a page
// for visitors: a signed-in user goes (replace) to the signed-in catalog, and a
// spinner shows while the session is still being restored.
//
// The header is sticky; from a tablet down the links and the language switch move
// into a menu behind one button. The colours are CSS custom properties on
// `.public-catalog` (publicCatalog.css), ready for an academy's own colours once
// the server offers them; the same colour and the public typefaces reach Ant
// Design's controls through the nested ConfigProvider.
import { AppstoreOutlined, DashboardOutlined, LoginOutlined, MenuOutlined, ReadOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, ConfigProvider, Drawer, Spin } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, useNavigate } from 'react-router'
import { brandLogoSrc } from '../academy/academy.brand'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { isCatalogPublic, isSelfRegistrationOpen } from '../api/academy'
import { useAuth } from '../auth/auth-context'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useLocalized } from '../i18n/useLocalized'
import { PublicAcademyNameContext } from './pageTitle'
import { isLearner, programsPathFor, showsProgramsLink, viewerOf } from './publicViewer'
import { useBrandName } from './useBrandName'
import type { PublicViewer } from './publicViewer'
import './publicFonts.css'
import './publicCatalog.css'

const PUBLIC_THEME = {
  token: {
    colorPrimary: '#039092',
    borderRadius: 8,
    fontFamily: "'Public Poppins', 'Public Cairo', 'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Noto Sans', system-ui, sans-serif",
  },
}

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

/** The main links, in the header and in the phone menu. */
function MainLinks({ viewer, programs, onNavigate }: { viewer: PublicViewer; programs: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <NavLink to="/home" end className="public-catalog__nav-link" onClick={onNavigate}>
        {t('publicCatalog.header.homeLink')}
      </NavLink>
      {programs ? (
        <NavLink to={programsPathFor(viewer)} className="public-catalog__nav-link" onClick={onNavigate}>
          {t('publicCatalog.header.programsLink')}
        </NavLink>
      ) : null}
      <NavLink to="/verify" className="public-catalog__nav-link" onClick={onNavigate}>
        {t('publicCatalog.header.certificatesLink')}
      </NavLink>
      <Link to="/home#about" className="public-catalog__nav-link" onClick={onNavigate}>
        {t('publicCatalog.header.aboutLink')}
      </Link>
    </>
  )
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
  const { language } = useLocalized()
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
  const [menuOpen, setMenuOpen] = useState(false)
  const viewer = viewerOf(status, user)
  const programs = showsProgramsLink(viewer, catalogOpen ?? isCatalogPublic(reading.academy))
  // A visitor only: `pending` may still turn out to be a signed-in user.
  const offersRegistration = viewer === 'visitor' && isSelfRegistrationOpen(reading.academy)

  return (
    <ConfigProvider theme={PUBLIC_THEME}>
      <div className="public-catalog">
        <header className="public-catalog__header">
          <div className={offersRegistration ? 'public-catalog__header-inner public-catalog__header-inner--register' : 'public-catalog__header-inner'}>
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
              <MainLinks viewer={viewer} programs={programs} />
            </nav>
            {programs ? (
              <Link to={programsPathFor(viewer)} className="public-catalog__search-link" aria-label={t('publicCatalog.header.searchLink')}>
                <SearchOutlined aria-hidden="true" />
              </Link>
            ) : null}
            <div className="public-catalog__language">
              <LanguageSwitcher />
            </div>
            <div className="public-catalog__actions">
              {offersRegistration ? (
                <Link to="/register" className="public-catalog__register">
                  {t('studentRegistration.entry.createAccount')}
                </Link>
              ) : null}
              <ViewerAction viewer={viewer} />
            </div>
            <Button
              className="public-catalog__menu-button"
              icon={<MenuOutlined />}
              aria-label={t('publicCatalog.header.openMenu')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            />
          </div>
        </header>
        <Drawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement={language === 'ar' ? 'right' : 'left'}
          size="min(300px, 86vw)"
          title={name || t('publicCatalog.header.navLabel')}
          rootClassName="public-menu"
          destroyOnHidden
        >
          <nav className="public-menu__nav" aria-label={t('publicCatalog.header.navLabel')}>
            <MainLinks viewer={viewer} programs={programs} onNavigate={() => setMenuOpen(false)} />
            {offersRegistration ? (
              <Link to="/register" className="public-catalog__nav-link" onClick={() => setMenuOpen(false)}>
                {t('studentRegistration.entry.createAccount')}
              </Link>
            ) : null}
          </nav>
          <div className="public-menu__language">
            <LanguageSwitcher />
          </div>
        </Drawer>
        <main className={bleed ? 'public-catalog__main public-catalog__main--bleed' : 'public-catalog__main'}>
          <PublicAcademyNameContext value={name}>{children}</PublicAcademyNameContext>
        </main>
        <footer className="public-catalog__footer" data-testid="public-footer">
          <div className="public-catalog__footer-inner">
            <div className="public-catalog__footer-top">
              <div className="public-catalog__footer-about">
                {/* The academy's own name only — never a fallback or the product's name (the site is the academy's). */}
                {reading.academy && name ? (
                  <bdi dir="auto" className="public-catalog__footer-name">
                    {name}
                  </bdi>
                ) : null}
                <p>{t('publicCatalog.footer.tagline')}</p>
              </div>
              <nav className="public-catalog__footer-links" aria-label={t('publicCatalog.footer.navLabel')}>
                <div>
                  <strong>{t('publicCatalog.footer.quickLinks')}</strong>
                  <Link to="/home">{t('publicCatalog.header.homeLink')}</Link>
                  {programs ? <Link to={programsPathFor(viewer)}>{t('publicCatalog.header.programsLink')}</Link> : null}
                  <Link to="/home#about">{t('publicCatalog.header.aboutLink')}</Link>
                </div>
                <div>
                  <strong>{t('publicCatalog.footer.services')}</strong>
                  <Link to="/verify">{t('publicCatalog.footer.verifyCertificate')}</Link>
                </div>
              </nav>
            </div>
            {reading.academy && name ? <div className="public-catalog__copyright">{t('publicCatalog.footer.copyright', { year, name })}</div> : null}
          </div>
        </footer>
      </div>
    </ConfigProvider>
  )
}

/** The header's one action: sign in (visitor), «فصولي» (learner), the dashboard (staff), nothing while pending. */
function ViewerAction({ viewer }: { viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (viewer === 'pending') return null
  if (viewer === 'learner') {
    return (
      <Button type="primary" icon={<AppstoreOutlined />} onClick={() => navigate('/my-classes')}>
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
