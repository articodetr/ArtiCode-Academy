// Pure rules of the learner's courses (J-F64; since J-F67 shown on «فصولي», while «دروسي» keeps the summary counts):
// which courses the learner studies, the summary counts, the lessons of a course as the list shows them, and what a
// row offers. Every count and state is the server's (D-R133). Unit-tested in hub.view.test.ts.
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

/** A course whose lessons a card of «فصولي» shows below the cards (`studyCourses()`): the learner's own, and one they can open. */
export function isStudyCourse(item: Pick<MyLearningCourse, 'relation' | 'canLearn'>): boolean {
  return item.relation === 'self' && item.canLearn
}

/**
 * The learner's own courses they can open, once each: the unfinished ones by latest activity, then the finished ones.
 * A child's course is a guardian's to follow, not to study (API-230 refuses it).
 */
export function studyCourses(items: readonly MyLearningCourse[]): MyLearningCourse[] {
  const seen = new Set<string>()
  const unique = items
    .filter(isStudyCourse)
    .sort(byRecentActivity)
    .filter((item) => {
      if (seen.has(item.course.id)) return false
      seen.add(item.course.id)
      return true
    })
  return [...unique.filter((item) => !isCourseDone(item)), ...unique.filter(isCourseDone)]
}

/** The course the address names when the learner studies it; none otherwise — «فصولي» shows a course only once chosen. */
export function chosenCourseOf(courses: readonly MyLearningCourse[], param: string | null): MyLearningCourse | null {
  return param ? (courses.find((item) => item.course.id === param) ?? null) : null
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

export function matchesFilter(item: Pick<WorkspaceItem, 'kind'>, filter: HubFilter): boolean {
  if (filter === 'live') return item.kind === 'live'
  if (filter === 'recorded') return item.kind !== 'live'
  return true
}

/** One lesson of «دروسي»'s single list (J-F67): the lesson with its course and level. */
export interface MergedLesson {
  course: MyLearningCourse
  section: WorkspaceSection
  item: WorkspaceItem
}

/**
 * Every lesson of the given courses' workspaces in one list, newest first by `createdAt` (API-230); a lesson without
 * it goes last. Ties keep the courses' order (the course the learner was on last first) and then the curriculum's.
 * The filter narrows by type as in a course's panel.
 */
export function mergedLessonsOf(entries: readonly { course: MyLearningCourse; workspace: LearningWorkspace }[], filter: HubFilter): MergedLesson[] {
  const rows = entries.flatMap(({ course, workspace }, courseIndex) =>
    workspace.sections.flatMap((section) => section.items.map((item) => ({ course, section, item }))).map((row, position) => ({ row, courseIndex, position })),
  )
  const time = (item: WorkspaceItem) => {
    const value = item.createdAt ? Date.parse(item.createdAt) : Number.NaN
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
  }
  return rows
    .filter(({ row }) => matchesFilter(row.item, filter))
    .sort((a, b) => time(b.row.item) - time(a.row.item) || a.courseIndex - b.courseIndex || a.position - b.position)
    .map(({ row }) => row)
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
