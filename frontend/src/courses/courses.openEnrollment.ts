// PORTAL-04 phase 1: the pure rules of the «فتح الاشتراك» panel of the course
// drawer. Every enrollment belongs to a class, so a course is open for
// subscription when one of its open or running classes takes self-service
// enrollment. The panel only ever changes OUR general class — the one whose
// `notes` carry GENERAL_CLASS_MARKER, written when the panel created it — and
// never a class the admin made themselves, whatever its code or name (both can
// be edited later): a private cohort stays private. The server stays the
// authority on who may actually enroll.
import type { AcademyClass, ClassStatus } from '../api/classes'
import type { Course, CourseStatus } from '../api/courses'
import { CLASS_CAPACITY_MAX } from '../classes/classes.form'
import { academyTimeZoneOf } from '../common/timeZone'
import { todayIn } from '../lessons/lessons.format'
import { deviceTimeZone } from '../timetable/timetable.settings'

/** The name of the class this panel creates. */
export const GENERAL_CLASS_NAME = { ar: 'الفصل العام', en: 'General class' } as const

/** In a class's `notes`, the one thing that makes it ours. */
export const GENERAL_CLASS_MARKER = '[general-class]'

/** The `notes` of the class this panel creates. */
export const GENERAL_CLASS_NOTE = '[general-class] أنشأه زر «فتح الاشتراك» — Created by the Open enrollment button'

export const DEFAULT_GENERAL_CAPACITY = 1000

/** `CLASS_CODE_PATTERN` of the server allows 32 characters. */
const CLASS_CODE_MAX_LENGTH = 32

const GENERAL_CODE_SUFFIXES = ['-GEN', '-GEN2', '-GEN3', '-GEN4', '-GEN5', '-GEN6', '-GEN7', '-GEN8', '-GEN9'] as const

const LIVE_STATUSES: ReadonlySet<ClassStatus> = new Set<ClassStatus>(['open', 'running'])

/** A general class in one of these still has a self-enrollment switch worth turning off. */
const STOPPABLE_STATUSES: ReadonlySet<ClassStatus> = new Set<ClassStatus>(['planned', 'open', 'running'])

/** What «فتح الاشتراك» has to do, given what the server holds now. */
export type OpenStep =
  /** Our general class is open or running with self-enrollment off: turn it back on. */
  | { kind: 'reenable'; classId: string }
  /** Our general class is still planned (an earlier attempt stopped half way): finish it. */
  | { kind: 'resume'; classId: string; enableSelfService: boolean }
  /** No general class can be reused: create one, then open it. */
  | { kind: 'create' }

export type EnrollmentPanelPlan =
  | { kind: 'unpublished' }
  | { kind: 'open'; classes: AcademyClass[] }
  | { kind: 'closed'; step: OpenStep }

/** The candidate codes in the order they are tried: `<COURSE_CODE>-GEN`, then `-GEN2` … `-GEN9`, each at most 32 characters. */
export function generalClassCodes(courseCode: string): string[] {
  return GENERAL_CODE_SUFFIXES.map((suffix) => {
    const prefix = courseCode.slice(0, CLASS_CODE_MAX_LENGTH - suffix.length).replace(/[._-]+$/, '')
    return `${prefix}${suffix}`
  })
}

/** A class this panel created: its notes carry the marker. Without it the class is the admin's, whatever its code or name. */
export function isGeneralClass(klass: Pick<AcademyClass, 'notes'>): boolean {
  return klass.notes?.includes(GENERAL_CLASS_MARKER) === true
}

/** Every class of the course that takes self-service enrollment right now, whoever made it. */
export function selfServiceClasses(classes: readonly AcademyClass[]): AcademyClass[] {
  return classes.filter((klass) => klass.selfEnrollment && LIVE_STATUSES.has(klass.status))
}

export interface StopPlan {
  /** The general classes «إيقاف الاشتراك» turns off, a planned one included. */
  targets: AcademyClass[]
  /** The admin's own self-service classes: never changed, so subscription stays open through them. */
  staysOpenThrough: AcademyClass[]
}

export function planStop(classes: readonly AcademyClass[]): StopPlan {
  return {
    targets: classes.filter((klass) => isGeneralClass(klass) && klass.selfEnrollment && STOPPABLE_STATUSES.has(klass.status)),
    staysOpenThrough: selfServiceClasses(classes).filter((klass) => !isGeneralClass(klass)),
  }
}

/** The admin's own classes still in use: a new general class would sit beside them, so the dialog says so. */
export function hasPrivateClasses(classes: readonly AcademyClass[]): boolean {
  return classes.some((klass) => !isGeneralClass(klass) && STOPPABLE_STATUSES.has(klass.status))
}

/** The default start of a new general class: today in the academy's zone, or this device's when the academy could not be read. */
export function defaultStartsOn(academy: { timezone?: unknown } | null | undefined, now: Date = new Date()): string {
  return todayIn(academyTimeZoneOf(academy) ?? deviceTimeZone(), now)
}

function nextOpenStep(classes: readonly AcademyClass[]): OpenStep {
  const general = classes.filter(isGeneralClass)
  const live = general.find((klass) => LIVE_STATUSES.has(klass.status))
  if (live) return { kind: 'reenable', classId: live.id }
  const planned = general.find((klass) => klass.status === 'planned')
  if (planned) return { kind: 'resume', classId: planned.id, enableSelfService: !planned.selfEnrollment }
  return { kind: 'create' }
}

/** The panel's state from the course status and the classes the server returned. */
export function planEnrollmentPanel(courseStatus: CourseStatus, classes: readonly AcademyClass[]): EnrollmentPanelPlan {
  if (courseStatus !== 'published') return { kind: 'unpublished' }
  const open = selfServiceClasses(classes)
  if (open.length > 0) return { kind: 'open', classes: open }
  return { kind: 'closed', step: nextOpenStep(classes) }
}

/**
 * A paid course whose fee plan the detail shows as deactivated: the class can
 * open, but the server refuses every request with `course_price_unavailable`.
 * API-043 does not expose whether an active plan still fits the course.
 */
export function coursePriceUnusable(course: Pick<Course, 'pricing' | 'enrollmentFeePlan'>): boolean {
  return course.pricing === 'paid' && course.enrollmentFeePlan?.isActive !== true
}

/** A whole number of seats the server accepts (1..32767). */
export function isValidCapacity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CLASS_CAPACITY_MAX
}
