import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { EnrollmentStudentDto } from '../enrollments/enrollments.dto.js';
import { seesChildren } from '../enrollments/my-classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toIso } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { displayTimeZone } from '../schedule/timetable.policy.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import { toDecimalText } from './assignments.changes.js';
import { assignmentsError } from './assignments.errors.js';
import { READ_ASSIGNMENTS_PERMISSION, seesEveryClass, visibleAssignmentsWhere } from './assignments.policy.js';
import type { ReviewSubmissionDto, SubmissionDto, SubmissionRosterDto, SubmissionRosterItemDto, SubmissionSummaryDto, SubmitAssignmentDto } from './submissions.dto.js';
import {
  SUBMISSION_ROSTER_ENROLLMENT_STATUSES,
  SUBMITTING_ENROLLMENT_STATUS,
  isScoreInRange,
  reviewTarget,
  reviewVersionMatches,
  sameReview,
  submissionWindow,
  summarizeAttempts,
} from './submissions.policy.js';

export const SUBMISSIONS_AUDIT_ACTIONS = {
  submitted: 'assignments.submitted',
  graded: 'assignments.graded',
  returned: 'assignments.returned',
} as const;

/** Audit `entity_type` of the submission events (the assignment and class travel in the metadata). */
export const SUBMISSIONS_ENTITY_TYPE = 'assignment_submissions';

/** The academy's time zone for `assignment.timeZone` (D-R41), or UTC while the academy row is missing. */
const FALLBACK_TIME_ZONE = 'UTC';

const ASSIGNMENT_SUMMARY_SELECT = {
  id: true,
  classId: true,
  title: true,
  status: true,
  maxScore: true,
  maxAttempts: true,
  dueAt: true,
  allowLate: true,
  class: { select: { code: true } },
  lesson: { select: { room: { select: { branch: { select: { timezone: true } } } } } },
} satisfies Prisma.AssignmentSelect;

const SUBMISSION_SELECT = {
  id: true,
  assignmentId: true,
  studentUserId: true,
  attemptNo: true,
  submittedAt: true,
  isLate: true,
  textAnswer: true,
  linkUrl: true,
  status: true,
  score: true,
  feedback: true,
  gradedAt: true,
  student: { select: { id: true, fullName: true, displayName: true } },
  gradedBy: { select: { fullName: true, displayName: true } },
  assignment: { select: ASSIGNMENT_SUMMARY_SELECT },
} satisfies Prisma.AssignmentSubmissionSelect;

const SUMMARY_SELECT = {
  id: true,
  studentUserId: true,
  attemptNo: true,
  submittedAt: true,
  isLate: true,
  status: true,
  score: true,
  gradedAt: true,
} satisfies Prisma.AssignmentSubmissionSelect;

