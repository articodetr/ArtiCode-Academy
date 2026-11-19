import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { catalogError } from '../catalog/catalog.errors.js';
import { COURSE_PLAN_SELECT, coursePlanUsable } from '../catalog/course-pricing.js';
import { classesError } from '../classes/classes.errors.js';
import { ELIGIBLE_USER_STATUSES, STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import { InvoicesService } from '../finance/invoices.service.js';
import type { ClassStatus, CourseStatus, EnrollmentSource, EnrollmentStatus, Prisma } from '../generated/prisma/client.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationBatch } from '../notifications/notifications.service.js';
import { existingRowKind } from './enrollment-requests.policy.js';
import { hasFreeSeat, isEnrollableClass } from './enrollments.status.js';

type Tx = Prisma.TransactionClient;

export const ENROLLMENT_REQUEST_AUDIT_ACTIONS = {
  created: 'enrollments.created',
  requested: 'enrollments.requested',
} as const;

const ENROLLMENTS_ENTITY_TYPE = 'enrollments';

/**
 * The class row of an enrollment write, locked, with what MOD-19 needs of its
 * course: the course state and the plan that prices a request.
 */
export interface JoinClass {
  id: string;
  code: string;
  status: ClassStatus;
  capacity: number;
  selfEnrollment: boolean;
  name: LocalizedText;
  courseId: string;
  courseStatus: CourseStatus;
  courseName: LocalizedText;
  /** null = a free course (D-R122). */
  feePlanId: string | null;
}

interface JoinClassRow {
  code: string;
  status: ClassStatus;
  capacity: number;
  self_enrollment: boolean;
  name: Prisma.JsonValue;
  course_id: string;
  course_status: CourseStatus;
  course_name: Prisma.JsonValue;
  enrollment_fee_plan_id: string | null;
}

/**
 * Locks the class row with the lock of every class-dependent write of MOD-05
 * (`FOR NO KEY UPDATE`, the class row only — `OF c`) and reads its course in
 * the same statement. Every enrollment write of a class takes it first, so the
 * class → invoice order holds for the request writes too (API-150 locks the
 * class before creating invoices; payments lock only their invoice).
 */
export async function lockJoinClass(tx: Tx, classId: string): Promise<JoinClass | null> {
  const rows = await tx.$queryRaw<JoinClassRow[]>`
    SELECT c.code, c.status, c.capacity, c.self_enrollment, c.name, c.course_id,
           co.status AS course_status, co.name AS course_name, co.enrollment_fee_plan_id
    FROM classes c JOIN courses co ON co.id = c.course_id
    WHERE c.id = ${classId}::uuid
    FOR NO KEY UPDATE OF c`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: classId,
    code: row.code,
    status: row.status,
    capacity: row.capacity,
    selfEnrollment: row.self_enrollment,
    name: readLocalizedText(row.name) ?? { ar: row.code },
    courseId: row.course_id,
    courseStatus: row.course_status,
    courseName: readLocalizedText(row.course_name) ?? { ar: row.code },
    feePlanId: row.enrollment_fee_plan_id,
  };
}

export interface EnrollableStudent {
  id: string;
  name: string;
}

/**
 * For enroll, reactivate, approve and a self-service request: unknown or
 * soft-deleted 404, not invited/active 422 user_not_eligible, no `student`
 * role row 422 not_a_student (the T03 order for teachers).
 */
export async function assertEnrollableStudent(tx: Tx, studentId: string): Promise<EnrollableStudent> {
  const student = await tx.user.findUnique({
    where: { id: studentId },
    select: {
      status: true,
      deletedAt: true,
      fullName: true,
      displayName: true,
      roles: { where: { role: { key: STUDENT_ROLE_KEY } }, select: { roleId: true } },
    },
  });
  if (!student || student.deletedAt !== null) throw classesError.userNotFound(studentId);
  if (!(ELIGIBLE_USER_STATUSES as readonly string[]).includes(student.status)) throw classesError.userNotEligible(studentId, student.status);
  if (student.roles.length === 0) throw classesError.notAStudent(studentId);
  return { id: studentId, name: student.displayName ?? student.fullName };
}

export interface JoinResult {
  enrollmentId: string;
  outcome: 'enrolled' | 'requested';
  /** Every batch the write produced; dispatch each after the commit. */
  batches: NotificationBatch[];
}

const INVOICE_REQUEST_NOTE = 'Enrollment request';

/**
 * MOD-19 (roadmap §4p, D-R121..D-R127, ADR-077) — what an enrollment of
 * (class, student) becomes, inside the caller's transaction, after the
 * caller locked the class (`lockJoinClass()`), checked who may enroll here and
 * checked the student (`assertEnrollableStudent()`):
 *
 *   1. an existing row: a pending request → 409 request_pending; any row but
 *      a closed request (cancelled, never active) → 409 already_enrolled —
 *      a closed request is reopened instead;
 *   2. the class state (409 class_not_enrollable) and a free seat (409
 *      class_full) — a request does not hold a seat, approval checks again;
 *   3. a paid course needs a usable plan (409 course_price_unavailable);
 *   4. free course → the enrollment is `active` at once (`enrollments.created`);
 *      paid course → it is `pending` with an issued invoice from the course
 *      plan (`enrollments.requested`) — never active without payment (D-R127).
 *
 * Exactly one audit event. Notifications: a self-service request tells the
 * student (and guardians) and the office; an office request tells the student
 * only; a free self-service enrollment tells the student it is active; a free
 * office enrollment notifies nobody, as API-058 always did.
 */
