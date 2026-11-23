// The opening band of the public home page: a welcome line in the academy's name
// (API-205 — a generic welcome while the name is unknown, a skeleton while it
// loads), a heading and a line about how learning works here (true of the
// product: levels and lessons followed step by step, progress in «مدرستي»), the
// actions the viewer may take, and an original decorative picture beside it.
// One main action per viewer, so the page never repeats itself (PORTAL-04 PR-1
// redesign): a visitor gets «استعرض البرامج» once the academy is known to open
// its catalog, otherwise «تسجيل الدخول» (the header has it too — the programs
// section and the closing band no longer do), and nothing until it is known
// whether the catalog is open (no button that flashes and flips); a learner
// gets «مدرستي» and the signed-in catalog; staff the dashboard; nothing while
// the session is restored. The visitor's line that accounts come from the
// academy (there is no self-registration — no «أنشئ حسابًا») stays here.
import { AppstoreOutlined, CompassOutlined, DashboardOutlined, LoginOutlined } from '@ant-design/icons'
import { Button, Skeleton, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'
import { HomeHeroArt } from './HomeHeroArt'

export function HomeHero({ name, nameLoading, viewer, catalogOpen }: { name: string; nameLoading: boolean; viewer: PublicViewer; catalogOpen: boolean | null }) {
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
            {t('publicHome.hero.title')}
          </Typography.Title>
          <Typography.Paragraph className="public-home__hero-subtitle">{t('publicHome.hero.subtitle')}</Typography.Paragraph>
          <div className="public-home__hero-actions">
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
            {visitorBrowses ? (
              <Button type="primary" size="large" icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
                {t('publicHome.hero.browse')}
              </Button>
            ) : null}
            {visitorSignsIn ? (
              <Button type="primary" size="large" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
                {t('publicHome.hero.signIn')}
              </Button>
            ) : null}
          </div>
          {viewer === 'visitor' ? <p className="public-home__hero-note">{t('publicHome.hero.accountsNote')}</p> : null}
        </div>
        <div className="public-home__hero-visual">
          <HomeHeroArt />
        </div>
      </div>
    </section>
  )
}
