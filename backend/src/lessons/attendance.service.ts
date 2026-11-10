import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AttendanceStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UsersProjection } from '../users/users.service.js';
import { ATTENDANCE_ENROLLMENT_STATUSES, attendanceBlocker, isEmptyAttendancePlan, planAttendanceBatch } from './attendance.changes.js';
import type { AttendanceEntry, AttendanceValues } from './attendance.changes.js';
import type { AttendanceCountsDto } from './lessons.dto.js';
import type { AttendanceItemDto, AttendanceRecordDto, AttendanceSheetDto, RecordAttendanceDto } from './attendance.dto.js';
import { lessonsError } from './lessons.errors.js';
import { visibleLessonsWhere } from './lessons.policy.js';
import { LESSONS_ENTITY_TYPE } from './lessons.service.js';
import { toIso } from './lessons.time.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';

/** The one audit event of attendance (12.4): recorded on the lesson when a batch writes something. */
export const ATTENDANCE_AUDIT_ACTION = 'attendance.recorded';

// The lesson as the sheet needs it: its class for the visibility rule, the
// blockers and the event metadata.
const SHEET_LESSON_SELECT = {
  id: true,
  classId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  attendanceTakenAt: true,
  class: { select: { code: true, status: true } },
} satisfies Prisma.LessonSelect;

