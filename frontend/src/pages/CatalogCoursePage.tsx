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
// shows is always the server's state. MOD-20 (D-R138): a visitor who chose
// «سجّل في هذه الدورة» on the public course page arrives here after the sign-in
// with `?intent=enroll` — the page scrolls to the classes, highlights them with
// «اختر الفصل الذي تريد التسجيل فيه» and drops the parameter from the URL
// (replace); it never enrolls by itself, the learner confirms as always. When
// exactly one class takes the learner there is nothing to choose: its usual
// confirmation opens by itself, once per arrival, and nothing is sent until the
// learner presses confirm. Cancelling leaves the class and its button.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, ConfigProvider, Descriptions, Flex, Skeleton, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps, ThemeConfig } from 'antd'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { enrollInClass } from '../api/catalog'
import type { CatalogClass, CatalogCourseDetail, CatalogEnrollResult } from '../api/catalog'
import { catalogFailureKey, isCourseGone } from '../catalog/catalog.errors'
import { REQUEST_STATE_COLORS, autoConfirmClass, courseStandingOf, enrollableClasses, enrollmentUnavailable } from '../catalog/catalog.view'
import type { CourseStanding } from '../catalog/catalog.view'
import { ClassOffer } from '../catalog/ClassOffer'
import { useCatalogCourse } from '../catalog/useCatalogCourse'
import '../catalog/catalogCourse.css'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import type { Language } from '../i18n/language'
import { formatMoney } from '../payments/payments.format'
import { CourseEnrollCard, CoursePageLayout } from '../publicCatalog/CoursePageLayout'
import type { CoursePageSection } from '../publicCatalog/CoursePageLayout'
import { courseBadgesOf } from '../publicCatalog/publicCatalog.view'
import { localizedLabel } from '../users/users.format'

