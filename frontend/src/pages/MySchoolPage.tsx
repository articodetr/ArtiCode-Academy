// «My School» (MOD-20, roadmap §4q) at /my-school — the learner's dashboard,
// built only from the server's answers, each source on its own (a failure
// shows its own «try again» and never hides the others):
// - API-229 «my learning» — every owned enrollment with its progress, last
//   lesson and the one action the server allows (start / continue / review →
//   the learning workspace /learn/<courseId>, which resumes by itself). A
//   guardian's child course shows the student and the progress, never a learn
//   button (D-R132).
// - API-222 «my requests» (students only, MOD-19) with the context action of
//   each state: pay on /payments where «my invoices» lives, wait for the
//   office, or ask again from the course page after a refusal; cancellation
//   (API-223) as in MOD-19.
// - API-112 (pending) and API-121 (scheduled, from now) — read once their
//   section opens — and API-135 «my certificates».
// The sections are a menu at the start side on a wide screen and a bar on a
// phone; the chosen one stays in the URL (`?section=`). The summary strip
// counts what the server answered, never a guess. Ownership, no permission key.
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { App, Button, Empty, Flex, Input, Menu, Segmented, Skeleton } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { cancelMyEnrollmentRequest } from '../api/catalog'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { MyLearningCourse } from '../api/learning'
import { useAuth } from '../auth/auth-context'
import { catalogFailureKey } from '../catalog/catalog.errors'
import { RequestCard } from '../catalog/RequestCard'
import { useMyRequests } from '../catalog/useMyRequests'
import { useMyCertificates } from '../certificates/useMyCertificates'
import { PageHeader } from '../components/PageHeader'
import { MySchoolAssessments } from '../mySchool/MySchoolAssessments'
import { MySchoolCertificates } from '../mySchool/MySchoolCertificates'
import { MySchoolCourseCard } from '../mySchool/MySchoolCourseCard'
import {
  PAYMENTS_PATH,
  SECTION_PARAM,
  catalogCoursePath,
  continueItems,
  isCourseSection,
  itemsOfSection,
  mySchoolFailureKey,
  requestActionOf,
  searchItems,
  sectionOf,
  sectionsFor,
  summaryOf,
} from '../mySchool/mySchool.view'
import type { MySchoolSection, MySchoolViewer, SummaryCount } from '../mySchool/mySchool.view'
import { SourceAlert } from '../mySchool/SourceAlert'
import { useIsPhone, useMyLearning, usePendingAssignments, useUpcomingExams } from '../mySchool/useMyLearning'
import '../mySchool/mySchool.css'

const CATALOG_PATH = '/catalog'
/** The local search reads at most this many characters. */
const SEARCH_MAX_LENGTH = 100

interface Stat {
  key: string
  label: string
  value: SummaryCount
  loading: boolean
}

