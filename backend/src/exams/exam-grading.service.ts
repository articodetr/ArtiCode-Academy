import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ATTEMPT_GRACE_MS } from './attempts.policy.js';
import { EXAM_ATTEMPTS_ENTITY_TYPE } from './exams.audit.js';
import { readSnapshot } from './exams.online.js';
import { countedAttempt, gradeAttempt } from './online-grading.js';
import type { AttemptGrade, GradableQuestion } from './online-grading.js';

export const EXAM_ATTEMPT_AUDIT_ACTIONS = {
  started: 'exams.attempt.started',
  submitted: 'exams.attempt.submitted',
  timedOut: 'exams.attempt.timed_out',
} as const;

/** How many overdue attempts one sweep transaction closes. */
export const SWEEP_BATCH = 25;

const ATTEMPT_SELECT = {
  id: true,
  examId: true,
  studentUserId: true,
  attemptNo: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  maxScore: true,
  questionCount: true,
  exam: { select: { classId: true } },
} satisfies Prisma.ExamAttemptSelect;

/** An attempt as the grading reads it: locked by the caller and still in progress. */
export type OpenAttempt = Prisma.ExamAttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>;
export { ATTEMPT_SELECT as GRADING_ATTEMPT_SELECT };

export type FinishedStatus = 'submitted' | 'timed_out';

export interface FinalizedAttempt {
  id: string;
  status: FinishedStatus;
  submittedAt: Date;
  /** `numeric(6,2)` text. */
  score: string;
  correctCount: number;
  /** True when the student's counted result was written or changed by this finish. */
  resultChanged: boolean;
}

export interface RegradeSummary {
  /** Finished attempts looked at. */
  attempts: number;
  /** Attempts whose score, correct count or per-answer grading changed. */
  changedAttempts: number;
  /** Students whose counted result changed. */
  changedResults: number;
}

type Tx = Prisma.TransactionClient;

/**
 * MOD-09 phase 2 — the grading of the attempts at an online exam (roadmap §4r;
 * decisions D-R153, D-R154, D-R160, D-R161). The only writer of an attempt's
 * result and of the `online` rows of `exam_results`; it depends on no other
 * exam service, so the status actions, the learner's routes and the sweeper
 * all use it.
 *
 *   - `finish()` grades one attempt ONCE: the caller holds its row lock (`FOR
 *     UPDATE`) and has seen it in progress, so two submits, or a submit and
 *     the sweeper, can never grade it twice. It grades from the frozen copies
 *     alone (D-R158), writes each answer's grading and the attempt's result,
 *     then the student's counted result, in the caller's transaction, with
 *     exactly one audit event — `exams.attempt.submitted` by the student, or
 *     `exams.attempt.timed_out` with no actor when the server closes it.
 *   - The counted result is the highest finished attempt (D-R153), written to
 *     `exam_results` as a `scored` row with `source = online` (D-R160) — the
 *     gradebook, «my exams», «my grades», the reports and the certificates
 *     read it like a manual one. It replaces a manual row of that student; it
 *     is rewritten only when it really changes, so `updated_at` moves exactly
 *     when a final grade fixed earlier has to become stale.
 *   - An attempt whose time is over is closed with what was saved (D-R154):
 *     by `closeOverdueOf()` before a learner's own write, by
 *     `closeAllOpenOfExam()` when the results are published, and by `sweep()`
 *     — the in-process sweeper — even if the learner never comes back.
 *   - `regrade()` re-grades every finished attempt of an exam from the frozen
 *     copies as they are now (after a key correction — D-R161) under their row
 *     locks, and rewrites the counted results that change.
 *
 * Lock order, everywhere: the exam row (when a caller takes it) → attempt rows
 * in id order → `exam_results`.
 */
