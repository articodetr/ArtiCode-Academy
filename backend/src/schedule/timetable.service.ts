import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { relationOf, seesChildren } from '../enrollments/my-classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SLOT_SELECT, toSlotDto } from './class-schedule.service.js';
import { calendarDateIn } from './schedule.time.js';
import type { AcademyScheduleDto, AcademyScheduleQueryDto, MyScheduleDto, MyScheduleItemDto, MyScheduleQueryDto, TimetableClassDto, TimetableSlotDto } from './timetable.dto.js';
import { academyScheduleWhere, displayTimeZone, effectiveOnWhere, expandOwnership } from './timetable.policy.js';
import type { ScheduleOwnership } from './timetable.policy.js';

// The API-088 slot plus what the timetable readings add: the branch's time
// zone (display zone), the teacher's display name, and the class with its
// course — a summary only, never the roster, `created_by` or any account
// field of a teacher or student.
const TIMETABLE_SELECT = {
  ...SLOT_SELECT,
  classId: true,
  room: { select: { id: true, code: true, name: true, branch: { select: { id: true, code: true, name: true, timezone: true } } } },
  teacher: { select: { id: true, fullName: true, displayName: true } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.ClassScheduleSelect;

type TimetableRow = Prisma.ClassScheduleGetPayload<{ select: typeof TIMETABLE_SELECT }>;

const SLOT_ORDER: Prisma.ClassScheduleOrderByWithRelationInput[] = [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }];

/** The academy's time zone, or UTC while the academy row is missing (the readiness check reports that state). */
const FALLBACK_TIME_ZONE = 'UTC';

function classOf(row: TimetableRow): TimetableClassDto {
  return {
    id: row.class.id,
    code: row.class.code,
    name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
    status: row.class.status,
    course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
  };
}

function toTimetableSlot(row: TimetableRow, academyTimeZone: string): TimetableSlotDto {
  return { ...toSlotDto(row), timeZone: displayTimeZone(row.room?.branch?.timezone, academyTimeZone), class: classOf(row) };
}

function toMyScheduleItem(row: TimetableRow, ownership: ScheduleOwnership, academyTimeZone: string): MyScheduleItemDto {
  const slot = toSlotDto(row);
  return {
    id: slot.id,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    timeZone: displayTimeZone(row.room?.branch?.timezone, academyTimeZone),
    room: slot.room,
    teacher: row.teacher ? { fullName: row.teacher.fullName, displayName: row.teacher.displayName } : null,
    effectiveFrom: slot.effectiveFrom,
    effectiveTo: slot.effectiveTo,
    class: classOf(row),
    relation: ownership.relation,
    student: ownership.student,
  };
}

/**
 * MOD-07-T04 — the timetable readings (roadmap §4e.5 T04, D-R27): the
 * academy's weekly schedule for its managers, and «my schedule» by ownership
 * (the caller's active enrollments, their linked children's while they hold
 * the `guardian` role — the T05 rule — and the classes they teach). Both
 * show the slots effective on one calendar date (`on`, default today in the
 * academy's time zone) and read each slot in the time zone of its room's
 * branch, else the academy's. Read-only: no audit event.
 */
@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService) {}

  async academy(query: AcademyScheduleQueryDto): Promise<AcademyScheduleDto> {
    const timeZone = await this.academyTimeZone();
    const on = query.on ?? calendarDateIn(timeZone);
    const rows = await this.prisma.db.classSchedule.findMany({ where: academyScheduleWhere(query, on), orderBy: SLOT_ORDER, select: TIMETABLE_SELECT });
    return { on, slots: rows.map((row) => toTimetableSlot(row, timeZone)) };
  }

  async mine(query: MyScheduleQueryDto, caller: AuthPrincipal): Promise<MyScheduleDto> {
    const timeZone = await this.academyTimeZone();
    const on = query.on ?? calendarDateIn(timeZone);
    const ownerships = await this.ownershipsOf(caller);
    if (ownerships.length === 0) return { on, items: [] };
    const rows = await this.prisma.db.classSchedule.findMany({
      where: { classId: { in: [...new Set(ownerships.map((ownership) => ownership.classId))] }, ...effectiveOnWhere(on) },
      orderBy: SLOT_ORDER,
      select: TIMETABLE_SELECT,
    });
    return { on, items: expandOwnership(rows, ownerships).map(({ slot, ownership }) => toMyScheduleItem(slot, ownership, timeZone)) };
  }

  private async academyTimeZone(): Promise<string> {
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });
    return academy?.timezone ?? FALLBACK_TIME_ZONE;
  }

  /**
   * Why the caller may see a class's slots: an `active` enrollment of their
   * own (`self`), an `active` enrollment of a linked, not soft-deleted child
   * while the caller holds the `guardian` role (`child` — as API-060), and
   * every class the caller teaches, lead or assistant (`teacher`). The role
   * keys come from the principal, which is rebuilt from the database on
   * every request.
   */
  private async ownershipsOf(caller: AuthPrincipal): Promise<ScheduleOwnership[]> {
    const owned: Prisma.EnrollmentWhereInput[] = [{ studentUserId: caller.id }];
    if (seesChildren(caller.roles)) owned.push({ student: { deletedAt: null, guardians: { some: { guardianUserId: caller.id } } } });
    const [enrollments, teaching] = await Promise.all([
      this.prisma.db.enrollment.findMany({
        where: { status: 'active', OR: owned },
        select: { classId: true, studentUserId: true, student: { select: { id: true, fullName: true, displayName: true } } },
      }),
      this.prisma.db.classTeacher.findMany({ where: { teacherUserId: caller.id }, select: { classId: true } }),
    ]);
    return [
      ...enrollments.map((row) => ({ classId: row.classId, relation: relationOf(row.studentUserId, caller.id), student: row.student })),
      ...teaching.map((row) => ({ classId: row.classId, relation: 'teacher' as const, student: null })),
    ];
  }
}