@Injectable()
export class EnrollmentRequestsWriter {
  constructor(
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
  ) {}

  async join(
    tx: Tx,
    klass: JoinClass,
    student: EnrollableStudent,
    actorId: string,
    source: Extract<EnrollmentSource, 'admin' | 'self'>,
    ctx: RequestContext,
  ): Promise<JoinResult> {
    const existing = await tx.enrollment.findUnique({
      where: { classId_studentUserId: { classId: klass.id, studentUserId: student.id } },
      select: { id: true, status: true, activatedAt: true },
    });
    const kind = existingRowKind(existing);
    if (kind === 'pending') throw catalogError.requestPending(existing!.id);
    if (kind === 'taken') throw classesError.alreadyEnrolled(existing!.id, existing!.status);
    if (!isEnrollableClass(klass.status)) throw classesError.classNotEnrollable(klass.status);
    const activeCount = await tx.enrollment.count({ where: { classId: klass.id, status: 'active' } });
    if (!hasFreeSeat(klass.capacity, activeCount)) throw classesError.classFull(klass.capacity, activeCount);
    if (klass.feePlanId !== null) {
      const plan = await tx.feePlan.findUnique({ where: { id: klass.feePlanId }, select: COURSE_PLAN_SELECT });
      if (!plan || !coursePlanUsable(plan, klass.courseId)) throw catalogError.coursePriceUnavailable(klass.courseId, klass.feePlanId);
    }

    const now = new Date();
    const reopened = kind === 'reopen';
    const status: EnrollmentStatus = klass.feePlanId === null ? 'active' : 'pending';
    // A reopened closed request starts over: the rejection columns go (ck_enrollments_rejected_cancelled), and the
    // request instant is the new one. `enrolled_at` and `created_by` keep the row's first values.
    const columns = {
      status,
      source,
      activatedAt: status === 'active' ? now : null,
      requestedAt: status === 'pending' ? now : null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
      withdrawnAt: null,
      withdrawalReason: null,
      completedAt: null,
    } satisfies Prisma.EnrollmentUncheckedUpdateInput;
    const enrollmentId = reopened
      ? (await tx.enrollment.update({ where: { id: existing!.id }, data: columns, select: { id: true } })).id
      : (await tx.enrollment.create({ data: { ...columns, classId: klass.id, studentUserId: student.id, enrolledAt: now, createdById: actorId }, select: { id: true } })).id;
    const base = { classId: klass.id, classCode: klass.code, studentUserId: student.id, source, ...(reopened ? { reopened: true } : {}) };

    if (status === 'active') {
      await this.audit.record(
        { action: ENROLLMENT_REQUEST_AUDIT_ACTIONS.created, actorUserId: actorId, entityType: ENROLLMENTS_ENTITY_TYPE, entityId: enrollmentId, metadata: { ...base, status }, ...ctx },
        tx,
      );
      const batch =
        source === 'self'
          ? await this.notifications.notifyStudents(tx, 'enrollment.activated', [
              { studentId: student.id, params: { enrollmentId, classId: klass.id, courseName: klass.courseName, className: klass.name } },
            ])
          : EMPTY_BATCH;
      return { enrollmentId, outcome: 'enrolled', batches: [batch] };
    }

    const invoice = await this.invoices.issueForRequest(tx, { studentId: student.id, enrollmentId, feePlanId: klass.feePlanId!, callerId: actorId, now });
    await this.audit.record(
      {
        action: ENROLLMENT_REQUEST_AUDIT_ACTIONS.requested,
        actorUserId: actorId,
        entityType: ENROLLMENTS_ENTITY_TYPE,
        entityId: enrollmentId,
        metadata: {
          ...base,
          status,
          feePlanId: klass.feePlanId,
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.number,
          total: Number(invoice.total),
          currency: invoice.currency,
        },
        ...ctx,
      },
      tx,
    );
    const toStudent = await this.notifications.notifyStudents(tx, 'enrollment.requested', [
      {
        studentId: student.id,
        params: {
          enrollmentId,
          invoiceId: invoice.invoiceId,
          courseName: klass.courseName,
          className: klass.name,
          number: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
          firstDueOn: invoice.firstDueOn,
        },
      },
    ]);
    const toOffice =
      source === 'self'
        ? await this.notifications.notifyStaff(
            tx,
            'enrollment.request_received',
            { enrollmentId, studentName: student.name, courseName: klass.courseName, className: klass.name },
            [actorId],
          )
        : EMPTY_BATCH;
    return { enrollmentId, outcome: 'requested', batches: [toStudent, toOffice] };
  }

  /** The fixed `cancel_reason` of a request's invoice cancelled with it (the request's own reason stays on the enrollment). */
  static invoiceCancelReason(kind: 'rejected' | 'cancelled'): string {
    return kind === 'rejected' ? `${INVOICE_REQUEST_NOTE} rejected` : `${INVOICE_REQUEST_NOTE} cancelled by the student`;
  }

  dispatch(batches: readonly NotificationBatch[]): void {
    for (const batch of batches) this.notifications.dispatch(batch);
  }
}
