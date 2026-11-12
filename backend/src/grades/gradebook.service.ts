import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText, sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { canManageClasses } from '../classes/classes.policy.js';
import { ROSTER_STUDENT_SELECT, rosterProjectionOf, toRosterStudentDto } from '../enrollments/roster-student.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ClassStatus } from '../generated/prisma/client.js';
import type { NotificationEventParams } from '../notifications/notifications.events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { formatNumber } from '../notifications/notifications.templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UsersProjection } from '../users/users.service.js';
import { bandOf, percentText } from './grade-schemes.changes.js';
import { canonicalJson, cellOutcome, isReady, isWeighted, readinessOf, weightedPercent } from './gradebook.calc.js';
import type { CellInput, CellOutcome, GradeComponent } from './gradebook.calc.js';
import type { FinalizeGradesDto, GradebookDto, GradebookStudentDto } from './gradebook.dto.js';
import { gradesError } from './grades.errors.js';

export const GRADES_AUDIT_ACTIONS = {
  finalized: 'grades.finalized',
  withdrawn: 'grades.withdrawn',
} as const;

/** The finalization events are recorded on the class. */
export const GRADES_ENTITY_TYPE = 'classes';

/** Final grades are fixed for a class in one of these states (D-R45). */
export const GRADABLE_CLASS_STATUSES: readonly ClassStatus[] = ['running', 'completed'];
/** The students of a gradebook and of a finalization (as the rosters). */
const GRADED_ENROLLMENT_STATUSES = ['active', 'completed'] as const;

type Tx = Prisma.TransactionClient;
export type GradesDb = Tx | PrismaService['db'];
type Db = GradesDb;

interface ComponentRow extends GradeComponent {
  title: LocalizedText;
  updatedAt: Date;
}

interface StudentRow {
  enrollmentId: string;
  enrollmentStatus: (typeof GRADED_ENROLLMENT_STATUSES)[number];
  student: Prisma.UserGetPayload<{ select: typeof ROSTER_STUDENT_SELECT }>;
  outcomes: CellOutcome[];
  /** The latest change of anything this student's grade reads. */
  sourcesChangedAt: number;
  final: {
    percent: string;
    schemeId: string;
    bandLabel: LocalizedText;
    bandLetter: string | null;
    isPass: boolean;
    breakdown: unknown;
    finalizedAt: Date;
    finalizedBy: { id: string; fullName: string } | null;
  } | null;
}

/** An enrollment's final grade as MOD-10 reads it (D-R52). */
export interface FinalGradeState {
  enrollmentId: string;
  enrollmentStatus: 'active' | 'completed';
  /** The roster projection source (ROSTER_STUDENT_SELECT). */
  student: StudentRow['student'];
  final: { percent: string; bandLabel: LocalizedText; bandLetter: string | null; isPass: boolean; finalizedAt: Date; stale: boolean } | null;
}

