// One course of the public catalog (MOD-20, D-R138): /explore/:courseId,
// outside the app layout and without a sign-in. GET
// /api/public/catalog/courses/:id (API-237 — no token, 60/min per IP): the
// course (cover, level, duration, sessions, price, age range, overview) and its
// outline by level (D-R130 — «المستوى الأول — …») with the lesson titles, kinds
// and lengths only; the content opens after an enrollment. No teacher, class or
// schedule is ever shown. «سجّل في هذه الدورة» sends the visitor to the sign-in
// page with `from` = the course in the signed-in catalog plus the enroll intent
// (`/catalog/<id>?intent=enroll`), which scrolls to its classes once signed in —
// nothing enrolls by itself, and no account is created here (accounts come from
// the academy). Since PORTAL-04 PR-2 the button shows only while a visitor can go
// on to enroll (`publicEnrollStateOf()`: a class open, a free seat, a usable price);
// otherwise «التسجيل غير متاح حالياً» says why and the details stay readable. A
// paid course says that it becomes a request with an invoice, activated after
// payment and approval (MOD-19). The tab reads «course — academy».
// `404 catalog_not_public` shows the calm «closed» page; a signed-in
// user goes (replace) to /catalog/<id>. «العودة إلى الدورات» returns to the
// search the course was opened from — its own address carries it
// (`/explore/:id?q=`, PORTAL-04 PR-2) — so a refresh, a new tab and a shared link
// keep it; without one it leads to /explore. Only ever /explore: the search is a
// value of `q`, never an address.
//
// The look (the course redesign): CoursePageLayout — a turquoise band with the
// title, badges, counts, short text and availability; the enrollment card beside
// it; «الوصف» and «الخطة الدراسية» below, each only with real data. API-237 has no
// learning outcomes and no teacher, so neither section exists.
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  LoginOutlined,
  ReadOutlined,
  RiseOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Collapse, Skeleton } from 'antd'
