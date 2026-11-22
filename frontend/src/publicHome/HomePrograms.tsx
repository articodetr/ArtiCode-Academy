// «البرامج التعليمية» on the public home page: up to six cards of API-236 —
// the same card as the public catalog (cover, name, summary, level, price,
// duration, counts, whether a class is open; the server's data only) — and
// «كل البرامج». The section fails alone: while it loads, fails, is empty or the
// academy keeps its catalog closed, the rest of the page stays. A closed catalog
// tells a visitor to sign in, a learner where the signed-in catalog is, and
// staff why visitors see nothing (with the settings for whoever may change it).
import { CompassOutlined, LoginOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Empty, Flex, Result, Row, Skeleton, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PublicCourseCard } from '../publicCatalog/PublicCourseCard'
import { publicFailureKey } from '../publicCatalog/publicCatalog.view'
import { coursePathFor, programsPathFor } from '../publicCatalog/publicViewer'
import type { PublicViewer } from '../publicCatalog/publicViewer'
import type { HomePrograms as HomeProgramsReading } from './useHomePrograms'

const SKELETON_CARDS = 3

export function HomePrograms({ programs, viewer }: { programs: HomeProgramsReading; viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const open = (courseId: string) => navigate(coursePathFor(viewer, courseId))

  return (
    <section className="public-home__section" aria-labelledby="public-home-programs" data-testid="home-programs">
      <Flex justify="space-between" align="end" wrap gap={12} className="public-home__section-head">
        <div>
          <Typography.Title level={2} id="public-home-programs" className="public-home__section-title">
            {t('publicHome.programs.title')}
          </Typography.Title>
          {programs.state === 'closed' ? null : (
            <Typography.Paragraph type="secondary" className="public-home__section-subtitle">
              {t('publicHome.programs.subtitle')}
            </Typography.Paragraph>
          )}
        </div>
        {programs.state === 'ready' ? (
          <Button icon={<CompassOutlined />} onClick={() => navigate(programsPathFor(viewer))}>
            {t('publicHome.programs.all')}
          </Button>
        ) : null}
      </Flex>
      <ProgramsBody programs={programs} viewer={viewer} onOpen={open} />
    </section>
  )
}

function ProgramsBody({ programs, viewer, onOpen }: { programs: HomeProgramsReading; viewer: PublicViewer; onOpen: (courseId: string) => void }) {
  const { t } = useTranslation()

  if (programs.state === 'loading') {
    return (
      <Row gutter={[16, 16]} aria-busy="true">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <Col key={index} xs={24} sm={12} lg={8}>
            <Card>
              <Skeleton active />
            </Card>
          </Col>
        ))}
      </Row>
    )
  }
  if (programs.state === 'closed') return <ProgramsClosed viewer={viewer} />
  if (programs.state === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        title={t('publicHome.programs.loadError')}
        description={t(publicFailureKey(programs.error))}
        action={
          <Button size="small" onClick={programs.retry}>
            {t('publicHome.programs.retry')}
          </Button>
        }
      />
    )
  }
  if (programs.state === 'empty') {
    return (
      <Card>
        <Empty description={t('publicHome.programs.empty')} />
      </Card>
    )
  }
  return (
    <Row gutter={[16, 16]}>
      {programs.items.map((card) => (
        <Col key={card.id} xs={24} sm={12} lg={8}>
          <PublicCourseCard card={card} onOpen={onOpen} />
        </Col>
      ))}
    </Row>
  )
}

function ProgramsClosed({ viewer }: { viewer: PublicViewer }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  if (viewer === 'learner') {
    return (
      <Card data-testid="home-programs-closed">
        <Result
          status="info"
          title={t('publicHome.programs.closedLearner.title')}
          subTitle={t('publicHome.programs.closedLearner.text')}
          extra={
            <Button type="primary" icon={<CompassOutlined />} onClick={() => navigate('/catalog')}>
              {t('publicHome.programs.closedLearner.action')}
            </Button>
          }
        />
      </Card>
    )
  }
  if (viewer === 'staff') {
    return (
      <Card data-testid="home-programs-closed">
        <Result
          status="info"
          title={t('publicHome.programs.closedStaff.title')}
          subTitle={t('publicHome.programs.closedStaff.text')}
          extra={
            hasPermission('academy.settings.manage') ? (
              <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
                {t('publicHome.programs.closedStaff.action')}
              </Button>
            ) : null
          }
        />
      </Card>
    )
  }
  return (
    <Card data-testid="home-programs-closed">
      <Result
        status="info"
        title={t('publicHome.programs.closedVisitor.title')}
        subTitle={t('publicHome.programs.closedVisitor.text')}
        extra={
          viewer === 'visitor' ? (
            <Button type="primary" icon={<LoginOutlined />} onClick={() => navigate('/login')}>
              {t('publicHome.programs.closedVisitor.action')}
            </Button>
          ) : null
        }
      />
    </Card>
  )
}
