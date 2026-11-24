// The frame of the pages where a visitor signs in or creates an account (PORTAL-04): /login, /register,
// /register/complete/:token, /forgot-password and /auth/google/done. A light page — no full-screen colour — with a slim
// top bar (the academy's logo and name from API-205, as the public pages show them, leading to /home; «العودة إلى
// الرئيسية»; the language switch) and one centred card of at most 440 px: full width with comfortable padding on a
// phone, from 320 px up, right to left and left to right. The academy's logo, when it has one, heads the card too.
// The colours and typefaces are those of the public pages (publicCatalog/PublicShell.tsx): turquoise controls, Cairo for
// Arabic and Poppins for Latin text, reaching Ant Design's controls through the nested ConfigProvider, which also makes
// every field and button of the card large.
//
// A page that reads API-205 itself hands its reading in (`academy`), so the frame never asks twice; without one, the
// frame reads it. The name is the academy's own — a neutral «الأكاديمية» after a failed read, nothing while it runs,
// never the product's name (the sign-in page is the academy's site).
import { ArrowLeftOutlined, ArrowRightOutlined, ReadOutlined } from '@ant-design/icons'
import { ConfigProvider, Spin } from 'antd'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { brandLogoSrc } from '../academy/academy.brand'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useLocalized } from '../i18n/useLocalized'
import { useBrandName } from '../publicCatalog/useBrandName'
import '../publicCatalog/publicFonts.css'
import './AuthLayout.css'

/** The public pages' theme (PUBLIC_THEME of publicCatalog/PublicShell.tsx — keep the two the same). */
const AUTH_THEME = {
  token: {
    colorPrimary: '#039092',
    colorLink: '#047c83',
    borderRadius: 8,
    fontFamily: "'Public Poppins', 'Public Cairo', 'Segoe UI', Tahoma, 'Noto Sans Arabic', 'Noto Sans', system-ui, sans-serif",
  },
}

interface AuthLayoutProps {
  /** The card's heading (the page's one `h1`). */
  title: string
  /** One line under the heading. */
  subtitle?: ReactNode
  /** API-205 as the page already reads it; absent = the frame reads it. */
  academy?: PublicAcademyReading
  children: ReactNode
}

export function AuthLayout({ title, subtitle, academy, children }: AuthLayoutProps) {
  const own = usePublicAcademy(academy === undefined)
  const reading = academy ?? own
  return (
    <ConfigProvider theme={AUTH_THEME} componentSize="large">
      <div className="auth-layout">
        <AuthTopBar reading={reading} />
        <main className="auth-layout__main">
          <AuthCard title={title} subtitle={subtitle} reading={reading}>
            {children}
          </AuthCard>
        </main>
      </div>
    </ConfigProvider>
  )
}

/** The page's spinner while the session is still being restored, on the same light page (no card, no request). */
export function AuthLoading({ label }: { label?: string }) {
  return (
    <ConfigProvider theme={AUTH_THEME}>
      <div className="auth-layout auth-layout__loading" data-testid="auth-loading" role={label ? 'status' : undefined}>
        <Spin size="large" />
        {label ? <p className="auth-layout__loading-label">{label}</p> : null}
      </div>
    </ConfigProvider>
  )
}

/** The academy's logo when it has one that may be loaded on this page; null otherwise or once it failed to load. */
function useLogo(reading: PublicAcademyReading) {
  const src = brandLogoSrc(reading.academy?.logoUrl, window.location.origin)
  const [broken, setBroken] = useState<string | null>(null)
  return { src: src !== null && src !== broken ? src : null, onError: () => setBroken(src) }
}

function AuthTopBar({ reading }: { reading: PublicAcademyReading }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const name = useBrandName(reading)
  const logo = useLogo(reading)
  // «Back» points where the reader's eye goes back to: right in Arabic, left in English.
  const BackIcon = language === 'ar' ? ArrowRightOutlined : ArrowLeftOutlined
  return (
    <header className="auth-layout__bar">
      <div className="auth-layout__bar-inner">
        <Link to="/home" className="auth-layout__brand" title={name || undefined}>
          {logo.src ? (
            <img className="auth-layout__brand-logo" src={logo.src} alt="" referrerPolicy="no-referrer" decoding="async" onError={logo.onError} />
          ) : name ? (
            <span className="auth-layout__brand-mark" aria-hidden="true">
              <ReadOutlined />
            </span>
          ) : null}
          <bdi dir="auto" className="auth-layout__brand-name" data-testid="auth-academy-name">
            {name}
          </bdi>
        </Link>
        <nav className="auth-layout__bar-actions" aria-label={t('login.layout.navLabel')}>
          <Link to="/home" className="auth-layout__back">
            <BackIcon aria-hidden="true" />
            <span className="auth-layout__back-text">{t('login.layout.backHome')}</span>
          </Link>
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  )
}

function AuthCard({
  title,
  subtitle,
  reading,
  children,
}: {
  title: string
  subtitle?: ReactNode
  reading: PublicAcademyReading
  children: ReactNode
}) {
  const titleId = useId()
  const logo = useLogo(reading)
  return (
    <section className="auth-layout__card" aria-labelledby={titleId}>
      <div className="auth-layout__head">
        {logo.src ? (
          <img className="auth-layout__card-logo" src={logo.src} alt="" referrerPolicy="no-referrer" decoding="async" onError={logo.onError} />
        ) : null}
        <h1 id={titleId} className="auth-layout__title">
          {title}
        </h1>
        {subtitle ? <p className="auth-layout__subtitle">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * «سؤال؟ رابط» on one centred line that wraps on a phone (`لديك حساب بالفعل؟ تسجيل الدخول`); `top` right under the
 * card's heading, `bottom` (the default) after the card's last control.
 */
export function AuthPrompt({
  question,
  children,
  testId,
  placement = 'bottom',
}: {
  question: string
  children: ReactNode
  testId?: string
  placement?: 'top' | 'bottom'
}) {
  return (
    <p className={`auth-layout__prompt auth-layout__prompt--${placement}`} data-testid={testId}>
      <span>{question}</span> {children}
    </p>
  )
}
