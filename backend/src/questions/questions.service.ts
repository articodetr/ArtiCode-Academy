import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { BANK_SORT_FIELD } from './question-banks.service.js';
import { QUESTIONS_PAGE_DEFAULT, toStoredText } from './questions.dto.js';
import type { CreateQuestionDto, ListQuestionsQueryDto, QuestionDto, QuestionListDto, QuestionOptionInputDto, UpdateQuestionDto } from './questions.dto.js';
import { questionsError } from './questions.errors.js';
import { visibleBanksWhere, visibleQuestionsWhere } from './questions.policy.js';
import { normalizeTags, planQuestionUpdate, pointsText, questionProblems } from './questions.rules.js';
import type { OptionContent, QuestionPatch, QuestionValues } from './questions.rules.js';

export const QUESTIONS_AUDIT_ACTIONS = {
  created: 'questions.created',
  updated: 'questions.updated',
  deleted: 'questions.deleted',
} as const;

/** Audit `entity_type` of every question event. */
export const QUESTIONS_ENTITY_TYPE = 'questions';

export const QUESTION_SELECT = {
  id: true,
  bankId: true,
  type: true,
  status: true,
  prompt: true,
  explanation: true,
  points: true,
  correctBoolean: true,
  difficulty: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
  options: { orderBy: { sortOrder: 'asc' }, select: { id: true, text: true, isCorrect: true } },
} satisfies Prisma.QuestionSelect;

