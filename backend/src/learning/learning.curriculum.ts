// The curriculum tree of MOD-20 «My School» (roadmap §4q, D-R130/D-R135) as
// pure rules, unit-tested in learning.curriculum.spec.ts.
//
// A course's curriculum = its levels (`course_sections`, by `sort_order`),
// each holding its lessons (`course_syllabus_items` with that `section_id`,
// by the lessons' own `sort_order`). Lessons outside every level (a course
// that has no level yet, or a lesson added later through the flat syllabus
// API-049) form one implicit group after the levels — or the only group when
// the course has no level at all. That displayed order is THE learning order:
// the sidebar, «previous/next» and the resume fallback all follow it, on
// every device. Learners see published lessons only, and a level without a
// published lesson is not shown to them.
//
// Every level is open to an enrolled learner (D-R132): completing an earlier
// level is never a condition for opening a later one.

export interface CurriculumSectionRow {
  id: string;
  sortOrder: number;
}

export interface CurriculumItemRow {
  id: string;
  sectionId: string | null;
  sortOrder: number;
  isPublished: boolean;
}

export interface CurriculumGroup<S extends CurriculumSectionRow, I extends CurriculumItemRow> {
  /** null = the implicit group of lessons outside every level. */
  section: S | null;
  /** 1-based number of the group in the displayed order («المستوى الأول» = 1). */
  number: number;
  items: I[];
}

export interface BuildOptions {
  /** Learners: published lessons only, and no empty level. Authors see everything. */
  learner: boolean;
}

export function buildCurriculum<S extends CurriculumSectionRow, I extends CurriculumItemRow>(
  sections: readonly S[],
  items: readonly I[],
  options: BuildOptions,
): CurriculumGroup<S, I>[] {
  const visible = options.learner ? items.filter((item) => item.isPublished) : [...items];
  const sectionIds = new Set(sections.map((section) => section.id));
  const bySection = new Map<string | null, I[]>();
  for (const item of [...visible].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = item.sectionId !== null && sectionIds.has(item.sectionId) ? item.sectionId : null;
    const list = bySection.get(key) ?? [];
    list.push(item);
    bySection.set(key, list);
  }
  const groups: CurriculumGroup<S, I>[] = [];
  for (const section of [...sections].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = bySection.get(section.id) ?? [];
    if (options.learner && list.length === 0) continue;
    groups.push({ section, number: groups.length + 1, items: list });
  }
  const loose = bySection.get(null) ?? [];
  if (loose.length > 0) groups.push({ section: null, number: groups.length + 1, items: loose });
  return groups;
}

/** Lesson ids in learning order. */
export function learningOrder<I extends CurriculumItemRow>(groups: readonly CurriculumGroup<CurriculumSectionRow, I>[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id));
}

export interface Neighbors {
  previous: string | null;
  next: string | null;
}

/** The lessons before and after `itemId` in learning order, across level boundaries; both null when it is not in the order. */
export function neighborsOf(order: readonly string[], itemId: string): Neighbors {
  const index = order.indexOf(itemId);
  if (index < 0) return { previous: null, next: null };
  return { previous: index > 0 ? order[index - 1]! : null, next: index < order.length - 1 ? order[index + 1]! : null };
}

/**
 * Where «continue learning» opens (D-R133):
 * - `last` — the lesson the learner opened last, while it is still published;
 * - `replaced` — that lesson was removed or unpublished: the first lesson
 *   after where it stood that is not completed, else the first not completed,
 *   else the first lesson (the screen tells the learner why);
 * - `first` — nothing opened yet: the first lesson.
 * null when the course shows no lesson at all.
 */
export type ResumeReason = 'last' | 'replaced' | 'first';

export interface ResumeTarget {
  itemId: string;
  reason: ResumeReason;
}

export function resumeTargetOf(
  order: readonly string[],
  lastOpened: { itemId: string; sortKey: number } | null,
  completed: ReadonlySet<string>,
  sortKeyOf: (itemId: string) => number,
): ResumeTarget | null {
  if (order.length === 0) return null;
  if (lastOpened === null) return { itemId: order[0]!, reason: 'first' };
  if (order.includes(lastOpened.itemId)) return { itemId: lastOpened.itemId, reason: 'last' };
  const after = order.find((id) => sortKeyOf(id) > lastOpened.sortKey && !completed.has(id));
  const anyOpen = order.find((id) => !completed.has(id));
  return { itemId: after ?? anyOpen ?? order[0]!, reason: 'replaced' };
}
