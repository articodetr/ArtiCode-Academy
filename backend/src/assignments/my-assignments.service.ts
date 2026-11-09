import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';
import { expandLessonOwnership, ownedClassIds, ownedEnrollmentsWhere, ownershipOf } from '../lessons/my-lessons.policy.js';
import type { LessonOwnership } from '../lessons/my-lessons.policy.js';
import { toInstant, toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { ASSIGNMENTS_PAGE_DEFAULT } from './assignments.dto.js';
import { assignmentsError } from './assignments.errors.js';
import { ASSIGNMENT_SORT_FIELD, afterDueCursor, dueCursorKey, dueOrderBy } from './assignments.keyset.js';
import type { ListMyAssignmentsQueryDto, MyAssignmentItemDto, MyAssignmentLatestDto, MyAssignmentListDto } from './my-assignments.dto.js';
import { MY_ASSIGNMENT_STATUSES, pendingWhere } from './my-assignments.policy.js';
import type { MyAssignmentStatus } from './my-assignments.policy.js';
import { summarizeAttempts } from './submissions.policy.js';

/** The academy's time zone for `timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

// Only what a learner may know about an assignment of their class: never the
// weight (MOD-09's), `created_by`, the roster or anyone else's attempt.
const MY_ASSIGNMENT_SELECT = {
  id: true,
  classId: true,
  title: true,
  instructions: true,
  status: true,
  maxScore: true,
  dueAt: true,
  allowLate: true,
  latePenaltyPercent: true,
  maxAttempts: true,
  publishedAt: true,
  closedAt: true,
  lesson: { select: { id: true, title: true, startsAt: true, room: { select: { branch: { select: { timezone: true } } } } } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.AssignmentSelect;

// The owned students' own attempts: their review, never the reviewer or the answer (read through API-110).
const MY_ATTEMPT_SELECT = {
  id: true,
  assignmentId: true,
  studentUserId: true,
  attemptNo: true,
  submittedAt: true,
  isLate: true,
  status: true,
  score: true,
  feedback: true,
  gradedAt: true,
} satisfies Prisma.AssignmentSubmissionSelect;

type MyAssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof MY_ASSIGNMENT_SELECT }>;
type MyAttemptRow = Prisma.AssignmentSubmissionGetPayload<{ select: typeof MY_ATTEMPT_SELECT }>;

function attemptKey(assignmentId: string, studentId: string): string {
  return `${assignmentId}|${studentId}`;
}

function toLatest(row: MyAttemptRow): MyAssignmentLatestDto {
  return {
    id: row.id,
    attemptNo: row.attemptNo,
    submittedAt: toIso(row.submittedAt),
    isLate: row.isLate,
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    feedback: row.feedback,
    gradedAt: row.gradedAt ? toIso(row.gradedAt) : null,
  };
}

function toItem(row: MyAssignmentRow, ownership: LessonOwnership, attempts: readonly MyAttemptRow[], academyTimeZone: string): MyAssignmentItemDto {
  const summary = summarizeAttempts(
    attempts.map((attempt) => ({ attemptNo: attempt.attemptNo, status: attempt.status, score: null })),
    row.maxAttempts,
  );
  const latest = attempts.find((attempt) => attempt.attemptNo === summary.lastAttemptNo) ?? null;
  return {
    id: row.id,
    title: readLocalizedText(row.title) ?? { ar: '' },
    instructions: readLocalizedText(row.instructions),
    status: row.status as MyAssignmentStatus,
    maxScore: Number(row.maxScore),
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
    allowLate: row.allowLate,
    latePenaltyPercent: row.latePenaltyPercent === null ? null : Number(row.latePenaltyPercent),
    maxAttempts: row.maxAttempts,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
    lesson: row.lesson ? { id: row.lesson.id, title: readLocalizedText(row.lesson.title) ?? { ar: '' }, startsAt: toIso(row.lesson.startsAt) } : null,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
    relation: ownership.relation,
    student: ownership.student,
    attempts: summary.attempts,
    attemptsAllowed: summary.attemptsAllowed,
    latest: latest ? toLatest(latest) : null,
  };
}

/**
 * MOD-08-T04 — «my assignments» (`GET /api/me/assignments`, API-112).
 * Ownership instead of a permission key (D-R40 — as API-060 and API-101): the
 * assignments of the classes the caller is enrolled in, now or finished
 * (`self`), plus — while the caller holds the `guardian` role — those of the
 * classes their linked, not soft-deleted children are enrolled in (`child`).
 * Drafts are never listed. One item per (assignment × ownership), the page
 * keyset-paginated on `(due_at NULLS LAST, id)` like API-102 (`limit` counts
 * assignments), each item with that student's own attempts and the review of
 * the latest one — never the weight, the reviewer, the answer or anyone
 * else's attempt. A user with no owned enrollment gets an empty list, never a
 * 403. Read-only: no audit event.
 */
@Injectable()
export class MyAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyAssignmentsQueryDto, caller: AuthPrincipal): Promise<MyAssignmentListDto> {
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: ownedEnrollmentsWhere(caller, query.studentId),
      select: { classId: true, studentUserId: true, student: { select: { id: true, fullName: true, displayName: true } } },
    });
    const ownerships = enrollments.map((row) => ownershipOf(row, caller.id));
    const classIds = ownedClassIds(ownerships, query.classId);
    if (classIds.length === 0) return { items: [], nextCursor: null };
    const relevant = ownerships.filter((ownership) => classIds.includes(ownership.classId));

    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? ASSIGNMENTS_PAGE_DEFAULT;
    const filters: Prisma.AssignmentWhereInput[] = [{ classId: { in: classIds } }, { status: query.status ?? { in: [...MY_ASSIGNMENT_STATUSES] } }];
    if (query.dueFrom) filters.push({ dueAt: { gte: toInstant(query.dueFrom) } });
    if (query.dueTo) filters.push({ dueAt: { lte: toInstant(query.dueTo) } });
    if (query.pending === true) filters.push(pendingWhere(relevant));
    if (query.cursor) {
      // The same cursor shape as API-102 (AssignmentsService.list): `(dueAt, id)` bound to the order.
      const cursor = decodeKeysetCursor(query.cursor, ASSIGNMENT_SORT_FIELD, order, true, () => assignmentsError.cursorInvalid());
      const after = afterDueCursor(cursor.key as string, cursor.id, order);
      if (after === null) throw assignmentsError.cursorInvalid();
      filters.push(after);
    }
    const rows = await this.prisma.db.assignment.findMany({ where: { AND: filters }, orderBy: dueOrderBy(order), take: limit + 1, select: MY_ASSIGNMENT_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: ASSIGNMENT_SORT_FIELD, order, key: dueCursorKey(last.dueAt), id: last.id }) : null;
    if (page.length === 0) return { items: [], nextCursor };

    const expanded = expandLessonOwnership(page, relevant);
    const studentIds = [...new Set(expanded.map(({ ownership }) => ownership.student.id))];
    const [attempts, academy] = await Promise.all([
      this.prisma.db.assignmentSubmission.findMany({
        where: { assignmentId: { in: page.map((row) => row.id) }, studentUserId: { in: studentIds } },
        select: MY_ATTEMPT_SELECT,
      }),
      this.prisma.db.academy.findFirst({ select: { timezone: true } }),
    ]);
    const byKey = new Map<string, MyAttemptRow[]>();
    for (const attempt of attempts) {
      const key = attemptKey(attempt.assignmentId, attempt.studentUserId);
      byKey.set(key, [...(byKey.get(key) ?? []), attempt]);
    }
    const timeZone = academy?.timezone ?? FALLBACK_TIME_ZONE;
    const items = expanded.map(({ lesson: row, ownership }) => toItem(row, ownership, byKey.get(attemptKey(row.id, ownership.student.id)) ?? [], timeZone));
    return { items: query.pending === true ? items.filter((item) => item.latest === null) : items, nextCursor };
  }
}
