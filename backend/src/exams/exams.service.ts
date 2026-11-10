import { Injectable } from '@nestjs/common';
import { toDecimalText } from '../assignments/assignments.changes.js';
import { toInstructionsText } from '../assignments/assignments.dto.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { SortOrder } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { toInstant, toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { isEmptyExamPatch, passScoreProblem, planExamUpdate } from './exams.changes.js';
import type { ExamPatch, ExamValues } from './exams.changes.js';
import { EXAMS_PAGE_DEFAULT } from './exams.dto.js';
import type { ChangeExamStatusDto, CreateExamDto, ExamDto, ExamListDto, ExamResultCountsDto, ListExamsQueryDto, UpdateExamDto } from './exams.dto.js';
import { EXAM_SORT_FIELD, afterExamCursor, examCursorKey, examOrderBy } from './exams.keyset.js';
import { isClassFrozenForExams, isClassOpenForNewExam, seesEveryClass, visibleExamsWhere } from './exams.policy.js';
import { actionNeedsLiveClass, allowedExamActions, isExamDeletable, lockedExamFields, nextExamStatus } from './exams.status.js';

export const EXAMS_AUDIT_ACTIONS = {
  created: 'exams.created',
  updated: 'exams.updated',
  statusChanged: 'exams.status.changed',
  deleted: 'exams.deleted',
} as const;

/** Audit `entity_type` of every exam event. */
export const EXAMS_ENTITY_TYPE = 'exams';

