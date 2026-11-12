// What one exam form session needs beyond its own fields (J-F45), on the
// pattern of assignments/useAssignmentFormContext.ts: the lessons of its class
// for the lesson select (API-093, only with `lessons.read` — the assignments'
// useClassLessons()) and the zone its date is typed in — examZoneOf() of
// exams.zone.ts, fed with the lesson the form links (watched), that lesson's
// `timeZone` from the list already read, the exam as the server holds it
// (edit) and the academy's zone from the shared API-035 read. The creation
// modal and the edit form call it with their own form instance, so the zone
// they show is the zone they submit with. While the academy's first read has
// not answered, the device zone stands in without a failure: `zonePending`
// lets the hint say so (J-F56, as the assignments' — the owner's note 3 on #87).
import { Form } from 'antd'
import type { FormInstance } from 'antd'
import { useAcademy } from '../academy/useAcademy'
import type { Exam } from '../api/exams'
import { academyZoneOf, lessonZoneOf } from '../assignments/assignments.zone'
import { useClassLessons } from '../assignments/useClassLessons'
import type { ClassLessons } from '../assignments/useClassLessons'
import { useAuth } from '../auth/auth-context'
import { examZoneOf } from './exams.zone'
import type { ExamZone } from './exams.zone'

export interface ExamFormContext {
  lessons: ClassLessons
  /** API-093 needs `lessons.read`; without it the lesson select explains why it is empty. */
  canReadLessons: boolean
  zone: ExamZone
  /** The device zone stands in because the academy's first read is still running — not because it failed. */
  zonePending: boolean
}

export function useExamFormContext(form: FormInstance, classId: string | undefined, current?: Exam): ExamFormContext {
  const canReadLessons = useAuth().hasPermission('lessons.read')
  const lessons = useClassLessons(classId, canReadLessons)
  const lessonId = Form.useWatch('lessonId', form) as string | undefined
  const { academy, error } = useAcademy()
  const lessonZone = lessonZoneOf(lessons.lessons.find((lesson) => lesson.id === lessonId))
  const zone = examZoneOf({
    lessonId,
    lessonZone,
    current: current ? { lessonId: current.lesson?.id ?? null, timeZone: current.timeZone } : undefined,
    academyZone: academyZoneOf(academy),
  })
  return { lessons, canReadLessons, zone, zonePending: zone.source === 'device' && academy === null && error === null }
}
