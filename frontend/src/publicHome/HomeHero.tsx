// The opening band of the public home page: a welcome line in the academy's name
// (API-205 — a generic welcome while the name is unknown, a skeleton while it
// loads), the heading, a line about how learning works here, the actions the
// viewer may take, what the platform offers in four short words, and a large
// picture with floating cards beside it.
// One main action per viewer, so the page never repeats itself: a visitor of an
// open catalog gets the search box whose button is «استعرض البرامج» (an empty box
// opens the whole catalog), a visitor of a closed one «تسجيل الدخول», and nothing
// until it is known whether the catalog is open (no button that flashes and
// flips); a learner gets «مدرستي» and the signed-in catalog; staff the dashboard;
// nothing while the session is restored. The visitor's line that accounts come
// from the academy (there is no self-registration — no «أنشئ حسابًا») stays here.
// The floating cards state the server's figures once they are read, plain words
// before and without them: never a number of its own.
import {
  AppstoreOutlined,
  BookOutlined,
  CompassOutlined,
  DashboardOutlined,
  DesktopOutlined,
  GlobalOutlined,
  LineChartOutlined,
  LoginOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  SearchOutlined,
  WifiOutlined,
} from '@ant-design/icons'
import { Button, Input, Skeleton, Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { PUBLIC_SEARCH_MAX_LENGTH } from '../publicCatalog/publicCatalog.view'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'
import { HOME_IMAGES } from './homeImages'
import { formatHomeStat } from './publicHome.view'
import type { HomeStats } from './publicHome.view'

const INDICATORS: { key: 'media' | 'devices' | 'languages' | 'progress'; icon: ReactNode }[] = [
  { key: 'media', icon: <PlayCircleOutlined /> },
  { key: 'devices', icon: <DesktopOutlined /> },
  { key: 'languages', icon: <GlobalOutlined /> },
  { key: 'progress', icon: <LineChartOutlined /> },
]

export function HomeHero({
  name,
  nameLoading,
  viewer,
  catalogOpen,
  stats,
}: {
  name: string
  nameLoading: boolean
  viewer: PublicViewer
  catalogOpen: boolean | null
  stats: HomeStats | null
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
                <Button type="primary" size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/my-school')}>
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
          {viewer === 'visitor' ? <p className="public-home__hero-note">{t('publicHome.hero.accountsNote')}</p> : null}
          <ul className="public-home__indicators">
            {INDICATORS.map((item) => (
              <li key={item.key} className="public-home__indicator">
                <span className="public-home__indicator-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {t(`publicHome.hero.indicators.${item.key}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="public-home__hero-visual">
          <div className="public-home__hero-photo">
            <img src={HOME_IMAGES.heroStudent} alt="" width={1000} height={667} decoding="async" fetchPriority="high" />
          </div>
          <HeroBadge
            place="top"
            icon={<BookOutlined />}
            value={stats ? formatHomeStat(stats.programs, stats.partial) : null}
            label={stats ? t('publicHome.stats.programs') : t('publicHome.hero.badges.programs')}
          />
          <HeroBadge place="middle" icon={<WifiOutlined />} value={null} label={t('publicHome.hero.badges.online')} />
          <HeroBadge
            place="bottom"
            icon={<ReadOutlined />}
            value={stats && stats.lessons > 0 ? formatHomeStat(stats.lessons, stats.partial) : null}
            label={stats && stats.lessons > 0 ? t('publicHome.stats.lessons') : t('publicHome.hero.badges.lessons')}
          />
        </div>
      </div>
    </section>
  )
}

function HeroBadge({ place, icon, value, label }: { place: 'top' | 'middle' | 'bottom'; icon: ReactNode; value: string | null; label: string }) {
  return (
    <div className={`public-home__badge public-home__badge--${place}`}>
      <span className="public-home__badge-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="public-home__badge-text">
        {value ? (
          <strong>
            <bdi dir="ltr">{value}</bdi>
          </strong>
        ) : null}
        <span>{label}</span>
      </span>
    </div>
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