/** The academy's time zone for `ExamDto.timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

export const EXAM_SELECT = {
  id: true,
  classId: true,
  lessonId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  scheduledAt: true,
  durationMinutes: true,
  maxScore: true,
  passScore: true,
  weight: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
  lesson: { select: { id: true, title: true, startsAt: true, room: { select: { branch: { select: { timezone: true } } } } } },
} satisfies Prisma.ExamSelect;

export type ExamRow = Prisma.ExamGetPayload<{ select: typeof EXAM_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

const EMPTY_COUNTS: ExamResultCountsDto = { students: 0, scored: 0, absent: 0, excused: 0 };

function decimalOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

function toExamDto(row: ExamRow, counts: ExamResultCountsDto, activeStudents: number, academyTimeZone: string): ExamDto {
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
    description: readLocalizedText(row.description),
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduledAt ? toIso(row.scheduledAt) : null,
    durationMinutes: row.durationMinutes,
    // D-R41: the linked lesson's room branch zone, else the academy's.
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
    maxScore: Number(row.maxScore),
    passScore: decimalOrNull(row.passScore),
    weight: decimalOrNull(row.weight),
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    results: counts,
    activeStudents,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: ExamRow): ExamValues {
  return {
    title: readLocalizedText(row.title) ?? { ar: '' },
    description: readLocalizedText(row.description),
    type: row.type,
    lessonId: row.lessonId,
    scheduledAt: row.scheduledAt ? toIso(row.scheduledAt) : null,
    durationMinutes: row.durationMinutes,
    maxScore: toDecimalText(row.maxScore.toString())!,
    passScore: toDecimalText(row.passScore === null ? null : row.passScore.toString()),
    weight: toDecimalText(row.weight === null ? null : row.weight.toString()),
  };
}

function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toUpdateInput(data: ExamPatch): Prisma.ExamUncheckedUpdateInput {
  const input: Prisma.ExamUncheckedUpdateInput = {};
  if (data.title !== undefined) input.title = data.title as Prisma.InputJsonValue;
  if (data.description !== undefined) input.description = jsonOrDbNull(data.description);
  if (data.type !== undefined) input.type = data.type;
  if (data.lessonId !== undefined) input.lessonId = data.lessonId;
  if (data.scheduledAt !== undefined) input.scheduledAt = data.scheduledAt === null ? null : toInstant(data.scheduledAt);
  if (data.durationMinutes !== undefined) input.durationMinutes = data.durationMinutes;
  if (data.maxScore !== undefined) input.maxScore = data.maxScore;
  if (data.passScore !== undefined) input.passScore = data.passScore;
  if (data.weight !== undefined) input.weight = data.weight;
  return input;
}

/**
 * MOD-09-T03 — exams whose results a teacher records (roadmap §4h.4
 * API-113..API-118; owner decisions D-R42/D-R47). Visibility follows D-R16
 * through the class (`classes.manage` sees every class's exams, anyone else
 * those of the classes they teach — others are 404); writing needs
 * `exams.manage` and the same visibility. An exam is created as a draft for a
 * planned, open or running class, optionally held in one of its lessons; its
 * status moves through manual actions; `maxScore` is locked once a result
 * exists; an exam of a cancelled class is frozen. Creation locks the class row
 * (`FOR NO KEY UPDATE`, the MOD-05 lock), edits and actions lock the exam row,
 * deletion locks it `FOR UPDATE` (so a results batch of T04, which locks the
 * row too, serialises with all of them). Every write is one transaction with
 * exactly one audit event; an identical PATCH writes and records nothing.
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListExamsQueryDto, caller: AuthPrincipal): Promise<ExamListDto> {
    const order: SortOrder = query.order ?? 'asc';
    const limit = query.limit ?? EXAMS_PAGE_DEFAULT;
    const filters: Prisma.ExamWhereInput[] = [visibleExamsWhere(caller)];
    if (query.classId) filters.push({ classId: query.classId });
    if (query.lessonId) filters.push({ lessonId: query.lessonId });
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (query.from) filters.push({ scheduledAt: { gte: toInstant(query.from) } });
    if (query.to) filters.push({ scheduledAt: { lte: toInstant(query.to) } });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, EXAM_SORT_FIELD, order, true, () => gradesError.cursorInvalid());
      const after = afterExamCursor(cursor.key as string, cursor.id, order);
      if (after === null) throw gradesError.cursorInvalid();
      filters.push(after);
    }
    const rows = await this.prisma.db.exam.findMany({ where: { AND: filters }, orderBy: examOrderBy(order), take: limit + 1, select: EXAM_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: EXAM_SORT_FIELD, order, key: examCursorKey(last.scheduledAt), id: last.id }) : null;
    return { items: await this.toDtos(this.prisma.db, page), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<ExamDto> {
    const row = await this.prisma.db.exam.findFirst({ where: { AND: [{ id }, visibleExamsWhere(caller)] }, select: EXAM_SELECT });
    if (!row) throw gradesError.examNotFound(id);
    const [dto] = await this.toDtos(this.prisma.db, [row]);
    return dto!;
  }

  /** `POST /api/classes/:id/exams` — a draft for a planned, open or running class (API-115). */
  async create(classId: string, input: CreateExamDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ExamDto> {
    const passScore = input.passScore ?? null;
    if (passScore !== null && passScore > input.maxScore) throw gradesError.passScoreInvalid(passScore, input.maxScore);
    return this.prisma.db.$transaction(async (tx) => {
      const klass = await this.lockClass(tx, classId, caller);
      if (!isClassOpenForNewExam(klass.status)) throw gradesError.classClosed(classId, klass.status);
      const lessonId = input.lessonId ?? null;
      if (lessonId !== null) await this.assertLessonOfClass(tx, lessonId, classId);
      const created = await tx.exam.create({
        data: {
          classId,
          lessonId,
          createdById: caller.id,
          title: toLocalizedText(input.title) as Prisma.InputJsonValue,
          description: input.description === undefined || input.description === null ? Prisma.DbNull : (toInstructionsText(input.description) as Prisma.InputJsonValue),
          type: input.type,
          scheduledAt: input.scheduledAt === undefined || input.scheduledAt === null ? null : toInstant(input.scheduledAt),
          durationMinutes: input.durationMinutes ?? null,
          maxScore: toDecimalText(input.maxScore)!,
          passScore: toDecimalText(passScore),
          weight: toDecimalText(input.weight ?? null),
        },
        select: { id: true },
      });
      await this.audit.record(
        { action: EXAMS_AUDIT_ACTIONS.created, actorUserId: caller.id, entityType: EXAMS_ENTITY_TYPE, entityId: created.id, metadata: { classId, code: klass.code, type: input.type }, ...ctx },
        tx,
      );
      return this.read(tx, created.id);
    });
  }

  async update(id: string, input: UpdateExamDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ExamDto> {
    if (isEmptyExamPatch(input)) throw gradesError.nothingToUpdate();
    const patch: ExamPatch = {};
    if (input.title !== undefined) patch.title = toLocalizedText(input.title);
    if (input.description !== undefined) patch.description = input.description === null ? null : toInstructionsText(input.description);
    if (input.type !== undefined) patch.type = input.type;
    if (input.lessonId !== undefined) patch.lessonId = input.lessonId;
    if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt === null ? null : toIso(toInstant(input.scheduledAt));
    if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes;
    if (input.maxScore !== undefined) patch.maxScore = toDecimalText(input.maxScore)!;
    if (input.passScore !== undefined) patch.passScore = toDecimalText(input.passScore);
    if (input.weight !== undefined) patch.weight = toDecimalText(input.weight);

    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockExam(tx, id, caller, 'NO KEY UPDATE');
      const current = valuesOf(row);
      const plan = planExamUpdate(current, patch);
      if (plan.fields.length === 0) return this.read(tx, id);
      if (isClassFrozenForExams(row.class.status)) throw gradesError.classClosed(row.classId, row.class.status);
      const resultCount = await tx.examResult.count({ where: { examId: id } });
      const locked = lockedExamFields(resultCount, plan.fields);
      if (locked.length > 0) throw gradesError.examLocked(row.status, locked, resultCount);
      const pass = passScoreProblem(current, plan.data);
      if (pass !== null) throw gradesError.passScoreInvalid(pass.passScore, pass.maxScore);
      if (typeof plan.data.lessonId === 'string') await this.assertLessonOfClass(tx, plan.data.lessonId, row.classId);
      await tx.exam.update({ where: { id }, data: toUpdateInput(plan.data), select: { id: true } });
      await this.audit.record(
        { action: EXAMS_AUDIT_ACTIONS.updated, actorUserId: caller.id, entityType: EXAMS_ENTITY_TYPE, entityId: id, metadata: { classId: row.classId, code: row.class.code, fields: plan.fields }, ...ctx },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** schedule / unschedule / publish / unpublish (exams.status.ts). */
  async changeStatus(id: string, input: ChangeExamStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ExamDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockExam(tx, id, caller, 'NO KEY UPDATE');
      if (actionNeedsLiveClass(input.action) && isClassFrozenForExams(row.class.status)) throw gradesError.classClosed(row.classId, row.class.status);
      const to = nextExamStatus(input.action, row.status);
      if (to === null) throw gradesError.invalidTransition(row.status, input.action, allowedExamActions(row.status));
      if (input.action === 'unschedule') {
        const resultCount = await tx.examResult.count({ where: { examId: id } });
        if (resultCount > 0) throw gradesError.examHasResults(input.action, resultCount);
      }
      const data: Prisma.ExamUncheckedUpdateInput = { status: to };
      if (input.action === 'publish') data.publishedAt = new Date();
      if (input.action === 'unpublish') data.publishedAt = null;
      await tx.exam.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(
        {
          action: EXAMS_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: EXAMS_ENTITY_TYPE,
          entityId: id,
          metadata: { classId: row.classId, code: row.class.code, action: input.action, from: row.status, to, ...(input.reason !== undefined ? { reason: input.reason } : {}) },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** Deletes a draft or scheduled exam without any result (whatever the class status); anything else is 409 exam_not_deletable. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockExam(tx, id, caller, 'UPDATE');
      const resultCount = await tx.examResult.count({ where: { examId: id } });
      if (!isExamDeletable(row.status, resultCount)) throw gradesError.examNotDeletable(row.status, resultCount);
      await tx.exam.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        { action: EXAMS_AUDIT_ACTIONS.deleted, actorUserId: caller.id, entityType: EXAMS_ENTITY_TYPE, entityId: id, metadata: { classId: row.classId, code: row.class.code }, ...ctx },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------

  /** Locks the class row (the MOD-05 lock) and applies the visibility rule; an unknown or invisible class is 404. */
  private async lockClass(tx: Tx, classId: string, caller: AuthPrincipal): Promise<{ code: string; status: ClassStatus }> {
    const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`
      SELECT code, status FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
    const klass = locked[0];
    if (!klass) throw gradesError.classNotFound(classId);
    if (!seesEveryClass(caller)) {
      const assigned = await tx.classTeacher.findFirst({ where: { classId, teacherUserId: caller.id }, select: { classId: true } });
      if (!assigned) throw gradesError.classNotFound(classId);
    }
    return klass;
  }

  /** Locks the exam row and reads it with the visibility rule; an unknown or invisible exam is 404. */
  private async lockExam(tx: Tx, id: string, caller: AuthPrincipal, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<ExamRow> {
    const locked =
      mode === 'UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw gradesError.examNotFound(id);
    const row = await tx.exam.findFirst({ where: { AND: [{ id }, visibleExamsWhere(caller)] }, select: EXAM_SELECT });
    if (!row) throw gradesError.examNotFound(id);
    return row;
  }

  private async assertLessonOfClass(tx: Tx, lessonId: string, classId: string): Promise<void> {
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { classId: true } });
    if (!lesson) throw gradesError.lessonNotFound(lessonId);
    if (lesson.classId !== classId) throw gradesError.lessonMismatch(lessonId, classId);
  }

  private async read(db: Db, id: string): Promise<ExamDto> {
    const row = await db.exam.findUniqueOrThrow({ where: { id }, select: EXAM_SELECT });
    const [dto] = await this.toDtos(db, [row]);
    return dto!;
  }

  /** The DTOs of a page: one grouped query for the results, one for the active enrollments, one read of the academy's zone (sequential — `db` may be a transaction). */
  private async toDtos(db: Db, rows: readonly ExamRow[]): Promise<ExamDto[]> {
    if (rows.length === 0) return [];
    const results = await db.examResult.groupBy({ by: ['examId', 'status'], where: { examId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
    const counts: Record<string, ExamResultCountsDto> = {};
    for (const group of results) {
      const entry = (counts[group.examId] ??= { ...EMPTY_COUNTS });
      entry[group.status] += group._count._all;
      entry.students += group._count._all;
    }
    const actives = await db.enrollment.groupBy({ by: ['classId'], where: { classId: { in: [...new Set(rows.map((row) => row.classId))] }, status: 'active' }, _count: { _all: true } });
    const active = Object.fromEntries(actives.map((group) => [group.classId, group._count._all]));
    const academy = await db.academy.findFirst({ select: { timezone: true } });
    const timeZone = academy?.timezone ?? FALLBACK_TIME_ZONE;
    return rows.map((row) => toExamDto(row, counts[row.id] ?? EMPTY_COUNTS, active[row.classId] ?? 0, timeZone));
  }
}