@Injectable()
export class ExamGradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Grades and closes an attempt the caller has locked and found in progress.
   * `actor` is the student who submits, or null when the server closes it.
   */
  async finish(tx: Tx, attempt: OpenAttempt, status: FinishedStatus, now: Date, actor: { userId: string; ctx: RequestContext } | null): Promise<FinalizedAttempt> {
    const questions = await this.questionsOf(tx, attempt.examId);
    const grade = await this.writeGrade(tx, attempt.id, questions, attempt.maxScore.toFixed(2));
    // The server's close is dated at the deadline itself: that is when the attempt ended.
    const submittedAt = status === 'timed_out' ? attempt.expiresAt : now;
    await tx.examAttempt.update({
      where: { id: attempt.id },
      data: { status, submittedAt, score: grade.score, correctCount: grade.correctCount, gradedAt: now },
      select: { id: true },
    });
    const resultChanged = await this.syncCountedResult(tx, attempt.examId, attempt.studentUserId);
    await this.audit.record(
      {
        action: status === 'submitted' ? EXAM_ATTEMPT_AUDIT_ACTIONS.submitted : EXAM_ATTEMPT_AUDIT_ACTIONS.timedOut,
        actorUserId: actor?.userId ?? null,
        entityType: EXAM_ATTEMPTS_ENTITY_TYPE,
        entityId: attempt.id,
        metadata: {
          examId: attempt.examId,
          classId: attempt.exam.classId,
          studentId: attempt.studentUserId,
          attemptNo: attempt.attemptNo,
          score: Number(grade.score),
          maxScore: Number(attempt.maxScore),
          correctCount: grade.correctCount,
          questionCount: attempt.questionCount,
          counted: resultChanged,
        },
        ...actor?.ctx,
      },
      tx,
    );
    return { id: attempt.id, status, submittedAt, score: grade.score, correctCount: grade.correctCount, resultChanged };
  }

  /**
   * Closes, in its own transaction, the student's attempts at this exam whose
   * time is over (deadline + the network allowance). Called before a learner's
   * own write so the close is kept even when that write is then refused.
   */
  async closeOverdueOf(examId: string, studentUserId: string, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ATTEMPT_GRACE_MS);
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM exam_attempts
         WHERE exam_id = ${examId}::uuid AND student_user_id = ${studentUserId}::uuid AND status = 'in_progress' AND expires_at <= ${cutoff}
         ORDER BY id FOR UPDATE`;
      return this.finishLocked(tx, locked, now);
    });
  }

  /**
   * Inside the `publish` transaction (the exam row is locked and its window
   * has closed, so every attempt's deadline has passed — a deadline never
   * lies beyond the closing): closes every attempt still in progress, waiting
   * for a submit that holds its row. Whatever its deadline says, no attempt
   * stays open once the results — and, where the exam reveals them, the
   * correct answers — are released.
   */
  async closeAllOpenOfExam(tx: Tx, examId: string, now: Date): Promise<number> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM exam_attempts WHERE exam_id = ${examId}::uuid AND status = 'in_progress' ORDER BY id FOR UPDATE`;
    return this.finishLocked(tx, locked, now);
  }

  /**
   * The sweeper (D-R154): closes attempts whose time is over, a batch per
   * transaction, skipping rows another process holds. `examIds` narrows it to
   * some exams — the e2e suites use it so a shared database is left alone.
   */
  async sweep(now: Date, options: { examIds?: readonly string[]; maxBatches?: number } = {}): Promise<number> {
    const cutoff = new Date(now.getTime() - ATTEMPT_GRACE_MS);
    const maxBatches = options.maxBatches ?? 40;
    let closed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const done = await this.prisma.db.$transaction(async (tx) => {
        const locked = options.examIds
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM exam_attempts
               WHERE status = 'in_progress' AND expires_at <= ${cutoff} AND exam_id = ANY(${[...options.examIds]}::uuid[])
               ORDER BY expires_at, id LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED`
          : await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM exam_attempts
               WHERE status = 'in_progress' AND expires_at <= ${cutoff}
               ORDER BY expires_at, id LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED`;
        return this.finishLocked(tx, locked, now);
      });
      closed += done;
      if (done < SWEEP_BATCH) break;
    }
    return closed;
  }

  /**
   * Locks every attempt of the exam, in id order, inside the caller's
   * transaction (which holds the exam row, so no attempt can start meanwhile).
   * A key correction takes it BEFORE it changes a frozen copy: a finish in
   * flight — which read the old key — commits first and is then graded again,
   * and a finish that comes later waits and reads the new key. Without it an
   * attempt finishing at that very moment could keep the old grading.
   */
  async lockAttemptsOf(tx: Tx, examId: string): Promise<number> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exam_attempts WHERE exam_id = ${examId}::uuid ORDER BY id FOR UPDATE`;
    return locked.length;
  }

  /**
   * Re-grades every finished attempt of the exam from its frozen questions as
   * they are now, inside the caller's transaction (which holds the exam row).
   * Only what really changes is written; `graded_at` moves with it.
   */
  async regrade(tx: Tx, examId: string, now: Date): Promise<RegradeSummary> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM exam_attempts WHERE exam_id = ${examId}::uuid AND status <> 'in_progress' ORDER BY id FOR UPDATE`;
    const summary: RegradeSummary = { attempts: locked.length, changedAttempts: 0, changedResults: 0 };
    if (locked.length === 0) return summary;
    const questions = await this.questionsOf(tx, examId);
    const attempts = await tx.examAttempt.findMany({
      where: { id: { in: locked.map((row) => row.id) } },
      orderBy: { id: 'asc' },
      select: { id: true, studentUserId: true, score: true, maxScore: true, correctCount: true, answers: { select: { examQuestionId: true, response: true, isCorrect: true, pointsAwarded: true } } },
    });
    const students = new Set<string>();
    for (const attempt of attempts) {
      students.add(attempt.studentUserId);
      const grade = gradeAttempt(questions, new Map(attempt.answers.map((answer) => [answer.examQuestionId, answer.response])), attempt.maxScore.toFixed(2));
      const graded = new Map(grade.answers.map((answer) => [answer.examQuestionId, answer]));
      let changed = attempt.score === null || attempt.score.toFixed(2) !== grade.score || attempt.correctCount !== grade.correctCount;
      for (const answer of attempt.answers) {
        const next = graded.get(answer.examQuestionId);
        if (!next) continue;
        if (answer.isCorrect === next.isCorrect && answer.pointsAwarded !== null && answer.pointsAwarded.toFixed(2) === next.pointsAwarded) continue;
        changed = true;
        await tx.examAnswer.update({
          where: { attemptId_examQuestionId: { attemptId: attempt.id, examQuestionId: answer.examQuestionId } },
          data: { isCorrect: next.isCorrect, pointsAwarded: next.pointsAwarded },
          select: { attemptId: true },
        });
      }
      if (!changed) continue;
      summary.changedAttempts += 1;
      await tx.examAttempt.update({ where: { id: attempt.id }, data: { score: grade.score, correctCount: grade.correctCount, gradedAt: now }, select: { id: true } });
    }
    for (const studentUserId of [...students].sort()) {
      if (await this.syncCountedResult(tx, examId, studentUserId)) summary.changedResults += 1;
    }
    return summary;
  }

  // ---------------------------------------------------------------------------

  /** Closes the locked attempts as timed out, with no actor. */
  private async finishLocked(tx: Tx, locked: readonly { id: string }[], now: Date): Promise<number> {
    if (locked.length === 0) return 0;
    const attempts = await tx.examAttempt.findMany({ where: { id: { in: locked.map((row) => row.id) }, status: 'in_progress' }, orderBy: { id: 'asc' }, select: ATTEMPT_SELECT });
    for (const attempt of attempts) await this.finish(tx, attempt, 'timed_out', now, null);
    return attempts.length;
  }

  /** The frozen questions of the exam, in its order. A link without a readable copy (only a draft has none) is left out. */
  private async questionsOf(tx: Tx, examId: string): Promise<GradableQuestion[]> {
    const links = await tx.examQuestion.findMany({ where: { examId }, orderBy: { sortOrder: 'asc' }, select: { id: true, points: true, snapshot: true } });
    const questions: GradableQuestion[] = [];
    for (const link of links) {
      const snapshot = readSnapshot(link.snapshot);
      if (snapshot) questions.push({ id: link.id, points: link.points.toFixed(2), snapshot });
    }
    return questions;
  }

  /** Grades the stored answers of an attempt and writes each answer's grading. */
  private async writeGrade(tx: Tx, attemptId: string, questions: readonly GradableQuestion[], maxScore: string): Promise<AttemptGrade> {
    const answers = await tx.examAnswer.findMany({ where: { attemptId }, select: { examQuestionId: true, response: true } });
    const grade = gradeAttempt(questions, new Map(answers.map((answer) => [answer.examQuestionId, answer.response])), maxScore);
    for (const answer of grade.answers) {
      await tx.examAnswer.update({
        where: { attemptId_examQuestionId: { attemptId, examQuestionId: answer.examQuestionId } },
        data: { isCorrect: answer.isCorrect, pointsAwarded: answer.pointsAwarded },
        select: { attemptId: true },
      });
    }
    return grade;
  }

  /**
   * Writes the student's counted result — the highest finished attempt
   * (D-R153) — as a `scored`, `online` row of `exam_results` (D-R160). Returns
   * false when the row already says exactly that, so nothing is rewritten.
   */
  private async syncCountedResult(tx: Tx, examId: string, studentUserId: string): Promise<boolean> {
    const finished = await tx.examAttempt.findMany({ where: { examId, studentUserId, status: { not: 'in_progress' } }, select: { attemptNo: true, score: true } });
    const best = countedAttempt(finished.filter((attempt) => attempt.score !== null).map((attempt) => ({ attemptNo: attempt.attemptNo, score: attempt.score!.toFixed(2) })));
    if (best === null) return false;
    const key = { examId_studentUserId: { examId, studentUserId } };
    const existing = await tx.examResult.findUnique({ where: key, select: { status: true, score: true, source: true } });
    if (existing && existing.source === 'online' && existing.status === 'scored' && existing.score !== null && existing.score.toFixed(2) === best.score) return false;
    if (existing) {
      // An earlier manual entry of this student (absent, excused, a typed score) gives way to what they actually did.
      await tx.examResult.update({ where: key, data: { status: 'scored', score: best.score, source: 'online', feedback: null, recordedById: null }, select: { examId: true } });
    } else {
      await tx.examResult.create({ data: { examId, studentUserId, status: 'scored', score: best.score, source: 'online' }, select: { examId: true } });
    }
    return true;
  }
}
