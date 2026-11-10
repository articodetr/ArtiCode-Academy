import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { ownedEnrollmentsWhere, ownershipOf } from '../lessons/my-lessons.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cellOutcome } from './gradebook.calc.js';
import type { CellInput, GradeComponent } from './gradebook.calc.js';
import type { ListMyGradesQueryDto, MyGradeComponentDto, MyGradeItemDto, MyGradeListDto } from './my-grades.dto.js';
import { myGradesAccess, opensRelation } from './my-grades.policy.js';

interface LearnerComponent extends GradeComponent {
  classId: string;
  title: LocalizedText;
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * MOD-09-T06 — «my grades» (`GET /api/me/grades`, API-129; owner decision
 * D-R48). Ownership as «my lessons» plus the dedicated keys: the caller's
 * enrollments need `grades.read_own`, their children's `grades.read_linked`
 * (and the `guardian` role); the controller refuses a caller with neither.
 * One item per owned `active`/`completed` enrollment with the class's
 * non-draft assignments (the student's latest graded attempt, the late
 * penalty applied as in the gradebook) and published exams (their result),
 * their weights, and the final grade once fixed — no running average, never
 * the breakdown of another student, the reviewer or the recorder. No
 * pagination (a student's enrollments are few). Read-only: no audit event.
 */
@Injectable()
export class MyGradesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyGradesQueryDto, caller: AuthPrincipal): Promise<MyGradeListDto> {
    const access = myGradesAccess(caller.permissions);
    const where = ownedEnrollmentsWhere(caller, query.studentId);
    if (query.classId) where.classId = query.classId;
    const enrollments = (
      await this.prisma.db.enrollment.findMany({
        where,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          classId: true,
          status: true,
          studentUserId: true,
          student: { select: { id: true, fullName: true, displayName: true } },
          class: { select: { id: true, code: true, name: true, status: true, course: { select: { id: true, code: true, name: true } } } },
          finalGrade: { select: { percent: true, bandLabel: true, bandLetter: true, isPass: true, finalizedAt: true } },
        },
      })
    ).filter((row) => opensRelation(access, ownershipOf(row, caller.id).relation));
    if (enrollments.length === 0) return { items: [] };

    const classIds = [...new Set(enrollments.map((row) => row.classId))];
    const studentIds = [...new Set(enrollments.map((row) => row.studentUserId))];
    const assignments = await this.prisma.db.assignment.findMany({
      where: { classId: { in: classIds }, status: { not: 'draft' } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      select: { id: true, classId: true, title: true, weight: true, maxScore: true, latePenaltyPercent: true, status: true },
    });
    const exams = await this.prisma.db.exam.findMany({
      where: { classId: { in: classIds }, status: 'published' },
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      select: { id: true, classId: true, title: true, weight: true, maxScore: true, status: true },
    });
    const components: LearnerComponent[] = [
      ...assignments.map((row) => ({
        kind: 'assignment' as const,
        id: row.id,
        classId: row.classId,
        title: readLocalizedText(row.title) ?? { ar: '' },
        weight: decimalText(row.weight),
        maxScore: row.maxScore.toString(),
        latePenaltyPercent: decimalText(row.latePenaltyPercent),
        status: row.status,
      })),
      ...exams.map((row) => ({
        kind: 'exam' as const,
        id: row.id,
        classId: row.classId,
        title: readLocalizedText(row.title) ?? { ar: '' },
        weight: decimalText(row.weight),
        maxScore: row.maxScore.toString(),
        latePenaltyPercent: null,
        status: row.status,
      })),
    ];
    const submissions =
      assignments.length === 0
        ? []
        : await this.prisma.db.assignmentSubmission.findMany({
            where: { assignmentId: { in: assignments.map((row) => row.id) }, studentUserId: { in: studentIds } },
            select: { assignmentId: true, studentUserId: true, attemptNo: true, status: true, score: true, isLate: true },
          });
    const results =
      exams.length === 0
        ? []
        : await this.prisma.db.examResult.findMany({
            where: { examId: { in: exams.map((row) => row.id) }, studentUserId: { in: studentIds } },
            select: { examId: true, studentUserId: true, status: true, score: true },
          });

    // The latest attempt's status and the latest GRADED attempt per (assignment, student) — as the gradebook (D-R36).
    const attempts = new Map<string, { latestNo: number; latestStatus: 'submitted' | 'graded' | 'returned'; gradedNo: number; gradedScore: string | null; gradedLate: boolean }>();
    for (const row of submissions) {
      const key = `${row.assignmentId}|${row.studentUserId}`;
      const entry = attempts.get(key) ?? { latestNo: 0, latestStatus: 'submitted' as const, gradedNo: 0, gradedScore: null, gradedLate: false };
      if (row.attemptNo > entry.latestNo) {
        entry.latestNo = row.attemptNo;
        entry.latestStatus = row.status;
      }
      if (row.status === 'graded' && row.attemptNo > entry.gradedNo) {
        entry.gradedNo = row.attemptNo;
        entry.gradedScore = row.score === null ? null : row.score.toString();
        entry.gradedLate = row.isLate;
      }
      attempts.set(key, entry);
    }
    const examResults = new Map(results.map((row) => [`${row.examId}|${row.studentUserId}`, { status: row.status, score: row.score === null ? null : row.score.toString() }]));

    const items: MyGradeItemDto[] = enrollments.map((row) => {
      const ownership = ownershipOf(row, caller.id);
      const mine: MyGradeComponentDto[] = components
        .filter((component) => component.classId === row.classId)
        .map((component) => {
          const key = `${component.id}|${row.studentUserId}`;
          let cell: CellInput;
          if (component.kind === 'assignment') {
            const entry = attempts.get(key);
            cell = { kind: 'assignment', lastGradedScore: entry?.gradedScore ?? null, lastGradedLate: entry?.gradedLate ?? false, latestStatus: entry ? entry.latestStatus : null };
          } else {
            const entry = examResults.get(key);
            cell = { kind: 'exam', status: entry?.status ?? null, score: entry?.score ?? null };
          }
          const outcome = cellOutcome(component, cell);
          return {
            kind: component.kind,
            id: component.id,
            title: component.title,
            weight: numberOrNull(component.weight),
            maxScore: Number(component.maxScore),
            status: outcome.status,
            score: numberOrNull(outcome.score),
            effectiveScore: numberOrNull(outcome.effectiveScore),
            late: outcome.late,
          };
        });
      return {
        enrollmentId: row.id,
        enrollmentStatus: row.status,
        relation: ownership.relation,
        student: row.student,
        class: {
          id: row.class.id,
          code: row.class.code,
          name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
          status: row.class.status,
          course: { id: row.class.course.id, code: row.class.course.code, name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code } },
        },
        components: mine,
        final: row.finalGrade
          ? {
              percent: Number(row.finalGrade.percent),
              label: readLocalizedText(row.finalGrade.bandLabel) ?? { ar: '' },
              letter: row.finalGrade.bandLetter,
              isPass: row.finalGrade.isPass,
              finalizedAt: row.finalGrade.finalizedAt.toISOString(),
            }
          : null,
      };
    });
    return { items };
  }
}
