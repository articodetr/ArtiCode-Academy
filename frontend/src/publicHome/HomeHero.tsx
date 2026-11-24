// The opening band of the public home page: a welcome line in the academy's name
// (API-205 — a generic welcome while the name is unknown, a skeleton while it
// loads), the heading, a line about how learning works here, the actions the
// viewer may take, what the platform offers in four short words, and a large
// picture with floating cards beside it.
// One main action per viewer, so the page never repeats itself: a visitor of an
// open catalog gets the search box whose button is «استعرض البرامج» (an empty box
// opens the whole catalog), a visitor of a closed one «تسجيل الدخول», and nothing
// until it is known whether the catalog is open (no button that flashes and
// flips); a learner gets «فصولي» and the signed-in catalog; staff the dashboard;
// nothing while the session is restored. The visitor's line that accounts come
// from the academy stays here; only while the server says `selfRegistration: true`
// it says a visitor can create one, with a quiet link in that same line — never a
// second button beside «استعرض البرامج».
// Under the search, four small facts: the server's figures once they are read,
// plain words before and without them — never a number of its own. The picture
// follows the reference: a pale disc, the student rising out of it (a stock photo
// with its background removed), a drawn laptop in front and three small cards
// that state what the platform offers.
import {
  AppstoreOutlined,
  BookOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  DashboardOutlined,
  DesktopOutlined,
  GlobalOutlined,
  LineChartOutlined,
  LoginOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
  WifiOutlined,
} from '@ant-design/icons'
import { Button, Input, Skeleton, Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { PUBLIC_SEARCH_MAX_LENGTH } from '../publicCatalog/publicCatalog.view'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'
import { HomeImage } from './HomeImage'
import { formatHomeStat } from './publicHome.view'
import type { HomeStats } from './publicHome.view'

const INDICATORS: { key: 'media' | 'devices' | 'languages' | 'progress'; icon: ReactNode }[] = [
  { key: 'media', icon: <PlayCircleOutlined /> },
  { key: 'devices', icon: <DesktopOutlined /> },
  { key: 'languages', icon: <GlobalOutlined /> },
  { key: 'progress', icon: <LineChartOutlined /> },
]

const FIGURES: { key: 'programs' | 'lessons' | 'hours' | 'openClasses'; icon: ReactNode }[] = [
  { key: 'programs', icon: <BookOutlined /> },
  { key: 'lessons', icon: <ReadOutlined /> },
  { key: 'hours', icon: <ClockCircleOutlined /> },
  { key: 'openClasses', icon: <TeamOutlined /> },
]

export function HomeHero({
  name,
  nameLoading,
  viewer,
  catalogOpen,
  stats,
  registrationOpen = false,
}: {
  name: string
  nameLoading: boolean
  viewer: PublicViewer
  catalogOpen: boolean | null
  stats: HomeStats | null
  registrationOpen?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const visitorBrowses = viewer === 'visitor' && catalogOpen === true
  const visitorSignsIn = viewer === 'visitor' && catalogOpen === false

  return (
    <section className="public-home__hero" aria-labelledby="public-home-title">
      <div className="public-home__container public-home__hero-grid">
        <div className="public-home__hero-text">
          {/* The welcome: a skeleton stands in while the name loads. */}
          <div className="public-home__eyebrow-slot" aria-busy={nameLoading || undefined}>
            {nameLoading ? (
              <Skeleton.Input active size="small" className="public-home__eyebrow-skeleton" />
            ) : (
              <p className="public-home__eyebrow">
                <span className="public-home__eyebrow-dot" aria-hidden="true" />
                <bdi dir="auto">{name ? t('publicHome.hero.welcomeNamed', { name }) : t('publicHome.hero.welcome')}</bdi>
              </p>
            )}
          </div>
          <Typography.Title level={1} id="public-home-title" className="public-home__hero-title">
            {t('publicHome.hero.titleStart')} <span className="public-home__highlight">{t('publicHome.hero.titleHighlight')}</span>
          </Typography.Title>
          <Typography.Paragraph className="public-home__hero-subtitle">{t('publicHome.hero.subtitle')}</Typography.Paragraph>
          {visitorBrowses ? <HeroSearch /> : null}
          <div className={visitorBrowses ? 'public-home__hero-actions public-home__hero-actions--empty' : 'public-home__hero-actions'}>
            {viewer === 'learner' ? (
              <>
                <Button type="primary" size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/my-classes')}>
                  {t('publicHome.hero.mySchool')}
                </Button>
                <Button size="large" icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
                  {t('publicHome.hero.browse')}
                </Button>
              </>
            ) : null}
            {viewer === 'staff' ? (
              <Button type="primary" size="large" icon={<DashboardOutlined />} onClick={() => navigate('/')}>
                {t('publicHome.hero.dashboard')}
              </Button>
            ) : null}
            {visitorSignsIn ? (
              <Button type="primary" size="large" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
                {t('publicHome.hero.signIn')}
              </Button>
            ) : null}
          </div>
          {viewer === 'visitor' ? (
            registrationOpen ? (
              <p className="public-home__hero-note">
                {t('studentRegistration.entry.accountsNote')}{' '}
                <Link to="/register" className="public-register-link" data-testid="home-register">
                  {t('studentRegistration.entry.createAccount')}
                </Link>
              </p>
            ) : (
              <p className="public-home__hero-note">{t('publicHome.hero.accountsNote')}</p>
            )
          ) : null}
          <ul className="public-home__indicators">
            {stats
              ? FIGURES.filter((item) => stats[item.key] > 0).map((item) => (
                  <li key={item.key} className="public-home__indicator">
                    <span className="public-home__indicator-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="public-home__indicator-text">
                      <strong>
                        <bdi dir="ltr">{formatHomeStat(stats[item.key], stats.partial)}</bdi>
                      </strong>
                      {t(`publicHome.stats.${item.key}`)}
                    </span>
                  </li>
                ))
              : INDICATORS.map((item) => (
                  <li key={item.key} className="public-home__indicator">
                    <span className="public-home__indicator-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="public-home__indicator-text public-home__indicator-text--words">{t(`publicHome.hero.indicators.${item.key}`)}</span>
                  </li>
                ))}
          </ul>
        </div>
        <div className="public-home__hero-visual">
          <span className="public-home__hero-disc" aria-hidden="true" />
          <div className="public-home__hero-figure">
            <HomeImage place="heroStudent" alt="" width={760} height={981} decoding="async" fetchPriority="high" />
          </div>
          <HeroLaptop />
          <HeroBadge place="top" icon={<WifiOutlined />} title={t('publicHome.hero.badges.online')} text={t('publicHome.hero.badges.onlineText')} />
          <HeroBadge place="middle" icon={<SafetyCertificateOutlined />} title={t('publicHome.hero.badges.certificate')} text={t('publicHome.hero.badges.certificateText')} />
          <HeroBadge place="bottom" icon={<BookOutlined />} title={t('publicHome.hero.badges.programs')} text={t('publicHome.hero.badges.programsText')} />
        </div>
      </div>
    </section>
  )
}

function HeroBadge({ place, icon, title, text }: { place: 'top' | 'middle' | 'bottom'; icon: ReactNode; title: string; text: string }) {
  return (
    <div className={`public-home__badge public-home__badge--${place}`}>
      <span className="public-home__badge-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="public-home__badge-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
    </div>
  )
}

/** A drawn laptop in front of the student — decoration only. */
function HeroLaptop() {
  return (
    <svg className="public-home__hero-laptop" viewBox="0 0 320 210" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="public-home-laptop-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f7f8" />
          <stop offset="1" stopColor="#b7c5cb" />
        </linearGradient>
        <linearGradient id="public-home-laptop-base" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c4d0d5" />
          <stop offset="1" stopColor="#e6ecee" />
        </linearGradient>
      </defs>
      <path d="M46 12 L262 5 Q273 5 275 16 L301 150 L60 165 L35 25 Q33 13 46 12 Z" fill="url(#public-home-laptop-lid)" stroke="#a3b3b9" strokeWidth="1.5" />
      <path d="M60 165 L301 150 L317 177 Q320 185 309 186 L38 202 Q26 202 30 191 Z" fill="url(#public-home-laptop-base)" stroke="#a3b3b9" strokeWidth="1.5" />
      <path d="M140 179 L212 175 L216 182 L138 187 Z" fill="#aebcc2" />
      <circle cx="168" cy="84" r="14" fill="#ffffff" opacity="0.7" />
    </svg>
  )
}

/** The visitor's way into the catalog: the words typed travel in the address of /explore (`?q=`), nothing typed opens all of it. */
function HeroSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  return (
    <form
      role="search"
      className="public-home__search"
      onSubmit={(event) => {
        event.preventDefault()
        const q = value.trim().slice(0, PUBLIC_SEARCH_MAX_LENGTH)
        navigate(q ? `/explore?${new URLSearchParams({ q }).toString()}` : '/explore')
      }}
    >
      <Input
        size="large"
        variant="borderless"
        value={value}
        maxLength={PUBLIC_SEARCH_MAX_LENGTH}
        prefix={<SearchOutlined aria-hidden="true" className="public-home__search-icon" />}
        placeholder={t('publicCatalog.list.searchPlaceholder')}
        aria-label={t('publicCatalog.list.searchLabel')}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="primary" size="large" htmlType="submit">
        {t('publicHome.hero.browse')}
      </Button>
    </form>
  )
}
