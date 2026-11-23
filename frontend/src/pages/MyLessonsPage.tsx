// «My lessons» (MOD-06 — J-F11): GET /api/me/lessons (API-101) for a student
// (the lessons of their own classes, `relation: self`) and a guardian (those of
// the classes their linked children are enrolled in, `relation: child`, while
// they hold the `guardian` role — the server decides). Ownership, no permission
// key. The student and class filters read «my classes» (API-060 — the same
// ownership). The route opens to the holders of the `student` or `guardian`
// server role key only (nav entry `myLessons`, like «my classes»); a learner
// without an owned enrollment gets an empty list, and the page says why. The
// list waits for the academy's zone (the shared API-035 reading), as /lessons
// does. The table and its filters live in `lessons/MyLessonsList.tsx` since
// J-F62, which shows them for one class on /my-classes/:classId too.
import { Card } from 'antd'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { useMyClasses } from '../enrollments/useMyClasses'
import { MyLessonsList } from '../lessons/MyLessonsList'
import { useAcademyZone } from '../lessons/useAcademyZone'

export function MyLessonsPage() {
  const { t } = useTranslation()
  const zone = useAcademyZone()
  const myClasses = useMyClasses()
  return (
    <>
      <PageHeader title={t('myLessons.title')} subtitle={t('myLessons.subtitle')} />
      {/* Keyed by the zone, so «today» is always the academy's day of the reading on screen. */}
      {zone.settled ? <MyLessonsList key={zone.timeZone} dayZone={zone.timeZone} myClasses={myClasses} /> : <Card loading />}
    </>
  )
}
