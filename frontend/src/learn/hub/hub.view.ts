// Pure rules of «دروسي» (J-F64): which courses the learner studies, the summary
// counts, the lessons of a course as the list shows them, and what a row offers.
// Every count and state is the server's (D-R133). Unit-tested in hub.view.test.ts.
import type { LearningWorkspace, MyLearningCourse, ProgressCounts, WorkspaceItem, WorkspaceSection } from '../../api/learning'
import { byRecentActivity, isCourseDone } from '../../mySchool/mySchool.view'

export const HUB_FILTERS = ['all', 'live', 'recorded'] as const
export type HubFilter = (typeof HUB_FILTERS)[number]

/** The query parameters of the page. */
export const VIEW_PARAM = 'view'
export const SESSIONS_VIEW = 'sessions'
export const COURSE_PARAM = 'course'
export const LESSON_PARAM = 'lesson'

/** The address of the class-sessions table, which the learner home links to. */
export const SESSIONS_PATH = `/my-lessons?${VIEW_PARAM}=${SESSIONS_VIEW}`

/**
 * The learner's own courses they can open, once each: the unfinished ones by latest activity, then the finished ones.
 * A child's course is a guardian's to follow, not to study (API-230 refuses it).
 */
export function studyCourses(items: readonly MyLearningCourse[]): MyLearningCourse[] {
  const seen = new Set<string>()
  const unique = items
    .filter((item) => item.relation === 'self' && item.canLearn)
    .sort(byRecentActivity)
    .filter((item) => {
      if (seen.has(item.course.id)) return false
      seen.add(item.course.id)
      return true
    })
  return [...unique.filter((item) => !isCourseDone(item)), ...unique.filter(isCourseDone)]
}

/** The course the address names when the learner has it, else the first one. */
export function selectedCourseOf(courses: readonly MyLearningCourse[], param: string | null): MyLearningCourse | null {
  return courses.find((item) => item.course.id === param) ?? courses[0] ?? null
}

/** The counts of a course: the latest answer of this page when there is one, else API-229's. */
export function countsOf(item: MyLearningCourse, live: Readonly<Record<string, ProgressCounts>>): ProgressCounts {
  return live[item.course.id] ?? item.progress
}

export interface HubTotals {
  courses: number
  lessons: number
  completed: number
}

export function hubTotals(courses: readonly MyLearningCourse[], live: Readonly<Record<string, ProgressCounts>>): HubTotals {
  return courses.reduce<HubTotals>(
    (totals, item) => {
      const counts = countsOf(item, live)
      return { courses: totals.courses + 1, lessons: totals.lessons + counts.total, completed: totals.completed + counts.completed }
    },
    { courses: 0, lessons: 0, completed: 0 },
  )
}

/** A course's share on its card: the server's percent over the required lessons, 0 when it has none. */
export function cardPercent(counts: ProgressCounts): number {
  return counts.percent ?? 0
}

export function matchesFilter(item: Pick<WorkspaceItem, 'kind'>, filter: HubFilter): boolean {
  if (filter === 'live') return item.kind === 'live'
  if (filter === 'recorded') return item.kind !== 'live'
  return true
}

export interface HubRow {
  item: WorkspaceItem
  /** The lesson's number in the whole course, whatever the filter shows. */
  number: number
}

export interface HubGroup {
  section: WorkspaceSection
  rows: HubRow[]
}

/** The lessons by level in learning order; a level the filter empties is left out. */
export function hubGroupsOf(workspace: LearningWorkspace, filter: HubFilter): HubGroup[] {
  let number = 0
  return workspace.sections
    .map((section) => ({
      section,
      rows: section.items.map((item) => ({ item, number: ++number })).filter((row) => matchesFilter(row.item, filter)),
    }))
    .filter((group) => group.rows.length > 0)
}

export type RowAction = 'play' | 'attend' | 'open'

/** What the row's main button says: a medium plays, a live lesson shows its sessions, anything else opens. */
export function rowActionOf(item: Pick<WorkspaceItem, 'kind'>): RowAction {
  if (item.kind === 'video' || item.kind === 'audio') return 'play'
  return item.kind === 'live' ? 'attend' : 'open'
}
