import { Injectable } from '@nestjs/common';
import { toDecimalText } from '../assignments/assignments.changes.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';
import type { ExamResultStatus, Prisma } from '../generated/prisma/client.js';
import { gradesError } from '../grades/grades.errors.js';
import { toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UsersProjection } from '../users/users.service.js';
import { RESULT_ENROLLMENT_STATUSES, duplicateStudents, isEmptyResultsPlan, planResultsBatch, resultsBlocker, scoreAboveMax } from './exam-results.changes.js';
import type { ResultEntry, ResultValues } from './exam-results.changes.js';
import type { ExamResultCountsSheetDto, ExamResultDto, ExamResultItemDto, ExamResultsSheetDto, RecordExamResultsDto } from './exam-results.dto.js';
import { visibleExamsWhere } from './exams.policy.js';
import { EXAMS_ENTITY_TYPE } from './exams.service.js';

/** The one audit event of the results sheet (12.4): recorded on the exam when a batch writes something. */
export const EXAM_RESULTS_AUDIT_ACTION = 'exams.results.recorded';

const SHEET_EXAM_SELECT = {
  id: true,
  classId: true,
  status: true,
  maxScore: true,
  class: { select: { code: true, status: true } },
} satisfies Prisma.ExamSelect;

const RESULT_SELECT = {
  studentUserId: true,
  status: true,
  score: true,
  feedback: true,
  recordedAt: true,
  updatedAt: true,
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ExamResultSelect;

type SheetExam = Prisma.ExamGetPayload<{ select: typeof SHEET_EXAM_SELECT }>;
type ResultRow = Prisma.ExamResultGetPayload<{ select: typeof RESULT_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

const EMPTY_COUNTS: ExamResultCountsSheetDto = { students: 0, scored: 0, absent: 0, excused: 0 };

function toResultDto(row: ResultRow): ExamResultDto {
  return {
    status: row.status,
    score: row.score === null ? null : Number(row.score),
    feedback: row.feedback,
    recordedBy: row.recordedBy ? { userId: row.recordedBy.id, fullName: row.recordedBy.fullName } : null,
    recordedAt: toIso(row.recordedAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function valuesOf(row: ResultRow): ResultValues {
  return { status: row.status, score: toDecimalText(row.score === null ? null : row.score.toString()), feedback: row.feedback };
}

function countsOf(rows: readonly { status: ExamResultStatus }[]): ExamResultCountsSheetDto {
  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    counts.students += 1;
    counts[row.status] += 1;
  }
  return counts;
}

function toEntry(input: RecordExamResultsDto['results'][number]): ResultEntry {
  return {
    studentId: input.studentId,
    status: input.status,
    score: input.status === 'scored' ? toDecimalText(input.score ?? null) : null,
    feedback: input.feedback ?? null,
  };
}

/**
 * MOD-09-T04 — the results sheet of an exam (roadmap §4h.4 API-119 `GET` and
 * API-120 `PUT /api/exams/:id/results`; owner decisions D-R45/D-R47).
 * Reading needs `exams.read`, writing `exams.grade`, both through the exam's
 * class visibility (D-R16 — an invisible exam is 404). The sheet lists every
 * student with an active or completed enrollment in the class plus anyone
 * holding a result, in the caller's D-R07 projection (the shared
 * `toRosterStudentDto()`), with their result or null. A batch is accepted for
 * a scheduled or published exam of a class that is not cancelled; no student
 * twice (`results_invalid`), every score within the exam's maximum
 * (`score_out_of_range`) and every named student enrolled (`not_enrolled`)
 * before any write. The batch is planned as a diff under the exam-row lock
 * (`FOR NO KEY UPDATE`, the T03 lock — a PATCH of `maxScore` and concurrent
 * saves serialise), written in one transaction with exactly one
 * `exams.results.recorded` event, and nothing is written or recorded for an
 * identical batch; `recorded_by` is the last writer of each result.
 */
@Injectable()
export class ExamResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sheet(examId: string, caller: AuthPrincipal): Promise<ExamResultsSheetDto> {
    const exam = await this.prisma.db.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: SHEET_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    return this.buildSheet(this.prisma.db, exam, rosterProjectionOf(caller));
  }

  async record(examId: string, input: RecordExamResultsDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ExamResultsSheetDto> {
    const entries = input.results.map(toEntry);
    const duplicates = duplicateStudents(entries.map((entry) => entry.studentId));
    if (duplicates.length > 0) throw gradesError.resultsInvalid(duplicates);
    const view = rosterProjectionOf(caller);
    return this.prisma.db.$transaction(async (tx) => {
      const exam = await this.lockExam(tx, examId, caller);
      const blocker = resultsBlocker(exam.class.status, exam.status);
      if (blocker === 'class_cancelled') throw gradesError.classClosed(exam.classId, exam.class.status);
      if (blocker !== null) throw gradesError.examNotRecordable(blocker);
      const maxScore = Number(exam.maxScore);
      const above = scoreAboveMax(entries, maxScore);
      if (above) throw gradesError.scoreOutOfRange(Number(above.score), maxScore, above.studentId);

      const studentIds = entries.map((entry) => entry.studentId);
      const enrolled = await tx.enrollment.findMany({
        where: { classId: exam.classId, studentUserId: { in: studentIds }, status: { in: [...RESULT_ENROLLMENT_STATUSES] } },
        select: { studentUserId: true },
      });
      const eligible = new Set(enrolled.map((row) => row.studentUserId));
      const notEnrolled = studentIds.filter((studentId) => !eligible.has(studentId));
      if (notEnrolled.length > 0) throw gradesError.notEnrolled(notEnrolled);

      const existing = await tx.examResult.findMany({ where: { examId, studentUserId: { in: studentIds } }, select: RESULT_SELECT });
      const plan = planResultsBatch(new Map(existing.map((row) => [row.studentUserId, valuesOf(row)])), entries);
      if (isEmptyResultsPlan(plan)) return this.buildSheet(tx, exam, view);

      if (plan.created.length > 0) {
        await tx.examResult.createMany({
          data: plan.created.map((entry) => ({ examId, studentUserId: entry.studentId, status: entry.status, score: entry.score, feedback: entry.feedback, recordedById: caller.id })),
        });
      }
      for (const update of plan.updated) {
        await tx.examResult.update({
          where: { examId_studentUserId: { examId, studentUserId: update.studentId } },
          data: { ...update.data, recordedById: caller.id },
          select: { examId: true },
        });
      }
      const sheet = await this.buildSheet(tx, exam, view);
      await this.audit.record(
        {
          action: EXAM_RESULTS_AUDIT_ACTION,
          actorUserId: caller.id,
          entityType: EXAMS_ENTITY_TYPE,
          entityId: examId,
          metadata: { classId: exam.classId, code: exam.class.code, created: plan.created.length, updated: plan.updated.length, counts: sheet.counts },
          ...ctx,
        },
        tx,
      );
      return sheet;
    });
  }

  // ---------------------------------------------------------------------------

  /** Locks the exam row (the T03 lock) and reads it with the visibility rule; an unknown or invisible exam is 404. */
  private async lockExam(tx: Tx, examId: string, caller: AuthPrincipal): Promise<SheetExam> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM exams WHERE id = ${examId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw gradesError.examNotFound(examId);
    const exam = await tx.exam.findFirst({ where: { AND: [{ id: examId }, visibleExamsWhere(caller)] }, select: SHEET_EXAM_SELECT });
    if (!exam) throw gradesError.examNotFound(examId);
    return exam;
  }

  /** The class's active/completed enrollments plus every other student holding a result, in enrollment order. */
  private async buildSheet(db: Db, exam: SheetExam, view: UsersProjection): Promise<ExamResultsSheetDto> {
    const results = await db.examResult.findMany({ where: { examId: exam.id }, select: RESULT_SELECT });
    const byStudent = new Map(results.map((row) => [row.studentUserId, row]));
    const resultIds = [...byStudent.keys()];
    const enrollments = await db.enrollment.findMany({
      where: { classId: exam.classId, OR: [{ status: { in: [...RESULT_ENROLLMENT_STATUSES] } }, { studentUserId: { in: resultIds } }] },
      orderBy: { id: 'asc' },
      select: { studentUserId: true, status: true, student: { select: ROSTER_STUDENT_SELECT } },
    });
    const items: ExamResultItemDto[] = enrollments.map((row) => ({
      student: toRosterStudentDto(row.student, view),
      enrollmentStatus: row.status,
      result: byStudent.has(row.studentUserId) ? toResultDto(byStudent.get(row.studentUserId)!) : null,
    }));
    const listed = new Set(enrollments.map((row) => row.studentUserId));
    const orphans = resultIds.filter((studentId) => !listed.has(studentId));
    if (orphans.length > 0) {
      // A result whose student has no enrollment row cannot come from the API (enrollments are never deleted) but is still listed.
      const users = await db.user.findMany({ where: { id: { in: orphans } }, orderBy: { id: 'asc' }, select: ROSTER_STUDENT_SELECT });
      for (const user of users) items.push({ student: toRosterStudentDto(user, view), enrollmentStatus: null, result: toResultDto(byStudent.get(user.id)!) });
    }
    const blocker = resultsBlocker(exam.class.status, exam.status);
    return {
      examId: exam.id,
      classId: exam.classId,
      examStatus: exam.status,
      maxScore: Number(exam.maxScore),
      recordable: blocker === null,
      closedReason: blocker,
      counts: countsOf(results),
      items,
    };
  }
}
