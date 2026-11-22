// The closing call of the public home page: a visitor is invited to the
// programs (once the catalog is known to be open) or to sign in; a learner back
// to «مدرستي». Staff and a session still being restored get none.
import { AppstoreOutlined, CompassOutlined, LoginOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'

export function HomeCallToAction({ viewer, catalogOpen }: { viewer: PublicViewer; catalogOpen: boolean | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (viewer !== 'visitor' && viewer !== 'learner') return null
  const learner = viewer === 'learner'

  return (
    <section className="public-home__cta" aria-labelledby="public-home-cta" data-testid="home-cta">
      <Typography.Title level={2} id="public-home-cta" className="public-home__section-title">
        {learner ? t('publicHome.cta.learnerTitle') : t('publicHome.cta.visitorTitle')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="public-home__cta-text">
        {learner ? t('publicHome.cta.learnerText') : t('publicHome.cta.visitorText')}
      </Typography.Paragraph>
      {learner ? (
        <Button type="primary" size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/my-school')}>
          {t('publicHome.hero.mySchool')}
        </Button>
      ) : catalogOpen === true ? (
        <Button type="primary" size="large" icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
          {t('publicHome.hero.browse')}
        </Button>
      ) : (
        <Button type="primary" size="large" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
          {t('publicHome.hero.signIn')}
        </Button>
      )}
    </section>
  )
}
