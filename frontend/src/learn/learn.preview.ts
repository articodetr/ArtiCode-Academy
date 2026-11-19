// «معاينة كطالب» (MOD-20 — D-R144): the curriculum an author reads (API-226)
// turned into the shapes the course player renders (API-230/231), so the
// preview shows the very sidebar and lesson a learner sees — and records
// nothing (no API-229..234 call is ever made from it). As a learner sees it:
// published lessons only (drafts too when the author asks, tagged), a level
// without a shown lesson left out, the levels numbered in the displayed order
// and the lessons outside every level last (backend learning.curriculum.ts
// buildCurriculum). Every level is shown open; its `releaseAfterDays` is
// stated beside it (D-R145 — the learner's opening day depends on the class).
// Nothing is progress: every lesson is «not started». Pure; unit-tested in
// learn.preview.test.ts.
import type { Curriculum, CurriculumItem, CurriculumSection } from '../api/curriculum'
import type { ItemProgress, LearningItem, LearningWorkspace, ProgressCounts, WorkspaceItem, WorkspaceSection } from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import { sectionKeyOf } from './learn.state'

/** A level as API-226 sends it; `releaseAfterDays` since LRN-T06 (read defensively — a body without it is «always open»). */
type SectionWithRelease = CurriculumSection & { releaseAfterDays?: unknown }

interface PreviewPlace {
  item: CurriculumItem
  section: { id: string | null; number: number; title: LocalizedLabel | null }
}

export interface PreviewModel {
  workspace: LearningWorkspace
  /** The shown lessons in learning order. */
  order: string[]
  places: ReadonlyMap<string, PreviewPlace>
  /** The shown lessons that are not published. */
  drafts: ReadonlySet<string>
  /** Each shown level's `releaseAfterDays` (null = always open), by its key (sectionKeyOf). */
  releaseAfterDays: ReadonlyMap<string, number | null>
  /** How many unpublished lessons the curriculum holds that are not shown (the drafts switch is off). */
  hiddenDrafts: number
}

/** A level's `releaseAfterDays` as the preview states it: a whole number of days 0..365, else null (always open). */
export function releaseDaysOf(section: CurriculumSection): number | null {
  const value = (section as SectionWithRelease).releaseAfterDays
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 365 ? value : null
}

function emptyCounts(items: readonly CurriculumItem[]): ProgressCounts {
  const required = items.filter((item) => item.isRequired).length
  return { total: items.length, required, completed: 0, completedRequired: 0, percent: required > 0 ? 0 : null, isComplete: false, completedAt: null }
}

function workspaceItemOf(item: CurriculumItem): WorkspaceItem {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    isRequired: item.isRequired,
    estimatedMinutes: item.estimatedMinutes,
    durationSeconds: item.durationSeconds,
    completionMode: item.completionMode,
    state: 'not_started',
    completedAt: null,
    available: true,
  }
}

export function previewModelOf(curriculum: Curriculum, options: { showDrafts: boolean }): PreviewModel {
  const shown = (item: CurriculumItem) => options.showDrafts || item.isPublished
  const groups: { id: string | null; title: LocalizedLabel | null; description: LocalizedLabel | null; release: number | null; items: CurriculumItem[] }[] = []
  for (const section of curriculum.sections) {
    const items = section.items.filter(shown)
    if (items.length > 0) groups.push({ id: section.id, title: section.title, description: section.description, release: releaseDaysOf(section), items })
  }
  const loose = curriculum.looseItems.filter(shown)
  if (loose.length > 0) groups.push({ id: null, title: null, description: null, release: null, items: loose })

  const places = new Map<string, PreviewPlace>()
  const releaseAfterDays = new Map<string, number | null>()
  const drafts = new Set<string>()
  const sections: WorkspaceSection[] = groups.map((group, index) => {
    const number = index + 1
    releaseAfterDays.set(sectionKeyOf(group), group.release)
    for (const item of group.items) {
      places.set(item.id, { item, section: { id: group.id, number, title: group.title } })
      if (!item.isPublished) drafts.add(item.id)
    }
    return {
      id: group.id,
      number,
      title: group.title,
      description: group.description,
      items: group.items.map(workspaceItemOf),
      progress: emptyCounts(group.items),
      isOpen: true,
      opensOn: null,
    }
  })
  const every = groups.flatMap((group) => group.items)
  const all = [...curriculum.sections.flatMap((section) => section.items), ...curriculum.looseItems]
  return {
    workspace: {
      // API-226 names the course by its code only.
      course: { id: curriculum.courseId, code: curriculum.courseCode, name: { ar: curriculum.courseCode }, coverImageUrl: null },
      enrollment: { id: '', status: 'active', class: { id: '', code: '', name: { ar: '' } } },
      completionPercent: 0,
      sections,
      progress: emptyCounts(every),
      resume: null,
      sessions: [],
    },
    order: every.map((item) => item.id),
    places,
    drafts,
    releaseAfterDays,
    hiddenDrafts: options.showDrafts ? 0 : all.filter((item) => !item.isPublished).length,
  }
}

const NOT_STARTED: ItemProgress = { state: 'not_started', completedAt: null, completionSource: null, positionSeconds: null, watchedSeconds: 0, watchedPercent: null }

/** One shown lesson as the lesson view renders it (API-231's shape), its neighbours in the shown order; null when it is not shown. */
export function previewItemOf(model: PreviewModel, itemId: string, completionPercent: number): LearningItem | null {
  const place = model.places.get(itemId)
  if (!place) return null
  const index = model.order.indexOf(itemId)
  const neighbor = (id: string | undefined) => {
    const other = id ? model.places.get(id) : undefined
    return other ? { id: other.item.id, title: other.item.title, available: true } : null
  }
  const { item } = place
  return {
    id: item.id,
    courseId: model.workspace.course.id,
    title: item.title,
    description: item.description,
    kind: item.kind,
    content: item.content,
    resources: item.resources,
    isRequired: item.isRequired,
    estimatedMinutes: item.estimatedMinutes,
    durationSeconds: item.durationSeconds,
    section: place.section,
    completionMode: item.completionMode,
    completionPercent,
    progress: NOT_STARTED,
    neighbors: { previous: neighbor(model.order[index - 1]), next: neighbor(model.order[index + 1]) },
    sessions: [],
    assignments: [],
    exams: [],
  }
}
