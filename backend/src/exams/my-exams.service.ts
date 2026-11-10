import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { expandLessonOwnership, ownedClassIds, ownedEnrollmentsWhere, ownershipOf } from '../lessons/my-lessons.policy.js';
import type { LessonOwnership } from '../lessons/my-lessons.policy.js';
import { toInstant, toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { EXAMS_PAGE_DEFAULT } from './exams.dto.js';
import { EXAM_SORT_FIELD, afterExamCursor, examCursorKey, examOrderBy } from './exams.keyset.js';
import type { ListMyExamsQueryDto, MyExamItemDto, MyExamListDto } from './my-exams.dto.js';
import { MY_EXAM_STATUSES, visibleResult } from './my-exams.policy.js';
import type { MyExamResultView, MyExamStatus } from './my-exams.policy.js';

/** The academy's time zone for `timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

// Only what a learner may know about an exam of their class: never the weight
// (the final grade explains it through «my grades»), `created_by`, the results
// sheet or anyone else's result.
const MY_EXAM_SELECT = {
  id: true,
  classId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  scheduledAt: true,
  durationMinutes: true,
  maxScore: true,
  passScore: true,
  publishedAt: true,
  lesson: { select: { id: true, title: true, startsAt: true, room: { select: { branch: { select: { timezone: true } } } } } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.ExamSelect;

type MyExamRow = Prisma.ExamGetPayload<{ select: typeof MY_EXAM_SELECT }>;

function resultKey(examId: string, studentId: string): string {
  return `${examId}|${studentId}`;
}

function toItem(row: MyExamRow, ownership: LessonOwnership, result: MyExamResultView | null, academyTimeZone: string): MyExamItemDto {
  return {
    id: row.id,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    type: row.type,
    status: row.status as MyExamStatus,
    scheduledAt: row.scheduledAt ? toIso(row.scheduledAt) : null,
    durationMinutes: row.durationMinutes,
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
    maxScore: Number(row.maxScore),
    passScore: row.passScore === null ? null : Number(row.passScore),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
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
    result: visibleResult(row.status, result),
  };
}

/**
 * MOD-09-T04 — «my exams» (`GET /api/me/exams`, API-121). Ownership instead of
 * a permission key (D-R48 — as API-112): the scheduled and published exams of
 * the classes the caller is enrolled in, now or finished (`self`), plus —
 * while the caller holds the `guardian` role — those of the classes their
 * linked, not soft-deleted children are enrolled in (`child`). Drafts are
 * never listed. One item per (exam × ownership), keyset-paginated on
 * `(scheduled_at NULLS LAST, id)` like API-113 (`limit` counts exams), each
 * with that student's own result once the results are published (D-R47) —
 * never the weight, the recorder or anyone else's result. A user with no owned
 * enrollment gets an empty list. Read-only: no audit event.
 */
@Injectable()
export class MyExamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyExamsQueryDto, caller: AuthPrincipal): Promise<MyExamListDto> {
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: ownedEnrollmentsWhere(caller, query.studentId),
      select: { classId: true, studentUserId: true, student: { select: { id: true, fullName: true, displayName: true } } },
    });
    const ownerships = enrollments.map((row) => ownershipOf(row, caller.id));
    const classIds = ownedClassIds(ownerships, query.classId);
    if (classIds.length === 0) return { items: [], nextCursor: null };
    const relevant = ownerships.filter((ownership) => classIds.includes(ownership.classId));

    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? EXAMS_PAGE_DEFAULT;
    const filters: Prisma.ExamWhereInput[] = [{ classId: { in: classIds } }, { status: query.status ?? { in: [...MY_EXAM_STATUSES] } }];
    if (query.from) filters.push({ scheduledAt: { gte: toInstant(query.from) } });
    if (query.to) filters.push({ scheduledAt: { lte: toInstant(query.to) } });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, EXAM_SORT_FIELD, order, true, () => gradesError.cursorInvalid());
      const after = afterExamCursor(cursor.key as string, cursor.id, order);
      if (after === null) throw gradesError.cursorInvalid();
      filters.push(after);
    }
    const rows = await this.prisma.db.exam.findMany({ where: { AND: filters }, orderBy: examOrderBy(order), take: limit + 1, select: MY_EXAM_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: EXAM_SORT_FIELD, order, key: examCursorKey(last.scheduledAt), id: last.id }) : null;
    if (page.length === 0) return { items: [], nextCursor };

    const expanded = expandLessonOwnership(page, relevant);
    const studentIds = [...new Set(expanded.map(({ ownership }) => ownership.student.id))];
    // Only the published exams' results are ever shown; the others are not even read.
    const publishedIds = page.filter((row) => row.status === 'published').map((row) => row.id);
    const results =
      publishedIds.length === 0
        ? []
        : await this.prisma.db.examResult.findMany({
            where: { examId: { in: publishedIds }, studentUserId: { in: studentIds } },
            select: { examId: true, studentUserId: true, status: true, score: true, feedback: true },
          });
    const byKey = new Map(results.map((row) => [resultKey(row.examId, row.studentUserId), { status: row.status, score: row.score === null ? null : Number(row.score), feedback: row.feedback }]));
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });
    const timeZone = academy?.timezone ?? FALLBACK_TIME_ZONE;
    return { items: expanded.map(({ lesson: row, ownership }) => toItem(row, ownership, byKey.get(resultKey(row.id, ownership.student.id)) ?? null, timeZone)), nextCursor };
  }
}