import type { KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { isCatalogNotPublic } from '../api/publicCatalog'
import type { PublicCourseDetail, PublicOutlineLevel } from '../api/publicCatalog'
import { useLocalized } from '../i18n/useLocalized'
import { CatalogClosed } from '../publicCatalog/CatalogClosed'
import { CourseEnrollCard, CoursePageLayout } from '../publicCatalog/CoursePageLayout'
import type { CoursePageSection } from '../publicCatalog/CoursePageLayout'
import { PublicPriceText } from '../publicCatalog/PublicPriceTag'
import {
  availabilityOf,
  cardSubscribeTarget,
  courseBadgesOf,
  courseTextsOf,
  durationMinutes,
  enrollIntentPath,
  explorePathFor,
  exploreSearchOf,
  isPublicCourseGone,
  levelNameOf,
  publicEnrollStateOf,
  publicFailureKey,
} from '../publicCatalog/publicCatalog.view'
import { PublicOnly, PublicShell } from '../publicCatalog/PublicShell'
import { PublicTitle } from '../publicCatalog/PublicTitle'
import { usePublicCourse } from '../publicCatalog/usePublicCourse'
import { localizedLabel } from '../users/users.format'

export function PublicCoursePage() {
  const { courseId = '' } = useParams()
  return (
    <PublicOnly signedInTo={`/catalog/${encodeURIComponent(courseId)}`}>
      <PublicShell bleed>
        <PublicCourse courseId={courseId} />
      </PublicShell>
    </PublicOnly>
  )
}

function PublicCourse({ courseId }: { courseId: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { course, error, reload } = usePublicCourse(courseId)
  // Back to the results the course was opened from (`?q=` of this page), else to all programs.
  const backPath = explorePathFor(exploreSearchOf(params))
  const back = <BackButton onClick={() => navigate(backPath)} />

  if (error && isCatalogNotPublic(error)) {
    return (
      <div className="course-page-state">
        <PublicTitle />
        <CatalogClosed />
      </div>
    )
  }

  if (!course) {
    return (
      <div className="course-page-state">
        <PublicTitle />
        {back}
        {error && isPublicCourseGone(error) ? (
          <Alert type="warning" showIcon title={t('publicCatalog.course.notFound')} />
        ) : error ? (
          <Alert
            type="error"
            showIcon
            title={t('publicCatalog.course.loadError')}
            description={t(publicFailureKey(error))}
            action={
              <Button size="small" onClick={reload}>
                {t('publicCatalog.list.retry')}
              </Button>
            }
          />
        ) : (
          <Card>
            <Skeleton active />
          </Card>
        )}
      </div>
    )
  }

  const name = localizedLabel(course.name, language)
  const { summary, description } = courseTextsOf(course, language)
  const availability = availabilityOf(course)
  const counts =
    course.levelCount > 0
      ? `${t('publicCatalog.card.lessons', { count: course.lessonCount })} · ${t('publicCatalog.card.levels', { count: course.levelCount })}`
      : t('publicCatalog.card.lessons', { count: course.lessonCount })
  const levels = course.outline.filter((level) => level.lessons.length > 0)

  const sections: CoursePageSection[] = []
  if (description) {
    sections.push({
      id: 'course-description',
      label: t('publicCatalog.course.descriptionSection'),
      // Plain text (D-R131): line breaks kept, never markup.
      content: <p className="course-page__text">{description}</p>,
    })
  }
  if (levels.length > 0) {
    sections.push({ id: 'course-outline', label: t('publicCatalog.course.outlineSection'), content: <CourseOutline levels={levels} /> })
  }

  return (
    <>
      <PublicTitle page={name} />
      <CoursePageLayout
        variant="public"
        title={name}
        back={back}
        badges={courseBadgesOf(course, t, language)}
        meta={counts}
        summary={summary}
        status={
          // A paid course without a usable price: the card's price and notice say why.
          availability !== 'priceUnavailable' ? (
            <span className={`course-availability course-availability--${availability}`}>
              <span className="course-availability__dot" aria-hidden="true" />
              {t(`publicCatalog.card.${availability}`)}
            </span>
          ) : null
        }
        aside={<CourseEnrollment course={course} counts={counts} onEnroll={() => navigate('/login', { state: { from: enrollIntentPath(course.id) } })} />}
        sections={sections}
        navLabel={t('publicCatalog.course.sectionsNav')}
      />
    </>
  )
}

/** The way back: a plain button, so the band can word it in white and the state pages in the academy's colour. */
function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <button type="button" className="course-back" onClick={onClick}>
      <span className="course-back__icon" aria-hidden="true">
        {language === 'ar' ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}
      </span>
      {t('publicCatalog.course.back')}
    </button>
  )
}

function CourseFact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="course-facts__row">
      <dt>
        <span className="course-facts__icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

function ageTextOf(course: PublicCourseDetail, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (course.minAge !== null && course.maxAge !== null) return t('publicCatalog.course.ageRange', { min: course.minAge, max: course.maxAge })
  if (course.minAge !== null) return t('publicCatalog.course.ageFrom', { min: course.minAge })
  if (course.maxAge !== null) return t('publicCatalog.course.ageTo', { max: course.maxAge })
  return null
}

