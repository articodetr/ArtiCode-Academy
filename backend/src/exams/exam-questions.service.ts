import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ExamStatus } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { visibleQuestionsWhere } from '../questions/questions.policy.js';
import { questionProblems } from '../questions/questions.rules.js';
import type { QuestionStatusValue } from '../questions/questions.rules.js';
import type { ExamQuestionItemDto, ExamQuestionsDto, ReplaceExamQuestionsDto } from './exam-questions.dto.js';
import { EXAMS_ENTITY_TYPE } from './exams.audit.js';
import type { ExamOnlineSummaryDto } from './exams.dto.js';
import { buildSnapshot, duplicateQuestionIds, examReadiness, planExamQuestions, readSnapshot, sumPoints } from './exams.online.js';
import type { ExamDeliveryValue, ExamReadiness, LinkedQuestionState, QuestionSnapshot } from './exams.online.js';
import { isClassFrozenForExams, visibleExamsWhere } from './exams.policy.js';

/** The one audit event of the question set (12.4): recorded on the exam when a replacement changes something. */
export const EXAM_QUESTIONS_AUDIT_ACTION = 'exams.questions.changed';

export const EXAM_QUESTION_LINK_SELECT = {
  id: true,
  examId: true,
  sortOrder: true,
  points: true,
  questionId: true,
  snapshot: true,
  question: {
    select: {
      status: true,
      type: true,
      prompt: true,
      explanation: true,
      correctBoolean: true,
      bank: { select: { id: true, name: true } },
      options: { orderBy: { sortOrder: 'asc' }, select: { id: true, text: true, isCorrect: true } },
    },
  },
} satisfies Prisma.ExamQuestionSelect;

const QUESTIONS_EXAM_SELECT = {
  id: true,
  classId: true,
  status: true,
  delivery: true,
  scheduledAt: true,
  closesAt: true,
  durationMinutes: true,
  maxScore: true,
  class: { select: { code: true, status: true } },
} satisfies Prisma.ExamSelect;

const LINK_SELECT = EXAM_QUESTION_LINK_SELECT;
export type ExamQuestionLinkRow = Prisma.ExamQuestionGetPayload<{ select: typeof EXAM_QUESTION_LINK_SELECT }>;
type LinkRow = ExamQuestionLinkRow;
type QuestionsExam = Prisma.ExamGetPayload<{ select: typeof QUESTIONS_EXAM_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

/** What `summaries()` and `freeze()` need to know about an exam. */
export interface OnlineExamState {
  id: string;
  status: ExamStatus;
  delivery: ExamDeliveryValue;
  scheduledAt: Date | null;
  closesAt: Date | null;
  durationMinutes: number | null;
  maxScore: Prisma.Decimal;
}

/**
 * A bank question counts as ready for an exam only when it is marked `ready`
 * AND still passes the rules of its type — the status alone is never trusted
 * when a copy is about to be frozen.
 */
function effectiveStatus(question: LinkRow['question']): QuestionStatusValue {
  if (question.status !== 'ready') return question.status;
  const problems = questionProblems({
    type: question.type,
    status: 'ready',
    options: question.options.map((option) => ({ text: readLocalizedText(option.text) ?? { ar: '' }, isCorrect: option.isCorrect })),
    correctAnswer: question.correctBoolean,
  });
  return problems.length === 0 ? 'ready' : 'draft';
}

function linkedState(link: LinkRow): LinkedQuestionState {
  return { questionId: link.questionId, status: effectiveStatus(link.question), points: link.points.toFixed(2) };
}

function readinessOf(exam: OnlineExamState, links: readonly LinkRow[], now: Date): ExamReadiness {
  return examReadiness({
    scheduledAt: exam.scheduledAt,
    closesAt: exam.closesAt,
    durationMinutes: exam.durationMinutes,
    maxScore: exam.maxScore.toFixed(2),
    questions: links.map(linkedState),
    now,
  });
}

/** A linked question as the teacher sees it, with its key: the frozen copy once the exam is scheduled, the bank's content before. */
export function toExamQuestionItem(link: ExamQuestionLinkRow): ExamQuestionItemDto {
  const frozen = readSnapshot(link.snapshot);
  const content: QuestionSnapshot = frozen ?? buildSnapshot(link.question);
  return {
    id: link.id,
    sortOrder: link.sortOrder,
    points: Number(link.points),
    questionId: link.questionId,
    bank: { id: link.question.bank.id, name: readLocalizedText(link.question.bank.name) ?? { ar: '' } },
    question: {
      type: content.type,
      prompt: content.prompt,
      explanation: content.explanation,
      options: content.options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect })),
      correctAnswer: content.correctBoolean,
      status: frozen ? null : link.question.status,
    },
    // Who, when and why — the previous keys stay in the stored copy.
    corrections: (frozen?.corrections ?? []).map((correction) => ({ at: correction.at, byUserId: correction.byUserId, reason: correction.reason })),
  };
}