export type QuestionRow = Prisma.QuestionGetPayload<{ select: typeof QUESTION_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

function optionsOf(row: QuestionRow): OptionContent[] {
  return row.options.map((option) => ({ text: readLocalizedText(option.text) ?? { ar: '' }, isCorrect: option.isCorrect }));
}

function valuesOf(row: QuestionRow): QuestionValues {
  return {
    status: row.status,
    prompt: readLocalizedText(row.prompt) ?? { ar: '' },
    explanation: readLocalizedText(row.explanation),
    points: row.points.toFixed(2),
    difficulty: row.difficulty,
    tags: [...row.tags],
    options: optionsOf(row),
    correctAnswer: row.correctBoolean,
  };
}

function toQuestionDto(row: QuestionRow, examCount: number): QuestionDto {
  const options = optionsOf(row);
  return {
    id: row.id,
    bankId: row.bankId,
    type: row.type,
    status: row.status,
    prompt: readLocalizedText(row.prompt) ?? { ar: '' },
    explanation: readLocalizedText(row.explanation),
    points: Number(row.points),
    difficulty: row.difficulty,
    tags: [...row.tags],
    options: row.options.map((option, index) => ({ id: option.id, text: options[index]!.text, isCorrect: option.isCorrect })),
    correctAnswer: row.correctBoolean,
    missing: questionProblems({ type: row.type, status: 'ready', options, correctAnswer: row.correctBoolean }),
    examCount,
    createdBy: row.createdBy ? { userId: row.createdBy.id, fullName: row.createdBy.fullName } : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toOptions(input: readonly QuestionOptionInputDto[]): OptionContent[] {
  return input.map((option) => ({ text: toStoredText(option.text), isCorrect: option.isCorrect }));
}

/** `q` on the Arabic or English prompt: case-insensitive, with `%`, `_` and `\` matched literally (the rule of lessons/title-search.ts). */
function promptSearchWhere(q: string): Prisma.QuestionWhereInput {
  const pattern = escapeLikePattern(q);
  return { OR: (['ar', 'en'] as const).map((locale) => ({ prompt: { path: [locale], string_contains: pattern, mode: 'insensitive' as const } })) };
}

/**
 * MOD-09 phase 2 — the questions of the banks (roadmap §4r.6 API-265..API-269;
 * decisions D-R162..D-R164). Every route needs `questions.manage` and reaches
 * only the questions of the banks the caller sees (others are 404). A question
 * is written whole: its type is fixed, a `draft` may be incomplete, a `ready`
 * one passes every rule of its type before any write (`question_invalid`), and
 * its options are replaced as one ordered list — nothing refers to their ids,
 * an exam keeps its own frozen copy (D-R158), so editing or archiving a
 * question never changes an exam that is being taken or a result already
 * counted. A question an exam links is archived, never deleted
 * (`question_in_use`). Edits lock the question row (`FOR NO KEY UPDATE`), the
 * deletion locks it `FOR UPDATE`; every write is one transaction with exactly
 * one audit event, and an identical PATCH writes and records nothing.
 */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListQuestionsQueryDto, caller: AuthPrincipal): Promise<QuestionListDto> {
    const limit = query.limit ?? QUESTIONS_PAGE_DEFAULT;
    const filters: Prisma.QuestionWhereInput[] = [visibleQuestionsWhere(caller)];
    if (query.bankId) filters.push({ bankId: query.bankId });
    if (query.q) filters.push(promptSearchWhere(query.q));
    if (query.type) filters.push({ type: query.type });
    filters.push(query.status ? { status: query.status } : { status: { not: 'archived' } });
    if (query.difficulty) filters.push({ difficulty: query.difficulty });
    if (query.tag) {
      const [tag] = normalizeTags([query.tag]);
      if (tag) filters.push({ tags: { has: tag } });
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, BANK_SORT_FIELD, 'desc', false, () => questionsError.cursorInvalid());
      filters.push({ id: { lt: cursor.id } });
    }
    const rows = await this.prisma.db.question.findMany({ where: { AND: filters }, orderBy: { id: 'desc' }, take: limit + 1, select: QUESTION_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: BANK_SORT_FIELD, order: 'desc', key: null, id: last.id }) : null;
    return { items: await this.toDtos(this.prisma.db, page), nextCursor };
  }

  async get(id: string, caller: AuthPrincipal): Promise<QuestionDto> {
    const row = await this.prisma.db.question.findFirst({ where: { AND: [{ id }, visibleQuestionsWhere(caller)] }, select: QUESTION_SELECT });
    if (!row) throw questionsError.questionNotFound(id);
    const [dto] = await this.toDtos(this.prisma.db, [row]);
    return dto!;
  }

  /** `POST /api/question-banks/:id/questions` — a draft or a ready question in a bank the caller sees (API-266). */
  async create(bankId: string, input: CreateQuestionDto, caller: AuthPrincipal, ctx: RequestContext): Promise<QuestionDto> {
    const status = input.status ?? 'draft';
    const options = toOptions(input.options ?? []);
    const correctAnswer = input.correctAnswer ?? null;
    const problems = questionProblems({ type: input.type, status, options, correctAnswer });
    if (problems.length > 0) throw questionsError.questionInvalid(problems);

    return this.prisma.db.$transaction(async (tx) => {
      // A key-share lock keeps the bank from being deleted between the check and the insert.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM question_banks WHERE id = ${bankId}::uuid FOR KEY SHARE`;
      if (locked.length === 0) throw questionsError.bankNotFound(bankId);
      const bank = await tx.questionBank.findFirst({ where: { AND: [{ id: bankId }, visibleBanksWhere(caller)] }, select: { id: true } });
      if (!bank) throw questionsError.bankNotFound(bankId);
      const created = await tx.question.create({
        data: {
          bankId,
          type: input.type,
          status,
          prompt: toStoredText(input.prompt) as Prisma.InputJsonValue,
          explanation: input.explanation === undefined || input.explanation === null ? Prisma.DbNull : (toStoredText(input.explanation) as Prisma.InputJsonValue),
          points: pointsText(input.points ?? 1),
          correctBoolean: correctAnswer,
          difficulty: input.difficulty ?? null,
          tags: normalizeTags(input.tags ?? []),
          createdById: caller.id,
          options: { create: options.map((option, index) => ({ text: option.text as Prisma.InputJsonValue, isCorrect: option.isCorrect, sortOrder: index })) },
        },
        select: { id: true },
      });
      await this.audit.record(
        { action: QUESTIONS_AUDIT_ACTIONS.created, actorUserId: caller.id, entityType: QUESTIONS_ENTITY_TYPE, entityId: created.id, metadata: { bankId, type: input.type, status }, ...ctx },
        tx,
      );
      return this.read(tx, created.id);
    });
  }

  async update(id: string, input: UpdateQuestionDto, caller: AuthPrincipal, ctx: RequestContext): Promise<QuestionDto> {
    const patch: QuestionPatch = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.prompt !== undefined) patch.prompt = toStoredText(input.prompt);
    if (input.explanation !== undefined) patch.explanation = input.explanation === null ? null : toStoredText(input.explanation);
    if (input.points !== undefined) patch.points = pointsText(input.points);
    if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
    if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
    if (input.options !== undefined) patch.options = toOptions(input.options);
    if (input.correctAnswer !== undefined) patch.correctAnswer = input.correctAnswer;
    if (Object.keys(patch).length === 0) throw questionsError.nothingToUpdate();

    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockQuestion(tx, id, caller, 'NO KEY UPDATE');
      const plan = planQuestionUpdate(valuesOf(row), patch);
      if (plan.fields.length === 0) return this.read(tx, id);
      const problems = questionProblems({ type: row.type, status: plan.next.status, options: plan.next.options, correctAnswer: plan.next.correctAnswer });
      if (problems.length > 0) throw questionsError.questionInvalid(problems);

      const data: Prisma.QuestionUncheckedUpdateInput = {};
      if (plan.data.status !== undefined) data.status = plan.data.status;
      if (plan.data.prompt !== undefined) data.prompt = plan.data.prompt as Prisma.InputJsonValue;
      if (plan.data.explanation !== undefined) data.explanation = plan.data.explanation === null ? Prisma.DbNull : (plan.data.explanation as Prisma.InputJsonValue);
      if (plan.data.points !== undefined) data.points = plan.data.points;
      if (plan.data.difficulty !== undefined) data.difficulty = plan.data.difficulty;
      if (plan.data.tags !== undefined) data.tags = plan.data.tags;
      if (plan.data.correctAnswer !== undefined) data.correctBoolean = plan.data.correctAnswer;
      if (plan.data.options !== undefined) {
        // The whole ordered list is replaced: nothing refers to an option's id.
        await tx.questionOption.deleteMany({ where: { questionId: id } });
        if (plan.data.options.length > 0) {
          await tx.questionOption.createMany({
            data: plan.data.options.map((option, index) => ({ questionId: id, text: option.text as Prisma.InputJsonValue, isCorrect: option.isCorrect, sortOrder: index })),
          });
        }
        // A change of the options alone still moves `updated_at`.
        data.updatedAt = new Date();
      }
      await tx.question.update({ where: { id }, data, select: { id: true } });
      await this.audit.record(
        { action: QUESTIONS_AUDIT_ACTIONS.updated, actorUserId: caller.id, entityType: QUESTIONS_ENTITY_TYPE, entityId: id, metadata: { bankId: row.bankId, fields: plan.fields }, ...ctx },
        tx,
      );
      return this.read(tx, id);
    });
  }

  /** Deletes a question no exam links; a linked one is archived instead (`question_in_use`). */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockQuestion(tx, id, caller, 'UPDATE');
      const examCount = await tx.examQuestion.count({ where: { questionId: id } });
      if (examCount > 0) throw questionsError.questionInUse(examCount);
      await tx.question.delete({ where: { id }, select: { id: true } });
      await this.audit.record(
        { action: QUESTIONS_AUDIT_ACTIONS.deleted, actorUserId: caller.id, entityType: QUESTIONS_ENTITY_TYPE, entityId: id, metadata: { bankId: row.bankId }, ...ctx },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------------------

  /** Locks the question row and reads it with the visibility rule; an unknown or invisible question is 404. */
  private async lockQuestion(tx: Tx, id: string, caller: AuthPrincipal, mode: 'NO KEY UPDATE' | 'UPDATE'): Promise<QuestionRow> {
    const locked =
      mode === 'UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM questions WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM questions WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw questionsError.questionNotFound(id);
    const row = await tx.question.findFirst({ where: { AND: [{ id }, visibleQuestionsWhere(caller)] }, select: QUESTION_SELECT });
    if (!row) throw questionsError.questionNotFound(id);
    return row;
  }

  private async read(db: Db, id: string): Promise<QuestionDto> {
    const row = await db.question.findUniqueOrThrow({ where: { id }, select: QUESTION_SELECT });
    const [dto] = await this.toDtos(db, [row]);
    return dto!;
  }

  /** The DTOs of a page with one grouped query for the exams that link each question. */
  private async toDtos(db: Db, rows: readonly QuestionRow[]): Promise<QuestionDto[]> {
    if (rows.length === 0) return [];
    const groups = await db.examQuestion.groupBy({ by: ['questionId'], where: { questionId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
    const examCounts = Object.fromEntries(groups.map((group) => [group.questionId, group._count._all]));
    return rows.map((row) => toQuestionDto(row, examCounts[row.id] ?? 0));
  }
}
