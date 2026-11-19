// A course of the catalog (MOD-19, roadmap §4p): GET /api/catalog/courses/:id
// (API-220) and the self-service enrollment POST /api/catalog/classes/:id/enroll
// (API-221). The course (cover, level, duration, sessions, price, overview,
// age range, syllabus titles — lessons and materials stay behind an active
// enrollment) and its classes: the ones open to self-service and any holding
// the reader's own enrollment or request. Whether a class takes the reader is
// the server's `enrollable`/`blocker`; the page offers a button for those only,
// behind a confirmation that, for a paid course, says the invoice comes first
// and the enrollment opens only after the payment is confirmed AND the academy
// approves (D-R125). After every attempt the course is read again, so what
// shows is always the server's state.
import { ArrowRightOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Descriptions, Flex, List, Row, Skeleton, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { enrollInClass } from '../api/catalog'
import type { CatalogClass, CatalogCourseDetail, CatalogEnrollResult } from '../api/catalog'
import { catalogFailureKey, isCourseGone } from '../catalog/catalog.errors'
import { enrollableClasses, enrollmentUnavailable } from '../catalog/catalog.view'
import { ClassOffer } from '../catalog/ClassOffer'
import { CourseCover } from '../catalog/CourseCover'
import { useCatalogCourse } from '../catalog/useCatalogCourse'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import type { Language } from '../i18n/language'
import { formatMoney } from '../payments/payments.format'
import { localizedLabel } from '../users/users.format'

interface EnrollOutcome {
  result: CatalogEnrollResult
  className: string
}

function priceText(course: CatalogCourseDetail, language: Language): string | null {
  return course.price ? formatMoney(course.price.amount, course.price.currency, language) : null
}

export function CatalogCoursePage() {
  const { courseId = '' } = useParams()
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const { modal } = App.useApp()
  const { course, error, loading, reload } = useCatalogCourse(courseId)
  const [busyClassId, setBusyClassId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<EnrollOutcome | null>(null)
  const [failureKey, setFailureKey] = useState<string | null>(null)

  const back = (
    <Button icon={<ArrowRightOutlined />} onClick={() => navigate('/catalog')}>
      {t('catalog.detail.back')}
    </Button>
  )

  if (!course) {
    if (error && isCourseGone(error)) {
      return (
        <>
          <PageHeader title={t('catalog.title')} extra={back} />
          <Alert type="warning" showIcon title={t('catalog.detail.notFound')} />
        </>
      )
    }
    if (error) {
      return (
        <>
          <PageHeader title={t('catalog.title')} extra={back} />
          <Alert
            type="error"
            showIcon
            title={t('catalog.detail.loadError')}
            description={t(catalogFailureKey(error))}
            action={
              <Button size="small" onClick={reload}>
                {t('catalog.retry')}
              </Button>
            }
          />
        </>
      )
    }
    return (
      <>
        <PageHeader title={t('catalog.title')} extra={back} />
        <Card>
          <Skeleton active />
        </Card>
      </>
    )
  }

  const name = localizedLabel(course.name, language)
  const price = priceText(course, language)
  const enrollable = enrollableClasses(course)
  const recommendedId = enrollable.length === 1 ? enrollable[0]!.id : null
  const unavailable = enrollmentUnavailable(course)

  async function enroll(klass: CatalogClass) {
    const className = localizedLabel(klass.name, language)
    setBusyClassId(klass.id)
    setOutcome(null)
    setFailureKey(null)
    try {
      const result = await enrollInClass(klass.id)
      setOutcome({ result, className })
    } catch (caught: unknown) {
      setFailureKey(catalogFailureKey(caught))
    } finally {
      setBusyClassId(null)
      reload()
    }
  }

  function confirmEnroll(klass: CatalogClass) {
    const className = localizedLabel(klass.name, language)
    const paid = course!.pricing === 'paid'
    modal.confirm({
      title: t(paid ? 'catalog.confirm.paidTitle' : 'catalog.confirm.freeTitle'),
      content: paid ? t('catalog.confirm.paidContent', { price: price ?? '' }) : t('catalog.confirm.freeContent', { className }),
      okText: t('catalog.confirm.ok'),
      cancelText: t('catalog.confirm.cancel'),
      onOk: () => enroll(klass),
    })
  }

  const facts: DescriptionsProps['items'] = []
  if (course.level) facts.push({ key: 'level', label: t('catalog.card.level'), children: localizedLabel(course.level.name, language) })
  if (course.durationHours !== null) facts.push({ key: 'duration', label: t('catalog.card.duration'), children: <bdi dir="ltr">{course.durationHours}</bdi> })
  if (course.sessionsCount !== null) facts.push({ key: 'sessions', label: t('catalog.card.sessions'), children: <bdi dir="ltr">{course.sessionsCount}</bdi> })
  facts.push({
    key: 'price',
    label: t('catalog.card.price'),
    children:
      course.pricing === 'free' ? (
        <Tag color="green">{t('catalog.free')}</Tag>
      ) : price ? (
        <bdi dir="ltr">{price}</bdi>
      ) : (
        <Typography.Text type="secondary">{t('catalog.card.priceUnavailable')}</Typography.Text>
      ),
  })
  if (course.price && course.price.installments > 1) {
    facts.push({ key: 'installments', label: t('catalog.detail.installments'), children: <bdi dir="ltr">{course.price.installments}</bdi> })
  }
  if (course.minAge !== null || course.maxAge !== null) {
    const age =
      course.minAge !== null && course.maxAge !== null
        ? t('catalog.detail.ageRange', { min: course.minAge, max: course.maxAge })
        : course.minAge !== null
          ? t('catalog.detail.ageFrom', { min: course.minAge })
          : t('catalog.detail.ageTo', { max: course.maxAge })
    facts.push({ key: 'age', label: t('catalog.detail.age'), children: age })
  }

  const overview = course.description ?? course.summary
  const invoiceOf = (result: CatalogEnrollResult) => result.enrollment.payment.invoices.find((invoice) => invoice.status === 'issued') ?? null

  return (
    <>
      <PageHeader title={name} subtitle={course.code} extra={back} />

      <Card style={{ marginBottom: 16 }} cover={course.coverImageUrl ? <CourseCover key={course.coverImageUrl} url={course.coverImageUrl} height={220} /> : undefined}>
        <Flex vertical gap={12}>
          <Space size={[4, 4]} wrap>
            {course.mine.enrolled ? <Tag color="green">{t('catalog.card.enrolled')}</Tag> : null}
            {course.mine.pending ? <Tag color="gold">{t('catalog.card.pending')}</Tag> : null}
          </Space>
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={facts} />
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title={t('catalog.detail.overview')} style={{ marginBottom: 16 }}>
            <Typography.Paragraph style={{ whiteSpace: 'pre-line', margin: 0 }}>
              {overview ? localizedLabel(overview, language) : <Typography.Text type="secondary">{t('catalog.detail.noDescription')}</Typography.Text>}
            </Typography.Paragraph>
          </Card>
          <Card title={t('catalog.detail.syllabus')}>
            <Alert type="info" showIcon title={t('catalog.detail.lockedNote')} style={{ marginBottom: 12 }} />
            {course.syllabus.length === 0 ? (
              <Typography.Text type="secondary">{t('catalog.detail.syllabusEmpty')}</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={course.syllabus}
                renderItem={(item, index) => (
                  <List.Item>
                    <Flex vertical style={{ width: '100%' }}>
                      <Typography.Text strong>
                        <bdi dir="ltr">{index + 1}.</bdi> {localizedLabel(item.title, language)}
                      </Typography.Text>
                      {item.description ? <Typography.Text type="secondary">{localizedLabel(item.description, language)}</Typography.Text> : null}
                      {item.estimatedMinutes !== null ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('catalog.detail.estimatedMinutes')}: <bdi dir="ltr">{item.estimatedMinutes}</bdi>
                        </Typography.Text>
                      ) : null}
                    </Flex>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={t('catalog.detail.classes')} aria-busy={loading}>
            <Flex vertical gap={12}>
              {course.selfService.allowed ? null : <Alert type="info" showIcon title={t(`catalog.selfService.${course.selfService.reason ?? 'no_permission'}`)} />}
              {outcome ? (
                outcome.result.outcome === 'enrolled' ? (
                  <Alert
                    type="success"
                    showIcon
                    title={t('catalog.result.enrolledTitle')}
                    description={
                      <Flex vertical gap={8}>
                        <span>{t('catalog.result.enrolledContent', { className: outcome.className })}</span>
                        <Space wrap>
                          <Button size="small" onClick={() => navigate('/my-courses')}>
                            {t('catalog.result.myCourses')}
                          </Button>
                          <Button size="small" onClick={() => navigate('/my-lessons')}>
                            {t('catalog.result.myLessons')}
                          </Button>
                        </Space>
                      </Flex>
                    }
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    title={t('catalog.result.requestedTitle')}
                    description={
                      <Flex vertical gap={8}>
                        <span>
                          {t('catalog.result.requestedContent', {
                            number: invoiceOf(outcome.result)?.number ?? '—',
                            total: outcome.result.enrollment.payment.currency
                              ? formatMoney(outcome.result.enrollment.payment.total, outcome.result.enrollment.payment.currency, language)
                              : outcome.result.enrollment.payment.total.toFixed(2),
                          })}
                        </span>
                        <Space wrap>
                          <Button size="small" onClick={() => navigate('/payments')}>
                            {t('catalog.result.invoices')}
                          </Button>
                          <Button size="small" onClick={() => navigate('/my-courses')}>
                            {t('catalog.result.myCourses')}
                          </Button>
                        </Space>
                      </Flex>
                    }
                  />
                )
              ) : null}
              {failureKey ? <Alert type="error" showIcon title={t(failureKey)} closable onClose={() => setFailureKey(null)} /> : null}
              {unavailable ? (
                <Alert
                  type="warning"
                  showIcon
                  title={t('catalog.detail.unavailable')}
                  description={course.classes.length === 0 ? t('catalog.detail.noClasses') : t('catalog.detail.unavailableHint')}
                />
              ) : null}
              {course.classes.length === 0 && !course.selfService.allowed ? <Typography.Text type="secondary">{t('catalog.detail.noClasses')}</Typography.Text> : null}
              {course.classes.map((klass) => (
                <ClassOffer
                  key={klass.id}
                  klass={klass}
                  pricing={course.pricing}
                  canEnroll={course.selfService.allowed}
                  recommended={klass.id === recommendedId}
                  busy={busyClassId === klass.id}
                  disabled={busyClassId !== null}
                  onEnroll={confirmEnroll}
                />
              ))}
            </Flex>
          </Card>
        </Col>
      </Row>
    </>
  )
}
