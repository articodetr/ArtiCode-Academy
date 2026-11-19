// Shared database reads of MOD-20 «My School» (roadmap §4q, ADR-078): the
// curriculum rows of courses (each level with its `releaseAfterDays` — D-R145)
// and each learner's lesson states, from which
// every screen computes its levels, progress and resume point with the pure
// rules of learning.curriculum.ts / learning.progress.ts. Used by the
// learner's own reads (API-229..231) and the class progress (API-235), so a
// teacher and the learner always see the same numbers.
//
// A lesson's state for a learner:
// - the stored `learning_progress` row (`in_progress` / `completed`), else
//   `not_started`;
// - a `live` lesson is also `completed` when the learner was present or late
//   at a non-cancelled session (MOD-06 lesson) covering it — computed here,
//   never written (D-R134); its completion instant is the session's start.
import type { LearningItemKind, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CurriculumItemRow, CurriculumSectionRow } from './learning.curriculum.js';
import type { ItemState } from './learning.progress.js';

type Db = PrismaService['db'] | Prisma.TransactionClient;

export const SECTION_SELECT = {
  id: true,
  courseId: true,
  sortOrder: true,
  title: true,
  description: true,
  /** D-R145 — the level opens N days after the learner's class starts; null = open at once. */
  releaseAfterDays: true,
} satisfies Prisma.CourseSectionSelect;

export const ITEM_SELECT = {
  id: true,
  courseId: true,
  sectionId: true,
  sortOrder: true,
  title: true,
  description: true,
  estimatedMinutes: true,
  kind: true,
  content: true,
  resources: true,
  isRequired: true,
  isPublished: true,
} satisfies Prisma.CourseSyllabusItemSelect;

export type SectionRow = Prisma.CourseSectionGetPayload<{ select: typeof SECTION_SELECT }> & CurriculumSectionRow;
export type ItemRow = Prisma.CourseSyllabusItemGetPayload<{ select: typeof ITEM_SELECT }> & CurriculumItemRow;

export interface CourseCurriculumRows {
  sections: SectionRow[];
  items: ItemRow[];
}

/** Every level and lesson (published or not) of the given courses, by course. */
export async function loadCurriculumRows(db: Db, courseIds: readonly string[]): Promise<Map<string, CourseCurriculumRows>> {
  const out = new Map<string, CourseCurriculumRows>();
  for (const id of courseIds) out.set(id, { sections: [], items: [] });
  if (courseIds.length === 0) return out;
  const [sections, items] = await Promise.all([
    db.courseSection.findMany({ where: { courseId: { in: [...courseIds] } }, orderBy: [{ courseId: 'asc' }, { sortOrder: 'asc' }], select: SECTION_SELECT }),
    db.courseSyllabusItem.findMany({ where: { courseId: { in: [...courseIds] } }, orderBy: [{ courseId: 'asc' }, { sortOrder: 'asc' }], select: ITEM_SELECT }),
  ]);
  for (const section of sections) out.get(section.courseId)?.sections.push(section);
  for (const item of items) out.get(item.courseId)?.items.push(item);
  return out;
}

export interface StoredLessonState extends ItemState {
  lastOpenedAt: Date | null;
  positionSeconds: number | null;
  watchedSeconds: number;
  mediaDurationSeconds: number | null;
  completionSource: 'manual' | 'playback' | 'attendance' | null;
}

/** `${studentId}|${itemId}` → the state. */
export type LessonStates = Map<string, StoredLessonState>;

export function stateKey(studentId: string, itemId: string): string {
  return `${studentId}|${itemId}`;
}

const NOT_STARTED: StoredLessonState = {
  state: 'not_started',
  completedAt: null,
  lastOpenedAt: null,
  positionSeconds: null,
  watchedSeconds: 0,
  mediaDurationSeconds: null,
  completionSource: null,
};

export function stateOf(states: LessonStates, studentId: string, itemId: string): StoredLessonState {
  return states.get(stateKey(studentId, itemId)) ?? NOT_STARTED;
}

/**
 * The lesson states of `studentIds` on the lessons of `courseIds`: the stored
 * rows, then the attendance completions of the `live` lessons (a stored
 * completion stays as it is).
 */
export async function loadLessonStates(
  db: Db,
  studentIds: readonly string[],
  courseIds: readonly string[],
  liveItems: readonly { id: string; kind: LearningItemKind }[],
): Promise<LessonStates> {
  const states: LessonStates = new Map();
  if (studentIds.length === 0 || courseIds.length === 0) return states;
  const rows = await db.learningProgress.findMany({
    where: { studentUserId: { in: [...studentIds] }, courseId: { in: [...courseIds] } },
    select: {
      studentUserId: true,
      syllabusItemId: true,
      status: true,
      completionSource: true,
      completedAt: true,
      lastOpenedAt: true,
      positionSeconds: true,
      watchedSeconds: true,
      mediaDurationSeconds: true,
    },
  });
  for (const row of rows) {
    states.set(stateKey(row.studentUserId, row.syllabusItemId), {
      state: row.status,
      completedAt: row.completedAt,
      lastOpenedAt: row.lastOpenedAt,
      positionSeconds: row.positionSeconds,
      watchedSeconds: row.watchedSeconds,
      mediaDurationSeconds: row.mediaDurationSeconds,
      completionSource: row.completionSource,
    });
  }
  const liveIds = liveItems.filter((item) => item.kind === 'live').map((item) => item.id);
  if (liveIds.length === 0) return states;
  const attended = await db.attendanceRecord.findMany({
    where: {
      studentUserId: { in: [...studentIds] },
      status: { in: ['present', 'late'] },
      lesson: { syllabusItemId: { in: liveIds }, status: { not: 'cancelled' } },
    },
    select: { studentUserId: true, lesson: { select: { syllabusItemId: true, startsAt: true } } },
  });
  for (const record of attended) {
    const itemId = record.lesson.syllabusItemId;
    if (itemId === null) continue;
    const key = stateKey(record.studentUserId, itemId);
    const current = states.get(key);
    if (current?.state === 'completed') {
      if (current.completionSource === 'attendance' && current.completedAt !== null && record.lesson.startsAt < current.completedAt) {
        current.completedAt = record.lesson.startsAt;
      }
      continue;
    }
    states.set(key, {
      ...(current ?? NOT_STARTED),
      state: 'completed',
      completedAt: record.lesson.startsAt,
      completionSource: 'attendance',
    });
  }
  return states;
}

/** The lesson each learner opened last in each course: `${studentId}|${courseId}` → { itemId, at }. */
export async function loadLastOpened(db: Db, studentIds: readonly string[], courseIds: readonly string[]): Promise<Map<string, { itemId: string; at: Date }>> {
  const out = new Map<string, { itemId: string; at: Date }>();
  if (studentIds.length === 0 || courseIds.length === 0) return out;
  const rows = await db.learningProgress.findMany({
    where: { studentUserId: { in: [...studentIds] }, courseId: { in: [...courseIds] } },
    orderBy: [{ lastOpenedAt: 'desc' }, { syllabusItemId: 'asc' }],
    distinct: ['studentUserId', 'courseId'],
    select: { studentUserId: true, courseId: true, syllabusItemId: true, lastOpenedAt: true },
  });
  for (const row of rows) out.set(`${row.studentUserId}|${row.courseId}`, { itemId: row.syllabusItemId, at: row.lastOpenedAt });
  return out;
}
