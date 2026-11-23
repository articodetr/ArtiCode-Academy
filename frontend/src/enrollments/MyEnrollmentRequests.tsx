// «طلبات الاشتراك» of «فصولي» (J-F61, API-222/223): the student's own requests, each with where it stands and the one
// step it waits for — pay on /payments, wait for the office, ask again after a refusal, or go to the course once the
// server says the enrollment is active. Cancelling a pending request is behind RequestCard's confirmation.
import { CompassOutlined } from '@ant-design/icons'
import { App, Button, Skeleton, Steps, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { cancelMyEnrollmentRequest } from '../api/catalog'
import type { MyEnrollmentRequest } from '../api/catalog'
import { catalogFailureKey } from '../catalog/catalog.errors'
import { RequestCard } from '../catalog/RequestCard'
import type { useMyRequests } from '../catalog/useMyRequests'
import { PAYMENTS_PATH, REQUEST_STEPS, catalogCoursePath, learnPath, requestActionOf, requestStepOf } from '../mySchool/mySchool.view'
import { SourceAlert } from '../mySchool/SourceAlert'
import '../mySchool/mySchool.css'

const CATALOG_PATH = '/catalog'

export function MyEnrollmentRequests({ source }: { source: ReturnType<typeof useMyRequests> }) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function cancel(request: MyEnrollmentRequest) {
    setCancellingId(request.id)
    try {
      source.replace(await cancelMyEnrollmentRequest(request.id))
      message.success(t('mySchool.requests.cancelled'))
    } catch (caught: unknown) {
      message.error(t(catalogFailureKey(caught)))
      source.reload()
    } finally {
      setCancellingId(null)
    }
  }

  function tracker(request: MyEnrollmentRequest): ReactNode {
    const step = requestStepOf(request)
    if (!step) return null
    return (
      <div className="ms-rsteps" role="group" aria-label={t('mySchool.requests.steps.label')} data-testid={`request-steps-${request.id}`} data-current={step.current} data-finished={step.finished}>
        <Steps
          size="small"
          type="dot"
          titlePlacement="vertical"
          responsive={false}
          current={step.current}
          status={step.finished ? 'finish' : 'process'}
          items={REQUEST_STEPS.map((key) => ({ title: t(`mySchool.requests.steps.${key}`) }))}
        />
      </div>
    )
  }

  function action(request: MyEnrollmentRequest): ReactNode {
    const next = requestActionOf(request)
    if (next === 'pay') {
      return (
        <Button type="primary" onClick={() => navigate(PAYMENTS_PATH)}>
          {t('mySchool.requests.pay')}
        </Button>
      )
    }
    if (next === 'learn') {
      return (
        <Button type="primary" onClick={() => navigate(learnPath(request.course.id))}>
          {t('mySchool.requests.learn')}
        </Button>
      )
    }
    if (next === 'requestAgain') {
      return (
        <Button type="primary" onClick={() => navigate(catalogCoursePath(request.course.id))}>
          {t('mySchool.requests.requestAgain')}
        </Button>
      )
    }
    // Waiting for the office is said by the card's own hint and state.
    return null
  }

  const alert = source.error ? <SourceAlert title={t('mySchool.requests.loadError')} description={t(catalogFailureKey(source.error))} onRetry={source.reload} /> : null
  if (source.loading && source.items.length === 0) return <Skeleton active />
  if (source.items.length === 0) {
    return (
      alert ?? (
        <div className="ms-empty" data-testid="requests-empty">
          <span className="ms-empty__icon" aria-hidden="true">
            <CompassOutlined />
          </span>
          <h3 className="ms-empty__title">{t('mySchool.requests.emptyTitle')}</h3>
          <p className="ms-empty__text">{t('mySchool.requests.emptyText')}</p>
          <Button type="primary" onClick={() => navigate(CATALOG_PATH)}>
            {t('mySchool.exploreMore')}
          </Button>
        </div>
      )
    )
  }
  return (
    <>
      {alert}
      <Typography.Paragraph type="secondary">{t('mySchool.requests.hint')}</Typography.Paragraph>
      <div className="ms-grid ms-grid--requests" data-testid="my-class-requests">
        {source.items.map((request) => (
          <RequestCard key={request.id} request={request} busy={cancellingId === request.id} onCancel={cancel} action={action(request)} tracker={tracker(request)} />
        ))}
      </div>
    </>
  )
}
