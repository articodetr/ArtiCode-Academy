import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AttendanceStatus } from '../generated/prisma/client.js';
import type { NotificationEventParams } from '../notifications/notifications.events.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import { ATTENDANCE_ENROLLMENT_STATUSES, attendanceBlocker, isEmptyAttendancePlan, planAttendanceBatch } from './attendance.changes.js';
import type { AttendanceEntry, AttendancePlan, AttendanceValues } from './attendance.changes.js';
import type { AttendanceCountsDto } from './lessons.dto.js';
import type { AttendanceItemDto, AttendanceRecordDto, AttendanceSheetDto, RecordAttendanceDto } from './attendance.dto.js';
import { lessonsError } from './lessons.errors.js';
import { visibleLessonsWhere } from './lessons.policy.js';
import { LESSONS_ENTITY_TYPE } from './lessons.service.js';
import { toIso } from './lessons.time.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';

/** The one audit event of attendance (12.4): recorded on the lesson when a batch writes something. */
export const ATTENDANCE_AUDIT_ACTION = 'attendance.recorded';

/** The academy's time zone for a lesson's display zone (D-R41), or UTC while the academy row is missing — as in lessons.service.ts. */
const FALLBACK_TIME_ZONE = 'UTC';

// The lesson as the sheet needs it: its class for the visibility rule, the
// blockers and the event metadata — and its title, room and class name for
// the absence notification (MOD-12-T03), which no response carries.
const SHEET_LESSON_SELECT = {
  id: true,
  classId: true,
  roomId: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  attendanceTakenAt: true,
  class: { select: { code: true, name: true, status: true } },
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
 * The students a batch newly marks absent (MOD-12 `attendance.absent`), in
 * request order: a record created as `absent`, or one whose status changes to
 * `absent`. A record that was absent already is not news, whatever else
 * changed in it (its note); neither is a record that stops being absent.
 */
function newlyAbsent(plan: AttendancePlan, entries: readonly AttendanceEntry[]): string[] {
  const absent = new Set<string>();
  for (const entry of plan.created) if (entry.status === 'absent') absent.add(entry.studentId);
  for (const update of plan.updated) if (update.data.status === 'absent' && update.fields.includes('status')) absent.add(update.studentId);
  return entries.map((entry) => entry.studentId).filter((studentId) => absent.has(studentId));
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
 *
 * MOD-12-T03 — inside the same transaction every student the batch newly
 * marks absent (a record created as `absent` or changed to it) and their
 * guardians get an `attendance.absent` notification: the lesson, its class
 * and its time — never the note, the minutes or who recorded. The e-mail
 * copies are handed over after the commit.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async sheet(lessonId: string, caller: AuthPrincipal): Promise<AttendanceSheetDto> {
    const lesson = await this.prisma.db.lesson.findFirst({ where: { AND: [{ id: lessonId }, visibleLessonsWhere(caller)] }, select: SHEET_LESSON_SELECT });
    if (!lesson) throw lessonsError.lessonNotFound(lessonId);
    return this.buildSheet(this.prisma.db, lesson, rosterProjectionOf(caller));
  }

  async record(lessonId: string, input: RecordAttendanceDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AttendanceSheetDto> {
    const entries = input.records.map(toEntry);
    const view = rosterProjectionOf(caller);
    const { sheet, batch } = await this.prisma.db.$transaction(async (tx) => {
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
      if (isEmptyAttendancePlan(plan)) return { sheet: await this.buildSheet(tx, lesson, view), batch: EMPTY_BATCH };

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
      // MOD-12: whoever this batch newly marks absent is told, with their guardians — one notification per (recipient × student).
      const absentees = newlyAbsent(plan, entries);
      if (absentees.length === 0) return { sheet, batch: EMPTY_BATCH };
      const params = await this.absenceParams(tx, lesson);
      const batch = await this.notifications.notifyStudents(
        tx,
        'attendance.absent',
        absentees.map((studentId) => ({ studentId, params })),
      );
      return { sheet, batch };
    });
    // After the commit: the e-mail copies leave in the background.
    this.notifications.dispatch(batch);
    return sheet;
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
   * What an `attendance.absent` notification says about the lesson
   * (MOD-12-T03): its title, its class and its start in the lesson's display
   * zone — the room's branch, else the academy, exactly as `LessonDto.timeZone`
   * (D-R41). The zone takes flat reads inside the writing transaction
   * (KI-074), made only when somebody is newly absent.
   */
  private async absenceParams(tx: Tx, lesson: SheetLesson): Promise<NotificationEventParams['attendance.absent']> {
    const room = lesson.roomId === null ? null : await tx.room.findUnique({ where: { id: lesson.roomId }, select: { branchId: true } });
    const branch = room?.branchId ? await tx.branch.findUnique({ where: { id: room.branchId }, select: { timezone: true } }) : null;
    const academy = await tx.academy.findFirst({ select: { timezone: true } });
    return {
      lessonId: lesson.id,
      classId: lesson.classId,
      lessonTitle: readLocalizedText(lesson.title) ?? { ar: '' },
      className: readLocalizedText(lesson.class.name) ?? { ar: lesson.class.code },
      startsAt: lesson.startsAt,
      timeZone: displayTimeZone(branch?.timezone, academy?.timezone ?? FALLBACK_TIME_ZONE),
    };
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
