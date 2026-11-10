// Pure rules of the MOD-09-T04 results sheet (roadmap §4h.4 API-119/API-120;
// owner decisions D-R45/D-R47), unit-tested in exam-results.changes.spec.ts,
// on the pattern of lessons/attendance.changes.ts:
//
//   - An exam takes results while it is scheduled or published and its class
//     is not cancelled (a completed class keeps corrections open — D-R33 (1));
//     a draft is `not_scheduled`.
//   - A result is `scored` with a score in 0..max_score, or `absent` (counts 0
//     in the final grade) or `excused` (left out of it — D-R45) without one.
//   - The batch is a diff: every entry is the WHOLE new state of that
//     student's result (status, score, feedback). A result is created when the
//     student has none, updated when any value differs, left alone when
//     identical; students absent from the request are never touched and
//     nothing is deleted. The plan is computed before any write, so an
//     identical batch is a 200 without a write or an audit event.
import type { ClassStatus, EnrollmentStatus, ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';
import type { ExamNotRecordableReason } from '../grades/grades.errors.js';

/** A student may hold a result while their enrollment in the class is one of these (as attendance — D-R33 (6)). */
export const RESULT_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['active', 'completed'];

/** Why an exam refuses results right now: `class_cancelled` → `409 class_closed`, the other → `409 exam_not_recordable { reason }`. */
export type ResultsBlocker = 'class_cancelled' | ExamNotRecordableReason;

/** The values of one result (the request's entry is the whole new state). */
export interface ResultValues {
  status: ExamResultStatus;
  /** `numeric(6,2)` text, only with `scored`. */
  score: string | null;
  feedback: string | null;
}

export interface ResultEntry extends ResultValues {
  studentId: string;
}

export const RESULT_FIELDS = ['status', 'score', 'feedback'] as const;
export type ResultField = (typeof RESULT_FIELDS)[number];

export interface ResultUpdate {
  studentId: string;
  data: ResultValues;
  fields: ResultField[];
}

export interface ResultsPlan {
  created: ResultEntry[];
  updated: ResultUpdate[];
  unchanged: string[];
}

/** The reason the exam cannot take results now, or null. The class first, then the exam's status. */
export function resultsBlocker(classStatus: ClassStatus, examStatus: ExamStatus): ResultsBlocker | null {
  if (classStatus === 'cancelled') return 'class_cancelled';
  if (examStatus === 'draft') return 'not_scheduled';
  return null;
}

/** Students named more than once in the batch (each once, in first-seen order). */
export function duplicateStudents(studentIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const studentId of studentIds) {
    if (seen.has(studentId)) duplicates.add(studentId);
    seen.add(studentId);
  }
  return [...duplicates];
}

/** The first entry whose score exceeds the maximum, or null. */
export function scoreAboveMax(entries: readonly ResultEntry[], maxScore: number): ResultEntry | null {
  return entries.find((entry) => entry.score !== null && Number(entry.score) > maxScore) ?? null;
}

export function changedResultFields(current: ResultValues, next: ResultValues): ResultField[] {
  return RESULT_FIELDS.filter((field) => current[field] !== next[field]);
}

/** Splits the request into results to create, to update (with the changed fields) and already equal. */
export function planResultsBatch(existing: ReadonlyMap<string, ResultValues>, requests: readonly ResultEntry[]): ResultsPlan {
  const plan: ResultsPlan = { created: [], updated: [], unchanged: [] };
  for (const request of requests) {
    const current = existing.get(request.studentId);
    if (!current) {
      plan.created.push({ ...request });
      continue;
    }
    const fields = changedResultFields(current, request);
    if (fields.length === 0) plan.unchanged.push(request.studentId);
    else plan.updated.push({ studentId: request.studentId, data: { status: request.status, score: request.score, feedback: request.feedback }, fields });
  }
  return plan;
}

export function isEmptyResultsPlan(plan: ResultsPlan): boolean {
  return plan.created.length === 0 && plan.updated.length === 0;
}
