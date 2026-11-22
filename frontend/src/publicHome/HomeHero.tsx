// The opening section of the public home page: a welcome in the academy's name
// (API-205 — a generic welcome while the name is unknown) and the actions the
// viewer may take. A visitor gets «استعرض البرامج» only once the academy is known
// to open its catalog (`catalogOpen` true — never flashed and withdrawn) and
// «تسجيل الدخول» with the line that accounts come from the academy (there is no
// self-registration — no «أنشئ حسابًا» button); a learner gets «مدرستي» and the
// signed-in catalog; staff the dashboard; nothing while the session is restored
// (not even «استعرض البرامج», which a staff session would then withdraw).
import { AppstoreOutlined, CompassOutlined, DashboardOutlined, LoginOutlined } from '@ant-design/icons'
import { Button, Flex, Skeleton, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'

export function HomeHero({ name, nameLoading, viewer, catalogOpen }: { name: string; nameLoading: boolean; viewer: PublicViewer; catalogOpen: boolean | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const browseToo = viewer === 'learner' || (viewer === 'visitor' && catalogOpen === true)

  return (
    // Labelled by the heading only once it is there (a skeleton stands in while the name loads).
    <section className="public-home__hero" aria-labelledby={nameLoading ? undefined : 'public-home-title'} aria-busy={nameLoading || undefined}>
      <div className="public-home__hero-text">
        {nameLoading ? (
          <Skeleton active title={{ width: '60%' }} paragraph={false} />
        ) : (
          <Typography.Title level={1} id="public-home-title" className="public-home__hero-title">
            {name ? t('publicHome.hero.titleNamed', { name }) : t('publicHome.hero.title')}
          </Typography.Title>
        )}
        <Typography.Paragraph className="public-home__hero-subtitle">{t('publicHome.hero.subtitle')}</Typography.Paragraph>
        <Flex wrap gap={12} className="public-home__hero-actions">
          {viewer === 'learner' ? (
            <Button type="primary" size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/my-school')}>
              {t('publicHome.hero.mySchool')}
            </Button>
          ) : null}
          {viewer === 'staff' ? (
            <Button type="primary" size="large" icon={<DashboardOutlined />} onClick={() => navigate('/')}>
              {t('publicHome.hero.dashboard')}
            </Button>
          ) : null}
          {browseToo ? (
            <Button type={viewer === 'learner' ? 'default' : 'primary'} size="large" icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
              {t('publicHome.hero.browse')}
            </Button>
          ) : null}
          {viewer === 'visitor' ? (
            <Button type={browseToo ? 'default' : 'primary'} size="large" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
              {t('publicHome.hero.signIn')}
            </Button>
          ) : null}
        </Flex>
        {viewer === 'visitor' ? (
          <Typography.Text type="secondary" className="public-home__hero-note">
            {t('publicHome.hero.accountsNote')}
          </Typography.Text>
        ) : null}
      </div>
    </section>
  )
}