export function MySchoolPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const phone = useIsPhone()
  const viewer: MySchoolViewer = { student: user?.roles.includes('student') ?? false }
  const sections = sectionsFor(viewer)
  const section = sectionOf(params.get(SECTION_PARAM), viewer)

  const learning = useMyLearning()
  const requests = useMyRequests(viewer.student)
  const certificates = useMyCertificates()
  // The assessments are read once their section has been open — not on every visit of the page.
  const [assessmentsOpened, setAssessmentsOpened] = useState(section === 'assessments')
  if (section === 'assessments' && !assessmentsOpened) setAssessmentsOpened(true)
  const assignments = usePendingAssignments(assessmentsOpened)
  const exams = useUpcomingExams(assessmentsOpened)

  const [query, setQuery] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const courses = learning.data
  const requestsKnown = viewer.student && !requests.error && !(requests.loading && requests.items.length === 0)
  const certificatesKnown = !certificates.error && !(certificates.loading && certificates.items.length === 0)
  const summary = summaryOf({
    courses,
    requests: requestsKnown ? requests.items : null,
    certificates: certificatesKnown ? certificates.items : null,
  })

  const sectionCount = (key: MySchoolSection): SummaryCount => {
    if (key === 'continue') return courses ? continueItems(courses).length : null
    if (key === 'courses') return courses ? courses.length : null
    if (key === 'completed') return summary.completedCourses
    // The section lists every request (pending, rejected, cancelled …), so its count is the list's; the summary strip keeps the pending ones.
    if (key === 'requests') return requestsKnown ? requests.items.length : null
    if (key === 'certificates') return summary.certificates
    return null
  }

  const choose = (next: MySchoolSection) => {
    const nextParams = new URLSearchParams(params)
    nextParams.set(SECTION_PARAM, next)
    setParams(nextParams, { replace: true })
  }

  async function cancel(request: MyEnrollmentRequest) {
    setCancellingId(request.id)
    try {
      requests.replace(await cancelMyEnrollmentRequest(request.id))
      message.success(t('mySchool.requests.cancelled'))
    } catch (caught: unknown) {
      message.error(t(catalogFailureKey(caught)))
      requests.reload()
    } finally {
      setCancellingId(null)
    }
  }

  const reloadAll = () => {
    learning.retry()
    requests.reload()
    certificates.reload()
    if (assessmentsOpened) {
      assignments.retry()
      exams.retry()
    }
  }

  const stats: Stat[] = [
    { key: 'activeCourses', label: t('mySchool.summary.activeCourses'), value: summary.activeCourses, loading: learning.loading },
    { key: 'completedCourses', label: t('mySchool.summary.completedCourses'), value: summary.completedCourses, loading: learning.loading },
    ...(viewer.student ? [{ key: 'pendingRequests', label: t('mySchool.summary.pendingRequests'), value: summary.pendingRequests, loading: requests.loading }] : []),
    { key: 'certificates', label: t('mySchool.summary.certificates'), value: summary.certificates, loading: certificates.loading },
  ]

  const sectionLabel = (key: MySchoolSection) => {
    const count = sectionCount(key)
    return (
      <span>
        {t(`mySchool.sections.${key}`)}
        {count !== null ? (
          <span className="ms-nav-count">
            <bdi dir="ltr">{count}</bdi>
          </span>
        ) : null}
      </span>
    )
  }

  const search = isCourseSection(section) ? (
    <Input
      allowClear
      value={query}
      maxLength={SEARCH_MAX_LENGTH}
      onChange={(event) => setQuery(event.target.value)}
      prefix={<SearchOutlined aria-hidden="true" />}
      placeholder={t('mySchool.search.placeholder')}
      aria-label={t('mySchool.search.label')}
    />
  ) : null

  const menuItems: MenuProps['items'] = sections.map((key) => ({ key, label: sectionLabel(key) }))

  const navigation = phone ? (
    <nav className="ms-side" aria-label={t('mySchool.sectionsLabel')} data-testid="my-school-sections">
      <div className="ms-tabs">
        <Segmented<MySchoolSection> value={section} onChange={choose} options={sections.map((key) => ({ value: key, label: sectionLabel(key) }))} />
      </div>
      {search}
    </nav>
  ) : (
    <nav className="ms-side" aria-label={t('mySchool.sectionsLabel')} data-testid="my-school-sections">
      <Menu mode="inline" selectedKeys={[section]} items={menuItems} onClick={({ key }) => choose(key as MySchoolSection)} />
      {search}
    </nav>
  )

  function coursesContent(): ReactNode {
    if (learning.loading) {
      return (
        <div className="ms-grid">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} active />
          ))}
        </div>
      )
    }
    if (learning.error || courses === null) {
      return <SourceAlert title={t('mySchool.courses.loadError')} description={t(mySchoolFailureKey(learning.error))} onRetry={learning.retry} />
    }
    const listed = itemsOfSection(section, courses)
    if (listed.length === 0) return emptyCourses(courses)
    const shown = searchItems(listed, query)
    if (shown.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mySchool.search.noMatch', { query: query.trim() })} />
    return (
      <div className="ms-grid" data-testid="my-school-courses">
        {shown.map((item) => (
          <MySchoolCourseCard key={item.enrollmentId} item={item} />
        ))}
      </div>
    )
  }

  function emptyCourses(all: readonly MyLearningCourse[]): ReactNode {
    const explore = viewer.student ? (
      <Button type="primary" onClick={() => navigate(CATALOG_PATH)}>
        {t('mySchool.explore')}
      </Button>
    ) : null
    const ownCourses = all.filter((item) => item.relation === 'self')
    if (section === 'completed') return <Empty description={t('mySchool.courses.completedEmpty')} />
    if (section === 'continue' && ownCourses.length > 0) return <Empty description={t('mySchool.courses.continueEmpty')}>{explore}</Empty>
    return <Empty description={t(viewer.student ? 'mySchool.courses.empty' : 'mySchool.courses.emptyGuardian')}>{explore}</Empty>
  }

  function requestsContent(): ReactNode {
    const alert = requests.error ? <SourceAlert title={t('mySchool.requests.loadError')} description={t(catalogFailureKey(requests.error))} onRetry={requests.reload} /> : null
    if (requests.loading && requests.items.length === 0) return <Skeleton active />
    if (requests.items.length === 0) {
      return (
        alert ?? (
          <Empty description={t('mySchool.requests.empty')}>
            <Button type="primary" onClick={() => navigate(CATALOG_PATH)}>
              {t('mySchool.explore')}
            </Button>
          </Empty>
        )
      )
    }
    return (
      <>
        {alert}
        <div className="ms-grid" data-testid="my-school-requests">
          {requests.items.map((request) => (
            <RequestCard key={request.id} request={request} busy={cancellingId === request.id} onCancel={cancel} action={requestAction(request)} />
          ))}
        </div>
      </>
    )
  }

  function requestAction(request: MyEnrollmentRequest): ReactNode {
    const action = requestActionOf(request)
    if (action === 'pay') {
      return (
        <Button type="primary" onClick={() => navigate(PAYMENTS_PATH)}>
          {t('mySchool.requests.pay')}
        </Button>
      )
    }
    if (action === 'awaitingApproval') return <Button disabled>{t('mySchool.requests.awaitingApproval')}</Button>
    if (action === 'requestAgain') {
      return (
        <Button type="primary" onClick={() => navigate(catalogCoursePath(request.course.id))}>
          {t('mySchool.requests.requestAgain')}
        </Button>
      )
    }
    return null
  }

  function content(): ReactNode {
    if (isCourseSection(section)) return coursesContent()
    if (section === 'requests') return requestsContent()
    if (section === 'assessments') return <MySchoolAssessments assignments={assignments} exams={exams} />
    return <MySchoolCertificates source={certificates} />
  }

  return (
    <>
      <PageHeader
        title={t('mySchool.title')}
        subtitle={t(viewer.student ? 'mySchool.subtitle' : 'mySchool.subtitleGuardian')}
        extra={
          <Flex gap={8} wrap>
            <Button onClick={() => navigate(CATALOG_PATH)}>{t('mySchool.explore')}</Button>
            <Button icon={<ReloadOutlined />} onClick={reloadAll} aria-label={t('mySchool.refresh')} />
          </Flex>
        }
      />

      <section className="ms-summary" aria-label={t('mySchool.summary.label')}>
        {stats.map((stat) => (
          <div key={stat.key} className="ms-stat" data-testid={`stat-${stat.key}`}>
            <span className="ms-stat__label">{stat.label}</span>
            <span className="ms-stat__value">
              {stat.value !== null ? (
                <bdi dir="ltr">{stat.value}</bdi>
              ) : stat.loading ? (
                <Skeleton.Input active size="small" style={{ width: 40, minWidth: 40 }} />
              ) : (
                <span title={t('mySchool.summary.unknown')} aria-label={t('mySchool.summary.unknown')}>
                  —
                </span>
              )}
            </span>
          </div>
        ))}
      </section>

      <div className={phone ? 'ms-layout ms-layout--phone' : 'ms-layout'}>
        {navigation}
        <section className="ms-content" aria-labelledby="my-school-section-title" data-testid={`section-${section}`}>
          <h2 className="ms-content__title" id="my-school-section-title">
            {t(`mySchool.sections.${section}`)}
          </h2>
          {content()}
        </section>
      </div>
    </>
  )
}