function CourseEnrollment({ course, counts, onEnroll }: { course: PublicCourseDetail; counts: string; onEnroll: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const enrollState = publicEnrollStateOf(course)
  const age = ageTextOf(course, t)
  // This page is a visitor's (PublicOnly sends a signed-in user to /catalog/:id).
  const subscribe = cardSubscribeTarget(course, 'visitor', false)

  return (
    <CourseEnrollCard courseId={course.id} coverUrl={course.coverImageUrl} testId="public-enroll-card">
      <dl className="course-facts">
        {course.level ? (
          <CourseFact icon={<RiseOutlined />} label={t('publicCatalog.course.level')}>
            {localizedLabel(course.level.name, language)}
          </CourseFact>
        ) : null}
        {course.durationHours !== null ? (
          <CourseFact icon={<ClockCircleOutlined />} label={t('publicCatalog.card.duration')}>
            {t('publicCatalog.card.hours', { count: course.durationHours })}
          </CourseFact>
        ) : null}
        {course.sessionsCount !== null ? (
          <CourseFact icon={<CalendarOutlined />} label={t('publicCatalog.card.sessions')}>
            {t('publicCatalog.card.sessionsCount', { count: course.sessionsCount })}
          </CourseFact>
        ) : null}
        <CourseFact icon={<ReadOutlined />} label={t('publicCatalog.card.content')}>
          {counts}
        </CourseFact>
        {age ? (
          <CourseFact icon={<TeamOutlined />} label={t('publicCatalog.course.age')}>
            {age}
          </CourseFact>
        ) : null}
      </dl>
      <div className="course-enroll__price">
        <span className="course-enroll__price-label">{t('publicCatalog.card.price')}</span>
        <PublicPriceText course={course} />
      </div>
      {enrollState === 'enrollable' ? (
        <div className="course-enroll__action" data-testid="public-enroll">
          <div className="course-enroll__buttons">
            <Button type="primary" size="large" icon={<LoginOutlined />} onClick={onEnroll}>
              {t('publicCatalog.course.enroll')}
            </Button>
            {subscribe ? (
              <Link to={subscribe.to} state={subscribe.state} className="course-enroll__subscribe" data-testid={`public-subscribe-${course.id}`}>
                {t(course.pricing === 'paid' ? 'publicCatalog.card.subscribePaid' : 'publicCatalog.card.subscribeFree')}
              </Link>
            ) : null}
          </div>
          <p className="course-enroll__note">{t('publicCatalog.course.enrollNote')}</p>
          {course.pricing === 'paid' ? <p className="course-enroll__note">{t('publicCatalog.course.paidNote')}</p> : null}
        </div>
      ) : (
        // PORTAL-04 PR-2: no way to enroll now — said plainly, and the details stay readable.
        <Alert
          data-testid="public-not-enrollable"
          type="info"
          showIcon
          title={t('publicCatalog.course.notEnrollableTitle')}
          description={t(`publicCatalog.course.notEnrollable.${enrollState}`)}
        />
      )}
      <div className="course-enroll__code">
        <bdi dir="ltr">{course.code}</bdi>
      </div>
    </CourseEnrollCard>
  )
}

/** A panel's header is a `role="button"` that answers Enter only: Space must press it too. */
function pressPanelOnSpace(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== ' ') return
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.matches('[role="button"][aria-expanded]')) return
  event.preventDefault()
  target.click()
}

/** The study plan: the curriculum levels that have lessons, in order, the first one open. */
function CourseOutline({ levels }: { levels: readonly PublicOutlineLevel[] }) {
  const { t } = useTranslation()
  const { language } = useLocalized()

  return (
    <div className="course-outline" data-testid="public-outline" onKeyDown={pressPanelOnSpace}>
      <p className="course-outline__note">
        <span className="course-outline__note-icon" aria-hidden="true">
          <InfoCircleOutlined />
        </span>
        <span>{t('publicCatalog.course.outlineNote')}</span>
      </p>
      <Collapse
        expandIconPlacement="end"
        defaultActiveKey={[String(levels[0]!.number)]}
        items={levels.map((level) => ({
          key: String(level.number),
          // Every lesson title stays in the document, also while its level is closed.
          forceRender: true,
          label: levelNameOf(level, t, language),
          extra: <span className="course-outline__count">{t('publicCatalog.card.lessons', { count: level.lessons.length })}</span>,
          children: (
            <ol className="course-outline__lessons">
              {level.lessons.map((lesson, index) => {
                const minutes = durationMinutes(lesson.durationSeconds)
                return (
                  <li key={index} className="course-outline__lesson">
                    <span className="course-outline__title">
                      {/* The list already announces the position. */}
                      <span className="course-outline__number" aria-hidden="true">
                        <bdi dir="ltr">{index + 1}</bdi>
                      </span>
                      <span>{localizedLabel(lesson.title, language)}</span>
                    </span>
                    <span className="course-outline__info">
                      <span className="course-outline__kind">{t(`publicCatalog.kinds.${lesson.kind}`)}</span>
                      {minutes !== null ? <span>{t('publicCatalog.course.minutes', { count: minutes })}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          ),
        }))}
      />
    </div>
  )
}
