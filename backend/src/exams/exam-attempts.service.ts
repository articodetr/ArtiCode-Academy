import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';
import { Prisma } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { toIso } from '../lessons/lessons.time.js';
import { AutoCertificatesService } from '../certificates/auto-certificates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CorrectKeyDto,
  ExamAttemptDetailDto,
  ExamAttemptRowDto,
  ExamAttemptsDto,
  ExamAttemptsStatsDto,
  ExamAttemptsStudentDto,
  KeyCorrectionResultDto,
  RegradeExamDto,
  RegradeSummaryDto,
} from './exam-attempts.dto.js';
import { ExamGradingService, GRADING_TX } from './exam-grading.service.js';
import { EXAM_QUESTION_LINK_SELECT, toExamQuestionItem } from './exam-questions.service.js';
import { EXAMS_ENTITY_TYPE } from './exams.audit.js';
import { planKeyCorrection, readSnapshot, windowStateOf } from './exams.online.js';
import { isClassFrozenForExams, visibleExamsWhere } from './exams.policy.js';
import { countedAttempt } from './online-grading.js';

export const EXAM_CORRECTION_AUDIT_ACTIONS = {
  keyCorrected: 'exams.questions.key_corrected',
  regraded: 'exams.attempts.regraded',
} as const;

/** A student holds a place on the roster of attempts while their enrollment is one of these (as the results sheet). */
const ROSTER_ENROLLMENT_STATUSES = ['active', 'completed'] as const;

const ATTEMPTS_EXAM_SELECT = {
  id: true,
  classId: true,
  status: true,
  delivery: true,
  scheduledAt: true,
  closesAt: true,
  maxScore: true,
  passScore: true,
  class: { select: { code: true, status: true } },
} satisfies Prisma.ExamSelect;

const ROW_SELECT = {
  id: true,
  studentUserId: true,
  attemptNo: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
  score: true,
  correctCount: true,
} satisfies Prisma.ExamAttemptSelect;

type AttemptsExam = Prisma.ExamGetPayload<{ select: typeof ATTEMPTS_EXAM_SELECT }>;
type AttemptRow = Prisma.ExamAttemptGetPayload<{ select: typeof ROW_SELECT }>;
type Tx = Prisma.TransactionClient;

const EMPTY_SUMMARY: RegradeSummaryDto = { attempts: 0, changedAttempts: 0, changedResults: 0 };

/** The counted attempt of one student's rows: the highest finished one, the earliest on a tie (D-R153). */
function countedOf(rows: readonly AttemptRow[]): AttemptRow | null {
  const finished = rows.filter((row) => row.status !== 'in_progress' && row.score !== null);
  const best = countedAttempt(finished.map((row) => ({ attemptNo: row.attemptNo, score: row.score!.toFixed(2) })));
  return best === null ? null : (finished.find((row) => row.attemptNo === best.attemptNo) ?? null);
}

function toRow(row: AttemptRow, countedId: string | null, now: Date): ExamAttemptRowDto {
  return {
    id: row.id,
    attemptNo: row.attemptNo,
    status: row.status,
    startedAt: toIso(row.startedAt),
    expiresAt: toIso(row.expiresAt),
    submittedAt: row.submittedAt ? toIso(row.submittedAt) : null,
    score: row.score === null ? null : Number(row.score),
    correctCount: row.correctCount,
    counted: row.id === countedId,
    timeUp: row.status === 'in_progress' && now.getTime() >= row.expiresAt.getTime(),
  };
}

function round2(value: Prisma.Decimal): number {
  return Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
}

/**
 * MOD-09 phase 2 — what the teacher and the office see of the attempts at an
 * online exam, and the audited corrections (roadmap §4r.6 API-272..API-275;
 * decisions D-R153, D-R161).
 *
 * Everything goes through the exam's class visibility (D-R16): `classes.manage`
 * sees every class, anyone else the classes they teach — an exam or an attempt
 * outside it is 404. Reading needs `exams.read`; correcting a key and
 * regrading need `exams.grade`.
 *
 *   - The roster lists every student with an active or completed enrollment
 *     plus anyone holding an attempt, with their attempts, their counted
 *     result and the exam's figures: who started, who finished, who did not,
 *     the mean, the range and the pass rate of the counted scores, and how
 *     each question went over each student's counted attempt.
 *   - A key correction (D-R161) fixes the key of ONE frozen question: the
 *     previous key joins the copy's own history, every finished attempt is
 *     graded again and the counted results that change are rewritten, in one
 *     transaction under the exam-row lock and the locks of the exam's attempt
 *     rows (so an attempt finishing at that moment is graded with the new key
 *     too), with exactly one audit event — it
 *     carries the reason and the counts, never a key. It is refused while the
 *     class has an issued certificate (`grades_certified` — D-R54); a final
 *     grade fixed earlier becomes stale, as after any correction of a result.
 *   - A regrade re-grades every finished attempt from the frozen copies as
 *     they are; when nothing changes it writes and records nothing.
 */
