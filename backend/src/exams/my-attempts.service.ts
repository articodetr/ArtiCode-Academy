import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { Prisma } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { toIso } from '../lessons/lessons.time.js';
import { AutoCertificatesService } from '../certificates/auto-certificates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { attemptDeadline, isAttemptOver, isResultReleased, isReviewReleased, remainingSeconds, takeState } from './attempts.policy.js';
import type { AttemptState } from './attempts.policy.js';
import { ATTEMPT_TX, EXAM_ATTEMPT_AUDIT_ACTIONS, ExamGradingService, GRADING_ATTEMPT_SELECT } from './exam-grading.service.js';
import { EXAM_ATTEMPTS_ENTITY_TYPE } from './exams.audit.js';
import { readSnapshot } from './exams.online.js';
import type { QuestionSnapshot } from './exams.online.js';
import type { AnswerEntryDto, AttemptQuestionDto, MyAttemptDto, SaveAnswersDto, SaveAnswersResultDto, StartAttemptDto } from './my-attempts.dto.js';
import { countedAttempt, parseResponse, passOutcome } from './online-grading.js';

/** The academy's time zone for `timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';
/** A learner may take an exam the learners can see; a draft does not exist for them. */
const TAKEABLE_STATUSES = ['scheduled', 'published'] as const;

const ATTEMPT_EXAM_SELECT = {
  id: true,
  classId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  delivery: true,
  scheduledAt: true,
  closesAt: true,
  durationMinutes: true,
  maxScore: true,
  passScore: true,
  attemptsAllowed: true,
  resultsRelease: true,
  revealAnswers: true,
  lesson: { select: { room: { select: { branch: { select: { timezone: true } } } } } },
  class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.ExamSelect;

const VIEW_SELECT = {
  id: true,
  examId: true,
  studentUserId: true,
  attemptNo: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
  score: true,
  maxScore: true,
  questionCount: true,
  correctCount: true,
  exam: { select: ATTEMPT_EXAM_SELECT },
  answers: { select: { examQuestionId: true, response: true, isCorrect: true, pointsAwarded: true } },
} satisfies Prisma.ExamAttemptSelect;

type ViewRow = Prisma.ExamAttemptGetPayload<{ select: typeof VIEW_SELECT }>;
type Tx = Prisma.TransactionClient;

/** What saving answers found: the attempt already closed (by the learner or by the clock), or the write it made. */
type SaveOutcome = { closed: string } | { closed: null; saved: number; answeredCount: number; questionCount: number; expiresAt: Date };

/** True for the unique violation of a second simultaneous «start» (the partial unique index or the attempt number). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** The raw response an entry asks to store; null = clear the answer; undefined = both fields given (malformed). */
function entryResponse(entry: AnswerEntryDto): Record<string, unknown> | null | undefined {
  const hasOption = typeof entry.optionId === 'string';
  const hasValue = typeof entry.value === 'boolean';
  if (hasOption && hasValue) return undefined;
  if (hasOption) return { optionId: entry.optionId };
  if (hasValue) return { value: entry.value };
  return null;
}

function answerOf(response: unknown): { optionId: string | null; value: boolean | null } | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const record = response as Record<string, unknown>;
  return { optionId: typeof record['optionId'] === 'string' ? record['optionId'] : null, value: typeof record['value'] === 'boolean' ? record['value'] : null };
}

/**
 * MOD-09 phase 2 — a learner's own attempts at an online exam (roadmap §4r.6
 * API-276..API-279; decisions D-R152..D-R157, D-R165; SEC-R-24).
 *
 *   - Everything here is the caller's own: an attempt is found by its id AND
 *     the caller's id, an exam by an enrollment of the caller in its class —
 *     anything else is 404. A guardian never takes an exam for a child.
 *   - Starting needs `exams.take`, an `active` enrollment, an online exam the
 *     learners can see, its window and an attempt left. It is «resume or
 *     create»: an attempt in progress is answered again, so a double click or
 *     a repeated request never opens a second one — the partial unique index
 *     is the backstop and the transaction is retried once on its violation.
 *     The exam row is locked `FOR SHARE`, so a status action or a PATCH of the
 *     exam (which hold it `FOR NO KEY UPDATE`) and a start never interleave.
 *   - The clock is the server's: the deadline is fixed at the start, every
 *     write is checked against it, and an attempt whose time is over is closed
 *     with what was saved before the request is answered `attempt_closed`.
 *   - Answers are saved one batch at a time under the attempt-row lock, each
 *     checked against the frozen question it answers; no audit event (D-R165).
 *   - Submitting grades the attempt once under its row lock; repeating it
 *     answers the same finished attempt without grading again.
 *   - The three writes run with `ATTEMPT_TX`: when a whole class starts in
 *     the same minute a request queues for a connection instead of failing.
 *   - What is answered to a learner never carries a key: the options come
 *     without `isCorrect`, the score only once the exam releases it (D-R156),
 *     the correct answers and explanations only once it reveals them (D-R157).
 */
