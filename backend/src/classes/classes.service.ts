import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { calendarDateToDate, escapeLikePattern } from '../users/users.validation.js';
import { invalidDateRange, isEmptyClassPatch, planClassUpdate } from './classes.changes.js';
import type { ClassPatch, ClassValues } from './classes.changes.js';
import { CLASSES_PAGE_DEFAULT } from './classes.dto.js';
import type {
  ChangeClassStatusDto,
  ClassDto,
  ClassListDto,
  ClassSortField,
  CreateClassDto,
  ListClassesQueryDto,
  UpdateClassDto,
} from './classes.dto.js';
import { classesError } from './classes.errors.js';
import { visibleClassesWhere } from './classes.policy.js';
import { allowedClassActions, closesOpenSlots, enrollmentStatusAfter, isClassDeletable, nextClassStatus } from './classes.status.js';
import { calendarDateIn } from '../schedule/schedule.time.js';

export const CLASSES_AUDIT_ACTIONS = {
  created: 'classes.created',
  updated: 'classes.updated',
  statusChanged: 'classes.status.changed',
  deleted: 'classes.deleted',
} as const;

/** Audit `entity_type` of class events. */
export const CLASSES_ENTITY_TYPE = 'classes';

const CLASS_SELECT = {
  id: true,
  code: true,
  name: true,
  capacity: true,
  status: true,
  startsOn: true,
  endsOn: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true, status: true } },
  teachers: {
    select: { teacherUserId: true, role: true, assignedAt: true, teacher: { select: { fullName: true } } },
    // The enum sorts in declaration order: lead before assistant.
    orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }, { teacherUserId: 'asc' }],
  },
  _count: { select: { enrollments: { where: { status: 'active' } } } },
} satisfies Prisma.ClassSelect;