@Injectable()
export class ExamAttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grading: ExamGradingService,
    private readonly autoCertificates: AutoCertificatesService,
  ) {}

  /** API-274 — the attempts of an exam by student, with its figures. */
  async roster(examId: string, caller: AuthPrincipal): Promise<ExamAttemptsDto> {
    const exam = await this.prisma.db.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: ATTEMPTS_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    const now = new Date();
    const view = rosterProjectionOf(caller);
    const db = this.prisma.db;

    const attempts = await db.examAttempt.findMany({ where: { examId }, orderBy: [{ studentUserId: 'asc' }, { attemptNo: 'asc' }], select: ROW_SELECT });
    const byStudent = new Map<string, AttemptRow[]>();
    for (const attempt of attempts) {
      const list = byStudent.get(attempt.studentUserId) ?? [];
      list.push(attempt);
      byStudent.set(attempt.studentUserId, list);
    }
    const results = await db.examResult.findMany({ where: { examId }, select: { studentUserId: true, status: true, score: true, source: true } });
    const resultOf = new Map(results.map((result) => [result.studentUserId, result]));
    const holders = [...new Set([...byStudent.keys(), ...resultOf.keys()])];
    const enrollments = await db.enrollment.findMany({
      where: { classId: exam.classId, OR: [{ status: { in: [...ROSTER_ENROLLMENT_STATUSES] } }, { studentUserId: { in: holders } }] },
      orderBy: { id: 'asc' },
      select: { studentUserId: true, status: true, student: { select: ROSTER_STUDENT_SELECT } },
    });

    const counted = new Map<string, AttemptRow>();
    const items: ExamAttemptsStudentDto[] = enrollments.map((enrollment) => {
      const rows = byStudent.get(enrollment.studentUserId) ?? [];
      const best = countedOf(rows);
      if (best) counted.set(enrollment.studentUserId, best);
      const result = resultOf.get(enrollment.studentUserId);
      return {
        student: toRosterStudentDto(enrollment.student, view),
        enrollmentStatus: enrollment.status,
        result: result ? { status: result.status, score: result.score === null ? null : Number(result.score), source: result.source } : null,
        attempts: rows.map((row) => toRow(row, best?.id ?? null, now)),
      };
    });

    const links = await db.examQuestion.findMany({ where: { examId }, orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true, points: true } });
    const countedIds = [...counted.values()].map((row) => row.id);
    const answerGroups =
      countedIds.length === 0 ? [] : await db.examAnswer.groupBy({ by: ['examQuestionId', 'isCorrect'], where: { attemptId: { in: countedIds } }, _count: { _all: true } });
    const questionStats = links.map((link) => {
      const groups = answerGroups.filter((group) => group.examQuestionId === link.id);
      return {
        examQuestionId: link.id,
        sortOrder: link.sortOrder,
        points: Number(link.points),
        answered: groups.reduce((sum, group) => sum + group._count._all, 0),
        correct: groups.filter((group) => group.isCorrect === true).reduce((sum, group) => sum + group._count._all, 0),
      };
    });

    return {
      examId: exam.id,
      classId: exam.classId,
      examStatus: exam.status,
      maxScore: Number(exam.maxScore),
      passScore: exam.passScore === null ? null : Number(exam.passScore),
      questionCount: links.length,
      scheduledAt: exam.scheduledAt ? toIso(exam.scheduledAt) : null,
      closesAt: exam.closesAt ? toIso(exam.closesAt) : null,
      window: windowStateOf(exam.scheduledAt, exam.closesAt, now),
      serverNow: toIso(now),
      stats: this.statsOf(items, [...counted.values()], exam.passScore),
      questions: questionStats,
      items,
    };
  }

  /** API-275 — one attempt with the questions' key and the student's answers. */
  async detail(attemptId: string, caller: AuthPrincipal): Promise<ExamAttemptDetailDto> {
    const db = this.prisma.db;
    const attempt = await db.examAttempt.findFirst({
      where: { id: attemptId, exam: visibleExamsWhere(caller) },
      select: {
        ...ROW_SELECT,
        examId: true,
        maxScore: true,
        questionCount: true,
        gradedAt: true,
        student: { select: ROSTER_STUDENT_SELECT },
        answers: { select: { examQuestionId: true, response: true, isCorrect: true, pointsAwarded: true } },
      },
    });
    if (!attempt) throw gradesError.attemptNotFound(attemptId);
    const siblings = await db.examAttempt.findMany({ where: { examId: attempt.examId, studentUserId: attempt.studentUserId }, select: ROW_SELECT });
    const links = await db.examQuestion.findMany({ where: { examId: attempt.examId }, orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true, points: true, snapshot: true } });
    const finished = attempt.status !== 'in_progress';
    const answers = new Map(attempt.answers.map((answer) => [answer.examQuestionId, answer]));

    return {
      id: attempt.id,
      examId: attempt.examId,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      startedAt: toIso(attempt.startedAt),
      expiresAt: toIso(attempt.expiresAt),
      submittedAt: attempt.submittedAt ? toIso(attempt.submittedAt) : null,
      gradedAt: attempt.gradedAt ? toIso(attempt.gradedAt) : null,
      score: attempt.score === null ? null : Number(attempt.score),
      maxScore: Number(attempt.maxScore),
      correctCount: attempt.correctCount,
      questionCount: attempt.questionCount,
      counted: countedOf(siblings)?.id === attempt.id,
      student: toRosterStudentDto(attempt.student, rosterProjectionOf(caller)),
      questions: links.flatMap((link) => {
        const snapshot = readSnapshot(link.snapshot);
        if (!snapshot) return [];
        const answer = answers.get(link.id);
        const response = answer?.response as Record<string, unknown> | undefined;
        return [
          {
            id: link.id,
            sortOrder: link.sortOrder,
            points: Number(link.points),
            type: snapshot.type,
            prompt: snapshot.prompt,
            explanation: snapshot.explanation,
            options: snapshot.options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect })),
            correctAnswer: snapshot.correctBoolean,
            answer: response
              ? { optionId: typeof response['optionId'] === 'string' ? response['optionId'] : null, value: typeof response['value'] === 'boolean' ? response['value'] : null }
              : null,
            isCorrect: finished ? answer?.isCorrect === true : null,
            pointsAwarded: finished ? (answer?.pointsAwarded ? Number(answer.pointsAwarded) : 0) : null,
          },
        ];
      }),
    };
  }

  /** API-272 — corrects the key of one frozen question and grades the finished attempts again (D-R161). */
  async correctKey(examId: string, examQuestionId: string, input: CorrectKeyDto, caller: AuthPrincipal, ctx: RequestContext): Promise<KeyCorrectionResultDto> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      const exam = await this.lockCorrectable(tx, examId, caller);
      // Before the copy is read or changed: no attempt may finish between the old key and the regrade.
      await this.grading.lockAttemptsOf(tx, examId);
      const link = await tx.examQuestion.findFirst({ where: { id: examQuestionId, examId }, select: EXAM_QUESTION_LINK_SELECT });
      if (!link) throw gradesError.questionNotFound([examQuestionId]);
      const snapshot = readSnapshot(link.snapshot);
      if (!snapshot) throw gradesError.examNotFrozen(exam.status);
      const now = new Date();
      const plan = planKeyCorrection(snapshot, { correctOptionId: input.correctOptionId, correctAnswer: input.correctAnswer }, { userId: caller.id, at: toIso(now), reason: input.reason });
      if (!plan.ok) throw gradesError.keyInvalid(plan.problem);
      if (!plan.changed) return { changed: false, question: toExamQuestionItem(link), regrade: { ...EMPTY_SUMMARY } };

      await tx.examQuestion.update({ where: { id: link.id }, data: { snapshot: plan.next as unknown as Prisma.InputJsonValue }, select: { id: true } });
      const regrade = await this.grading.regrade(tx, examId, now);
      await this.audit.record(
        {
          action: EXAM_CORRECTION_AUDIT_ACTIONS.keyCorrected,
          actorUserId: caller.id,
          entityType: EXAMS_ENTITY_TYPE,
          entityId: examId,
          // The reason and the counts — never the key, old or new: it stays in the copy's own history.
          metadata: { classId: exam.classId, code: exam.class.code, examQuestionId: link.id, position: link.sortOrder, ...regrade, reason: input.reason },
          ...ctx,
        },
        tx,
      );
      const after = await tx.examQuestion.findUniqueOrThrow({ where: { id: link.id }, select: EXAM_QUESTION_LINK_SELECT });
      return { changed: true, question: toExamQuestionItem(after), regrade };
    }, GRADING_TX);
    // CH-0244: a corrected key may turn a failed result into a pass — the course certificate is checked after the commit.
    if (result.regrade.changedResults > 0) await this.autoCertificates.awardForExam(examId);
    return result;
  }

  /** API-273 — grades every finished attempt again from the frozen copies; nothing is written or recorded when nothing changes. */
  async regrade(examId: string, input: RegradeExamDto, caller: AuthPrincipal, ctx: RequestContext): Promise<RegradeSummaryDto> {
    const summary = await this.prisma.db.$transaction(async (tx) => {
      const exam = await this.lockCorrectable(tx, examId, caller);
      const summary = await this.grading.regrade(tx, examId, new Date());
      if (summary.changedAttempts === 0 && summary.changedResults === 0) return summary;
      await this.audit.record(
        {
          action: EXAM_CORRECTION_AUDIT_ACTIONS.regraded,
          actorUserId: caller.id,
          entityType: EXAMS_ENTITY_TYPE,
          entityId: examId,
          metadata: { classId: exam.classId, code: exam.class.code, ...summary, reason: input.reason },
          ...ctx,
        },
        tx,
      );
      return summary;
    }, GRADING_TX);
    // CH-0244: as after a key correction.
    if (summary.changedResults > 0) await this.autoCertificates.awardForExam(examId);
    return summary;
  }

  // ---------------------------------------------------------------------------

  /**
   * Locks the class row (`FOR SHARE`) and then the exam row (`FOR NO KEY UPDATE`
   * — the lock of every exam write) and applies what a correction needs: a
   * visible exam, online, made available, of a class that is not cancelled and
   * holds no issued certificate (D-R54).
   *
   * The class row first, because issuing certificates and fixing final grades
   * lock it (`FOR NO KEY UPDATE`): with the shared lock a correction and either
   * of them never interleave — the certificate count below is exact until this
   * transaction ends, and a finalization that follows reads the corrected
   * results. Class → exam is the order exam creation already takes; nothing
   * locks an exam and then its class.
   */
  private async lockCorrectable(tx: Tx, examId: string, caller: AuthPrincipal): Promise<AttemptsExam> {
    const owner = await tx.exam.findUnique({ where: { id: examId }, select: { classId: true } });
    if (!owner) throw gradesError.examNotFound(examId);
    await tx.$queryRaw`SELECT id FROM classes WHERE id = ${owner.classId}::uuid FOR SHARE`;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${examId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw gradesError.examNotFound(examId);
    const exam = await tx.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: ATTEMPTS_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    if (exam.delivery !== 'online') throw gradesError.examNotOnline(examId);
    if (exam.status === 'draft') throw gradesError.examNotFrozen(exam.status);
    if (isClassFrozenForExams(exam.class.status)) throw gradesError.classClosed(exam.classId, exam.class.status);
    const certificateCount = await tx.certificate.count({ where: { classId: exam.classId, status: 'issued' } });
    if (certificateCount > 0) throw gradesError.gradesCertified(exam.classId, certificateCount);
    return exam;
  }

  private statsOf(items: readonly ExamAttemptsStudentDto[], counted: readonly AttemptRow[], passScore: Prisma.Decimal | null): ExamAttemptsStatsDto {
    const started = items.filter((item) => item.attempts.length > 0).length;
    const scores = counted.map((row) => row.score!);
    const stats: ExamAttemptsStatsDto = {
      students: items.length,
      started,
      inProgress: items.filter((item) => item.attempts.some((attempt) => attempt.status === 'in_progress')).length,
      finished: counted.length,
      notStarted: items.length - started,
      mean: null,
      highest: null,
      lowest: null,
      passed: null,
      failed: null,
      passRate: null,
    };
    if (scores.length === 0) return stats;
    const total = scores.reduce((sum, score) => sum.plus(score), new Prisma.Decimal(0));
    stats.mean = round2(total.dividedBy(scores.length));
    stats.highest = Number(Prisma.Decimal.max(...scores));
    stats.lowest = Number(Prisma.Decimal.min(...scores));
    if (passScore !== null) {
      const passed = scores.filter((score) => score.greaterThanOrEqualTo(passScore)).length;
      stats.passed = passed;
      stats.failed = scores.length - passed;
      stats.passRate = round2(new Prisma.Decimal(passed).times(100).dividedBy(scores.length));
    }
    return stats;
  }
}
