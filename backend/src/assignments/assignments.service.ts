import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus, SubmissionStatus } from '../generated/prisma/client.js';
import { toInstant, toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { isEmptyAssignmentPatch, latePolicyProblem, planAssignmentUpdate, toDecimalText } from './assignments.changes.js';
import type { AssignmentPatch, AssignmentValues } from './assignments.changes.js';
import { ASSIGNMENTS_PAGE_DEFAULT, toInstructionsText } from './assignments.dto.js';
import type {
  AssignmentDto,
  AssignmentListDto,
  ChangeAssignmentStatusDto,
  CreateAssignmentDto,
  ListAssignmentsQueryDto,
  SubmissionCountsDto,
  UpdateAssignmentDto,
} from './assignments.dto.js';
import { assignmentsError } from './assignments.errors.js';
import { ASSIGNMENT_SORT_FIELD, afterDueCursor, dueCursorKey, dueOrderBy } from './assignments.keyset.js';
import { isClassOpenForAssignments, seesEveryClass, visibleAssignmentsWhere } from './assignments.policy.js';
import { actionNeedsOpenClass, allowedAssignmentActions, isAssignmentDeletable, lockedAssignmentFields, nextAssignmentStatus } from './assignments.status.js';

export const ASSIGNMENTS_AUDIT_ACTIONS = {
  created: 'assignments.created',
  updated: 'assignments.updated',
  statusChanged: 'assignments.status.changed',
  deleted: 'assignments.deleted',
} as const;

/** Audit `entity_type` of every assignment event. */
export const ASSIGNMENTS_ENTITY_TYPE = 'assignments';

/** The academy's time zone for `AssignmentDto.timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

const ASSIGNMENT_SELECT = {
  id: true,
  classId: true,
  lessonId: true,
  title: true,
  instructions: true,
  maxScore: true,
  weight: true,
  status: true,
  publishedAt: true,
  closedAt: true,
  dueAt: true,
  allowLate: true,
  latePenaltyPercent: true,
  maxAttempts: true,
  createdAt: true,
  updatedAt: true,
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
  lesson: { select: { id: true, title: true, startsAt: true, room: { select: { branch: { select: { timezone: true } } } } } },
} satisfies Prisma.AssignmentSelect;

type AssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

const EMPTY_COUNTS: SubmissionCountsDto = { students: 0, submitted: 0, graded: 0, returned: 0 };

function decimalOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function toAssignmentDto(row: AssignmentRow, counts: SubmissionCountsDto, activeStudents: number, academyTimeZone: string): AssignmentDto {
  return {
    id: row.id,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
    },
    lesson: row.lesson ? { id: row.lesson.id, title: readLocalizedText(row.lesson.title) ?? { ar: '' }, startsAt: toIso(row.lesson.startsAt) } : null,
    title: readLocalizedText(row.title) ?? { ar: '' },
    instructions: readLocalizedText(row.instructions),
    maxScore: Number(row.maxScore),
    weight: decimalOrNull(row.weight),
    status: row.status,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    // D-R41: the linked lesson's room branch zone, else the academy's.
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
    allowLate: row.allowLate,
    latePenaltyPercent: decimalOrNull(row.latePenaltyPercent),
    maxAttempts: row.maxAttempts,
    submissions: counts,
    activeStudents,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: AssignmentRow): AssignmentValues {
  return {
    title: readLocalizedText(row.title) ?? { ar: '' },
    instructions: readLocalizedText(row.instructions),
    lessonId: row.lessonId,
    maxScore: toDecimalText(row.maxScore.toString())!,
    weight: toDecimalText(row.weight === null ? null : row.weight.toString()),
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    allowLate: row.allowLate,
    latePenaltyPercent: toDecimalText(row.latePenaltyPercent === null ? null : row.latePenaltyPercent.toString()),
    maxAttempts: row.maxAttempts,
  };
}

function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toUpdateInput(data: AssignmentPatch): Prisma.AssignmentUncheckedUpdateInput {
  const input: Prisma.AssignmentUncheckedUpdateInput = {};
  if (data.title !== undefined) input.title = data.title as Prisma.InputJsonValue;
  if (data.instructions !== undefined) input.instructions = jsonOrDbNull(data.instructions);
  if (data.lessonId !== undefined) input.lessonId = data.lessonId;
  if (data.maxScore !== undefined) input.maxScore = data.maxScore;
  if (data.weight !== undefined) input.weight = data.weight;
  if (data.dueAt !== undefined) input.dueAt = data.dueAt === null ? null : toInstant(data.dueAt);
  if (data.allowLate !== undefined) input.allowLate = data.allowLate;
  if (data.latePenaltyPercent !== undefined) input.latePenaltyPercent = data.latePenaltyPercent;
  if (data.maxAttempts !== undefined) input.maxAttempts = data.maxAttempts;
  return input;
}

/**
 * MOD-08-T02 — assignments (roadmap §4g.4 API-102..API-107; owner decisions
 * D-R35..D-R40). Visibility follows D-R16 through the class
 * (`classes.manage` sees every class's assignments, anyone else those of the
 * classes they teach — others are 404); writing needs `assignments.manage`
 * and the same visibility. An assignment is created as a draft for a class
 * that is planned, open or running, optionally linked to one of the class's
 * lessons; its status moves through manual actions (D-R37); the grading
 * rules are locked once a submission exists. Creation locks the class row
 * (`FOR NO KEY UPDATE`, the MOD-05 lock), edits and actions lock the
 * assignment row, deletion locks it `FOR UPDATE`. Every write is one
 * transaction with exactly one audit event; an identical PATCH writes and
 * records nothing.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListAssignmentsQueryDto, caller: AuthPrincipal): Promise<AssignmentListDto> {
    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? ASSIGNMENTS_PAGE_DEFAULT;
    const filters: Prisma.AssignmentWhereInput[] = [visibleAssignmentsWhere(caller)];
    if (query.classId) filters.push({ classId: query.classId });
    if (query.lessonId) filters.push({ lessonId: query.lessonId });
    if (query.status) filters.push({ status: query.status });
    if (query.dueFrom) filters.push({ dueAt: { gte: toInstant(query.dueFrom) } });
    if (query.dueTo) filters.push({ dueAt: { lte: toInstant(query.dueTo) } });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, ASSIGNMENT_SORT_FIELD, order, true, () => assignmentsError.cursorInvalid());
      const after = afterDueCursor(cursor.key as string, cursor.id, order);
      if (after === null) throw assignmentsError.cursorInvalid();
      filters.push(after);
    }
    const rows = await this.prisma.db.assignment.findMany({
      where: { AND: filters },
      orderBy: dueOrderBy(order),
      take: limit + 1,
      select: ASSIGNMENT_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeKeysetCursor({ sort: ASSIGNMENT_SORT_FIELD, order, key: dueCursorKey(last.dueAt), id: last.id })
        : null;
    return { items: await this.toDtos(this.prisma.db, page), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<AssignmentDto> {
    const row = await this.prisma.db.assignment.findFirst({ where: { AND: [{ id }, visibleAssignmentsWhere(caller)] }, select: ASSIGNMENT_SELECT });
    if (!row) throw assignmentsError.assignmentNotFound(id);
    const [dto] = await this.toDtos(this.prisma.db, [row]);
    return dto!;
  }

  /** `POST /api/classes/:id/assignments` — a draft for a planned, open or running class (API-104). */
  async create(classId: string, input: CreateAssignmentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AssignmentDto> {
    const allowLate = input.allowLate ?? false;
    const latePenaltyPercent = input.latePenaltyPercent ?? null;
    if (latePenaltyPercent !== null && !allowLate) throw assignmentsError.latePenaltyInvalid(allowLate, latePenaltyPercent);
    return this.prisma.db.$transaction(async (tx) => {
      const klass = await this.lockClass(tx, classId, caller);
      if (!isClassOpenForAssignments(klass.status)) throw assignmentsError.classClosed(classId, klass.status);
      const lessonId = input.lessonId ?? null;
      if (lessonId !== null) await this.assertLessonOfClass(tx, lessonId, classId);
      const created = await tx.assignment.create({
        data: {
          classId,
          lessonId,
          createdById: caller.id,
          title: toLocalizedText(input.title) as Prisma.InputJsonValue,
          instructions: input.instructions === undefined || input.instructions === null ? Prisma.DbNull : (toInstructionsText(input.instructions) as Prisma.InputJsonValue),
          maxScore: toDecimalText(input.maxScore)!,
          weight: toDecimalText(input.weight ?? null),
          dueAt: input.dueAt === undefined || input.dueAt === null ? null : toInstant(input.dueAt),
          allowLate,
          latePenaltyPercent: toDecimalText(latePenaltyPercent),
          maxAttempts: input.maxAttempts ?? 1,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: ASSIGNMENTS_AUDIT_ACTIONS.created,
          actorUserId: caller.id,
          entityType: ASSIGNMENTS_ENTITY_TYPE,
          entityId: created.id,
          metadata: { classId, code: klass.code },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, created.id);
    });
  }

  async update(id: string, input: UpdateAssignmentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AssignmentDto> {
    if (isEmptyAssignmentPatch(input)) throw assignmentsError.nothingToUpdate();
    const patch: AssignmentPatch = {};
    if (input.title !== undefined) patch.title = toLocalizedText(input.title);
    if (input.instructions !== undefined) patch.instructions = input.instructions === null ? null : toInstructionsText(input.instructions);
    if (input.lessonId !== undefined) patch.lessonId = input.lessonId;
    if (input.maxScore !== undefined) patch.maxScore = toDecimalText(input.maxScore)!;
    if (input.weight !== undefined) patch.weight = toDecimalText(input.weight);
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt === null ? null : toIso(toInstant(input.dueAt));
    if (input.allowLate !== undefined) patch.allowLate = input.allowLate;
    if (input.latePenaltyPercent !== undefined) patch.latePenaltyPercent = toDecimalText(input.latePenaltyPercent);
    if (input.maxAttempts !== undefined) patch.maxAttempts = input.maxAttempts;

    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockAssignment(tx, id, caller, 'NO KEY UPDATE');
      const current = valuesOf(row);
      const plan = planAssignmentUpdate(current, patch);
      if (plan.fields.length === 0) return this.read(tx, id);
      if (!isClassOpenForAssignments(row.class.status)) throw assignmentsError.classClosed(row.classId, row.class.status);
      const submissionCount = await tx.assignmentSubmission.count({ where: { assignmentId: id } });
      const locked = lockedAssignmentFields(row.status, submissionCount, plan.fields);
      if (locked.length > 0) throw assignmentsError.assignmentLocked(row.status, locked, submissionCount);
      const latePolicy = latePolicyProblem(current, plan.data);
      if (latePolicy !== null) throw assignmentsError.latePenaltyInvalid(latePolicy.allowLate, latePolicy.latePenaltyPercent);
      if (typeof plan.data.lessonId === 'string') await this.assertLessonOfClass(tx, plan.data.lessonId, row.classId);
      await tx.assignment.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
      await this.audit.record(
        {
          action: ASSIGNMENTS_AUDIT_ACTIONS.updated,
          actorUserId: caller.id,
          entityType: ASSIGNMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: { classId: row.classId, code: row.class.code, fields: plan.fields },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** publish / close / reopen (assignments.status.ts); `close` also ends an assignment of a completed or cancelled class. */
  async changeStatus(id: string, input: ChangeAssignmentStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<AssignmentDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockAssignment(tx, id, caller, 'NO KEY UPDATE');
      if (actionNeedsOpenClass(input.action) && !isClassOpenForAssignments(row.class.status)) throw assignmentsError.classClosed(row.classId, row.class.status);
      const to = nextAssignmentStatus(input.action, row.status);
      if (to === null) throw assignmentsError.invalidTransition(row.status, input.action, allowedAssignmentActions(row.status));
      const now = new Date();
      const data: Prisma.AssignmentUncheckedUpdateInput = { status: to };
      if (input.action === 'publish') data.publishedAt = now;
      if (input.action === 'close') data.closedAt = now;
      if (input.action === 'reopen') data.closedAt = null;
      await tx.assignment.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(
        {
          action: ASSIGNMENTS_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: ASSIGNMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: {
            classId: row.classId,
            code: row.class.code,
            action: input.action,
            from: row.status,
            to,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** Deletes a draft without any submission (also of a completed or cancelled class); any other is 409 assignment_not_deletable — close it instead. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockAssignment(tx, id, caller, 'UPDATE');
      const submissionCount = await tx.assignmentSubmission.count({ where: { assignmentId: id } });
      if (!isAssignmentDeletable(row.status, submissionCount)) throw assignmentsError.assignmentNotDeletable(row.status, submissionCount);
      await tx.assignment.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        {
          action: ASSIGNMENTS_AUDIT_ACTIONS.deleted,
          actorUserId: caller.id,
          entityType: ASSIGNMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: { classId: row.classId, code: row.class.code },
          ...ctx,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Locks the class row (the MOD-05 lock, so assignment creation serialises
   * with the class's own actions) and applies the visibility rule: without
   * `classes.manage` the caller must be one of the class's teachers — an
   * unknown or invisible class is 404 before any other detail is revealed.
   */
  private async lockClass(tx: Tx, classId: string, caller: AuthPrincipal): Promise<{ code: string; status: ClassStatus }> {
    const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`
      SELECT code, status FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
    const klass = locked[0];
    if (!klass) throw assignmentsError.classNotFound(classId);
    if (!seesEveryClass(caller)) {
      const assigned = await tx.classTeacher.findFirst({ where: { classId, teacherUserId: caller.id }, select: { classId: true } });
      if (!assigned) throw assignmentsError.classNotFound(classId);
    }
    return klass;
  }

  /** Locks the assignment row and reads it with the visibility rule; an unknown or invisible assignment is 404. */
  private async lockAssignment(tx: Tx, id: string, caller: AuthPrincipal, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<AssignmentRow> {
    const locked =
      mode === 'UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM assignments WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM assignments WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw assignmentsError.assignmentNotFound(id);
    const row = await tx.assignment.findFirst({ where: { AND: [{ id }, visibleAssignmentsWhere(caller)] }, select: ASSIGNMENT_SELECT });
    if (!row) throw assignmentsError.assignmentNotFound(id);
    return row;
  }

  private async assertLessonOfClass(tx: Tx, lessonId: string, classId: string): Promise<void> {
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { classId: true } });
    if (!lesson) throw assignmentsError.lessonNotFound(lessonId);
    if (lesson.classId !== classId) throw assignmentsError.lessonMismatch(lessonId, classId);
  }

  private async read(db: Db, id: string): Promise<AssignmentDto> {
    const row = await db.assignment.findUniqueOrThrow({ where: { id }, select: ASSIGNMENT_SELECT });
    const [dto] = await this.toDtos(db, [row]);
    return dto!;
  }

  /** The DTOs of a page: one grouped query for the submissions, one for the active enrollments, one read of the academy's zone. */
  private async toDtos(db: Db, rows: readonly AssignmentRow[]): Promise<AssignmentDto[]> {
    if (rows.length === 0) return [];
    const [counts, actives, timeZone] = await Promise.all([
      this.submissionCounts(db, rows.map((row) => row.id)),
      this.activeStudents(db, rows.map((row) => row.classId)),
      this.academyTimeZone(db),
    ]);
    return rows.map((row) => toAssignmentDto(row, counts[row.id] ?? EMPTY_COUNTS, actives[row.classId] ?? 0, timeZone));
  }

  /** The students' latest attempts by status, per assignment (one query over the page). */
  private async submissionCounts(db: Db, assignmentIds: readonly string[]): Promise<Record<string, SubmissionCountsDto>> {
    const ids = Prisma.join(assignmentIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await db.$queryRaw<{ assignmentId: string; status: SubmissionStatus; n: number }[]>`
      SELECT latest.assignment_id AS "assignmentId", latest.status::text AS status, count(*)::int AS n
        FROM (
          SELECT DISTINCT ON (assignment_id, student_user_id) assignment_id, status
            FROM assignment_submissions
           WHERE assignment_id IN (${ids})
           ORDER BY assignment_id, student_user_id, attempt_no DESC
        ) AS latest
       GROUP BY latest.assignment_id, latest.status`;
    const counts: Record<string, SubmissionCountsDto> = {};
    for (const row of rows) {
      const entry = (counts[row.assignmentId] ??= { ...EMPTY_COUNTS });
      entry[row.status] += row.n;
      entry.students += row.n;
    }
    return counts;
  }

  /** Active enrollments per class (the «total» of «submitted / total»). */
  private async activeStudents(db: Db, classIds: readonly string[]): Promise<Record<string, number>> {
    const grouped = await db.enrollment.groupBy({ by: ['classId'], where: { classId: { in: [...new Set(classIds)] }, status: 'active' }, _count: { _all: true } });
    return Object.fromEntries(grouped.map((group) => [group.classId, group._count._all]));
  }

  /** The academy's time zone for `timeZone` (D-R41); UTC while the academy row is missing. */
  private async academyTimeZone(db: Db): Promise<string> {
    const academy = await db.academy.findFirst({ select: { timezone: true } });
    return academy?.timezone ?? FALLBACK_TIME_ZONE;
  }
}