/**
 * MOD-09 phase 2 — the questions of an online exam (roadmap §4r.6 API-270 `GET`
 * and API-271 `PUT /api/exams/:id/questions`; decisions D-R158/D-R159), and
 * what ExamsService needs from them: the online summary of an exam, the freeze
 * at `schedule`, the thaw at `unschedule`.
 *
 * Reading needs `exams.read` through the exam's class visibility (D-R16 — an
 * invisible exam is 404) and answers the questions WITH their key: students
 * hold `exams.read` but are assigned to no class, so nothing here reaches
 * them. Replacing the set needs `exams.manage` and `questions.manage`, an
 * online draft of a class that is not cancelled, and only `ready` questions of
 * banks the caller sees; the request is the whole ordered list, planned as a
 * diff under the exam-row lock (`FOR NO KEY UPDATE`) and written in one
 * transaction with exactly one `exams.questions.changed` event — an identical
 * list writes and records nothing.
 *
 * `freeze()` runs inside the `schedule` transaction: it refuses an exam that
 * is not ready (`exam_not_ready`) and otherwise writes a full copy of every
 * linked question into `exam_questions.snapshot`. From then on the attempts
 * are served and graded from the copy alone, so a later edit of the bank
 * never changes this exam.
 */
@Injectable()
export class ExamQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(examId: string, caller: AuthPrincipal): Promise<ExamQuestionsDto> {
    const exam = await this.prisma.db.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: QUESTIONS_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    return this.build(this.prisma.db, exam, new Date());
  }

  async replace(examId: string, input: ReplaceExamQuestionsDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ExamQuestionsDto> {
    const ids = input.questions.map((entry) => entry.questionId);
    const duplicates = duplicateQuestionIds(ids);
    if (duplicates.length > 0) throw gradesError.examQuestionsInvalid(duplicates);

    return this.prisma.db.$transaction(async (tx) => {
      const exam = await this.lockExam(tx, examId, caller);
      if (exam.delivery !== 'online') throw gradesError.examNotOnline(examId);
      if (isClassFrozenForExams(exam.class.status)) throw gradesError.classClosed(exam.classId, exam.class.status);
      if (exam.status !== 'draft') throw gradesError.examQuestionsLocked(exam.status);

      if (ids.length > 0) {
        // The banks, then the questions, `FOR KEY SHARE` in id order: deleting one of them (or its bank) waits for this
        // link and is then refused as «in use», or wins first and the question is simply not found below — never a
        // foreign-key error half-way. An edit of the question takes `FOR NO KEY UPDATE` and is not held up.
        await tx.$queryRaw`SELECT id FROM question_banks WHERE id IN (SELECT bank_id FROM questions WHERE id = ANY(${ids}::uuid[])) ORDER BY id FOR KEY SHARE`;
        await tx.$queryRaw`SELECT id FROM questions WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR KEY SHARE`;
      }
      const questions = ids.length === 0 ? [] : await tx.question.findMany({ where: { AND: [{ id: { in: ids } }, visibleQuestionsWhere(caller)] }, select: { id: true, status: true, points: true } });
      const byId = new Map(questions.map((question) => [question.id, question]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) throw gradesError.questionNotFound(missing);
      const notReady = ids.filter((id) => byId.get(id)!.status !== 'ready');
      if (notReady.length > 0) throw gradesError.questionNotReady(notReady);

      const requested = input.questions.map((entry) => ({ questionId: entry.questionId, points: (entry.points === undefined ? byId.get(entry.questionId)!.points : new Prisma.Decimal(entry.points)).toFixed(2) }));
      const current = await tx.examQuestion.findMany({ where: { examId }, orderBy: { sortOrder: 'asc' }, select: { questionId: true, points: true } });
      const plan = planExamQuestions(
        current.map((row) => ({ questionId: row.questionId, points: row.points.toFixed(2) })),
        requested,
      );
      if (!plan.changed) return this.build(tx, exam, new Date());

      // No attempt exists for a draft, so nothing refers to the links: the set is rewritten whole.
      await tx.examQuestion.deleteMany({ where: { examId } });
      if (requested.length > 0) {
        await tx.examQuestion.createMany({ data: requested.map((entry, index) => ({ examId, questionId: entry.questionId, sortOrder: index, points: entry.points })) });
      }
      await this.audit.record(
        {
          action: EXAM_QUESTIONS_AUDIT_ACTION,
          actorUserId: caller.id,
          entityType: EXAMS_ENTITY_TYPE,
          entityId: examId,
          metadata: {
            classId: exam.classId,
            code: exam.class.code,
            added: plan.added.length,
            removed: plan.removed.length,
            repointed: plan.repointed.length,
            reordered: plan.reordered,
            count: requested.length,
            totalPoints: Number(sumPoints(requested.map((entry) => entry.points))),
          },
          ...ctx,
        },
        tx,
      );
      return this.build(tx, exam, new Date());
    });
  }

  // ---------------------------------------------------------------------------
  // For ExamsService
  // ---------------------------------------------------------------------------

  /** The online summary of each online exam of a page (two grouped reads for the questions, two for the attempts). */
  async summaries(db: Db, exams: readonly OnlineExamState[], now: Date): Promise<Map<string, ExamOnlineSummaryDto>> {
    const online = exams.filter((exam) => exam.delivery === 'online');
    const result = new Map<string, ExamOnlineSummaryDto>();
    if (online.length === 0) return result;
    const examIds = online.map((exam) => exam.id);
    const links = await db.examQuestion.findMany({ where: { examId: { in: examIds } }, orderBy: [{ examId: 'asc' }, { sortOrder: 'asc' }], select: LINK_SELECT });
    const linksByExam = new Map<string, LinkRow[]>();
    for (const link of links) {
      const list = linksByExam.get(link.examId) ?? [];
      list.push(link);
      linksByExam.set(link.examId, list);
    }
    const byStatus = await db.examAttempt.groupBy({ by: ['examId', 'status'], where: { examId: { in: examIds } }, _count: { _all: true } });
    const byStudent = await db.examAttempt.groupBy({ by: ['examId', 'studentUserId'], where: { examId: { in: examIds } } });
    for (const exam of online) {
      const examLinks = linksByExam.get(exam.id) ?? [];
      const readiness = readinessOf(exam, examLinks, now);
      const attempts = { students: 0, inProgress: 0, finished: 0 };
      for (const group of byStatus) {
        if (group.examId !== exam.id) continue;
        if (group.status === 'in_progress') attempts.inProgress += group._count._all;
        else attempts.finished += group._count._all;
      }
      attempts.students = byStudent.filter((group) => group.examId === exam.id).length;
      result.set(exam.id, {
        questionCount: examLinks.length,
        totalPoints: Number(readiness.totalPoints),
        frozen: exam.status !== 'draft',
        problems: exam.status === 'draft' ? readiness.problems : [],
        attempts,
      });
    }
    return result;
  }

  /** `schedule` of an online exam: refuses one that is not ready, then freezes a full copy of every linked question (D-R158). */
  async freeze(tx: Tx, exam: OnlineExamState, now: Date): Promise<void> {
    const links = await tx.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { sortOrder: 'asc' }, select: LINK_SELECT });
    const readiness = readinessOf(exam, links, now);
    if (readiness.problems.length > 0) throw gradesError.examNotReady(readiness.problems, Number(readiness.totalPoints), Number(exam.maxScore), readiness.notReady);
    for (const link of links) {
      await tx.examQuestion.update({ where: { id: link.id }, data: { snapshot: buildSnapshot(link.question) as unknown as Prisma.InputJsonValue }, select: { id: true } });
    }
  }

  /** `unschedule` (only without attempts — the caller checks): the exam follows its bank questions again. */
  async thaw(tx: Tx, examId: string): Promise<void> {
    await tx.examQuestion.updateMany({ where: { examId }, data: { snapshot: Prisma.DbNull } });
  }

  /** An online draft turned manual drops its links; the count goes into the audit event of that PATCH. */
  async unlinkAll(tx: Tx, examId: string): Promise<number> {
    const { count } = await tx.examQuestion.deleteMany({ where: { examId } });
    return count;
  }

  // ---------------------------------------------------------------------------

  /** Locks the exam row (the T03 lock) and reads it with the visibility rule; an unknown or invisible exam is 404. */
  private async lockExam(tx: Tx, examId: string, caller: AuthPrincipal): Promise<QuestionsExam> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${examId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw gradesError.examNotFound(examId);
    const exam = await tx.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: QUESTIONS_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    return exam;
  }

  private async build(db: Db, exam: QuestionsExam, now: Date): Promise<ExamQuestionsDto> {
    const links = await db.examQuestion.findMany({ where: { examId: exam.id }, orderBy: { sortOrder: 'asc' }, select: LINK_SELECT });
    const readiness = readinessOf(exam, links, now);
    const draft = exam.status === 'draft';
    return {
      examId: exam.id,
      examStatus: exam.status,
      delivery: exam.delivery,
      frozen: !draft,
      editable: draft && exam.delivery === 'online' && !isClassFrozenForExams(exam.class.status),
      maxScore: Number(exam.maxScore),
      totalPoints: Number(readiness.totalPoints),
      problems: draft && exam.delivery === 'online' ? readiness.problems : [],
      items: links.map(toExamQuestionItem),
    };
  }
}
