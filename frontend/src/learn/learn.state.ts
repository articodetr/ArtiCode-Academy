// Pure rules of the learning workspace's client state (MOD-20): where a
// lesson sits in the curriculum of API-230, and how an answer of the server
// (API-232 visit, API-233 playback, API-234 completion) is carried into the
// sidebar without reading the workspace again. The server is the only
// authority on progress (D-R133): nothing here computes a percentage or a
// completion — it copies what an answer said. The one local rule is D-R134's
// «completion never reverts»: an older answer that arrives late never turns a
// completed lesson back. Unit-tested in learn.state.test.ts.
import type { ItemProgress, LearningWorkspace, ProgressCounts, WorkspaceItem, WorkspaceSection } from '../api/learning'

/** Where a learner opens a lesson of the course: `/learn/:courseId/:itemId`. */
export function learnerItemPath(courseId: string): (itemId: string) => string {
  return (itemId) => `/learn/${encodeURIComponent(courseId)}/${encodeURIComponent(itemId)}`
}

/** A stable key of a level; the implicit group of lessons outside every level has none of its own. */
export function sectionKeyOf(section: Pick<WorkspaceSection, 'id'>): string {
  return section.id ?? 'loose'
}

export interface ItemPlace {
  section: WorkspaceSection
  item: WorkspaceItem
}

/** The level and the lesson of `itemId`, or null when the workspace does not show it. */
export function placeOf(workspace: LearningWorkspace | null, itemId: string | undefined): ItemPlace | null {
  if (!workspace || !itemId) return null
  for (const section of workspace.sections) {
    const item = section.items.find((candidate) => candidate.id === itemId)
    if (item) return { section, item }
  }
  return null
}

/** Every lesson id in learning order (the sidebar's order — the server's). */
export function learningOrderOf(workspace: LearningWorkspace): string[] {
  return workspace.sections.flatMap((section) => section.items.map((item) => item.id))
}

/**
 * False only when the server says the lesson's level is not open yet (D-R145);
 * a body without the field (a server before LRN-T06) reads as open.
 */
export function isItemAvailable(item: Pick<WorkspaceItem, 'available'>): boolean {
  return item.available !== false
}

/** False only when the server says the level is not open yet (D-R145). */
export function isSectionOpen(section: Pick<WorkspaceSection, 'isOpen'>): boolean {
  return section.isOpen !== false
}

/** The lessons the learner can open now, in learning order. */
function availableOrderOf(workspace: LearningWorkspace): string[] {
  return workspace.sections.flatMap((section) => section.items.filter(isItemAvailable).map((item) => item.id))
}

/**
 * Where the workspace opens: the server's resume target, unless that lesson
 * proved unavailable in this visit (`missing`), is not shown or cannot be
 * opened yet (D-R145) — then the first available lesson shown that is not
 * missing; null when nothing is left.
 */
export function openingItemOf(workspace: LearningWorkspace, missing: ReadonlySet<string> = new Set()): string | null {
  const order = availableOrderOf(workspace)
  const resume = workspace.resume?.itemId
  if (resume && !missing.has(resume) && order.includes(resume)) return resume
  return order.find((id) => !missing.has(id)) ?? null
}

/**
 * The earliest opening day (`YYYY-MM-DD`) among the levels that are not open
 * yet and hold a lesson — what the learner is told when no lesson can be
 * opened today; null when none names a day.
 */
export function firstOpeningDayOf(workspace: LearningWorkspace): string | null {
  const days = workspace.sections
    .filter((section) => !isSectionOpen(section) && section.items.length > 0 && typeof section.opensOn === 'string')
    .map((section) => section.opensOn as string)
    .sort()
  return days[0] ?? null
}

/** True when the workspace lists lessons but none of them can be opened today (every one in a level not open yet). */
export function everyLessonLocked(workspace: LearningWorkspace): boolean {
  const items = workspace.sections.flatMap((section) => section.items)
  return items.length > 0 && items.every((item) => !isItemAvailable(item))
}

/** The newer of two answers about one lesson, by D-R134: a completed lesson stays completed whatever arrives after. */
export function mergeProgress(current: ItemProgress | null, next: ItemProgress): ItemProgress {
  if (current && current.state === 'completed' && next.state !== 'completed') return current
  return next
}

export interface CountsUpdate {
  /** The lesson's level counts, when the answer carried them (API-234). */
  section?: ProgressCounts
  /** The course counts (API-233, API-234). */
  course?: ProgressCounts
}

/**
 * The workspace with one lesson's state from an answer of the server, and
 * the level and course counts that answer carried. The lesson never goes back
 * from completed; a lesson the workspace does not show changes nothing but
 * the course counts.
 */
export function withItemProgress(
  workspace: LearningWorkspace,
  itemId: string,
  progress: ItemProgress,
  counts: CountsUpdate = {},
): LearningWorkspace {
  const sections = workspace.sections.map((section) => {
    const index = section.items.findIndex((item) => item.id === itemId)
    if (index < 0) return section
    const items = section.items.map((item) => {
      if (item.id !== itemId) return item
      if (item.state === 'completed' && progress.state !== 'completed') return item
      return { ...item, state: progress.state, completedAt: progress.completedAt }
    })
    return { ...section, items, progress: counts.section ?? section.progress }
  })
  return { ...workspace, sections, progress: counts.course ?? workspace.progress }
}

/** True when this answer is the one that completed the course: it says so, and the course was not complete before (never inferred locally). */
export function completesCourse(before: ProgressCounts, after: ProgressCounts | undefined, completedNow: boolean): boolean {
  return completedNow && after !== undefined && after.isComplete && !before.isComplete
}
