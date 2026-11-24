// «My lessons» (MOD-06 — J-F11; J-F64). A student opens on their courses and the
// lessons inside them (learn/hub — API-229..234), with the video playing in the
// page; the tab «مواعيد الحصص» (`?view=sessions`) is the table of class sessions.
// A guardian follows their children and never studies, so they get that table
// alone. The table — GET /api/me/lessons (API-101): a student's own classes
// (`relation: self`), a guardian's linked children (`relation: child`, while they
// hold the `guardian` role — the server decides); ownership, no permission key.
// The student and class filters read «my classes» (API-060 — the same ownership).
// The route opens to the holders of the `student` or `guardian` server role key
// only (nav entry `myLessons`, like «my classes»); a learner without an owned
// enrollment gets an empty list, and the page says why. The list waits for the
// academy's zone (the shared API-035 reading), as /lessons does. The table and
// its filters live in `lessons/MyLessonsList.tsx` since J-F62, which shows them
// for one class on /my-classes/:classId too.
import { CalendarOutlined, ReadOutlined } from '@ant-design/icons'
import { Card } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'
import { SESSIONS_PATH, SESSIONS_VIEW, VIEW_PARAM } from '../learn/hub/hub.view'
import '../learn/hub/hub.css'
import { MyLessonsHub } from '../learn/hub/MyLessonsHub'
import { MyLessonsList } from '../lessons/MyLessonsList'
import { useAcademyZone } from '../lessons/useAcademyZone'

function MyLessonsTabs({ active }: { active: 'programs' | 'sessions' }) {
  const { t } = useTranslation()
  const tabs = [
    { key: 'programs', to: '/my-lessons', icon: <ReadOutlined aria-hidden />, label: t('myLessons.hub.tabs.programs') },
    { key: 'sessions', to: SESSIONS_PATH, icon: <CalendarOutlined aria-hidden />, label: t('myLessons.hub.tabs.sessions') },
  ] as const
  return (
    <nav className="hub-tabs" aria-label={t('myLessons.hub.tabs.label')}>
      {tabs.map((tab) => (
        <Link key={tab.key} to={tab.to} className={`hub-tab${tab.key === active ? ' is-active' : ''}`} aria-current={tab.key === active ? 'page' : undefined}>
          {tab.icon}
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  )
}

function MyLessonSessions({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation()
  const zone = useAcademyZone()
  const myClasses = useMyClasses()
  return (
    <>
      {tabs}
      <PageHeader title={t('myLessons.title')} subtitle={t('myLessons.subtitle')} />
      {/* Keyed by the zone, so «today» is always the academy's day of the reading on screen. */}
      {zone.settled ? <MyLessonsList key={zone.timeZone} dayZone={zone.timeZone} myClasses={myClasses} /> : <Card loading />}
    </>
  )
}

export function MyLessonsPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const studies = (user?.roles ?? []).includes('student')
  if (!studies) return <MyLessonSessions tabs={null} />
  if (params.get(VIEW_PARAM) === SESSIONS_VIEW) return <MyLessonSessions tabs={<MyLessonsTabs active="sessions" />} />
  return <MyLessonsHub tabs={<MyLessonsTabs active="programs" />} />
}
