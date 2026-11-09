// What one assignment form session needs beyond its own fields (J-F38): the
// lessons of its class for the lesson select (API-093, only with
// `lessons.read`) and the zone its due date is typed in — dueZoneOf() of
// assignments.zone.ts, fed with the lesson the form links (watched), that
// lesson's `timeZone` from the list already read, the assignment as the
// server holds it (edit) and the academy's zone from the shared API-035 read.
// The creation modal and the edit form call it with their own form instance,
// so the zone they show is the zone they submit with.
import { Form } from 'antd'
import type { FormInstance } from 'antd'
import { useAcademy } from '../academy/useAcademy'
import type { Assignment } from '../api/assignments'
import { useAuth } from '../auth/auth-context'
import { academyZoneOf, dueZoneOf, lessonZoneOf } from './assignments.zone'
import type { DueZone } from './assignments.zone'
import { useClassLessons } from './useClassLessons'
import type { ClassLessons } from './useClassLessons'

export interface AssignmentFormContext {
  lessons: ClassLessons
  /** API-093 needs `lessons.read`; without it the lesson select explains why it is empty. */
  canReadLessons: boolean
  dueZone: DueZone
}

export function useAssignmentFormContext(form: FormInstance, classId: string | undefined, current?: Assignment): AssignmentFormContext {
  const canReadLessons = useAuth().hasPermission('lessons.read')
  const lessons = useClassLessons(classId, canReadLessons)
  const lessonId = Form.useWatch('lessonId', form) as string | undefined
  const { academy } = useAcademy()
  const lessonZone = lessonZoneOf(lessons.lessons.find((lesson) => lesson.id === lessonId))
  const dueZone = dueZoneOf({
    lessonId,
    lessonZone,
    current: current ? { lessonId: current.lesson?.id ?? null, timeZone: current.timeZone } : undefined,
    academyZone: academyZoneOf(academy),
  })
  return { lessons, canReadLessons, dueZone }
}
