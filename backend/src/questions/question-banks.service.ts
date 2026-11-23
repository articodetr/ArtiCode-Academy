import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { NO_COURSE_FILTER, QUESTIONS_PAGE_DEFAULT, toStoredText } from './questions.dto.js';
import type { CreateQuestionBankDto, ListQuestionBanksQueryDto, QuestionBankDto, QuestionBankListDto, UpdateQuestionBankDto } from './questions.dto.js';
import { questionsError } from './questions.errors.js';
import { fileableCoursesWhere, visibleBanksWhere } from './questions.policy.js';
import { planBankUpdate } from './questions.rules.js';
import type { BankPatch, BankValues } from './questions.rules.js';

export const QUESTION_BANKS_AUDIT_ACTIONS = {
  created: 'question_banks.created',
  updated: 'question_banks.updated',
  deleted: 'question_banks.deleted',
} as const;

/** Audit `entity_type` of every bank event. */
export const QUESTION_BANKS_ENTITY_TYPE = 'question_banks';
/** Sort name of the bank and question cursors: creation order, newest first (the UUIDv7 id). */
export const BANK_SORT_FIELD = 'id';

const BANK_SELECT = {
  id: true,
  name: true,
  description: true,
  courseId: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.QuestionBankSelect;

type BankRow = Prisma.QuestionBankGetPayload<{ select: typeof BANK_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

interface BankCounts {
  questionCount: number;
  readyCount: number;
}

function toBankDto(row: BankRow, counts: BankCounts): QuestionBankDto {
  return {
    id: row.id,
    name: readLocalizedText(row.name) ?? { ar: '' },
    description: readLocalizedText(row.description),
    course: row.course ? { id: row.course.id, code: row.course.code, name: readLocalizedText(row.course.name) ?? { ar: row.course.code } } : null,
    createdBy: row.createdBy ? { userId: row.createdBy.id, fullName: row.createdBy.fullName } : null,
    questionCount: counts.questionCount,
    readyCount: counts.readyCount,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: BankRow): BankValues {
  return { name: readLocalizedText(row.name) ?? { ar: '' }, description: readLocalizedText(row.description), courseId: row.courseId };
}

/** `q` on the Arabic or English name: case-insensitive, with `%`, `_` and `\` matched literally (the rule of lessons/title-search.ts). */
function nameSearchWhere(q: string): Prisma.QuestionBankWhereInput {
  const pattern = escapeLikePattern(q);
  return { OR: (['ar', 'en'] as const).map((locale) => ({ name: { path: [locale], string_contains: pattern, mode: 'insensitive' as const } })) };
}

/**
 * MOD-09 phase 2 — question banks (roadmap §4r.6 API-260..API-264; decision
 * D-R162). Every route needs `questions.manage`; a holder sees and writes the
 * banks they created and those filed under a course they teach a class of —
 * every bank with `classes.manage` — and anything else is 404. A bank is filed
 * under no course or under one the caller may file under (the same rule).
 * Edits lock the bank row (`FOR NO KEY UPDATE`), the deletion locks it `FOR
 * UPDATE` and is refused while an exam links any of its questions
 * (`question_bank_in_use`) — the foreign key would refuse it anyway; a bank
 * goes with its questions and their options. Every write is one transaction
 * with exactly one audit event; an identical PATCH writes and records nothing.
 */
@Injectable()
export class QuestionBanksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuestionBanksQueryDto, caller: AuthPrincipal): Promise<QuestionBankListDto> {
    const limit = query.limit ?? QUESTIONS_PAGE_DEFAULT;
    const filters: Prisma.QuestionBankWhereInput[] = [visibleBanksWhere(caller)];
    if (query.q) filters.push(nameSearchWhere(query.q));
    if (query.courseId === NO_COURSE_FILTER) filters.push({ courseId: null });
    else if (query.courseId) filters.push({ courseId: query.courseId });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, BANK_SORT_FIELD, 'desc', false, () => questionsError.cursorInvalid());
      filters.push({ id: { lt: cursor.id } });
    }
    const rows = await this.prisma.db.questionBank.findMany({ where: { AND: filters }, orderBy: { id: 'desc' }, take: limit + 1, select: BANK_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: BANK_SORT_FIELD, order: 'desc', key: null, id: last.id }) : null;
    return { items: await this.toDtos(this.prisma.db, page), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<QuestionBankDto> {
    const row = await this.prisma.db.questionBank.findFirst({ where: { AND: [{ id }, visibleBanksWhere(caller)] }, select: BANK_SELECT });
    if (!row) throw questionsError.bankNotFound(id);
    const [dto] = await this.toDtos(this.prisma.db, [row]);
    return dto!;
  }

  async create(input: CreateQuestionBankDto, caller: AuthPrincipal, ctx: RequestContext): Promise<QuestionBankDto> {
    const courseId = input.courseId ?? null;
    return this.prisma.db.$transaction(async (tx) => {
      if (courseId !== null) await this.assertFileableCourse(tx, courseId, caller);
      const created = await tx.questionBank.create({
        data: {
          name: toStoredText(input.name) as Prisma.InputJsonValue,
          description: input.description === undefined || input.description === null ? Prisma.DbNull : (toStoredText(input.description) as Prisma.InputJsonValue),
          courseId,
          createdById: caller.id,
        },
        select: { id: true },
      });
      await this.audit.record(
        { action: QUESTION_BANKS_AUDIT_ACTIONS.created, actorUserId: caller.id, entityType: QUESTION_BANKS_ENTITY_TYPE, entityId: created.id, metadata: { courseId }, ...ctx },
        tx,
      );
      return this.read(tx, created.id);
    });
  }

  async update(id: string, input: UpdateQuestionBankDto, caller: AuthPrincipal, ctx: RequestContext): Promise<QuestionBankDto> {
    if (input.name === undefined && input.description === undefined && input.courseId === undefined) throw questionsError.nothingToUpdate();
    const patch: BankPatch = {};
    if (input.name !== undefined) patch.name = toStoredText(input.name);
    if (input.description !== undefined) patch.description = input.description === null ? null : toStoredText(input.description);
    if (input.courseId !== undefined) patch.courseId = input.courseId;

    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockBank(tx, id, caller, 'NO KEY UPDATE');
      const plan = planBankUpdate(valuesOf(row), patch);
      if (plan.fields.length === 0) return this.read(tx, id);
      if (typeof plan.data.courseId === 'string') await this.assertFileableCourse(tx, plan.data.courseId, caller);
      const data: Prisma.QuestionBankUncheckedUpdateInput = {};
      if (plan.data.name !== undefined) data.name = plan.data.name as Prisma.InputJsonValue;
      if (plan.data.description !== undefined) data.description = plan.data.description === null ? Prisma.DbNull : (plan.data.description as Prisma.InputJsonValue);
      if (plan.data.courseId !== undefined) data.courseId = plan.data.courseId;
      await tx.questionBank.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(
        { action: QUESTION_BANKS_AUDIT_ACTIONS.updated, actorUserId: caller.id, entityType: QUESTION_BANKS_ENTITY_TYPE, entityId: id, metadata: { fields: plan.fields }, ...ctx },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** Deletes a bank with its questions and their options — unless an exam links one of them. */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.lockBank(tx, id, caller, 'UPDATE');
      const linkedQuestionCount = await tx.question.count({ where: { bankId: id, examQuestions: { some: {} } } });
      if (linkedQuestionCount > 0) throw questionsError.bankInUse(linkedQuestionCount);
      const questionCount = await tx.question.count({ where: { bankId: id } });
      await tx.questionBank.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        { action: QUESTION_BANKS_AUDIT_ACTIONS.deleted, actorUserId: caller.id, entityType: QUESTION_BANKS_ENTITY_TYPE, entityId: id, metadata: { questionCount }, ...ctx },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------

  /** Locks the bank row and reads it with the visibility rule; an unknown or invisible bank is 404. */
  private async lockBank(tx: Tx, id: string, caller: AuthPrincipal, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<BankRow> {
    const locked =
      mode === 'UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM question_banks WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM question_banks WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw questionsError.bankNotFound(id);
    const row = await tx.questionBank.findFirst({ where: { AND: [{ id }, visibleBanksWhere(caller)] }, select: BANK_SELECT });
    if (!row) throw questionsError.bankNotFound(id);
    return row;
  }

  /** A bank is filed under any course by a holder of `classes.manage`, else under a course the caller teaches. */
  private async assertFileableCourse(tx: Tx, courseId: string, caller: AuthPrincipal): Promise<void> {
    const course = await tx.course.findFirst({ where: { AND: [{ id: courseId }, fileableCoursesWhere(caller)] }, select: { id: true } });
    if (!course) throw questionsError.courseNotFound(courseId);
  }

  private async read(db: Db, id: string): Promise<QuestionBankDto> {
    const row = await db.questionBank.findUniqueOrThrow({ where: { id }, select: BANK_SELECT });
    const [dto] = await this.toDtos(db, [row]);
    return dto!;
  }

  /** The DTOs of a page with one grouped query for the question counts. */
  private async toDtos(db: Db, rows: readonly BankRow[]): Promise<QuestionBankDto[]> {
    if (rows.length === 0) return [];
    const groups = await db.question.groupBy({ by: ['bankId', 'status'], where: { bankId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
    const counts: Record<string, BankCounts> = {};
    for (const group of groups) {
      const entry = (counts[group.bankId] ??= { questionCount: 0, readyCount: 0 });
      entry.questionCount += group._count._all;
      if (group.status === 'ready') entry.readyCount += group._count._all;
    }
    return rows.map((row) => toBankDto(row, counts[row.id] ?? { questionCount: 0, readyCount: 0 }));
  }
}
