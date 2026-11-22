// The closing band of the public home page — shown only where it adds a step the
// page has not offered twice already (PORTAL-04 PR-1 redesign): a visitor of an
// academy that opens its catalog is invited to the programs — once the section
// above shows some (not after a failed read or an empty catalog). A visitor of a
// closed catalog has the sign-in in the header and the hero, a learner «مدرستي»
// in both, staff the dashboard — none of them gets a third copy here, and nobody
// does while the session is restored or before it is known whether the catalog
// is open (its button would otherwise appear and vanish).
import { CompassOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'

export function HomeCallToAction({ viewer, catalogOpen, hasPrograms }: { viewer: PublicViewer; catalogOpen: boolean | null; hasPrograms: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (viewer !== 'visitor' || catalogOpen !== true || !hasPrograms) return null

  return (
    <section className="public-home__section public-home__section--cta" aria-labelledby="public-home-cta" data-testid="home-cta">
      <div className="public-home__container">
        <div className="public-home__cta">
          <div className="public-home__cta-text">
            <Typography.Title level={2} id="public-home-cta" className="public-home__cta-title">
              {t('publicHome.cta.visitorTitle')}
            </Typography.Title>
            <p className="public-home__cta-line">{t('publicHome.cta.visitorText')}</p>
          </div>
          <Button size="large" className="public-home__cta-button" icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
            {t('publicHome.hero.browse')}
          </Button>
        </div>
      </div>
    </section>
  )
}
