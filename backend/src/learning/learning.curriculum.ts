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
// Completing an earlier level is never a condition for opening a later one
// (D-R132). A level may open by date instead (D-R145): with
// `releaseAfterDays` N it opens for a learner on their class's `starts_on` + N
// days, in the academy's time zone; before that day its lessons are listed but
// cannot be opened, visited, played or completed. A class without `starts_on`,
// a level without N, and the lessons outside every level are always open. A
// locked required lesson still counts in the progress: the course is complete
// only once it is done too.

/** One calendar day in milliseconds (the dates are UTC midnights — no DST). */
const DAY_MS = 86_400_000;

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
 * Where «continue learning» opens (D-R133), among the lessons the learner may
 * open today (D-R145):
 * - `last` — the lesson the learner opened last, while it is still published
 *   and its level open;
 * - `replaced` — that lesson was removed, unpublished or is in a level that is
 *   not open: the first lesson after where it stood that is not completed,
 *   else the first not completed, else the first lesson (the screen tells the
 *   learner why);
 * - `first` — nothing opened yet: the first lesson.
 * null when the course shows no lesson the learner may open.
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
  /**
   * D-R145 — the lessons the learner may open today (their level is open);
   * omitted = every lesson of `order`. The target is never outside it: an
   * unavailable last lesson is `replaced` like an unpublished one, and when no
   * lesson is available the result is null.
   */
  available?: ReadonlySet<string>,
): ResumeTarget | null {
  const open = available === undefined ? order : order.filter((id) => available.has(id));
  if (open.length === 0) return null;
  if (lastOpened === null) return { itemId: open[0]!, reason: 'first' };
  if (open.includes(lastOpened.itemId)) return { itemId: lastOpened.itemId, reason: 'last' };
  const after = open.find((id) => sortKeyOf(id) > lastOpened.sortKey && !completed.has(id));
  const anyOpen = open.find((id) => !completed.has(id));
  return { itemId: after ?? anyOpen ?? open[0]!, reason: 'replaced' };
}

// ---------------------------------------------------------------------------
// D-R145 — a level that opens by date
// ---------------------------------------------------------------------------

/**
 * The day (`YYYY-MM-DD`) a level opens for a learner: their class's start
 * plus `releaseAfterDays` days. null = no date — the class has no `starts_on`
 * or the level no release delay — and the level is open.
 */
export function levelOpensOn(classStartsOn: string | null, releaseAfterDays: number | null): string | null {
  if (classStartsOn === null || releaseAfterDays === null) return null;
  const start = Date.parse(`${classStartsOn}T00:00:00.000Z`);
  if (Number.isNaN(start)) return null;
  return new Date(start + releaseAfterDays * DAY_MS).toISOString().slice(0, 10);
}

/** True when the level is open on `today` (`YYYY-MM-DD` in the academy's time zone): no date, or the date has come. */
export function isLevelOpen(opensOn: string | null, today: string): boolean {
  return opensOn === null || today >= opensOn;
}

export interface LevelState {
  isOpen: boolean;
  /** The opening day, also once it has passed; null for a level without a date (always open). */
  opensOn: string | null;
}

/** The state of one group for a learner: the implicit group of lessons outside every level is always open. */
export function levelStateOf(section: { releaseAfterDays: number | null } | null, classStartsOn: string | null, today: string): LevelState {
  const opensOn = section === null ? null : levelOpensOn(classStartsOn, section.releaseAfterDays);
  return { isOpen: isLevelOpen(opensOn, today), opensOn };
}
