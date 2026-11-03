// Pure planning of a class-teacher replacement (MOD-05-T03), on the pattern
// of diffRoleKeys() (users.roles.ts) and planSyllabusReplacement(): the
// request is the whole final list, the plan is what changes. Unit-tested in
// class-teachers.changes.spec.ts.
import type { ClassTeacherRole } from '../generated/prisma/client.js';

export interface TeacherAssignment {
  userId: string;
  role: ClassTeacherRole;
}

export interface TeacherRoleChange {
  userId: string;
  from: ClassTeacherRole;
  to: ClassTeacherRole;
}

export interface TeacherReplacementPlan {
  /** New rows, in request order. */
  added: TeacherAssignment[];
  /** Users whose row disappears, in current order. */
  removed: string[];
  /** Kept users whose role changes, in request order. */
  roleChanged: TeacherRoleChange[];
}

export interface TeacherListProblems {
  /** User ids listed more than once (each once, in first-seen order). */
  duplicates: string[];
  /** Number of `lead` entries; more than one is refused. */
  leadCount: number;
}

/** What makes a requested list invalid on its own (before any database read); null when it is valid. */
export function teacherListProblems(requested: readonly TeacherAssignment[]): TeacherListProblems | null {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const { userId } of requested) {
    if (seen.has(userId) && !duplicates.includes(userId)) duplicates.push(userId);
    seen.add(userId);
  }
  const leadCount = requested.filter((entry) => entry.role === 'lead').length;
  return duplicates.length > 0 || leadCount > 1 ? { duplicates, leadCount } : null;
}

/** Diff between the stored teachers and the requested final list (assumed valid — teacherListProblems() first). */
export function planTeacherReplacement(current: readonly TeacherAssignment[], requested: readonly TeacherAssignment[]): TeacherReplacementPlan {
  const stored = new Map(current.map((entry) => [entry.userId, entry.role]));
  const wanted = new Set(requested.map((entry) => entry.userId));
  const added: TeacherAssignment[] = [];
  const roleChanged: TeacherRoleChange[] = [];
  for (const entry of requested) {
    const from = stored.get(entry.userId);
    if (from === undefined) added.push({ userId: entry.userId, role: entry.role });
    else if (from !== entry.role) roleChanged.push({ userId: entry.userId, from, to: entry.role });
  }
  const removed = current.filter((entry) => !wanted.has(entry.userId)).map((entry) => entry.userId);
  return { added, removed, roleChanged };
}

export function isEmptyTeacherPlan(plan: TeacherReplacementPlan): boolean {
  return plan.added.length === 0 && plan.removed.length === 0 && plan.roleChanged.length === 0;
}

/** Users whose row the plan writes (added or role changed), in request order: they must be eligible teachers. */
export function writtenTeacherIds(plan: TeacherReplacementPlan, requested: readonly TeacherAssignment[]): string[] {
  const written = new Set([...plan.added.map((entry) => entry.userId), ...plan.roleChanged.map((change) => change.userId)]);
  return requested.map((entry) => entry.userId).filter((userId) => written.has(userId));
}