// The student as the roster shows them — a mirror of STUDENT_SELECT /
// toStudentDto() of enrollments.service.ts and attendance.service.ts (not
// exported): identity only, contact fields nulled in the reduced projection
// (D-R07). Never the password hash, the login counters or the security
// timestamps. Keep the three identical (moving them to one shared helper is a
// small follow-up PR of its own — roadmap §4g.8 (4)).
const STUDENT_SELECT = {
  id: true,
  fullName: true,
  fullNameLatin: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  email: true,
  username: true,
  phone: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type AssignmentSummaryRow = Prisma.AssignmentGetPayload<{ select: typeof ASSIGNMENT_SUMMARY_SELECT }>;
type SubmissionRow = Prisma.AssignmentSubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;
type SummaryRow = Prisma.AssignmentSubmissionGetPayload<{ select: typeof SUMMARY_SELECT }>;
type StudentRow = Prisma.UserGetPayload<{ select: typeof STUDENT_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

function projectionOf(caller: AuthPrincipal): UsersProjection {
  return caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced';
}

function toStudentDto(row: StudentRow, view: UsersProjection): EnrollmentStudentDto {
  const full = view === 'full';
  return {
    id: row.id,
    fullName: row.fullName,
    fullNameLatin: row.fullNameLatin,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    email: full ? row.email : null,
    username: full ? row.username : null,
    phone: full ? row.phone : null,
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
  };
}

function decimalOrNull(value: Prisma.Decimal | string | null): number | null {
  return value === null ? null : Number(value);
}

function toAssignmentSummary(row: AssignmentSummaryRow, academyTimeZone: string): SubmissionDto['assignment'] {
  return {
    id: row.id,
    classId: row.classId,
    title: readLocalizedText(row.title) ?? { ar: '' },
    status: row.status,
    maxScore: Number(row.maxScore),
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    allowLate: row.allowLate,
    timeZone: displayTimeZone(row.lesson?.room?.branch?.timezone, academyTimeZone),
  };
}

/** The academy's time zone (D-R41); UTC while the academy row is missing. */
async function academyTimeZone(db: Db): Promise<string> {
  const academy = await db.academy.findFirst({ select: { timezone: true } });
  return academy?.timezone ?? FALLBACK_TIME_ZONE;
}

function toSummaryDto(row: SummaryRow): SubmissionSummaryDto {
  return {
    id: row.id,
    attemptNo: row.attemptNo,
    submittedAt: toIso(row.submittedAt),
    isLate: row.isLate,
    status: row.status,
    score: decimalOrNull(row.score),
    gradedAt: row.gradedAt ? toIso(row.gradedAt) : null,
  };
}

/**
 * MOD-08-T03 — submissions and review (roadmap §4g.4 API-108..API-111; owner
 * decisions D-R35/D-R38/D-R39). The roster (API-108) follows the assignment's
 * class visibility (D-R16); a student submits to an open assignment of a class
 * they are actively enrolled in (API-109 — `assignments.submit` + ownership);
 * a submission is read (API-110) by the class's teachers with
 * `assignments.read`, by its student and by their guardian (the `guardian` role
 * and a link — the «my classes» rule); a teacher with `assignments.grade`
 * grades or returns it (API-111). Submitting locks the assignment row
 * (`FOR NO KEY UPDATE` — the T02 lock, so two attempts of one student, a PATCH
 * of the grading rules and a status action serialise); reviewing locks the
 * submission row. Every write is one transaction with exactly one audit event;
 * an identical review writes and records nothing.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** API-108 — every student with an active or completed enrollment, plus anyone holding a submission, with their attempts. */
  async roster(assignmentId: string, caller: AuthPrincipal): Promise<SubmissionRosterDto> {
    const assignment = await this.prisma.db.assignment.findFirst({ where: { AND: [{ id: assignmentId }, visibleAssignmentsWhere(caller)] }, select: ASSIGNMENT_SUMMARY_SELECT });
    if (!assignment) throw assignmentsError.assignmentNotFound(assignmentId);
    const view = projectionOf(caller);
    const submissions = await this.prisma.db.assignmentSubmission.findMany({ where: { assignmentId }, orderBy: [{ attemptNo: 'asc' }], select: SUMMARY_SELECT });
    const byStudent = new Map<string, SummaryRow[]>();
    for (const row of submissions) byStudent.set(row.studentUserId, [...(byStudent.get(row.studentUserId) ?? []), row]);
    const submittedIds = [...byStudent.keys()];
    const enrollments = await this.prisma.db.enrollment.findMany({
      where: { classId: assignment.classId, OR: [{ status: { in: [...SUBMISSION_ROSTER_ENROLLMENT_STATUSES] } }, { studentUserId: { in: submittedIds } }] },
      orderBy: { id: 'asc' },
      select: { studentUserId: true, status: true, student: { select: STUDENT_SELECT } },
    });
    const item = (student: StudentRow, enrollmentStatus: SubmissionRosterItemDto['enrollmentStatus']): SubmissionRosterItemDto => {
      const rows = byStudent.get(student.id) ?? [];
      const summary = summarizeAttempts(
        rows.map((row) => ({ attemptNo: row.attemptNo, status: row.status, score: toDecimalText(row.score === null ? null : row.score.toString()) })),
        assignment.maxAttempts,
      );
      const latest = rows.find((row) => row.attemptNo === summary.lastAttemptNo) ?? null;
      return {
        student: toStudentDto(student, view),
        enrollmentStatus,
        attempts: summary.attempts,
        attemptsAllowed: summary.attemptsAllowed,
        latest: latest ? toSummaryDto(latest) : null,
        lastGradedScore: decimalOrNull(summary.lastGradedScore),
      };
    };
    const items = enrollments.map((row) => item(row.student, row.status));
    const listed = new Set(enrollments.map((row) => row.studentUserId));
    const orphans = submittedIds.filter((studentId) => !listed.has(studentId));
    if (orphans.length > 0) {
      // A submission whose student has no enrollment row cannot come from the API (enrollments are never deleted) but is still listed.
      const users = await this.prisma.db.user.findMany({ where: { id: { in: orphans } }, orderBy: { id: 'asc' }, select: STUDENT_SELECT });
      for (const user of users) items.push(item(user, null));
    }
    return { assignment: toAssignmentSummary(assignment, await academyTimeZone(this.prisma.db)), maxAttempts: assignment.maxAttempts, items };
  }

  /** API-109 — one attempt of the calling student. */
  async submit(assignmentId: string, input: SubmitAssignmentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SubmissionDto> {
    const textAnswer = input.textAnswer ?? null;
    const linkUrl = input.linkUrl ?? null;
    if (textAnswer === null && linkUrl === null) throw assignmentsError.submissionInvalid();
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM assignments WHERE id = ${assignmentId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw assignmentsError.assignmentNotFound(assignmentId);
      const assignment = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: ASSIGNMENT_SUMMARY_SELECT });
      const enrolled = await tx.enrollment.findFirst({
        where: { classId: assignment.classId, studentUserId: caller.id, status: SUBMITTING_ENROLLMENT_STATUS },
        select: { id: true },
      });
      if (!enrolled) throw assignmentsError.notEnrolled(assignment.classId);
      const previous = await tx.assignmentSubmission.findMany({ where: { assignmentId, studentUserId: caller.id }, select: { attemptNo: true, status: true, score: true } });
      const summary = summarizeAttempts(
        previous.map((row) => ({ attemptNo: row.attemptNo, status: row.status, score: null })),
        assignment.maxAttempts,
      );
      // MOD-08-T07 (D-R49): a retried request names the attempt it meant to create — checked before the window, so a retry after closing still says what happened.
      if (input.attemptNo !== undefined && input.attemptNo !== summary.lastAttemptNo + 1) throw assignmentsError.attemptConflict(input.attemptNo, summary.lastAttemptNo + 1);
      const window = submissionWindow(assignment.status, assignment.dueAt, assignment.allowLate);
      if ('closed' in window) throw assignmentsError.assignmentClosed(window.closed, assignment.dueAt ? toIso(assignment.dueAt) : null);
      if (summary.attempts >= summary.attemptsAllowed) throw assignmentsError.attemptsExhausted(summary.attemptsAllowed, summary.attempts);
      const attemptNo = summary.lastAttemptNo + 1;
      const created = await tx.assignmentSubmission.create({
        data: { assignmentId, studentUserId: caller.id, attemptNo, isLate: window.isLate, textAnswer, linkUrl },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: SUBMISSIONS_AUDIT_ACTIONS.submitted,
          actorUserId: caller.id,
          entityType: SUBMISSIONS_ENTITY_TYPE,
          entityId: created.id,
          metadata: { assignmentId, classId: assignment.classId, code: assignment.class.code, attemptNo, isLate: window.isLate },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, created.id);
    });
  }

  /**
   * API-110 — a submission for the class's teachers (`assignments.read` +
   * the class's visibility), its student, or their guardian (the `guardian`
   * role and a link to a student who is not soft-deleted); anyone else 404.
   */
  async get(submissionId: string, caller: AuthPrincipal): Promise<SubmissionDto> {
    const row = await this.prisma.db.assignmentSubmission.findUnique({ where: { id: submissionId }, select: SUBMISSION_SELECT });
    if (!row || !(await this.mayRead(row, caller))) throw assignmentsError.submissionNotFound(submissionId);
    return this.toDto(this.prisma.db, row);
  }

  /** API-111 — grade or return one attempt (D-R39); the whole review state is written, an identical one writes nothing. */
  async review(submissionId: string, input: ReviewSubmissionDto, caller: AuthPrincipal, ctx: RequestContext): Promise<SubmissionDto> {
    const feedback = input.feedback ?? null;
    if (input.action === 'return' && feedback === null) throw assignmentsError.feedbackRequired();
    return this.prisma.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM assignment_submissions WHERE id = ${submissionId}::uuid FOR NO KEY UPDATE`;
      if (locked.length === 0) throw assignmentsError.submissionNotFound(submissionId);
      const row = await tx.assignmentSubmission.findFirst({ where: { id: submissionId, assignment: visibleAssignmentsWhere(caller) }, select: SUBMISSION_SELECT });
      if (!row) throw assignmentsError.submissionNotFound(submissionId);
      // MOD-08-T07 (D-R49): two reviewers never overwrite each other silently.
      if (!reviewVersionMatches(input.expectedGradedAt, row.gradedAt)) throw assignmentsError.reviewConflict(submissionId, row.status, row.gradedAt ? toIso(row.gradedAt) : null);
      let score: string | null = null;
      if (input.action === 'grade') {
        const maxScore = Number(row.assignment.maxScore);
        if (!isScoreInRange(input.score!, maxScore)) throw assignmentsError.scoreOutOfRange(input.score!, maxScore);
        score = toDecimalText(input.score!);
      }
      const current = { status: row.status, score: toDecimalText(row.score === null ? null : row.score.toString()), feedback: row.feedback };
      const next = reviewTarget(input.action, score, feedback);
      if (sameReview(current, next)) return this.toDto(tx, row);
      await tx.assignmentSubmission.update({
        where: { id: submissionId },
        data: { status: next.status, score: next.score, feedback: next.feedback, gradedById: caller.id, gradedAt: new Date() },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: input.action === 'grade' ? SUBMISSIONS_AUDIT_ACTIONS.graded : SUBMISSIONS_AUDIT_ACTIONS.returned,
          actorUserId: caller.id,
          entityType: SUBMISSIONS_ENTITY_TYPE,
          entityId: submissionId,
          metadata: {
            assignmentId: row.assignmentId,
            classId: row.assignment.classId,
            code: row.assignment.class.code,
            studentId: row.studentUserId,
            attemptNo: row.attemptNo,
            from: row.status,
            ...(input.action === 'grade' ? { score: Number(score) } : {}),
          },
          ...ctx,
        },
        tx,
      );
      return this.read(tx, submissionId);
    });
  }

  // ---------------------------------------------------------------------------

  private async mayRead(row: SubmissionRow, caller: AuthPrincipal): Promise<boolean> {
    if (row.studentUserId === caller.id) return true;
    if (caller.permissions.includes(READ_ASSIGNMENTS_PERMISSION)) {
      if (seesEveryClass(caller)) return true;
      const assigned = await this.prisma.db.classTeacher.findFirst({ where: { classId: row.assignment.classId, teacherUserId: caller.id }, select: { classId: true } });
      if (assigned) return true;
    }
    if (seesChildren(caller.roles)) {
      const link = await this.prisma.db.guardianStudent.findFirst({
        where: { guardianUserId: caller.id, studentUserId: row.studentUserId, student: { deletedAt: null } },
        select: { studentUserId: true },
      });
      if (link) return true;
    }
    return false;
  }

  private async read(db: Db, submissionId: string): Promise<SubmissionDto> {
    const row = await db.assignmentSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: SUBMISSION_SELECT });
    return this.toDto(db, row);
  }

  /** The DTO with the student's attempts on the assignment (counts and history). */
  private async toDto(db: Db, row: SubmissionRow): Promise<SubmissionDto> {
    // Sequential: `db` may be an interactive transaction, which runs one query at a time.
    const attempts = await db.assignmentSubmission.findMany({
      where: { assignmentId: row.assignmentId, studentUserId: row.studentUserId },
      orderBy: { attemptNo: 'asc' },
      select: SUMMARY_SELECT,
    });
    const timeZone = await academyTimeZone(db);
    const summary = summarizeAttempts(
      attempts.map((attempt) => ({ attemptNo: attempt.attemptNo, status: attempt.status, score: null })),
      row.assignment.maxAttempts,
    );
    return {
      id: row.id,
      assignment: toAssignmentSummary(row.assignment, timeZone),
      student: { id: row.student.id, fullName: row.student.fullName, displayName: row.student.displayName },
      attemptNo: row.attemptNo,
      submittedAt: toIso(row.submittedAt),
      isLate: row.isLate,
      textAnswer: row.textAnswer,
      linkUrl: row.linkUrl,
      status: row.status,
      score: decimalOrNull(row.score),
      feedback: row.feedback,
      gradedBy: row.gradedBy ? { fullName: row.gradedBy.fullName, displayName: row.gradedBy.displayName } : null,
      gradedAt: row.gradedAt ? toIso(row.gradedAt) : null,
      attempts: summary.attempts,
      attemptsAllowed: summary.attemptsAllowed,
      history: attempts.map(toSummaryDto),
    };
  }
}
