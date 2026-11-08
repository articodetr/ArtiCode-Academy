import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LESSON_SORT_FIELD, LESSONS_PAGE_DEFAULT } from './lessons.dto.js';
import { lessonsError } from './lessons.errors.js';
import { toInstant, toIso } from './lessons.time.js';
import type { ListMyLessonsQueryDto, MyLessonAttendanceDto, MyLessonItemDto, MyLessonListDto } from './my-lessons.dto.js';
import { expandLessonOwnership, ownedClassIds, ownedEnrollmentsWhere, ownershipOf } from './my-lessons.policy.js';
import type { LessonOwnership } from './my-lessons.policy.js';

// Only what a learner may know about a lesson of their class: the lesson
// itself with its room, syllabus item and teacher BY NAME, the class and
// course summary. Never the roster, the cancellation reason, `created_by`,
// `schedule_id`, `attendance_taken_at` or any account field of the teacher.
const MY_LESSON_SELECT = {
  id: true,
  classId: true,
  title: true,
  description: true,
  deliveryMode: true,
  startsAt: true,
  endsAt: true,
  status: true,
  meetingUrl: true,
  room: { select: { id: true, code: true, name: true, branch: { select: { id: true, code: true, name: true } } } },
  teacher: { select: { fullName: true, displayName: true } },
  syllabusItem: { select: { id: true, sortOrder: true, title: true } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.LessonSelect;

// The student's own record: status and lateness, never the note or who wrote it (D-R32).
const MY_RECORD_SELECT = { lessonId: true, studentUserId: true, status: true, minutesLate: true, recordedAt: true } satisfies Prisma.AttendanceRecordSelect;

type MyLessonRow = Prisma.LessonGetPayload<{ select: typeof MY_LESSON_SELECT }>;
type MyRecordRow = Prisma.AttendanceRecordGetPayload<{ select: typeof MY_RECORD_SELECT }>;

function recordKey(lessonId: string, studentId: string): string {
  return `${lessonId}|${studentId}`;
}

function toAttendance(row: MyRecordRow | undefined): MyLessonAttendanceDto | null {
  return row ? { status: row.status, minutesLate: row.minutesLate, recordedAt: toIso(row.recordedAt) } : null;
}

function toItem(row: MyLessonRow, ownership: LessonOwnership, record: MyRecordRow | undefined): MyLessonItemDto {
  return {
    id: row.id,
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    deliveryMode: row.deliveryMode,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    status: row.status,
    meetingUrl: row.meetingUrl,
    room: row.room
      ? {
          id: row.room.id,
          code: row.room.code,
          name: readLocalizedText(row.room.name),
          branch: row.room.branch ? { id: row.room.branch.id, code: row.room.branch.code, name: readLocalizedText(row.room.branch.name) ?? { ar: row.room.branch.code } } : null,
        }
      : null,
    teacher: row.teacher ? { fullName: row.teacher.fullName, displayName: row.teacher.displayName } : null,
    syllabusItem: row.syllabusItem ? { id: row.syllabusItem.id, sortOrder: row.syllabusItem.sortOrder, title: readLocalizedText(row.syllabusItem.title) ?? { ar: '' } } : null,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
    relation: ownership.relation,
    student: ownership.student,
    attendance: toAttendance(record),
  };
}

/**
 * MOD-06-T04 — «my lessons» (`GET /api/me/lessons`, API-101). Ownership
 * instead of a permission key (D-R32 — as API-060 and API-091): the lessons of
 * the classes the caller is enrolled in, now or finished (`self`), plus —
 * while the caller holds the `guardian` role — those of the classes their
 * linked, not soft-deleted children are enrolled in (`child`). One item per
 * (lesson × ownership), the page keyset-paginated on `(starts_at, id)` like
 * API-093 (`limit` counts lessons), each item with that student's own
 * attendance status and lateness — never the teacher's note, who recorded
 * it, the cancellation reason or anyone else's record. A user with no owned
 * enrollment gets an empty list, never a 403. Read-only: no audit event.
 */
@Injectable()
export class MyLessonsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyLessonsQueryDto, caller: AuthPrincipal): Promise<MyLessonListDto> {
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: ownedEnrollmentsWhere(caller, query.studentId),
      select: { classId: true, studentUserId: true, student: { select: { id: true, fullName: true, displayName: true } } },
    });
    const ownerships = enrollments.map((row) => ownershipOf(row, caller.id));
    const classIds = ownedClassIds(ownerships, query.classId);
    if (classIds.length === 0) return { items: [], nextCursor: null };

    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? LESSONS_PAGE_DEFAULT;
    const filters: Prisma.LessonWhereInput[] = [{ classId: { in: classIds } }];
    if (query.status) filters.push({ status: query.status });
    if (query.from) filters.push({ startsAt: { gte: toInstant(query.from) } });
    if (query.to) filters.push({ startsAt: { lte: toInstant(query.to) } });
    if (query.cursor) {
      // The same cursor shape as API-093 (LessonsService.list): `(startsAt, id)` bound to the order.
      const cursor = decodeKeysetCursor(query.cursor, LESSON_SORT_FIELD, order, true, () => lessonsError.cursorInvalid());
      const key = cursor.key as string;
      if (!Number.isFinite(Date.parse(key))) throw lessonsError.cursorInvalid();
      const cmp = order === 'asc' ? 'gt' : 'lt';
      const at = new Date(key);
      filters.push({ OR: [{ startsAt: { [cmp]: at } }, { startsAt: at, id: { [cmp]: cursor.id } }] });
    }
    const rows = await this.prisma.db.lesson.findMany({ where: { AND: filters }, orderBy: [{ startsAt: order }, { id: order }], take: limit + 1, select: MY_LESSON_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: LESSON_SORT_FIELD, order, key: toIso(last.startsAt), id: last.id }) : null;

    const expanded = expandLessonOwnership(page, ownerships);
    const studentIds = [...new Set(expanded.map(({ ownership }) => ownership.student.id))];
    const records =
      page.length === 0
        ? []
        : await this.prisma.db.attendanceRecord.findMany({ where: { lessonId: { in: page.map((row) => row.id) }, studentUserId: { in: studentIds } }, select: MY_RECORD_SELECT });
    const byKey = new Map(records.map((row) => [recordKey(row.lessonId, row.studentUserId), row]));
    return { items: expanded.map(({ lesson, ownership }) => toItem(lesson, ownership, byKey.get(recordKey(lesson.id, ownership.student.id)))), nextCursor };
  }
}
