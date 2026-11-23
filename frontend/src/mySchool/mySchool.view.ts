// Pure rules of «My School» (MOD-20, roadmap §4q): which sections a viewer
// gets and which one the URL names, which courses each section lists and in
// what order, the summary counts, the local search, the state badge and the
// one action of a course card, and the context action of an enrollment
// request. Nothing here decides what the server decides — the progress, the
// `action`, `canLearn`, the request state and the certificate status are
// always the server's (D-R133). Unit-tested in mySchool.view.test.ts (TEST-250).
import { ApiError } from '../api/client'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { LearningAction, MyLearningCourse } from '../api/learning'
import type { MyCertificateItem } from '../api/myCertificates'

export const MY_SCHOOL_SECTIONS = ['continue', 'courses', 'completed', 'requests', 'assessments', 'certificates'] as const
export type MySchoolSection = (typeof MY_SCHOOL_SECTIONS)[number]

/** The sections that list course cards (the local search applies to them only). */
export const COURSE_SECTIONS: readonly MySchoolSection[] = ['continue', 'courses', 'completed']

/** The query parameter that remembers the chosen section. */
export const SECTION_PARAM = 'section'

export interface MySchoolViewer {
  /** Holds the `student` server role key: studies, has own requests. */
  student: boolean
}

/**
 * The sections of a viewer, in menu order: «continue learning» and «requests» are a student's (a guardian follows
 * their children and has no own request — API-222 would answer an empty list).
 */
export function sectionsFor(viewer: MySchoolViewer): MySchoolSection[] {
  return MY_SCHOOL_SECTIONS.filter((section) => viewer.student || (section !== 'continue' && section !== 'requests'))
}

/** Where the page opens: a student continues learning, anyone else sees the courses they follow. */
export function defaultSection(viewer: MySchoolViewer): MySchoolSection {
  return viewer.student ? 'continue' : 'courses'
}

/** The section the URL names when the viewer has it, else the default one. */
export function sectionOf(param: string | null | undefined, viewer: MySchoolViewer): MySchoolSection {
  const sections = sectionsFor(viewer)
  return sections.find((section) => section === param) ?? defaultSection(viewer)
}

export function isCourseSection(section: MySchoolSection): boolean {
  return COURSE_SECTIONS.includes(section)
}

/** Done = every required lesson completed (the server's `isComplete`) or the enrollment itself completed. */
export function isCourseDone(item: Pick<MyLearningCourse, 'progress' | 'enrollment'>): boolean {
  return item.progress.isComplete || item.enrollment.status === 'completed'
}

function time(iso: string | null): number | null {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isNaN(value) ? null : value
}

/** Most recent activity first (no activity last), then the newest enrollment. */
export function byRecentActivity(a: Pick<MyLearningCourse, 'lastActivityAt' | 'enrollment'>, b: Pick<MyLearningCourse, 'lastActivityAt' | 'enrollment'>): number {
  const left = time(a.lastActivityAt)
  const right = time(b.lastActivityAt)
  if (left !== right) {
    if (left === null) return 1
    if (right === null) return -1
    return right - left
  }
  return (time(b.enrollment.enrolledAt) ?? 0) - (time(a.enrollment.enrolledAt) ?? 0)
}

/** «Continue learning»: the caller's own courses they can open and have not finished, most recent activity first. */
export function continueItems(items: readonly MyLearningCourse[]): MyLearningCourse[] {
  return items.filter((item) => item.relation === 'self' && item.canLearn && !isCourseDone(item)).sort(byRecentActivity)
}

/**
 * The course «قيد التعلم» puts first and wide («تابع من حيث توقفت», PORTAL-04): the most recent one of the list as
 * shown, when the student has already been in it (an activity or a lesson opened, per the server) — never a course
 * not started yet, and nothing while a search narrows the list. Presentation only: the card's action is the server's.
 */
export function featuredItemOf(items: readonly MyLearningCourse[], query: string): MyLearningCourse | null {
  if (query.trim() !== '') return null
  const first = items[0]
  if (!first || first.relation !== 'self' || !first.canLearn) return null
  return first.lastActivityAt !== null || first.lastLesson !== null ? first : null
}

/** «Completed courses»: the done ones, in the server's order (own first). */
export function completedItems(items: readonly MyLearningCourse[]): MyLearningCourse[] {
  return items.filter(isCourseDone)
}

/** The cards a course section lists (before the search). «My courses» is every item the server answered. */
export function itemsOfSection(section: MySchoolSection, items: readonly MyLearningCourse[]): MyLearningCourse[] {
  if (section === 'continue') return continueItems(items)
  if (section === 'completed') return completedItems(items)
  if (section === 'courses') return [...items]
  return []
}

/** Lower-cased and trimmed, for a forgiving local match. */
function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** The local search «ابحث في دوراتك»: the course name in any language or its code contains the query. */
export function matchesSearch(item: Pick<MyLearningCourse, 'course'>, query: string): boolean {
  const needle = normalized(query)
  if (!needle) return true
  const { name, code } = item.course
  return [name.ar, name.en, name.tr, code].some((value) => typeof value === 'string' && normalized(value).includes(needle))
}

export function searchItems(items: readonly MyLearningCourse[], query: string): MyLearningCourse[] {
  return items.filter((item) => matchesSearch(item, query))
}

/**
 * The one action of a card: only on the caller's own course the server lets them open (a guardian never studies). A
 * course whose enrollment the server reports completed (the office completed it, lessons done or not) is reviewed, not
 * started: PORTAL-04 stage 5 found «المكتملة» offering «ابدأ التعلم» for one — the workspace opens it the same way.
 */
