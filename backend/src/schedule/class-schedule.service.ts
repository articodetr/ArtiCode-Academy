import { Injectable } from '@nestjs/common';
import { readSettings } from '../academy/academy.settings.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { visibleClassesWhere } from '../classes/classes.policy.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ClassScheduleDto, ReplaceClassScheduleDto, ScheduleSlotDto } from './class-schedule.dto.js';
import { findNonWorkingDay, findRequestConflict, planScheduleReplacement, referencedIds, valuesOf } from './schedule.changes.js';
import type { ConflictKind, ExistingSlot, RequestedSlot, SlotValues } from './schedule.changes.js';
import { scheduleError } from './schedule.errors.js';
import { calendarDateToColumn, clockTimeToColumn, columnToCalendarDate, columnToClockTime } from './schedule.time.js';

export const CLASS_SCHEDULE_AUDIT_ACTION = 'classes.schedule.changed';

/** Class states whose weekly schedule may be edited (a completed or cancelled class is frozen — §4e.8 (3)). */
const SCHEDULABLE_CLASS_STATUSES: readonly ClassStatus[] = ['planned', 'open', 'running'];

/** The slot as API-088 returns it; the timetable readings of T04 extend it (timetable.service.ts). */
export const SLOT_SELECT = {
  id: true,
  weekday: true,
  startTime: true,
  endTime: true,
  roomId: true,
  teacherUserId: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
  updatedAt: true,
  room: { select: { id: true, code: true, name: true, branch: { select: { id: true, code: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
} satisfies Prisma.ClassScheduleSelect;

type SlotRow = Prisma.ClassScheduleGetPayload<{ select: typeof SLOT_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

const SLOT_ORDER: Prisma.ClassScheduleOrderByWithRelationInput[] = [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }];

export function toSlotDto(row: SlotRow): ScheduleSlotDto {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: columnToClockTime(row.startTime),
    endTime: columnToClockTime(row.endTime),
    room: row.room
      ? {
          id: row.room.id,
          code: row.room.code,
          name: readLocalizedText(row.room.name),
          branch: row.room.branch
            ? { id: row.room.branch.id, code: row.room.branch.code, name: readLocalizedText(row.room.branch.name) ?? { ar: row.room.branch.code } }
            : null,
        }
      : null,
    teacher: row.teacher ? { userId: row.teacher.id, fullName: row.teacher.fullName } : null,
    effectiveFrom: columnToCalendarDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? columnToCalendarDate(row.effectiveTo) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function existingOf(row: SlotRow): ExistingSlot {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: columnToClockTime(row.startTime),
    endTime: columnToClockTime(row.endTime),
    roomId: row.roomId,
    teacherUserId: row.teacherUserId,
    effectiveFrom: columnToCalendarDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? columnToCalendarDate(row.effectiveTo) : null,
  };
}

function toColumns(values: Partial<SlotValues>): Prisma.ClassScheduleUncheckedUpdateInput {
  const data: Prisma.ClassScheduleUncheckedUpdateInput = {};
  if (values.weekday !== undefined) data.weekday = values.weekday;
  if (values.startTime !== undefined) data.startTime = clockTimeToColumn(values.startTime);
  if (values.endTime !== undefined) data.endTime = clockTimeToColumn(values.endTime);
  if (values.roomId !== undefined) data.roomId = values.roomId;
  if (values.teacherUserId !== undefined) data.teacherUserId = values.teacherUserId;
  if (values.effectiveFrom !== undefined) data.effectiveFrom = calendarDateToColumn(values.effectiveFrom);
  if (values.effectiveTo !== undefined) data.effectiveTo = values.effectiveTo === null ? null : calendarDateToColumn(values.effectiveTo);
  return data;
}

/** The slot as the error body shows it (the request's values, never ids of other classes' people). */
function slotDetail(values: SlotValues, index: number): Record<string, unknown> {
  return { index, ...values };
}

/** Attempts of the replace transaction when PostgreSQL reports a write conflict or a deadlock (KI-071). */
const WRITE_CONFLICT_ATTEMPTS = 2;

/** Prisma's `P2034` — "Transaction failed due to a write conflict or a deadlock" (SQLSTATE 40001 / 40P01). */
export function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

/**
 * Which EXCLUDE constraint a database error names (`ex_class_schedules_room` /
 * `ex_class_schedules_teacher` — §4e.8 (1)). Prisma 7 with the pg adapter does
 * not map SQLSTATE 23P01 to a dedicated code, so the constraint is read from
 * the driver error (`meta.driverAdapterError.cause`) or the message (KI-036).
 */
export function exclusionKindOf(error: unknown): ConflictKind | null {
  const texts: string[] = [];
  if (error instanceof Error) texts.push(error.message);
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const cause = (meta?.['driverAdapterError'] as { cause?: Record<string, unknown> } | undefined)?.cause;
  if (cause) {
    const constraint = cause['constraint'] as { index?: unknown } | undefined;
    if (typeof constraint?.index === 'string') texts.push(constraint.index);
    if (typeof cause['originalMessage'] === 'string') texts.push(cause['originalMessage']);
  }
  const joined = texts.join(' ');
  if (joined.includes('ex_class_schedules_room')) return 'room';
  if (joined.includes('ex_class_schedules_teacher')) return 'teacher';
  return null;
}

/**
 * MOD-07-T03 — the weekly schedule of a class. Reading follows the class's
 * visibility (D-R16: `classes.read` alone sees the schedule of an assigned
 * class only); writing (`schedule.manage`) replaces the whole list in one
 * transaction behind the class-row lock of T02/T03/T04 (`FOR NO KEY UPDATE`),
 * after the checks of roadmap §4e.5 T03 in their order: class schedulable,
 * ids known and unique, working days (D-R28), rooms existing and active,
 * teachers assigned to the class (D-R26), conflicts inside the request; the
 * EXCLUDE constraints refuse a double booking against other classes and the
 * service names the conflicting slot. Exactly one `classes.schedule.changed`
 * event per effective write.
 */
@Injectable()
export class ClassScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(classId: string, caller: AuthPrincipal): Promise<ClassScheduleDto> {
    const klass = await this.prisma.db.class.findFirst({ where: { AND: [{ id: classId }, visibleClassesWhere(caller)] }, select: { id: true } });
    if (!klass) throw scheduleError.classNotFound(classId);
    return this.read(this.prisma.db, classId);
  }

  async replace(classId: string, input: ReplaceClassScheduleDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassScheduleDto> {
    const requested: RequestedSlot[] = input.slots.map((slot) => ({
      ...(slot.id !== undefined ? { id: slot.id } : {}),
      weekday: slot.weekday,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomId: slot.roomId ?? null,
      teacherUserId: slot.teacherUserId ?? null,
      effectiveFrom: slot.effectiveFrom,
      effectiveTo: slot.effectiveTo ?? null,
    }));
    const workingDays = await this.workingDays();
    const written: SlotValues[] = [];

    // A true tie on an EXCLUDE constraint — two requests inserting mutually
    // conflicting slots at the same instant — ends for the loser with a
    // deadlock (SQLSTATE 40P01, Prisma P2034) instead of 23P01 (KI-071). One
    // retry: the winner has committed by then, so the loser meets the
    // exclusion violation and is answered with the conflicting slot.
    for (let attempt = 1; ; attempt++) {
      written.length = 0;
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`
            SELECT code, status FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
          const klass = locked[0];
          if (!klass) throw scheduleError.classNotFound(classId);
          if (!SCHEDULABLE_CLASS_STATUSES.includes(klass.status)) throw scheduleError.classNotSchedulable(klass.status);

          const rows = await tx.classSchedule.findMany({ where: { classId }, orderBy: SLOT_ORDER, select: SLOT_SELECT });
          const plan = planScheduleReplacement(rows.map(existingOf), requested);
          if (!plan.ok) throw scheduleError.scheduleInvalid(plan.unknown, plan.duplicates);
          if (!plan.changed) return { classId, slots: rows.map(toSlotDto) };

          const final = requested.map(valuesOf);
          const offDay = findNonWorkingDay(final, workingDays);
          if (offDay) throw scheduleError.nonWorkingDay(offDay.weekday);
          await this.assertRoomsUsable(tx, referencedIds(plan, 'roomId'));
          await this.assertTeachersAssigned(tx, classId, referencedIds(plan, 'teacherUserId'));
          const conflict = findRequestConflict(final);
          if (conflict) throw scheduleError.scheduleConflict(conflict.kind, slotDetail(final[conflict.second]!, conflict.second), null, classId);

          written.push(...plan.create, ...plan.update.map((change) => ({ ...existingOf(rows.find((row) => row.id === change.id)!), ...change })));
          if (plan.remove.length > 0) await tx.classSchedule.deleteMany({ where: { classId, id: { in: plan.remove } } });
          for (const change of plan.update) {
            const { id, ...values } = change;
            await tx.classSchedule.update({ where: { id }, data: toColumns(values), select: { id: true } });
          }
          if (plan.create.length > 0) {
            await tx.classSchedule.createMany({
              data: plan.create.map((values) => ({
                classId,
                createdById: caller.id,
                weekday: values.weekday,
                startTime: clockTimeToColumn(values.startTime),
                endTime: clockTimeToColumn(values.endTime),
                roomId: values.roomId,
                teacherUserId: values.teacherUserId,
                effectiveFrom: calendarDateToColumn(values.effectiveFrom),
                effectiveTo: values.effectiveTo === null ? null : calendarDateToColumn(values.effectiveTo),
              })),
            });
          }
          await this.audit.record(
            {
              action: CLASS_SCHEDULE_AUDIT_ACTION,
              actorUserId: caller.id,
              entityType: 'classes',
              entityId: classId,
              metadata: { code: klass.code, ...plan.counts, slots: requested.length },
              ...ctx,
            },
            tx,
          );
          return this.read(tx, classId);
        });
      } catch (error) {
        const kind = exclusionKindOf(error);
        // The transaction is rolled back; name the slot of another class that the constraint protected.
        if (kind !== null) throw await this.conflictWithOtherClass(classId, kind, written);
        if (isWriteConflict(error) && attempt < WRITE_CONFLICT_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** `settings.scheduling.workingDays` of the academy, or null when not set (no restriction — D-R28). */
  private async workingDays(): Promise<number[] | null> {
    const academy = await this.prisma.db.academy.findFirst({ select: { settings: true } });
    return academy ? readSettings(academy.settings).scheduling.workingDays : null;
  }

  /** Every room a written slot names must exist (`404 room_not_found`) and be active (`422 room_inactive`); kept slots are not re-checked. */
  private async assertRoomsUsable(tx: Tx, roomIds: readonly string[]): Promise<void> {
    if (roomIds.length === 0) return;
    const rooms = await tx.room.findMany({ where: { id: { in: [...roomIds] } }, select: { id: true, isActive: true } });
    const byId = new Map(rooms.map((room) => [room.id, room]));
    for (const roomId of roomIds) {
      const room = byId.get(roomId);
      if (!room) throw scheduleError.roomNotFound(roomId);
      if (!room.isActive) throw scheduleError.roomInactive(roomId);
    }
  }

  /** Every teacher a written slot names must be one of the class's teachers, lead or assistant (D-R26 — `422 teacher_not_assigned`). */
  private async assertTeachersAssigned(tx: Tx, classId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const assigned = await tx.classTeacher.findMany({ where: { classId, teacherUserId: { in: [...userIds] } }, select: { teacherUserId: true } });
    const known = new Set(assigned.map((row) => row.teacherUserId));
    for (const userId of userIds) if (!known.has(userId)) throw scheduleError.teacherNotAssigned(userId);
  }

  /**
   * After a 23P01 from `ex_class_schedules_room` / `ex_class_schedules_teacher`:
   * the first written slot that overlaps a slot of another class on the same
   * resource (same weekday, half-open times, inclusive effective ranges).
   */
  private async conflictWithOtherClass(classId: string, kind: ConflictKind, written: readonly SlotValues[]): Promise<Error> {
    for (const [index, slot] of written.entries()) {
      const resource = kind === 'room' ? slot.roomId : slot.teacherUserId;
      if (resource === null) continue;
      const other = await this.prisma.db.classSchedule.findFirst({
        where: {
          classId: { not: classId },
          weekday: slot.weekday,
          ...(kind === 'room' ? { roomId: resource } : { teacherUserId: resource }),
          startTime: { lt: clockTimeToColumn(slot.endTime) },
          endTime: { gt: clockTimeToColumn(slot.startTime) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: calendarDateToColumn(slot.effectiveFrom) } }],
          ...(slot.effectiveTo !== null ? { effectiveFrom: { lte: calendarDateToColumn(slot.effectiveTo) } } : {}),
        },
        orderBy: SLOT_ORDER,
        select: { id: true, classId: true },
      });
      if (other) return scheduleError.scheduleConflict(kind, slotDetail(slot, index), other.id, other.classId);
    }
    return scheduleError.scheduleConflict(kind, null, null, null);
  }

  private async read(db: Db, classId: string): Promise<ClassScheduleDto> {
    const rows = await db.classSchedule.findMany({ where: { classId }, orderBy: SLOT_ORDER, select: SLOT_SELECT });
    return { classId, slots: rows.map(toSlotDto) };
  }
}