// The page's buttons in the academy's turquoise: the stronger shade (--pub-primary-strong), where white text keeps 4.5:1.
const COURSE_PAGE_THEME: ThemeConfig = { token: { colorPrimary: '#047c83' } }

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
  // The class of the last failed attempt: a re-read that shows the reader's own row there answers an unknown outcome.
  const [failedClassId, setFailedClassId] = useState<string | null>(null)

  // The enroll intent (D-R138), kept for this course once the parameter has left the URL.
  const [searchParams, setSearchParams] = useSearchParams()
  const intentInUrl = searchParams.get('intent') === 'enroll'
  const [intentFor, setIntentFor] = useState<string | null>(null)
  if (intentInUrl && intentFor !== courseId) setIntentFor(courseId)
  const enrollIntent = intentFor === courseId
  const classesRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  // The confirmation on screen, if any: one at a time, and it never outlives this course's page.
  const confirmation = useRef<{ destroy: () => void } | null>(null)
  // The course whose arrival was already answered: a re-read or a language change never asks again.
  const autoConfirmedFor = useRef<string | null>(null)

  // A reload or a copied link does not repeat the intent.
  useEffect(() => {
    if (!intentInUrl) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('intent')
        return next
      },
      { replace: true },
    )
  }, [intentInUrl, setSearchParams])

  // Once the course is on screen, its classes come into view (once per course).
  const courseShown = course !== null
  useEffect(() => {
    if (!enrollIntent || !courseShown || scrolledFor.current === courseId) return
    scrolledFor.current = courseId
    const node = classesRef.current
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [enrollIntent, courseShown, courseId])

  async function enroll(klass: CatalogClass) {
    const className = localizedLabel(klass.name, language)
    setIntentFor(null)
    setBusyClassId(klass.id)
    setOutcome(null)
    setFailureKey(null)
    setFailedClassId(null)
    try {
      const result = await enrollInClass(klass.id)
      setOutcome({ result, className })
    } catch (caught: unknown) {
      setFailureKey(catalogFailureKey(caught))
      setFailedClassId(klass.id)
    } finally {
      setBusyClassId(null)
      // What shows next is always the server's: the course is read again, and its classes card — where the answer is
      // said — comes into view (on a phone the pressed button sits below it).
      reload()
      const node = classesRef.current
      if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function confirmEnroll(detail: CatalogCourseDetail, klass: CatalogClass, autoFocusButton: 'ok' | 'cancel' = 'ok') {
    // PORTAL-04: one confirmation at a time — a second press while it is open, or while a request runs, sends nothing.
    if (confirmation.current !== null || busyClassId !== null) return
    const className = localizedLabel(klass.name, language)
    const paid = detail.pricing === 'paid'
    const release = () => {
      if (confirmation.current === handle) confirmation.current = null
    }
    const handle: { destroy: () => void } = modal.confirm({
      title: t(paid ? 'catalog.confirm.paidTitle' : 'catalog.confirm.freeTitle'),
      content: paid ? t('catalog.confirm.paidContent', { price: priceText(detail, language) ?? '' }) : t('catalog.confirm.freeContent', { className }),
      okText: t(paid ? 'catalog.confirm.paidOk' : 'catalog.confirm.freeOk'),
      cancelText: t('catalog.confirm.cancel'),
      focusable: { autoFocusButton },
      onOk: () => enroll(klass),
      onCancel: release,
      afterClose: release,
    })
    confirmation.current = handle
  }

  // One class takes the learner who pressed subscribe: ask them to confirm it. Decided once per arrival, on the first
  // read of the course — a later read never brings the question back, and only the learner's own press sends anything.
  const offerOnlyClass = useEffectEvent((detail: CatalogCourseDetail) => {
    const only = autoConfirmClass(detail)
    // The focus starts on «تراجع»: an Enter held or repeated from the subscribe button must not confirm an unread dialog.
    if (only) confirmEnroll(detail, only, 'cancel')
  })
  useEffect(() => {
    if (!enrollIntent || !course || autoConfirmedFor.current === courseId) return
    autoConfirmedFor.current = courseId
    offerOnlyClass(course)
  }, [enrollIntent, course, courseId])

  // Leaving the course closes its question: a confirmation must not stay open over another page.
  useEffect(
    () => () => {
      confirmation.current?.destroy()
      confirmation.current = null
    },
    [courseId],
  )

  const back = (
    <Button icon={language === 'ar' ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={() => navigate('/catalog')}>
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
  // The highlight only where the reader may enroll themself; otherwise the page already says why not.
  const highlightClasses = enrollIntent && course.selfService.allowed
  // PORTAL-04: the reader already studies the course, completed it or waits on a request — said first, with the way
  // on (learning, or «my requests»), instead of inviting a second request. Not while a fresh outcome says it already.
  // A success is said only for what the server confirmed: a free enrollment that is active now, or a paid request.
  // A paid course answers a request still pending (awaiting payment or approval) — anything else is no success to claim.
  const shownOutcome =
    outcome && (outcome.result.outcome === 'requested' ? outcome.result.enrollment.status === 'pending' : outcome.result.enrollment.state === 'enrolled') ? outcome : null
  const standing = shownOutcome ? null : courseStandingOf(course)
  // No answer, or a server error: whether the enrollment went through is unknown until the course is read again.
  const outcomeUnknown = failureKey === 'catalog.errors.network' || failureKey === 'catalog.errors.server'
  // …until the course read again shows the reader's own enrollment or request in that class: the server has answered.
  const outcomeResolved = outcomeUnknown && !loading && course.classes.some((klass) => klass.id === failedClassId && klass.myEnrollment !== null)
  // «اختر الفصل…» only when there is a class to choose: with none, the reason shows instead (unavailable / self-service).
  const chooseNotice = highlightClasses && standing === null && enrollable.length > 0
  const oneClass = enrollable.length === 1

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

  const invoiceOf = (result: CatalogEnrollResult) => result.enrollment.payment.invoices.find((invoice) => invoice.status === 'issued') ?? null

  const summary = course.summary ? localizedLabel(course.summary, language).trim() : ''
  const description = course.description ? localizedLabel(course.description, language).trim() : ''
  const counts = [
    course.sessionsCount !== null ? t('publicCatalog.card.sessionsCount', { count: course.sessionsCount }) : null,
    // With an empty syllabus this reads «لا دروس بعد»: the page says so instead of a section with nothing in it.
    t('publicCatalog.card.lessons', { count: course.syllabus.length }),
  ].filter((text) => text !== null)

  // A section only for what the server has: the description unless the band already says it, the plan when it has items.
  const sections: CoursePageSection[] = []
  if (description && description !== summary) {
    sections.push({
      id: 'course-description',
      label: t('publicCatalog.course.descriptionSection'),
      content: <p className="course-page__text">{description}</p>,
    })
  }
  if (course.syllabus.length > 0) {
    sections.push({
      id: 'course-outline',
      label: t('publicCatalog.course.outlineSection'),
      content: (
        <ol className="catalog-course__syllabus">
          {course.syllabus.map((item, index) => (
            <li key={index} className="catalog-course__lesson">
              <span className="catalog-course__lesson-number" aria-hidden="true">
                <bdi dir="ltr">{index + 1}</bdi>
              </span>
              <div className="catalog-course__lesson-body">
                <span className="catalog-course__lesson-title">{localizedLabel(item.title, language)}</span>
                {item.description ? <span className="catalog-course__lesson-text">{localizedLabel(item.description, language)}</span> : null}
                {item.estimatedMinutes !== null ? <span className="catalog-course__lesson-minutes">{t('publicCatalog.course.minutes', { count: item.estimatedMinutes })}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      ),
    })
  }

  return (
    <ConfigProvider theme={COURSE_PAGE_THEME}>
      <div className="catalog-course">
        <CoursePageLayout
          variant="app"
          title={name}
          back={back}
          badges={courseBadgesOf(course, t, language)}
          meta={
            <span className="catalog-course__meta">
              {counts.map((text) => (
                <span key={text}>{text}</span>
              ))}
            </span>
          }
          summary={summary || undefined}
          status={
            course.mine.enrolled || course.mine.pending ? (
              <Space size={[4, 4]} wrap>
                {course.mine.enrolled ? <Tag color="green">{t('catalog.card.enrolled')}</Tag> : null}
                {course.mine.pending ? <Tag color="gold">{t('catalog.card.pending')}</Tag> : null}
              </Space>
            ) : undefined
          }
          navLabel={t('publicCatalog.course.sectionsNav')}
          sections={sections}
          aside={
            <>
              <CourseEnrollCard courseId={course.id} coverUrl={course.coverImageUrl} testId="catalog-enroll-card">
                <Descriptions size="small" column={1} items={facts} />
                {/* «تُفتح لك بعد تفعيل تسجيلك» is no news to a reader already enrolled (the server's `mine.enrolled`). */}
                {course.mine.enrolled ? null : <Alert type="info" showIcon title={t('catalog.detail.lockedNote')} />}
                <div className="course-enroll__code">
                  <bdi dir="ltr">{course.code}</bdi>
                </div>
              </CourseEnrollCard>
              <div ref={classesRef} className="catalog-course__classes">
                <Card
                  title={t('catalog.detail.classes')}
                  aria-busy={loading}
                  data-testid="catalog-classes"
                  data-intent={highlightClasses ? 'enroll' : undefined}
                  style={highlightClasses ? { boxShadow: '0 0 0 2px #039092' } : undefined}
                >
                  <Flex vertical gap={12}>
                    {standing ? <StandingNotice standing={standing} courseId={course.id} /> : null}
                    {chooseNotice ? (
                      <Alert
                        type="info"
                        showIcon
                        data-testid="catalog-intent-notice"
                        title={t(oneClass ? 'catalog.detail.intentNoticeOne' : 'catalog.detail.intentNotice')}
                        description={t(oneClass ? 'catalog.detail.intentHintOne' : 'catalog.detail.intentHint')}
                        closable
                        onClose={() => setIntentFor(null)}
                      />
                    ) : null}
                    {course.selfService.allowed ? null : <Alert type="info" showIcon title={t(`catalog.selfService.${course.selfService.reason ?? 'no_permission'}`)} />}
                    {shownOutcome ? (
                      shownOutcome.result.outcome === 'enrolled' ? (
                        // PORTAL-04: the server answered an active enrollment — the way on is to learn, or to «فصولي».
                        <Alert
                          type="success"
                          showIcon
                          data-testid="catalog-enrolled"
                          title={t('catalog.result.enrolledTitle')}
                          description={
                            <Flex vertical gap={8}>
                              <span>{t('catalog.result.enrolledContent', { className: shownOutcome.className })}</span>
                              <Space wrap>
                                <Button type="primary" size="small" onClick={() => navigate(`/learn/${encodeURIComponent(course.id)}`)}>
                                  {t('catalog.result.startLearning')}
                                </Button>
                                <Button size="small" onClick={() => navigate('/my-classes')}>
                                  {t('catalog.result.goToMySchool')}
                                </Button>
                              </Space>
                            </Flex>
                          }
                        />
                      ) : (
                        // PORTAL-04: the server's own request — its state, the invoice it issued, and where to follow it. The
                        // request opens nothing: the lessons wait for the payment AND the academy's approval (D-R125).
                        <Alert
                          type="info"
                          showIcon
                          data-testid="catalog-requested"
                          title={t('catalog.result.requestedTitle')}
                          description={
                            <Flex vertical gap={8}>
                              <Space size={6} wrap>
                                <span>{t('catalog.result.requestState')}</span>
                                <Tag color={REQUEST_STATE_COLORS[shownOutcome.result.enrollment.state]}>{t(`catalog.states.${shownOutcome.result.enrollment.state}`)}</Tag>
                              </Space>
                              <span>
                                {t('catalog.result.requestedContent', {
                                  number: invoiceOf(shownOutcome.result)?.number ?? '—',
                                  total: shownOutcome.result.enrollment.payment.currency
                                    ? formatMoney(shownOutcome.result.enrollment.payment.total, shownOutcome.result.enrollment.payment.currency, language)
                                    : shownOutcome.result.enrollment.payment.total.toFixed(2),
                                })}
                              </span>
                              <Space wrap>
                                <Button type="primary" size="small" onClick={() => navigate('/my-classes?section=requests')}>
                                  {t('catalog.result.myRequests')}
                                </Button>
                                <Button size="small" onClick={() => navigate('/payments')}>
                                  {t('catalog.result.invoices')}
                                </Button>
                              </Space>
                            </Flex>
                          }
                        />
                      )
                    ) : null}
                    {failureKey && !outcomeResolved ? (
                      <Alert
                        type="error"
                        showIcon
                        data-testid="catalog-enroll-failure"
                        title={t(failureKey)}
                        // No answer or a server error: the enrollment may have gone through — read the course before trying again.
                        description={outcomeUnknown ? t('catalog.detail.enrollUnknown') : undefined}
                        action={
                          outcomeUnknown ? (
                            <Button size="small" onClick={reload} loading={loading}>
                              {t('catalog.detail.reloadCourse')}
                            </Button>
                          ) : undefined
                        }
                        closable
                        onClose={() => setFailureKey(null)}
                      />
                    ) : null}
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
                        onEnroll={(picked) => confirmEnroll(course, picked)}
                      />
                    ))}
                  </Flex>
                </Card>
              </div>
            </>
          }
        />
      </div>
    </ConfigProvider>
  )
}

/**
 * The reader's own place in the course (PORTAL-04): studying it → «واصل التعلم» to the learning workspace, which
 * resumes where the server says; completed → its review there; a request → its state and «طلباتي» in «فصولي».
 * The workspace itself still checks the enrollment (API-229..234) — this only shows the way.
 */
function StandingNotice({ standing, courseId }: { standing: CourseStanding; courseId: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const className = localizedLabel(standing.klass.name, language)
  const learnPath = `/learn/${encodeURIComponent(courseId)}`

  if (standing.kind === 'pending') {
    return (
      <Alert
        type="info"
        showIcon
        data-testid="catalog-standing"
        data-standing="pending"
        title={t('catalog.detail.mine.pendingTitle')}
        description={
          <Flex vertical gap={8} align="flex-start">
            <Space size={6} wrap>
              <span>{t('catalog.detail.mine.pendingText', { className })}</span>
              <Tag color={REQUEST_STATE_COLORS[standing.state]}>{t(`catalog.states.${standing.state}`)}</Tag>
            </Space>
            <Space wrap>
              <Button size="small" onClick={() => navigate('/my-classes?section=requests')}>
                {t('catalog.detail.mine.requests')}
              </Button>
              {/* The invoice is paid at the academy and recorded by its staff: «my invoices» shows it — no checkout here. */}
              {standing.state === 'pending_payment' ? (
                <Button size="small" onClick={() => navigate('/payments')}>
                  {t('catalog.result.invoices')}
                </Button>
              ) : null}
            </Space>
          </Flex>
        }
      />
    )
  }

  const studying = standing.kind === 'studying'
  return (
    <Alert
      type="success"
      showIcon
      data-testid="catalog-standing"
      data-standing={standing.kind}
      title={t(studying ? 'catalog.detail.mine.studyingTitle' : 'catalog.detail.mine.completedTitle')}
      description={
        <Flex vertical gap={8} align="flex-start">
          <span>{t(studying ? 'catalog.detail.mine.studyingText' : 'catalog.detail.mine.completedText', { className })}</span>
          <Space wrap>
            <Button type="primary" size="small" onClick={() => navigate(learnPath)}>
              {t(studying ? 'catalog.detail.mine.continue' : 'catalog.detail.mine.review')}
            </Button>
            <Button size="small" onClick={() => navigate('/my-classes')}>
              {t('catalog.detail.mine.mySchool')}
            </Button>
          </Space>
        </Flex>
      }
    />
  )
}