const RECORD_SELECT = {
  studentUserId: true,
  status: true,
  minutesLate: true,
  note: true,
  recordedAt: true,
  updatedAt: true,
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AttendanceRecordSelect;

type SheetLesson = Prisma.LessonGetPayload<{ select: typeof SHEET_LESSON_SELECT }>;
type RecordRow = Prisma.AttendanceRecordGetPayload<{ select: typeof RECORD_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

const EMPTY_COUNTS: AttendanceCountsDto = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 };

function isoOrNull(value: Date | null): string | null {
  return value ? toIso(value) : null;
}

function toRecordDto(row: RecordRow): AttendanceRecordDto {
  return {
    status: row.status,
    minutesLate: row.minutesLate,
    note: row.note,
    recordedBy: row.recordedBy ? { userId: row.recordedBy.id, fullName: row.recordedBy.fullName } : null,
    recordedAt: toIso(row.recordedAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: RecordRow): AttendanceValues {
  return { status: row.status, minutesLate: row.minutesLate, note: row.note };
}

function countsOf(rows: readonly { status: AttendanceStatus }[]): AttendanceCountsDto {
  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    counts.recorded += 1;
    counts[row.status] += 1;
  }
  return counts;
}

function toEntry(record: RecordAttendanceDto['records'][number]): AttendanceEntry {
  return {
    studentId: record.studentId,
    status: record.status,
    minutesLate: record.minutesLate ?? null,
    note: record.note ?? null,
  };
}

/**
 * MOD-06-T03 — the attendance sheet of a lesson (roadmap §4f.5 T03, API-099
 * `GET` and API-100 `PUT /api/lessons/:id/attendance`). Reading needs
 * `attendance.read`, writing `attendance.record`, both through the lesson's
 * class visibility (D-R16/D-R32: `classes.manage` reaches every class, anyone
 * else the classes they teach — an invisible lesson is 404). The sheet lists
 * every student with an active or completed enrollment in the class plus any
 * other student holding a record (a student withdrawn after the lesson keeps
 * their record — AC6), each in the caller's D-R07 projection with their record
 * or null. A batch is accepted for a lesson whose class is not cancelled, that
 * is not cancelled itself and whose start time has passed (D-R33); every named
 * student must be enrolled (active/completed) or the whole batch is refused
 * with `not_enrolled`. The batch is planned as a diff under the lesson-row
 * lock (`FOR NO KEY UPDATE`, the T02 lock — concurrent saves of one lesson
 * serialise), written in one transaction with exactly one
 * `attendance.recorded` event, and nothing is written or recorded for an
 * identical batch. The first write sets `attendance_taken_at`; `recorded_by`
 * is the last writer of each record.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sheet(lessonId: string, caller: AuthPrincipal): Promise<AttendanceSheetDto> {
    const lesson = await this.prisma.db.lesson.findFirst({ where: { AND: [{ id: lessonId }, visibleLessonsWhere(caller)] }, select: SHEET_LESSON_SELECT });
    if (!lesson) throw lessonsError.lessonNotFound(lessonId);
    return this.buildSheet(this.prisma.db, lesson, rosterProjectionOf(caller));
  }

  async record(lessonId: string, input: RecordAttendanceDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AttendanceSheetDto> {
    const entries = input.records.map(toEntry);
    const view = rosterProjectionOf(caller);
    return this.prisma.db.$transaction(async (tx) => {
      const lesson = await this.lockLesson(tx, lessonId, caller);
      const blocker = attendanceBlocker(lesson.class.status, lesson.status, lesson.startsAt);
      if (blocker === 'class_cancelled') throw lessonsError.classClosed(lesson.classId, lesson.class.status);
      if (blocker !== null) throw lessonsError.attendanceClosed(blocker, toIso(lesson.startsAt));

      const studentIds = entries.map((entry) => entry.studentId);
      const enrolled = await tx.enrollment.findMany({
        where: { classId: lesson.classId, studentUserId: { in: studentIds }, status: { in: [...ATTENDANCE_ENROLLMENT_STATUSES] } },
        select: { studentUserId: true },
      });
      const eligible = new Set(enrolled.map((row) => row.studentUserId));
      const notEnrolled = studentIds.filter((studentId) => !eligible.has(studentId));
      if (notEnrolled.length > 0) throw lessonsError.notEnrolled(notEnrolled);

      const existing = await tx.attendanceRecord.findMany({ where: { lessonId, studentUserId: { in: studentIds } }, select: RECORD_SELECT });
      const plan = planAttendanceBatch(new Map(existing.map((row) => [row.studentUserId, valuesOf(row)])), entries);
      if (isEmptyAttendancePlan(plan)) return this.buildSheet(tx, lesson, view);

      if (plan.created.length > 0) {
        await tx.attendanceRecord.createMany({
          data: plan.created.map((entry) => ({
            lessonId,
            studentUserId: entry.studentId,
            status: entry.status,
            minutesLate: entry.minutesLate,
            note: entry.note,
            recordedById: caller.id,
          })),
        });
      }
      for (const update of plan.updated) {
        await tx.attendanceRecord.update({
          where: { lessonId_studentUserId: { lessonId, studentUserId: update.studentId } },
          data: { ...update.data, recordedById: caller.id },
          select: { lessonId: true },
        });
      }
      // The first recording stamps the lesson; later ones leave the stamp alone.
      await tx.lesson.updateMany({ where: { id: lessonId, attendanceTakenAt: null }, data: { attendanceTakenAt: new Date() } });
      const stamped = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, select: SHEET_LESSON_SELECT });
      const sheet = await this.buildSheet(tx, stamped, view);
      await this.audit.record(
        {
          action: ATTENDANCE_AUDIT_ACTION,
          actorUserId: caller.id,
          entityType: LESSONS_ENTITY_TYPE,
          entityId: lessonId,
          metadata: { classId: lesson.classId, code: lesson.class.code, created: plan.created.length, updated: plan.updated.length, counts: sheet.counts },
          ...ctx,
        },
        tx,
      );
      return sheet;
    });
  }

  // ---------------------------------------------------------------------------

  /** Locks the lesson row (the T02 lock) and reads it with the visibility rule; an unknown or invisible lesson is 404. */
  private async lockLesson(tx: Tx, lessonId: string, caller: AuthPrincipal): Promise<SheetLesson> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM lessons WHERE id = ${lessonId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw lessonsError.lessonNotFound(lessonId);
    const lesson = await tx.lesson.findFirst({ where: { AND: [{ id: lessonId }, visibleLessonsWhere(caller)] }, select: SHEET_LESSON_SELECT });
    if (!lesson) throw lessonsError.lessonNotFound(lessonId);
    return lesson;
  }

  /**
   * The sheet: the class's active/completed enrollments plus the enrollments
   * of every other student holding a record, in enrollment order; a record
   * whose student has no enrollment row at all cannot come from the API
   * (enrollments are never deleted) but is still listed, after the others.
   */
  private async buildSheet(db: Db, lesson: SheetLesson, view: UsersProjection): Promise<AttendanceSheetDto> {
    const records = await db.attendanceRecord.findMany({ where: { lessonId: lesson.id }, select: RECORD_SELECT });
    const byStudent = new Map(records.map((row) => [row.studentUserId, row]));
    const recordedIds = [...byStudent.keys()];
    const enrollments = await db.enrollment.findMany({
      where: { classId: lesson.classId, OR: [{ status: { in: [...ATTENDANCE_ENROLLMENT_STATUSES] } }, { studentUserId: { in: recordedIds } }] },
      orderBy: { id: 'asc' },
      select: { studentUserId: true, status: true, student: { select: ROSTER_STUDENT_SELECT } },
    });
    const items: AttendanceItemDto[] = enrollments.map((row) => ({
      student: toRosterStudentDto(row.student, view),
      enrollmentStatus: row.status,
      record: byStudent.has(row.studentUserId) ? toRecordDto(byStudent.get(row.studentUserId)!) : null,
    }));
    const listed = new Set(enrollments.map((row) => row.studentUserId));
    const orphans = recordedIds.filter((studentId) => !listed.has(studentId));
    if (orphans.length > 0) {
      const users = await db.user.findMany({ where: { id: { in: orphans } }, orderBy: { id: 'asc' }, select: ROSTER_STUDENT_SELECT });
      for (const user of users) items.push({ student: toRosterStudentDto(user, view), enrollmentStatus: null, record: toRecordDto(byStudent.get(user.id)!) });
    }
    const blocker = attendanceBlocker(lesson.class.status, lesson.status, lesson.startsAt);
    return {
      lessonId: lesson.id,
      classId: lesson.classId,
      lessonStatus: lesson.status,
      startsAt: toIso(lesson.startsAt),
      endsAt: toIso(lesson.endsAt),
      attendanceTakenAt: isoOrNull(lesson.attendanceTakenAt),
      recordable: blocker === null,
      closedReason: blocker,
      counts: countsOf(records),
      items,
    };
  }
}
