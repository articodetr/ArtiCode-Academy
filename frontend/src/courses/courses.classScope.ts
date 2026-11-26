// The pure rules behind the course drawer's class tabs («المدرسون», «الطلاب»,
// the weekly schedule, the learning progress, the grades and the certificates).
// Every teacher assignment, enrollment and lesson hangs off a class, but the
// admin no longer manages classes: the drawer works on the course's class —
// normally the general class of the «فتح الاشتراك» panel (its `notes` carry
// GENERAL_CLASS_MARKER) — and a legacy course with several classes gets a small
// selector. An ended class (completed, cancelled) is never picked by default;
// it stays reachable through the selector for its grades and certificates.
import type { AcademyClass, ClassStatus } from '../api/classes'
import type { CourseStatus } from '../api/courses'
import { canReadCertificates } from '../certificates/certificates.policy'
import { isGeneralClass } from './courses.openEnrollment'

/** The drawer tabs that work on the course's class, in their order after «المنهج». */
export const COURSE_CLASS_TABS = ['teachers', 'students', 'schedule', 'learning', 'gradebook', 'certificates'] as const
export type CourseClassTab = (typeof COURSE_CLASS_TABS)[number]

/** The tabs whose class components hold editors that report unsaved work. */
export type CourseClassEditorTab = Extract<CourseClassTab, 'teachers' | 'students' | 'schedule'>

/** Each tab's label; the four last reuse the class drawer's own words, none of which says «فصل». */
export const COURSE_CLASS_TAB_LABELS: Readonly<Record<CourseClassTab, string>> = {
  teachers: 'courseClass.tabs.teachers',
  students: 'courseClass.tabs.students',
  schedule: 'classSchedule.tab',
  learning: 'learningProgress.tab',
  gradebook: 'gradebook.tab',
  certificates: 'certificates.classTab.tab',
}

export function isCourseClassTab(key: string): key is CourseClassTab {
  return (COURSE_CLASS_TABS as readonly string[]).includes(key)
}

/**
 * The class tabs a caller sees — the class drawer's gates. Every one needs `classes.read` (API-050 lists the
 * course's classes); the students and the learning progress need `enrollments.read`, and the class itself
 * decides the rest of their gate (`canReadRoster()` — `enrollments.manage` or teaching the class), the
 * gradebook `grades.read_all`, the certificates `certificates.read_all` or `certificates.issue`.
 */
export function visibleCourseClassTabs(hasPermission: (key: string) => boolean): CourseClassTab[] {
  if (!hasPermission('classes.read')) return []
  return COURSE_CLASS_TABS.filter((tab) => {
    if (tab === 'students' || tab === 'learning') return hasPermission('enrollments.read')
    if (tab === 'gradebook') return hasPermission('grades.read_all')
    if (tab === 'certificates') return canReadCertificates(hasPermission)
    return true
  })
}

const LIVE_STATUSES: ReadonlySet<ClassStatus> = new Set<ClassStatus>(['open', 'running'])

/** Lower picks first; null = never picked by default (an ended class). */
function defaultRank(klass: AcademyClass): number | null {
  const general = isGeneralClass(klass)
  if (LIVE_STATUSES.has(klass.status)) return general ? 0 : 2
  if (klass.status === 'planned') return general ? 1 : 3
  return null
}

/** Ended classes come after every pickable one in the selector: completed before cancelled. */
function choiceRank(klass: AcademyClass): number {
  return defaultRank(klass) ?? (klass.status === 'completed' ? 4 : 5)
}

/**
 * The class the drawer works on without a choice of the admin: the general class (open or running first,
 * then planned), else another open or running class, else a planned one, else none. Ties keep the
 * server's order (by code).
 */
export function pickDefaultClass(classes: readonly AcademyClass[]): AcademyClass | null {
  let best: AcademyClass | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const klass of classes) {
    const rank = defaultRank(klass)
    if (rank !== null && rank < bestRank) {
      best = klass
      bestRank = rank
    }
  }
  return best
}

/** The selector's options: every class of the course, the default order first, then the ended ones. */
export function classChoices(classes: readonly AcademyClass[]): AcademyClass[] {
  return classes
    .map((klass, index) => ({ klass, index }))
    .sort((a, b) => choiceRank(a.klass) - choiceRank(b.klass) || a.index - b.index)
    .map(({ klass }) => klass)
}

/**
 * Whether the admin has a choice the default does not make for them: more than one class (legacy data of
 * the old classes page), or a single class that is ended and so not picked by default.
 */
export function showsClassSelector(classes: readonly AcademyClass[]): boolean {
  return classes.length > 1 || (classes.length === 1 && pickDefaultClass(classes) === null)
}

/** The admin's choice while the course still has it, else the default pick. */
export function resolveSelectedClass(classes: readonly AcademyClass[], chosenId: string | null): AcademyClass | null {
  const chosen = chosenId === null ? undefined : classes.find((klass) => klass.id === chosenId)
  return chosen ?? pickDefaultClass(classes)
}

/** What «تجهيز الدورة للمدرسين والطلاب» has to do, given what the server holds now. */
export type PreparePlan =
  /** A class needs a published course (the server answers `422 course_not_published`). */
  | { kind: 'unpublished' }
  /** The drawer already works on a usable class: nothing to write. */
  | { kind: 'ready'; classId: string }
  /** Our general class is still planned (an earlier press stopped half way): just open it. */
  | { kind: 'open'; classId: string }
  /** No usable class: create the general class, then open it. */
  | { kind: 'create' }

/**
 * Only OUR planned general class is ever opened here; an admin's own planned class is left as it is (the
 * panel's rule: a private cohort is never changed by a button).
 */
export function planPrepare(courseStatus: CourseStatus, classes: readonly AcademyClass[]): PreparePlan {
  if (courseStatus !== 'published') return { kind: 'unpublished' }
  const picked = pickDefaultClass(classes)
  if (!picked) return { kind: 'create' }
  if (picked.status === 'planned' && isGeneralClass(picked)) return { kind: 'open', classId: picked.id }
  return { kind: 'ready', classId: picked.id }
}

/** The selected class is our general class, created but not opened yet: the prepare button finishes it. */
export function awaitsOpening(klass: AcademyClass): boolean {
  return klass.status === 'planned' && isGeneralClass(klass)
}