export function cardActionOf(item: Pick<MyLearningCourse, 'relation' | 'canLearn' | 'action' | 'enrollment'>): LearningAction | null {
  if (item.relation !== 'self' || !item.canLearn || item.action === null) return null
  return item.enrollment.status === 'completed' ? 'review' : item.action
}

/** The learning workspace of a course; it resumes by itself (API-230 `resume`). */
export function learnPath(courseId: string): string {
  return `/learn/${encodeURIComponent(courseId)}`
}

/** The catalog page of a course — where a new request starts. */
export function catalogCoursePath(courseId: string): string {
  return `/catalog/${encodeURIComponent(courseId)}`
}

/** The badge on a card's cover, from the server's counts. */
export type CourseState = 'complete' | 'inProgress' | 'notStarted'

export function courseStateOf(item: Pick<MyLearningCourse, 'progress' | 'lastActivityAt' | 'action' | 'enrollment'>): CourseState {
  // Done by the lessons or by the enrollment (the same rule as «المكتملة» — isCourseDone): never «جديدة» there.
  if (isCourseDone(item)) return 'complete'
  if (item.action === 'start' || (item.lastActivityAt === null && item.progress.completed === 0)) return 'notStarted'
  return 'inProgress'
}

export const COURSE_STATE_COLORS: Record<CourseState, string> = {
  complete: 'green',
  inProgress: 'blue',
  notStarted: 'default',
}

/** A request is still pending while the server's enrollment status is `pending` (awaiting payment or approval). */
export function isPendingRequest(request: Pick<MyEnrollmentRequest, 'status'>): boolean {
  return request.status === 'pending'
}

/**
 * The context action of a request card: pay the invoice, wait for the office, ask again after a refusal — or, once the
 * server says the enrollment is active (or done), go to the course (PORTAL-04: never before; the workspace checks it).
 */
export type RequestAction = 'pay' | 'awaitingApproval' | 'requestAgain' | 'learn'

export function requestActionOf(request: Pick<MyEnrollmentRequest, 'state'>): RequestAction | null {
  if (request.state === 'pending_payment') return 'pay'
  if (request.state === 'pending_approval') return 'awaitingApproval'
  if (request.state === 'rejected') return 'requestAgain'
  if (request.state === 'enrolled' || request.state === 'completed') return 'learn'
  return null
}

/** The four steps of a paid request, in order: sent, paid, approved by the office, active. */
export const REQUEST_STEPS = ['sent', 'payment', 'approval', 'active'] as const

/**
 * Where a request stands on those steps, from the server's state only (PORTAL-04): awaiting the payment = step 1,
 * awaiting the approval = step 2, active or done = every step finished. A rejected, cancelled or withdrawn request has
 * no place on them (null — its state and reason say it).
 */
export function requestStepOf(request: Pick<MyEnrollmentRequest, 'state'>): { current: number; finished: boolean } | null {
  if (request.state === 'pending_payment') return { current: 1, finished: false }
  if (request.state === 'pending_approval') return { current: 2, finished: false }
  if (request.state === 'enrolled' || request.state === 'completed') return { current: REQUEST_STEPS.length - 1, finished: true }
  return null
}

/** The line under a section's title, when it has one (PORTAL-04); a guardian's courses are their children's. */
export function sectionHintKey(section: MySchoolSection, viewer: MySchoolViewer): string | null {
  if (section === 'continue') return 'mySchool.courses.continueHint'
  if (section === 'courses') return viewer.student ? 'mySchool.courses.allHint' : 'mySchool.courses.allHintGuardian'
  if (section === 'completed') return 'mySchool.courses.completedHint'
  if (section === 'requests') return 'mySchool.requests.hint'
  return null
}

/** The page where «my invoices» lives (the request's invoice is there — never a checkout of this page's own). */
export const PAYMENTS_PATH = '/payments'

/** A count of the summary strip: a number from the server's answer, or null while it is unknown (loading, failed, not asked). */
export type SummaryCount = number | null

export interface MySchoolSummary {
  activeCourses: SummaryCount
  completedCourses: SummaryCount
  pendingRequests: SummaryCount
  certificates: SummaryCount
}

export interface SummarySources {
  /** API-229's items, or null while unknown. */
  courses: readonly MyLearningCourse[] | null
  /** API-222's items, or null while unknown or not asked (not a student). */
  requests: readonly MyEnrollmentRequest[] | null
  /** API-135's items, or null while unknown. */
  certificates: readonly Pick<MyCertificateItem, 'status'>[] | null
}

/** The summary strip: real counts only — an unknown source counts nothing (null), never a guessed number. */
export function summaryOf(sources: SummarySources): MySchoolSummary {
  const { courses, requests, certificates } = sources
  return {
    activeCourses: courses ? courses.filter((item) => !isCourseDone(item)).length : null,
    completedCourses: courses ? courses.filter(isCourseDone).length : null,
    pendingRequests: requests ? requests.filter(isPendingRequest).length : null,
    certificates: certificates ? certificates.filter((item) => item.status === 'issued').length : null,
  }
}

/** The i18n key under `mySchool.errors` for a failed read. */
export function mySchoolFailureKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'mySchool.errors.network'
  if (error.status === 403) return 'mySchool.errors.permission'
  if (error.status === 429) return 'mySchool.errors.rateLimited'
  return 'mySchool.errors.server'
}
