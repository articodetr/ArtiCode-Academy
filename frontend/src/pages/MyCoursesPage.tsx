// «My courses» (MOD-19, roadmap §4p): the learner's two areas apart from the
// catalog. (a) «My requests» — GET /api/me/enrollment-requests (API-222), the
// caller's own requests with their state, invoices and what is paid and due,
// the rejection reason, and «cancel the request» while it is pending (API-223)
// — shown to a holder of the `student` server role key only (a guardian has
// no own request; the server would answer an empty list). (b) The courses the
// caller (or, for a guardian, a linked child) is enrolled in — «my classes»
// (API-060, active and completed enrollments) grouped by course, with quick
// links to the learner pages, which open what an active enrollment opens.
// Ownership, no permission key; every value is the server's.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Empty, Flex, Row, Skeleton } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { cancelMyEnrollmentRequest } from '../api/catalog'
import type { MyEnrollmentRequest } from '../api/catalog'
import { useAuth } from '../auth/auth-context'
import { catalogFailureKey } from '../catalog/catalog.errors'
import { groupByCourse } from '../catalog/catalog.view'
import { CourseGroupCard } from '../catalog/CourseGroupCard'
import { RequestCard } from '../catalog/RequestCard'
import { useMyRequests } from '../catalog/useMyRequests'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'

export function MyCoursesPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isStudent = user?.roles.includes('student') ?? false
  const requests = useMyRequests(isStudent)
  const my = useMyClasses()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const groups = groupByCourse(my.items)
  // The student line matters to a guardian (or whenever the server returned a child's enrollment).
  const showStudent = (user?.roles.includes('guardian') ?? false) || my.items.some((item) => item.relation === 'child')

  async function cancel(request: MyEnrollmentRequest) {
    setCancellingId(request.id)
    try {
      requests.replace(await cancelMyEnrollmentRequest(request.id))
      message.success(t('myCourses.requests.cancelled'))
    } catch (caught: unknown) {
      message.error(t(catalogFailureKey(caught)))
      requests.reload()
    } finally {
      setCancellingId(null)
    }
  }

  const reloadAll = () => {
    requests.reload()
    my.reload()
  }

  return (
    <>
      <PageHeader
        title={t('myCourses.title')}
        subtitle={t('myCourses.subtitle')}
        extra={
          <Flex gap={8} wrap>
            <Button onClick={() => navigate('/catalog')}>{t('myCourses.explore')}</Button>
            <Button icon={<ReloadOutlined />} onClick={reloadAll} aria-label={t('myCourses.refresh')} />
          </Flex>
        }
      />

      {isStudent ? (
        <Card title={t('myCourses.requests.title')} style={{ marginBottom: 16 }} data-testid="my-requests">
          {requests.error ? (
            <Alert
              type="error"
              showIcon
              title={t('myCourses.requests.loadError')}
              description={t(catalogFailureKey(requests.error))}
              action={
                <Button size="small" onClick={requests.reload}>
                  {t('myCourses.retry')}
                </Button>
              }
              style={{ marginBottom: 12 }}
            />
          ) : null}
          {requests.loading && requests.items.length === 0 ? (
            <Skeleton active />
          ) : requests.items.length === 0 ? (
            requests.error ? null : <Empty description={t('myCourses.requests.empty')} />
          ) : (
            <Row gutter={[16, 16]}>
              {requests.items.map((request) => (
                <Col key={request.id} xs={24} md={12} xl={8}>
                  <RequestCard request={request} busy={cancellingId === request.id} onCancel={cancel} />
                </Col>
              ))}
            </Row>
          )}
        </Card>
      ) : null}

      <Card title={t('myCourses.courses.title')} data-testid="my-courses">
        {my.error ? (
          <Alert
            type="error"
            showIcon
            title={t('myCourses.courses.loadError')}
            description={t(catalogFailureKey(my.error))}
            action={
              <Button size="small" onClick={my.reload}>
                {t('myCourses.retry')}
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {my.loading && my.items.length === 0 ? (
          <Skeleton active />
        ) : groups.length === 0 ? (
          my.error ? null : (
            <Empty description={t('myCourses.courses.empty')}>
              <Button type="primary" onClick={() => navigate('/catalog')}>
                {t('myCourses.explore')}
              </Button>
            </Empty>
          )
        ) : (
          <Row gutter={[16, 16]}>
            {groups.map((group) => (
              <Col key={group.course.id} xs={24} lg={12}>
                <CourseGroupCard group={group} showStudent={showStudent} />
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </>
  )
}
