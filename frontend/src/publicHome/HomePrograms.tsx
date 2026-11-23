// «البرامج التعليمية» on the public home page: up to six cards of API-236 that take
// a learner now — or, when none does, the first published ones under a line saying
// so (`homeProgramsOf()`) — and a centred «كل البرامج». The section fails alone: while
// it loads, fails, is empty or the academy keeps its catalog closed, the rest of
// the page stays, and each of these states is a designed panel (HomeNotice), not a
// bare message. The heading makes no «most popular» claim: the server records no
// popularity and orders the courses by code.
// A closed catalog tells a visitor that the programs are for account holders —
// with no button of its own: the sign-in is in the header and the hero — a learner
// where the signed-in catalog is, and staff why visitors see nothing (with the
// settings for whoever may change it).
// Staff open a course on /courses, which needs `courses.read` (the nav entry
// `courses`): without it the cards are a plain preview, with no link and no
// «كل البرامج», so nobody lands on the 403 page (PORTAL-04 review).
import { ArrowLeftOutlined, ArrowRightOutlined, DisconnectOutlined, CompassOutlined, InboxOutlined, LockOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Skeleton, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { publicFailureKey } from '../publicCatalog/publicCatalog.view'
import { coursePathFor, programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'
import { HomeCourseCard } from './HomeCourseCard'
import { HomeNotice } from './HomeNotice'
import type { HomePrograms as HomeProgramsReading } from './useHomePrograms'

const SKELETON_CARDS = 3

export function HomePrograms({ programs, viewer }: { programs: HomeProgramsReading; viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canOpen = viewer !== 'staff' || hasPermission('courses.read')
  const hrefOf = (courseId: string) => (canOpen ? coursePathFor(viewer, courseId) : null)

  return (
    <section className="public-home__section public-home__section--programs" aria-labelledby="public-home-programs" data-testid="home-programs">
      <div className="public-home__container">
        <div className="public-home__section-head public-home__section-head--center">
          <span className="public-home__pill">{t('publicHome.programs.label')}</span>
          <Typography.Title level={2} id="public-home-programs" className="public-home__section-title public-home__section-title--accent">
            {t('publicHome.programs.title')}
          </Typography.Title>
          {/* When none of the cards takes a learner now, the line says so rather than invite to join them. */}
          {programs.state === 'closed' ? null : (
            <p className="public-home__section-subtitle">{t(programs.state === 'ready' && !programs.joinable ? 'publicHome.programs.noneJoinable' : 'publicHome.programs.subtitle')}</p>
          )}
        </div>
        <ProgramsBody programs={programs} viewer={viewer} hrefOf={hrefOf} />
        {programs.state === 'ready' && canOpen ? (
          <div className="public-home__all-row">
            <Button
              className="public-home__all"
              size="large"
              icon={language === 'ar' ? <ArrowLeftOutlined /> : <ArrowRightOutlined />}
              iconPlacement="end"
              onClick={() => navigate(programsPathFor(viewer))}
            >
              {t('publicHome.programs.all')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ProgramsBody({ programs, viewer, hrefOf }: { programs: HomeProgramsReading; viewer: PublicViewer; hrefOf: (courseId: string) => string | null }) {
  const { t } = useTranslation()

  if (programs.state === 'loading') {
    return (
      <div className="public-home__courses" aria-busy="true">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <div key={index} className="public-card public-card--home public-card--skeleton">
            <div className="public-card__media public-home__skeleton-media" />
            <div className="public-card__body">
              <Skeleton active title={{ width: '70%' }} paragraph={{ rows: 2 }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (programs.state === 'closed') return <ProgramsClosed viewer={viewer} />
  if (programs.state === 'error') {
    return (
      <HomeNotice
        tone="error"
        icon={<DisconnectOutlined />}
        title={t('publicHome.programs.loadError')}
        text={t(publicFailureKey(programs.error))}
        action={<Button onClick={programs.retry}>{t('publicHome.programs.retry')}</Button>}
      />
    )
  }
  if (programs.state === 'empty') {
    return <HomeNotice tone="neutral" icon={<InboxOutlined />} title={t('publicHome.programs.emptyTitle')} text={t('publicHome.programs.empty')} />
  }
  return (
    <div className="public-home__courses">
      {programs.items.map((card) => (
        <HomeCourseCard key={card.id} card={card} href={hrefOf(card.id)} />
      ))}
    </div>
  )
}

function ProgramsClosed({ viewer }: { viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  if (viewer === 'learner') {
    return (
      <HomeNotice
        testId="home-programs-closed"
        tone="info"
        icon={<CompassOutlined />}
        title={t('publicHome.programs.closedLearner.title')}
        text={t('publicHome.programs.closedLearner.text')}
        action={
          <Button type="primary" icon={<CompassOutlined />} onClick={() => navigate('/catalog')}>
            {t('publicHome.programs.closedLearner.action')}
          </Button>
        }
      />
    )
  }
  if (viewer === 'staff') {
    return (
      <HomeNotice
        testId="home-programs-closed"
        tone="info"
        icon={<LockOutlined />}
        title={t('publicHome.programs.closedStaff.title')}
        text={t('publicHome.programs.closedStaff.text')}
        action={
          hasPermission('academy.settings.manage') ? (
            <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
              {t('publicHome.programs.closedStaff.action')}
            </Button>
          ) : null
        }
      />
    )
  }
  return (
    <HomeNotice
      testId="home-programs-closed"
      tone="info"
      icon={<LockOutlined />}
      title={t('publicHome.programs.closedVisitor.title')}
      text={t('publicHome.programs.closedVisitor.text')}
    />
  )
}