interface Loaded {
  klass: { id: string; code: string; name: LocalizedText; status: ClassStatus };
  components: ComponentRow[];
  students: StudentRow[];
}

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** The weighted components with the student's outcome — the snapshot a final grade keeps (D-R44). */
function breakdownOf(components: readonly ComponentRow[], outcomes: readonly CellOutcome[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  components.forEach((component, index) => {
    if (!isWeighted(component)) return;
    const outcome = outcomes[index]!;
    rows.push({
      kind: component.kind,
      id: component.id,
      title: component.title,
      weight: Number(component.weight),
      maxScore: Number(component.maxScore),
      status: outcome.status,
      score: numberOrNull(outcome.score),
      effectiveScore: numberOrNull(outcome.effectiveScore),
      late: outcome.late,
    });
  });
  return rows;
}

/** One `grades.finalized` notification: the student and what the event is worded from. */
interface FinalizedNotice {
  studentId: string;
  params: NotificationEventParams['grades.finalized'];
}

/** MOD-12-T03: what a student is told about a final grade — the percentage and the band exactly as they were just written. */
function finalizedNotice(klass: Loaded['klass'], studentId: string, grade: { percent: string; bandLabel: LocalizedText; bandLetter: string | null }): FinalizedNotice {
  return { studentId, params: { classId: klass.id, className: klass.name, percent: formatNumber(grade.percent), bandLabel: grade.bandLabel, bandLetter: grade.bandLetter } };
}

/**
 * MOD-09-T05 — the gradebook and the final grades of a class (roadmap §4h.4
 * API-126..API-128; owner decisions D-R43..D-R45). The gradebook is computed
 * on read from the class's non-draft assignments (the latest graded attempt of
 * each student, with the late penalty) and exams (the recorded results) by the
 * pure `gradebook.calc.ts` — nothing is stored but the final grade (D-R44).
 * Reading needs `grades.read_all`, finalizing and withdrawing `grades.manage`,
 * all through the class's visibility (D-R16: `classes.manage` sees every
 * class, anyone else the classes they teach — others are 404). A finalization
 * fixes, for every active or completed enrollment of a running or completed
 * class, the percentage (missing work and absences count 0, an excused exam is
 * left out — D-R45), the band of the default (or chosen) grade scheme and the
 * breakdown, once nothing is pending (no weighted assignment open, no latest
 * attempt waiting for review, every weighted exam published). It runs in one
 * transaction under the class-row lock (`FOR NO KEY UPDATE`), writes only what
 * differs and records exactly one `grades.finalized`; `finalized_at` is taken
 * before the sources are read, so a grade written meanwhile shows the final
 * grade as `stale` (finalize again). Withdrawing deletes the class's final
 * grades with one `grades.withdrawn`. Since MOD-10-T02 (D-R54) both refuse a
 * class that has an issued certificate (`409 grades_certified`) before any
 * write — the certificates are revoked first. `finalGradeStates()` hands MOD-10
 * each enrollment's final grade and whether it is stale, inside the issuing
 * transaction (after the same class-row lock). Since MOD-12-T03 a finalization
 * also writes, in the same transaction, one `grades.finalized` notification per
 * final grade it created or changed — to the student and their guardians
 * (D-R80/D-R81); the unchanged and the skipped students are told nothing, and
 * neither is anybody by a withdrawal. The e-mail copies go out after the commit.
 */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** API-126 */
  async gradebook(classId: string, caller: AuthPrincipal): Promise<GradebookDto> {
    await this.assertVisible(this.prisma.db, classId, caller);
    return this.build(this.prisma.db, await this.load(this.prisma.db, classId), rosterProjectionOf(caller));
  }

  /** API-127 */
  async finalize(classId: string, input: FinalizeGradesDto, caller: AuthPrincipal, ctx: RequestContext): Promise<GradebookDto> {
    const view = rosterProjectionOf(caller);
    const { dto, batch } = await this.prisma.db.$transaction(async (tx) => {
      const klass = await this.lockClass(tx, classId, caller);
      await this.assertNotCertified(tx, classId);
      if (!GRADABLE_CLASS_STATUSES.includes(klass.status)) throw gradesError.classNotGradable(classId, klass.status);
      const scheme = await this.schemeFor(tx, input.schemeId);
      const finalizedAt = new Date(); // before the sources are read: a later change marks the result stale
      const loaded = await this.load(tx, classId);
      const readiness = readinessOf(
        loaded.components,
        loaded.students.map((student) => student.outcomes),
      );
      if (readiness.weightedComponents === 0) throw gradesError.gradesNotReady(readiness, 'no_weighted_components');
      if (!isReady(readiness)) throw gradesError.gradesNotReady(readiness);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      // MOD-12-T03: the final grades this run writes, each worth one notification.
      const written: FinalizedNotice[] = [];
      for (const student of loaded.students) {
        const percent = weightedPercent(loaded.components, student.outcomes, 'final');
        if (percent === null) {
          skipped += 1; // every weighted component excused: nothing to grade
          continue;
        }
        const band = bandOf(scheme.bands, Number(percent))!;
        const next = {
          percent,
          schemeId: scheme.id,
          bandLabel: band.label,
          bandLetter: band.letter,
          isPass: band.isPass,
          breakdown: breakdownOf(loaded.components, student.outcomes),
        };
        const current = student.final;
        if (current === null) {
          await tx.finalGrade.create({
            data: { enrollmentId: student.enrollmentId, ...next, bandLabel: next.bandLabel as Prisma.InputJsonValue, breakdown: next.breakdown as Prisma.InputJsonValue, finalizedById: caller.id, finalizedAt },
            select: { enrollmentId: true },
          });
          created += 1;
          written.push(finalizedNotice(loaded.klass, student.student.id, next));
          continue;
        }
        const same =
          percentText(current.percent) === next.percent &&
          current.schemeId === next.schemeId &&
          sameLocalizedText(current.bandLabel, next.bandLabel) &&
          current.bandLetter === next.bandLetter &&
          current.isPass === next.isPass &&
          canonicalJson(current.breakdown) === canonicalJson(next.breakdown);
        if (same) continue;
        await tx.finalGrade.update({
          where: { enrollmentId: student.enrollmentId },
          data: { ...next, bandLabel: next.bandLabel as Prisma.InputJsonValue, breakdown: next.breakdown as Prisma.InputJsonValue, finalizedById: caller.id, finalizedAt },
          select: { enrollmentId: true },
        });
        updated += 1;
        // Only what the student sees on «my grades» is news: another percentage or band. A changed breakdown or scheme
        // alone rewrites the row quietly.
        const outcomeChanged =
          percentText(current.percent) !== next.percent ||
          !sameLocalizedText(current.bandLabel, next.bandLabel) ||
          current.bandLetter !== next.bandLetter ||
          current.isPass !== next.isPass;
        if (outcomeChanged) written.push(finalizedNotice(loaded.klass, student.student.id, next));
      }
      if (created + updated > 0) {
        await this.audit.record(
          {
            action: GRADES_AUDIT_ACTIONS.finalized,
            actorUserId: caller.id,
            entityType: GRADES_ENTITY_TYPE,
            entityId: classId,
            metadata: { code: klass.code, schemeId: scheme.id, created, updated, ...(skipped > 0 ? { skipped } : {}) },
            ...ctx,
          },
          tx,
        );
      }
      // After the writes, still under the class-row lock; an identical run wrote nothing, so it tells nobody (an empty list is no query at all).
      const batch = await this.notifications.notifyStudents(tx, 'grades.finalized', written);
      return { dto: await this.build(tx, await this.load(tx, classId), view), batch };
    });
    this.notifications.dispatch(batch); // after the commit — the e-mail copies never delay or fail the request
    return dto;
  }

  /** API-128 */
  async withdraw(classId: string, caller: AuthPrincipal, ctx: RequestContext): Promise<GradebookDto> {
    const view = rosterProjectionOf(caller);
    return this.prisma.db.$transaction(async (tx) => {
      const klass = await this.lockClass(tx, classId, caller);
      await this.assertNotCertified(tx, classId);
      const { count } = await tx.finalGrade.deleteMany({ where: { enrollment: { classId } } });
      if (count > 0) {
        await this.audit.record(
          { action: GRADES_AUDIT_ACTIONS.withdrawn, actorUserId: caller.id, entityType: GRADES_ENTITY_TYPE, entityId: classId, metadata: { code: klass.code, count }, ...ctx },
          tx,
        );
      }
      return this.build(tx, await this.load(tx, classId), view);
    });
  }

  /**
   * MOD-10 (D-R52): every active or completed enrollment of the class with its
   * final grade and whether a source changed after it was fixed. Read with the
   * caller's `db` — inside the issuing transaction after its class-row lock.
   */
  async finalGradeStates(db: Db, classId: string): Promise<FinalGradeState[]> {
    const loaded = await this.load(db, classId);
    return loaded.students.map((student) => ({
      enrollmentId: student.enrollmentId,
      enrollmentStatus: student.enrollmentStatus,
      student: student.student,
      final: student.final
        ? {
            percent: student.final.percent,
            bandLabel: student.final.bandLabel,
            bandLetter: student.final.bandLetter,
            isPass: student.final.isPass,
            finalizedAt: student.final.finalizedAt,
            stale: student.sourcesChangedAt > student.final.finalizedAt.getTime(),
          }
        : null,
    }));
  }

  // ---------------------------------------------------------------------------

  /** D-R54: no new final grades and no withdrawal while the class has an issued certificate. */
  private async assertNotCertified(tx: Tx, classId: string): Promise<void> {
    const certificateCount = await tx.certificate.count({ where: { classId, status: 'issued' } });
    if (certificateCount > 0) throw gradesError.gradesCertified(classId, certificateCount);
  }

  private async assertVisible(db: Db, classId: string, caller: AuthPrincipal): Promise<void> {
    const klass = await db.class.findUnique({ where: { id: classId }, select: { id: true } });
    if (!klass) throw gradesError.classNotFound(classId);
    if (canManageClasses(caller.permissions)) return;
    const assigned = await db.classTeacher.findFirst({ where: { classId, teacherUserId: caller.id }, select: { classId: true } });
    if (!assigned) throw gradesError.classNotFound(classId);
  }

  /** Locks the class row (the MOD-05 lock) and applies the visibility rule; an unknown or invisible class is 404. */
  private async lockClass(tx: Tx, classId: string, caller: AuthPrincipal): Promise<{ code: string; status: ClassStatus }> {
    const locked = await tx.$queryRaw<{ code: string; status: ClassStatus }[]>`SELECT code, status FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
    const klass = locked[0];
    if (!klass) throw gradesError.classNotFound(classId);
    await this.assertVisible(tx, classId, caller);
    return klass;
  }

  /** The chosen active scheme, or the default one. */
  private async schemeFor(tx: Tx, schemeId: string | undefined) {
    const select = { id: true, bands: { select: { minPercent: true, label: true, letter: true, isPass: true } } } as const;
    const scheme = schemeId
      ? await tx.gradeScheme.findFirst({ where: { id: schemeId, isActive: true }, select })
      : await tx.gradeScheme.findFirst({ where: { isDefault: true }, select });
    if (!scheme) throw schemeId ? gradesError.gradeSchemeNotFound(schemeId) : gradesError.gradeSchemeMissing();
    return {
      id: scheme.id,
      bands: scheme.bands.map((band) => ({ minPercent: percentText(band.minPercent.toString()), label: readLocalizedText(band.label) ?? { ar: '' }, letter: band.letter, isPass: band.isPass })),
    };
  }

  /** Every source of the class's grades, read in order (sequential — `db` may be a transaction). */
  private async load(db: Db, classId: string): Promise<Loaded> {
    const klass = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { id: true, code: true, name: true, status: true } });
    const assignments = await db.assignment.findMany({
      where: { classId, status: { not: 'draft' } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      select: { id: true, title: true, weight: true, maxScore: true, latePenaltyPercent: true, status: true, updatedAt: true },
    });
    const exams = await db.exam.findMany({
      where: { classId, status: { not: 'draft' } },
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      select: { id: true, title: true, weight: true, maxScore: true, status: true, updatedAt: true },
    });
    const components: ComponentRow[] = [
      ...assignments.map((row) => ({
        kind: 'assignment' as const,
        id: row.id,
        title: readLocalizedText(row.title) ?? { ar: '' },
        weight: decimalText(row.weight),
        maxScore: row.maxScore.toString(),
        latePenaltyPercent: decimalText(row.latePenaltyPercent),
        status: row.status,
        updatedAt: row.updatedAt,
      })),
      ...exams.map((row) => ({
        kind: 'exam' as const,
        id: row.id,
        title: readLocalizedText(row.title) ?? { ar: '' },
        weight: decimalText(row.weight),
        maxScore: row.maxScore.toString(),
        latePenaltyPercent: null,
        status: row.status,
        updatedAt: row.updatedAt,
      })),
    ];
    const enrollments = await db.enrollment.findMany({
      where: { classId, status: { in: [...GRADED_ENROLLMENT_STATUSES] } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        studentUserId: true,
        student: { select: ROSTER_STUDENT_SELECT },
        finalGrade: {
          select: { percent: true, schemeId: true, bandLabel: true, bandLetter: true, isPass: true, breakdown: true, finalizedAt: true, finalizedBy: { select: { id: true, fullName: true } } },
        },
      },
    });
    const studentIds = enrollments.map((row) => row.studentUserId);
    const submissions =
      assignments.length === 0 || studentIds.length === 0
        ? []
        : await db.assignmentSubmission.findMany({
            where: { assignmentId: { in: assignments.map((row) => row.id) }, studentUserId: { in: studentIds } },
            select: { assignmentId: true, studentUserId: true, attemptNo: true, status: true, score: true, isLate: true, updatedAt: true },
          });
    const results =
      exams.length === 0 || studentIds.length === 0
        ? []
        : await db.examResult.findMany({
            where: { examId: { in: exams.map((row) => row.id) }, studentUserId: { in: studentIds } },
            select: { examId: true, studentUserId: true, status: true, score: true, updatedAt: true },
          });

    // Per (assignment, student): the latest attempt's status and the latest GRADED attempt (D-R36).
    const attempts = new Map<string, { latestNo: number; latestStatus: 'submitted' | 'graded' | 'returned'; gradedNo: number; gradedScore: string | null; gradedLate: boolean }>();
    const changedAt = new Map<string, number>();
    const touch = (studentId: string, at: Date) => changedAt.set(studentId, Math.max(changedAt.get(studentId) ?? 0, at.getTime()));
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
      touch(row.studentUserId, row.updatedAt);
    }
    const examResults = new Map<string, { status: 'scored' | 'absent' | 'excused'; score: string | null }>();
    for (const row of results) {
      examResults.set(`${row.examId}|${row.studentUserId}`, { status: row.status, score: row.score === null ? null : row.score.toString() });
      touch(row.studentUserId, row.updatedAt);
    }
    const componentsChangedAt = Math.max(0, ...components.map((component) => component.updatedAt.getTime()));

    const students: StudentRow[] = enrollments.map((row) => {
      const outcomes = components.map((component) => {
        const key = `${component.id}|${row.studentUserId}`;
        let cell: CellInput;
        if (component.kind === 'assignment') {
          const entry = attempts.get(key);
          cell = { kind: 'assignment', lastGradedScore: entry?.gradedScore ?? null, lastGradedLate: entry?.gradedLate ?? false, latestStatus: entry ? entry.latestStatus : null };
        } else {
          const entry = examResults.get(key);
          cell = { kind: 'exam', status: entry?.status ?? null, score: entry?.score ?? null };
        }
        return cellOutcome(component, cell);
      });
      const final = row.finalGrade
        ? {
            percent: row.finalGrade.percent.toString(),
            schemeId: row.finalGrade.schemeId,
            bandLabel: readLocalizedText(row.finalGrade.bandLabel) ?? { ar: '' },
            bandLetter: row.finalGrade.bandLetter,
            isPass: row.finalGrade.isPass,
            breakdown: row.finalGrade.breakdown,
            finalizedAt: row.finalGrade.finalizedAt,
            finalizedBy: row.finalGrade.finalizedBy,
          }
        : null;
      return {
        enrollmentId: row.id,
        enrollmentStatus: row.status as StudentRow['enrollmentStatus'],
        student: row.student,
        outcomes,
        sourcesChangedAt: Math.max(componentsChangedAt, changedAt.get(row.studentUserId) ?? 0),
        final,
      };
    });
    return { klass: { id: klass.id, code: klass.code, name: readLocalizedText(klass.name) ?? { ar: klass.code }, status: klass.status }, components, students };
  }

  private async build(db: Db, loaded: Loaded, view: UsersProjection): Promise<GradebookDto> {
    const readiness = readinessOf(
      loaded.components,
      loaded.students.map((student) => student.outcomes),
    );
    const defaultScheme = await db.gradeScheme.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });
    const students: GradebookStudentDto[] = loaded.students.map((student) => ({
      enrollmentId: student.enrollmentId,
      enrollmentStatus: student.enrollmentStatus,
      student: toRosterStudentDto(student.student, view),
      cells: loaded.components.map((component, index) => {
        const outcome = student.outcomes[index]!;
        return { kind: component.kind, id: component.id, status: outcome.status, score: numberOrNull(outcome.score), effectiveScore: numberOrNull(outcome.effectiveScore), late: outcome.late };
      }),
      current: numberOrNull(weightedPercent(loaded.components, student.outcomes, 'current')),
      projected: numberOrNull(weightedPercent(loaded.components, student.outcomes, 'final')),
      final: student.final
        ? {
            percent: Number(student.final.percent),
            schemeId: student.final.schemeId,
            label: student.final.bandLabel,
            letter: student.final.bandLetter,
            isPass: student.final.isPass,
            finalizedAt: student.final.finalizedAt.toISOString(),
            finalizedBy: student.final.finalizedBy ? { userId: student.final.finalizedBy.id, fullName: student.final.finalizedBy.fullName } : null,
            stale: student.sourcesChangedAt > student.final.finalizedAt.getTime(),
          }
        : null,
    }));
    return {
      class: loaded.klass,
      components: loaded.components.map((component) => ({
        kind: component.kind,
        id: component.id,
        title: component.title,
        weight: numberOrNull(component.weight),
        maxScore: Number(component.maxScore),
        latePenaltyPercent: numberOrNull(component.latePenaltyPercent),
        status: component.status,
        counted: isWeighted(component),
      })),
      students,
      readiness: { ...readiness, ready: readiness.weightedComponents > 0 && isReady(readiness) },
      defaultScheme: defaultScheme ? { id: defaultScheme.id, name: readLocalizedText(defaultScheme.name) ?? { ar: '' } } : null,
    };
  }
}
