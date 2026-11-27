// «My lessons» (MOD-06 — J-F11; J-F64; J-F67). The route opens to the holders of
// the `student` or `guardian` server role key only (nav entry `myLessons`, like
// «دوراتي»).
// A student — since J-F67 (CH-0243, Jallal's request) — gets the summary header
// and the lessons panel of every course they study, exactly the panel «دوراتي»
// (/my-classes) opens under its cards: `learn/hub/AllCoursesLessons.tsx`
// (API-229..234), the course the learner was on last at the top.
// A guardian follows their children and never studies (API-230 refuses a child's
// course), so they get every lesson of their children's classes, newest first, in
// the same look: `lessons/MyLessonsFeed.tsx` on GET /api/me/lessons (API-101 —
// ownership, `relation: child` while they hold the `guardian` role), which waits
// for the academy's zone (the shared API-035 reading), as /lessons does.
// Since J-F80 (CH-0387, Jallal's request «يجب ان يرى الطالب الدروس والروابط التي يرسلها الاستاذ») a student's page
// also lists the class lessons their teachers add (MOD-06, API-101 — the guardian's feed in its student variant),
// between the summary and the curriculum, each with its join link, video and attachments.
// The learner home still links here with `?view=sessions` (SESSIONS_PATH); the
// page reads no parameter of its own, so that link opens this same page.
import { Card, ConfigProvider } from 'antd'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'
import { AllCoursesLessons } from '../learn/hub/AllCoursesLessons'
import { HUB_ANTD_THEME } from '../learn/hub/hub.theme'
import '../publicCatalog/publicFonts.css'
import '../learn/hub/hub.css'
import { MyLessonsFeed } from '../lessons/MyLessonsFeed'
import { useAcademyZone } from '../lessons/useAcademyZone'

/** J-F80: a student's class lessons (API-101), once the academy's zone is read. */
function StudentClassLessons() {
  const zone = useAcademyZone()
  const myClasses = useMyClasses()
  return zone.settled ? <MyLessonsFeed key={zone.timeZone} dayZone={zone.timeZone} myClasses={myClasses} variant="student" /> : <Card loading />
}

/** A guardian's page: their children's lessons, newest first. */
function ChildrenLessons() {
  const { t } = useTranslation()
  const zone = useAcademyZone()
  const myClasses = useMyClasses()
  return (
    <>
      <PageHeader title={t('myLessons.title')} subtitle={t('myLessons.subtitle')} />
      {/* Keyed by the zone, so «today» is always the academy's day of the reading on screen. */}
      {zone.settled ? <MyLessonsFeed key={zone.timeZone} dayZone={zone.timeZone} myClasses={myClasses} /> : <Card loading />}
    </>
  )
}

export function MyLessonsPage() {
  const { user } = useAuth()
  const studies = (user?.roles ?? []).includes('student')

  return (
    <ConfigProvider theme={HUB_ANTD_THEME}>
      <div className="hub hub-sessions">{studies ? <AllCoursesLessons afterSummary={<StudentClassLessons />} /> : <ChildrenLessons />}</div>
    </ConfigProvider>
  )
}