type ClassRow = Prisma.ClassGetPayload<{ select: typeof CLASS_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toClassDto(row: ClassRow): ClassDto {
  return {
    id: row.id,
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    capacity: row.capacity,
    status: row.status,
    startsOn: dateOnly(row.startsOn),
    endsOn: dateOnly(row.endsOn),
    notes: row.notes,
    course: {
      id: row.course.id,
      code: row.course.code,
      name: readLocalizedText(row.course.name) ?? { ar: row.course.code },
      status: row.course.status,
    },
    teachers: row.teachers.map((teacher) => ({
      userId: teacher.teacherUserId,
      fullName: teacher.teacher.fullName,
      role: teacher.role,
      assignedAt: teacher.assignedAt.toISOString(),
    })),
    enrolledCount: row._count.enrollments,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function valuesOf(row: ClassRow): ClassValues {
  return {
    code: row.code,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    capacity: row.capacity,
    startsOn: dateOnly(row.startsOn),
    endsOn: dateOnly(row.endsOn),
    notes: row.notes,
  };
}

function toDateColumn(value: string | null): Date | null {
  return value === null ? null : calendarDateToDate(value);
}

function toUpdateInput(data: ClassPatch): Prisma.ClassUncheckedUpdateInput {
  const input: Prisma.ClassUncheckedUpdateInput = {};
  if (data.code !== undefined) input.code = data.code;
  if (data.name !== undefined) input.name = data.name as Prisma.InputJsonValue;
  if (data.capacity !== undefined) input.capacity = data.capacity;
  if (data.startsOn !== undefined) input.startsOn = toDateColumn(data.startsOn);
  if (data.endsOn !== undefined) input.endsOn = toDateColumn(data.endsOn);
  if (data.notes !== undefined) input.notes = data.notes;
  return input;
}

/**
 * Concurrent requests can beat the friendly checks: a duplicate code (P2002),
 * a course deleted meanwhile (P2003 on classes.course_id) or a class deleted
 * meanwhile (P2025).
 */
function translateKnownError(error: unknown, classId: string | null, code: string | null, courseId: string | null): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
  if (error.code === 'P2002' && code !== null) return classesError.classCodeTaken(code);
  if (error.code === 'P2003' && courseId !== null) return classesError.courseNotFound(courseId);
  if (error.code === 'P2025' && classId !== null) return classesError.classNotFound(classId);
  return error;
}

/**
 * MOD-05-T02 — classes. `classes.read` alone sees only the classes the caller
 * is assigned to (others are 404 — D-R16); `classes.manage` sees every class
 * and writes. A class is created `planned` for a published course; its status
 * moves through manual actions (D-R17), `complete`/`cancel` move the active
 * enrollments in the same transaction; only a planned class without
 * enrollments is deleted. Writes that depend on the enrollments (capacity,
 * status, delete) lock the class row first and count in a second statement,
 * so they see every enrollment committed before the lock (KI-041 lesson).
 * Every write is one transaction with exactly one audit event (`classes.*`).
 */
@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListClassesQueryDto, caller: AuthPrincipal): Promise<ClassListDto> {
    const sort: ClassSortField = query.sort ?? 'code';
    const order: SortOrder = query.order ?? (sort === 'code' ? 'asc' : 'desc');
    const limit = query.limit ?? CLASSES_PAGE_DEFAULT;

    const filters: Prisma.ClassWhereInput[] = [visibleClassesWhere(caller)];
    if (query.status) filters.push({ status: query.status });
    if (query.courseId) filters.push({ courseId: query.courseId });
    if (query.teacherId) filters.push({ teachers: { some: { teacherUserId: query.teacherId } } });
    if (query.q) {
      const pattern = escapeLikePattern(query.q);
      filters.push({
        OR: [{ code: { contains: pattern, mode: 'insensitive' } }, { id: { in: await this.classIdsByName(pattern) } }],
      });
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, sort, order, sort === 'code', () => classesError.cursorInvalid());
      const cmp = order === 'asc' ? 'gt' : 'lt';
      filters.push(sort === 'code' ? { code: { [cmp]: cursor.key as string } } : { id: { [cmp]: cursor.id } });
    }

    const rows = await this.prisma.db.class.findMany({
      where: { AND: filters },
      orderBy: sort === 'code' ? [{ code: order }] : [{ id: order }],
      take: limit + 1,
      select: CLASS_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last ? encodeKeysetCursor({ sort, order, key: sort === 'code' ? last.code : null, id: last.id }) : null;
    return { items: page.map(toClassDto), nextCursor };
  }

  /**
   * Ids of the classes whose Arabic or English name contains `pattern` (already
   * passed through escapeLikePattern), case-insensitively and literally — the
   * parameterised ILIKE of the courses search (KI-048 lesson). The caller's
   * other filters (visibility, cursor) still apply to the final query.
   */
  private async classIdsByName(pattern: string): Promise<string[]> {
    const like = `%${pattern}%`;
    const rows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM classes
      WHERE name ->> 'ar' ILIKE ${like} ESCAPE '\\' OR name ->> 'en' ILIKE ${like} ESCAPE '\\'`;
    return rows.map((row) => row.id);
  }

  async get(id: string, caller: AuthPrincipal): Promise<ClassDto> {
    const row = await this.prisma.db.class.findFirst({ where: { AND: [{ id }, visibleClassesWhere(caller)] }, select: CLASS_SELECT });
    if (!row) throw classesError.classNotFound(id);
    return toClassDto(row);
  }

  async create(input: CreateClassDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassDto> {
    const startsOn = input.startsOn ?? null;
    const endsOn = input.endsOn ?? null;
    if (startsOn !== null && endsOn !== null && endsOn < startsOn) throw classesError.dateRangeInvalid(startsOn, endsOn);
    const course = await this.prisma.db.course.findUnique({ where: { id: input.courseId }, select: { status: true } });
    if (!course) throw classesError.courseNotFound(input.courseId);
    if (course.status !== 'published') throw classesError.courseNotPublished(input.courseId, course.status);
    const clash = await this.prisma.db.class.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw classesError.classCodeTaken(input.code);

    let classId: string;
    try {
      classId = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.class.create({
          data: {
            courseId: input.courseId,
            code: input.code,
            name: toLocalizedText(input.name) as Prisma.InputJsonValue,
            capacity: input.capacity,
            startsOn: toDateColumn(startsOn),
            endsOn: toDateColumn(endsOn),
            notes: input.notes ?? null,
            createdById: caller.id,
          },
          select: { id: true, status: true },
        });
        await this.audit.record(
          {
            action: CLASSES_AUDIT_ACTIONS.created,
            actorUserId: caller.id,
            entityType: CLASSES_ENTITY_TYPE,
            entityId: created.id,
            metadata: { code: input.code, courseId: input.courseId, status: created.status },
            ...ctx,
          },
          tx,
        );
        return created.id;
      });
    } catch (error) {
      throw translateKnownError(error, null, input.code, input.courseId);
    }
    return this.getForManager(classId);
  }

  async update(id: string, input: UpdateClassDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassDto> {
    if (isEmptyClassPatch(input)) throw classesError.nothingToUpdate();
    const row = await this.prisma.db.class.findUnique({ where: { id }, select: CLASS_SELECT });
    if (!row) throw classesError.classNotFound(id);

    const patch: ClassPatch = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.name !== undefined) patch.name = toLocalizedText(input.name);
    if (input.capacity !== undefined) patch.capacity = input.capacity;
    if (input.startsOn !== undefined) patch.startsOn = input.startsOn;
    if (input.endsOn !== undefined) patch.endsOn = input.endsOn;
    if (input.notes !== undefined) patch.notes = input.notes;

    const current = valuesOf(row);
    const badRange = invalidDateRange(current, patch);
    if (badRange) throw classesError.dateRangeInvalid(badRange.startsOn, badRange.endsOn);
    const plan = planClassUpdate(current, patch);
    if (plan.fields.length === 0) return toClassDto(row);

    if (plan.data.code !== undefined) {
      const clash = await this.prisma.db.class.findUnique({ where: { code: plan.data.code }, select: { id: true } });
      if (clash && clash.id !== id) throw classesError.classCodeTaken(plan.data.code);
    }

    try {
      await this.prisma.db.$transaction(async (tx) => {
        if (plan.data.capacity !== undefined) {
          // Lock first, count after (a fresh statement): an enrollment committed
          // before the lock is counted, a later one waits for this transaction.
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM classes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
          if (locked.length === 0) throw classesError.classNotFound(id);
          const enrolledCount = await tx.enrollment.count({ where: { classId: id, status: 'active' } });
          if (plan.data.capacity < enrolledCount) throw classesError.capacityBelowEnrolled(plan.data.capacity, enrolledCount);
        }
        await tx.class.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
        await this.audit.record(
          {
            action: CLASSES_AUDIT_ACTIONS.updated,
            actorUserId: caller.id,
            entityType: CLASSES_ENTITY_TYPE,
            entityId: id,
            metadata: { code: plan.data.code ?? row.code, fields: plan.fields },
            ...ctx,
          },
          tx,
        );
      });
    } catch (error) {
      throw translateKnownError(error, id, plan.data.code ?? null, null);
    }
    return this.getForManager(id);
  }

  /**
   * open / start / complete / cancel / restore (classes.status.ts). The class
   * row is locked so the transition, the enrollment update of complete/cancel
   * and concurrent enrollments (T04 locks the same row) run one after the other.
   */
  async changeStatus(id: string, input: ChangeClassStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`
        SELECT code, status FROM classes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const current = locked[0];
      if (!current) throw classesError.classNotFound(id);
      const to = nextClassStatus(input.action, current.status);
      if (to === null) throw classesError.invalidTransition(current.status, input.action, allowedClassActions(current.status));

      await tx.class.update({ where: { id }, data: { status: to }, select: { id: true } });
      const enrollmentStatus = enrollmentStatusAfter(input.action);
      let affectedEnrollments: number | null = null;
      if (enrollmentStatus !== null) {
        const moved = await tx.enrollment.updateMany({
          where: { classId: id, status: 'active' },
          data: { status: enrollmentStatus, ...(enrollmentStatus === 'completed' ? { completedAt: new Date() } : {}) },
        });
        affectedEnrollments = moved.count;
      }
      // MOD-07-T03 (§4e.8 (3)): a completed or cancelled class stops booking its rooms and
      // teachers — its open-ended (or later-ending) weekly slots end today in the academy's
      // time zone, or on their own first day when that is later (CHECK ck_class_schedules_effective).
      let closedSlots = 0;
      if (closesOpenSlots(input.action)) {
        const academy = await tx.academy.findFirst({ select: { timezone: true } });
        const today = calendarDateIn(academy?.timezone ?? 'UTC');
        closedSlots = await tx.$executeRaw`
          UPDATE class_schedules
          SET effective_to = GREATEST(${today}::date, effective_from)
          WHERE class_id = ${id}::uuid
            AND (effective_to IS NULL OR effective_to > GREATEST(${today}::date, effective_from))`;
      }
      await this.audit.record(
        {
          action: CLASSES_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: CLASSES_ENTITY_TYPE,
          entityId: id,
          metadata: {
            code: current.code,
            action: input.action,
            from: current.status,
            to,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
            ...(affectedEnrollments !== null ? { affectedEnrollments } : {}),
            ...(closedSlots > 0 ? { closedSlots } : {}),
          },
          ...ctx,
        },
        tx,
      );
    });
    return this.getForManager(id);
  }

  /** Deletes a planned class without any enrollment (its teacher rows cascade); any other is 409 class_not_deletable — cancel it instead. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      // FOR UPDATE (a delete): an enrollment insert takes FOR KEY SHARE on this row and waits.
      const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`
        SELECT code, status FROM classes WHERE id = ${id}::uuid FOR UPDATE`;
      const current = locked[0];
      if (!current) throw classesError.classNotFound(id);
      const enrollmentCount = await tx.enrollment.count({ where: { classId: id } });
      if (!isClassDeletable(current.status, enrollmentCount)) throw classesError.classNotDeletable(current.status, enrollmentCount);
      await tx.class.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        {
          action: CLASSES_AUDIT_ACTIONS.deleted,
          actorUserId: caller.id,
          entityType: CLASSES_ENTITY_TYPE,
          entityId: id,
          metadata: { code: current.code },
          ...ctx,
        },
        tx,
      );
    });
  }

  /** The class as a manager sees it (no visibility filter); shared with the T03 teacher replacement. */
  async getForManager(id: string): Promise<ClassDto> {
    const row = await this.prisma.db.class.findUnique({ where: { id }, select: CLASS_SELECT });
    if (!row) throw classesError.classNotFound(id);
    return toClassDto(row);
  }
}
