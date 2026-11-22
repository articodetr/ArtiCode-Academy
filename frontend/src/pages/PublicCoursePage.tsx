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
// user goes (replace) to /catalog/<id>.
import { ArrowLeftOutlined, ArrowRightOutlined, LoginOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Flex, List, Skeleton, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { isCatalogNotPublic } from '../api/publicCatalog'
import type { PublicCourseDetail } from '../api/publicCatalog'
import { CourseCover } from '../catalog/CourseCover'
import { useLocalized } from '../i18n/useLocalized'
import { CatalogClosed } from '../publicCatalog/CatalogClosed'
import { PublicPriceTag } from '../publicCatalog/PublicPriceTag'
import {
  AVAILABILITY_COLORS,
  availabilityOf,
  durationMinutes,
  enrollIntentPath,
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
      <PublicShell>
        <PublicCourse courseId={courseId} />
      </PublicShell>
    </PublicOnly>
  )
}

function PublicCourse({ courseId }: { courseId: string }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const { course, error, reload } = usePublicCourse(courseId)

  const back = (
    <Button icon={language === 'ar' ? <ArrowRightOutlined /> : <ArrowLeftOutlined />} onClick={() => navigate('/explore')} style={{ marginBottom: 16 }}>
      {t('publicCatalog.course.back')}
    </Button>
  )

  if (error && isCatalogNotPublic(error)) {
    return (
      <>
        <PublicTitle />
        <CatalogClosed />
      </>
    )
  }

  if (!course) {
    return (
      <>
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
      </>
    )
  }

  const overview = course.description ?? course.summary

  return (
    <>
      <PublicTitle page={localizedLabel(course.name, language)} />
      {back}
      <CourseSummary course={course} onEnroll={() => navigate('/login', { state: { from: enrollIntentPath(course.id) } })} />
      <Card title={t('publicCatalog.course.overview')} style={{ marginBottom: 16 }}>
        {/* Plain text (D-R131): line breaks kept, never markup. */}
        <Typography.Paragraph style={{ whiteSpace: 'pre-line', margin: 0 }}>
          {overview ? localizedLabel(overview, language) : <Typography.Text type="secondary">{t('publicCatalog.course.noDescription')}</Typography.Text>}
        </Typography.Paragraph>
      </Card>
      <CourseOutline course={course} />
    </>
  )
}

function CourseSummary({ course, onEnroll }: { course: PublicCourseDetail; onEnroll: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = availabilityOf(course)
  const enrollState = publicEnrollStateOf(course)

  const facts: DescriptionsProps['items'] = []
  if (course.level) facts.push({ key: 'level', label: t('publicCatalog.course.level'), children: localizedLabel(course.level.name, language) })
  if (course.durationHours !== null) facts.push({ key: 'duration', label: t('publicCatalog.card.duration'), children: t('publicCatalog.card.hours', { count: course.durationHours }) })
  if (course.sessionsCount !== null) facts.push({ key: 'sessions', label: t('publicCatalog.card.sessions'), children: t('publicCatalog.card.sessionsCount', { count: course.sessionsCount }) })
  facts.push({
    key: 'content',
    label: t('publicCatalog.card.content'),
    children:
      course.levelCount > 0
        ? `${t('publicCatalog.card.lessons', { count: course.lessonCount })} · ${t('publicCatalog.card.levels', { count: course.levelCount })}`
        : t('publicCatalog.card.lessons', { count: course.lessonCount }),
  })
  if (course.minAge !== null || course.maxAge !== null) {
    const age =
      course.minAge !== null && course.maxAge !== null
        ? t('publicCatalog.course.ageRange', { min: course.minAge, max: course.maxAge })
        : course.minAge !== null
          ? t('publicCatalog.course.ageFrom', { min: course.minAge })
          : t('publicCatalog.course.ageTo', { max: course.maxAge })
    facts.push({ key: 'age', label: t('publicCatalog.course.age'), children: age })
  }
  facts.push({ key: 'price', label: t('publicCatalog.card.price'), children: <PublicPriceTag course={course} /> })

  return (
    <Card style={{ marginBottom: 16 }} cover={course.coverImageUrl ? <CourseCover key={course.coverImageUrl} url={course.coverImageUrl} height={220} /> : undefined}>
      <Flex vertical gap={12}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {localizedLabel(course.name, language)}
          </Typography.Title>
          <Typography.Text type="secondary">
            <bdi dir="ltr">{course.code}</bdi>
          </Typography.Text>
        </div>
        <Space size={[4, 4]} wrap>
          {/* A paid course without a usable price: the price row and the notice below say why. */}
          {availability !== 'priceUnavailable' ? <Tag color={AVAILABILITY_COLORS[availability]}>{t(`publicCatalog.card.${availability}`)}</Tag> : null}
        </Space>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={facts} />
        {enrollState === 'enrollable' ? (
          <Flex vertical gap={6} align="flex-start" data-testid="public-enroll">
            <Button type="primary" size="large" icon={<LoginOutlined />} onClick={onEnroll}>
              {t('publicCatalog.course.enroll')}
            </Button>
            <Typography.Text type="secondary">{t('publicCatalog.course.enrollNote')}</Typography.Text>
            {course.pricing === 'paid' ? <Typography.Text type="secondary">{t('publicCatalog.course.paidNote')}</Typography.Text> : null}
          </Flex>
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
      </Flex>
    </Card>
  )
}

function CourseOutline({ course }: { course: PublicCourseDetail }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const levels = course.outline.filter((level) => level.lessons.length > 0)

  return (
    <Card title={t('publicCatalog.course.outline')} data-testid="public-outline">
      <Alert type="info" showIcon title={t('publicCatalog.course.outlineNote')} style={{ marginBottom: 12 }} />
      {levels.length === 0 ? (
        <Typography.Text type="secondary">{t('publicCatalog.course.outlineEmpty')}</Typography.Text>
      ) : (
        <Flex vertical gap={16}>
          {levels.map((level) => (
            <section key={level.number} aria-label={levelNameOf(level, t, language)}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {levelNameOf(level, t, language)}
              </Typography.Title>
              <List
                size="small"
                bordered
                dataSource={level.lessons}
                renderItem={(lesson, index) => {
                  const minutes = durationMinutes(lesson.durationSeconds)
                  return (
                    <List.Item>
                      <Flex justify="space-between" align="center" gap={8} wrap style={{ width: '100%' }}>
                        <Typography.Text>
                          <bdi dir="ltr">{index + 1}.</bdi> {localizedLabel(lesson.title, language)}
                        </Typography.Text>
                        <Space size={4} wrap>
                          <Tag>{t(`publicCatalog.kinds.${lesson.kind}`)}</Tag>
                          {minutes !== null ? <Typography.Text type="secondary">{t('publicCatalog.course.minutes', { count: minutes })}</Typography.Text> : null}
                        </Space>
                      </Flex>
                    </List.Item>
                  )
                }}
              />
            </section>
          ))}
        </Flex>
      )}
    </Card>
  )
}