@Injectable()
export class MyAttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grading: ExamGradingService,
    private readonly autoCertificates: AutoCertificatesService,
  ) {}

  /** API-276 — starts the caller's next attempt, or answers the one in progress. */
  async start(examId: string, input: StartAttemptDto, caller: AuthPrincipal, ctx: RequestContext): Promise<{ attempt: MyAttemptDto; created: boolean }> {
    const now = new Date();
    await this.assertOwnExam(this.prisma.db, examId, caller.id);
    // Kept even when the start is then refused: an attempt whose time is over is closed first.
    await this.grading.closeOverdueOf(examId, caller.id, now);
    let outcome: { id: string; created: boolean };
    try {
      outcome = await this.startOnce(examId, input, caller, ctx, now);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two «start» requests at once: the other one inserted first — this one now finds its attempt in progress.
      outcome = await this.startOnce(examId, input, caller, ctx, new Date());
    }
    return { attempt: await this.read(outcome.id, caller), created: outcome.created };
  }

  /** API-277 — the caller's own attempt. Read-only: an attempt whose time is up is shown as such, never closed here. */
  async read(attemptId: string, caller: AuthPrincipal): Promise<MyAttemptDto> {
    const row = await this.prisma.db.examAttempt.findFirst({ where: { id: attemptId, studentUserId: caller.id }, select: VIEW_SELECT });
    if (!row) throw gradesError.attemptNotFound(attemptId);
    return this.toDto(row, new Date());
  }

  /** API-278 — saves or clears answers of an attempt in progress. */
  async saveAnswers(attemptId: string, input: SaveAnswersDto, caller: AuthPrincipal): Promise<SaveAnswersResultDto> {
    const ids = input.answers.map((entry) => entry.examQuestionId);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicates.length > 0) throw gradesError.answersInvalid([], duplicates, []);
    const now = new Date();

    const outcome = await this.prisma.db.$transaction(async (tx): Promise<SaveOutcome> => {
      const attempt = await this.lockOwnAttempt(tx, attemptId, caller.id);
      if (attempt.status !== 'in_progress') return { closed: attempt.status };
      if (isAttemptOver(attempt.expiresAt, now)) {
        // The time is up: the server closes the attempt with what was saved; this write is not part of it.
        await this.grading.finish(tx, attempt, 'timed_out', now, null);
        return { closed: 'timed_out' };
      }
      const links = await tx.examQuestion.findMany({ where: { examId: attempt.examId }, select: { id: true, snapshot: true } });
      const snapshots = new Map<string, QuestionSnapshot | null>(links.map((link) => [link.id, readSnapshot(link.snapshot)]));
      const unknown = ids.filter((id) => !snapshots.has(id));
      if (unknown.length > 0) throw gradesError.answersInvalid(unknown, [], []);

      const toClear: string[] = [];
      const toWrite: { examQuestionId: string; response: Prisma.InputJsonValue }[] = [];
      const malformed: string[] = [];
      for (const entry of input.answers) {
        const raw = entryResponse(entry);
        const snapshot = snapshots.get(entry.examQuestionId);
        if (raw === null) {
          toClear.push(entry.examQuestionId);
          continue;
        }
        const parsed = raw === undefined || !snapshot ? null : parseResponse(snapshot, raw);
        if (!parsed || !parsed.ok) malformed.push(entry.examQuestionId);
        else toWrite.push({ examQuestionId: entry.examQuestionId, response: parsed.response as unknown as Prisma.InputJsonValue });
      }
      if (malformed.length > 0) throw gradesError.answersInvalid([], [], malformed);

      if (toClear.length > 0) await tx.examAnswer.deleteMany({ where: { attemptId, examQuestionId: { in: toClear } } });
      for (const answer of toWrite) {
        await tx.examAnswer.upsert({
          where: { attemptId_examQuestionId: { attemptId, examQuestionId: answer.examQuestionId } },
          create: { attemptId, examQuestionId: answer.examQuestionId, response: answer.response, answeredAt: now },
          update: { response: answer.response, answeredAt: now },
          select: { attemptId: true },
        });
      }
      const answeredCount = await tx.examAnswer.count({ where: { attemptId } });
      return { closed: null, saved: toClear.length + toWrite.length, answeredCount, questionCount: attempt.questionCount, expiresAt: attempt.expiresAt };
    }, ATTEMPT_TX);

    // Thrown after the commit, so the server's close of an expired attempt is kept.
    if (outcome.closed !== null) throw gradesError.attemptClosed(outcome.closed);
    return {
      attemptId,
      saved: outcome.saved,
      answeredCount: outcome.answeredCount,
      questionCount: outcome.questionCount,
      expiresAt: toIso(outcome.expiresAt),
      serverNow: toIso(now),
      remainingSeconds: remainingSeconds(outcome.expiresAt, now),
    };
  }

  /** API-279 — the final submit: grades the attempt once; a repeated submit answers the same finished attempt. */
  async submit(attemptId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<MyAttemptDto> {
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      const attempt = await this.lockOwnAttempt(tx, attemptId, caller.id);
      if (attempt.status !== 'in_progress') return;
      // Past the deadline and its allowance the server closes it; the learner did not submit in time.
      if (isAttemptOver(attempt.expiresAt, now)) await this.grading.finish(tx, attempt, 'timed_out', now, null);
      else await this.grading.finish(tx, attempt, 'submitted', now, { userId: caller.id, ctx });
    }, ATTEMPT_TX);
    // J-F67: the last exam of the class may complete the course's automatic certificate (after the commit; never fails the submit).
    const owner = await this.prisma.db.examAttempt.findUnique({ where: { id: attemptId }, select: { studentUserId: true, exam: { select: { class: { select: { courseId: true } } } } } });
    if (owner && owner.studentUserId === caller.id) await this.autoCertificates.awardIfComplete(caller.id, owner.exam.class.courseId);
    return this.read(attemptId, caller);
  }

  // ---------------------------------------------------------------------------

  /** The exam must be an online one the learners can see, in a class the caller has an enrollment in — else 404. */
  private async assertOwnExam(db: Tx | PrismaService['db'], examId: string, callerId: string): Promise<void> {
    const exam = await db.exam.findFirst({ where: { id: examId, delivery: 'online', status: { in: [...TAKEABLE_STATUSES] } }, select: { classId: true } });
    if (!exam) throw gradesError.examNotFound(examId);
    const enrollment = await db.enrollment.findUnique({ where: { classId_studentUserId: { classId: exam.classId, studentUserId: callerId } }, select: { id: true } });
    if (!enrollment) throw gradesError.examNotFound(examId);
  }

  private async startOnce(examId: string, input: StartAttemptDto, caller: AuthPrincipal, ctx: RequestContext, now: Date): Promise<{ id: string; created: boolean }> {
    return this.prisma.db.$transaction(async (tx) => {
      // FOR SHARE: many learners start at once, but never while a status action or a PATCH of the exam is in flight.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${examId}::uuid FOR SHARE`;
      if (locked.length === 0) throw gradesError.examNotFound(examId);
      const exam = await tx.exam.findFirst({ where: { id: examId, delivery: 'online', status: { in: [...TAKEABLE_STATUSES] } }, select: ATTEMPT_EXAM_SELECT });
      if (!exam) throw gradesError.examNotFound(examId);
      const enrollment = await tx.enrollment.findUnique({ where: { classId_studentUserId: { classId: exam.classId, studentUserId: caller.id } }, select: { status: true } });
      if (!enrollment) throw gradesError.examNotFound(examId);

      // An attempt still open whose official deadline has passed (inside the network allowance) is closed here, so the next one can start.
      const stale = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM exam_attempts WHERE exam_id = ${examId}::uuid AND student_user_id = ${caller.id}::uuid AND status = 'in_progress' AND expires_at <= ${now} FOR UPDATE`;
      for (const row of stale) {
        const open = await tx.examAttempt.findFirst({ where: { id: row.id, status: 'in_progress' }, select: GRADING_ATTEMPT_SELECT });
        if (open) await this.grading.finish(tx, open, 'timed_out', now, null);
      }

      const attempts: AttemptState[] = await tx.examAttempt.findMany({ where: { examId, studentUserId: caller.id }, orderBy: { attemptNo: 'asc' }, select: { id: true, attemptNo: true, status: true, expiresAt: true } });
      const state = takeState({
        relation: 'self',
        // The route's guard has already required `exams.take`.
        mayTake: true,
        examStatus: exam.status,
        classStatus: exam.class.status,
        enrollmentStatus: enrollment.status,
        scheduledAt: exam.scheduledAt,
        closesAt: exam.closesAt,
        attemptsAllowed: exam.attemptsAllowed,
        attempts,
        now,
      });
      const opensAt = exam.scheduledAt ? toIso(exam.scheduledAt) : null;
      const closesAt = exam.closesAt ? toIso(exam.closesAt) : null;
      if (state.blocker === 'results_published') throw gradesError.examNotOpen('results_published', opensAt, closesAt);
      if (state.blocker === 'not_enrolled') throw gradesError.enrollmentRequired(enrollment.status);
      if (state.blocker === 'class_closed') throw gradesError.classClosed(exam.classId, exam.class.status);
      // D-R49's guard for attempts: the number the client means must be the one the server would give.
      const serverNumber = state.inProgress ? state.inProgress.attemptNo : state.attemptsUsed + 1;
      if (input.attemptNo !== undefined && input.attemptNo !== serverNumber) throw gradesError.attemptConflict(input.attemptNo, serverNumber);
      if (state.inProgress) return { id: state.inProgress.id, created: false };
      if (state.blocker === 'not_open_yet' || state.blocker === 'closed') throw gradesError.examNotOpen(state.blocker, opensAt, closesAt);
      if (state.blocker === 'attempts_exhausted') throw gradesError.attemptsExhausted(exam.attemptsAllowed, state.attemptsUsed);

      const questionCount = await tx.examQuestion.count({ where: { examId } });
      const expiresAt = attemptDeadline(now, exam.durationMinutes!, exam.closesAt!);
      const created = await tx.examAttempt.create({
        data: { examId, studentUserId: caller.id, attemptNo: state.nextAttemptNo!, startedAt: now, expiresAt, maxScore: exam.maxScore, questionCount },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: EXAM_ATTEMPT_AUDIT_ACTIONS.started,
          actorUserId: caller.id,
          entityType: EXAM_ATTEMPTS_ENTITY_TYPE,
          entityId: created.id,
          metadata: { examId, classId: exam.classId, attemptNo: state.nextAttemptNo, expiresAt: toIso(expiresAt) },
          ...ctx,
        },
        tx,
      );
      return { id: created.id, created: true };
    }, ATTEMPT_TX);
  }

  /** Locks the caller's own attempt (`FOR UPDATE`) and reads it; anybody else's, or an unknown one, is 404. */
  private async lockOwnAttempt(tx: Tx, attemptId: string, callerId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exam_attempts WHERE id = ${attemptId}::uuid AND student_user_id = ${callerId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw gradesError.attemptNotFound(attemptId);
    return tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: GRADING_ATTEMPT_SELECT });
  }

  /** The attempt as its learner may see it at `now`. */
  private async toDto(row: ViewRow, now: Date): Promise<MyAttemptDto> {
    const exam = row.exam;
    const links = await this.prisma.db.examQuestion.findMany({ where: { examId: row.examId }, orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true, points: true, snapshot: true } });
    const siblings = await this.prisma.db.examAttempt.findMany({
      where: { examId: row.examId, studentUserId: row.studentUserId },
      orderBy: { attemptNo: 'asc' },
      select: { id: true, attemptNo: true, status: true, startedAt: true, submittedAt: true, score: true },
    });
    const academy = await this.prisma.db.academy.findFirst({ select: { timezone: true } });

    const finished = row.status !== 'in_progress';
    const release = { status: exam.status, delivery: exam.delivery, resultsRelease: exam.resultsRelease, revealAnswers: exam.revealAnswers, closesAt: exam.closesAt };
    const resultReleased = isResultReleased(release);
    const reviewReleased = isReviewReleased(release, now);
    const answers = new Map(row.answers.map((answer) => [answer.examQuestionId, answer]));

    const questions: AttemptQuestionDto[] = [];
    for (const link of links) {
      const snapshot = readSnapshot(link.snapshot);
      if (!snapshot) continue;
      const answer = answers.get(link.id);
      questions.push({
        id: link.id,
        sortOrder: link.sortOrder,
        points: Number(link.points),
        type: snapshot.type,
        prompt: snapshot.prompt,
        // SEC-R-24: the options go out without their key.
        options: snapshot.options.map((option) => ({ id: option.id, text: option.text })),
        answer: answer ? answerOf(answer.response) : null,
        review:
          finished && reviewReleased
            ? {
                isCorrect: answer?.isCorrect === true,
                pointsAwarded: answer?.pointsAwarded ? Number(answer.pointsAwarded) : 0,
                correctOptionId: snapshot.type === 'single_choice' ? (snapshot.options.find((option) => option.isCorrect)?.id ?? null) : null,
                correctAnswer: snapshot.type === 'true_false' ? snapshot.correctBoolean : null,
                explanation: snapshot.explanation,
              }
            : null,
      });
    }

    const counted = countedAttempt(siblings.filter((attempt) => attempt.status !== 'in_progress' && attempt.score !== null).map((attempt) => ({ attemptNo: attempt.attemptNo, score: attempt.score!.toFixed(2) })));
    return {
      id: row.id,
      attemptNo: row.attemptNo,
      status: row.status,
      startedAt: toIso(row.startedAt),
      expiresAt: toIso(row.expiresAt),
      submittedAt: row.submittedAt ? toIso(row.submittedAt) : null,
      serverNow: toIso(now),
      remainingSeconds: finished ? 0 : remainingSeconds(row.expiresAt, now),
      timeUp: !finished && now.getTime() >= row.expiresAt.getTime(),
      answeredCount: row.answers.length,
      questionCount: row.questionCount,
      exam: {
        id: exam.id,
        title: readLocalizedText(exam.title) ?? { ar: '' },
        description: readLocalizedText(exam.description),
        type: exam.type,
        maxScore: Number(exam.maxScore),
        passScore: exam.passScore === null ? null : Number(exam.passScore),
        durationMinutes: exam.durationMinutes,
        scheduledAt: exam.scheduledAt ? toIso(exam.scheduledAt) : null,
        closesAt: exam.closesAt ? toIso(exam.closesAt) : null,
        timeZone: displayTimeZone(exam.lesson?.room?.branch?.timezone, academy?.timezone ?? FALLBACK_TIME_ZONE),
        attemptsAllowed: exam.attemptsAllowed,
        resultsRelease: exam.resultsRelease,
        revealAnswers: exam.revealAnswers,
        class: {
          id: exam.class.id,
          code: exam.class.code,
          name: readLocalizedText(exam.class.name) ?? { ar: exam.class.code },
          status: exam.class.status,
          course: { id: exam.class.course.id, code: exam.class.course.code, name: readLocalizedText(exam.class.course.name) ?? { ar: exam.class.course.code } },
        },
      },
      questions,
      resultReleased,
      reviewReleased,
      result:
        finished && resultReleased && row.score !== null
          ? {
              score: Number(row.score),
              maxScore: Number(row.maxScore),
              correctCount: row.correctCount ?? 0,
              questionCount: row.questionCount,
              isPass: passOutcome(row.score.toFixed(2), exam.passScore === null ? null : exam.passScore.toFixed(2)),
              counted: counted !== null && counted.attemptNo === row.attemptNo,
            }
          : null,
      attempts: siblings.map((attempt) => ({
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        status: attempt.status,
        startedAt: toIso(attempt.startedAt),
        submittedAt: attempt.submittedAt ? toIso(attempt.submittedAt) : null,
        score: resultReleased && attempt.score !== null ? Number(attempt.score) : null,
      })),
    };
  }
}
