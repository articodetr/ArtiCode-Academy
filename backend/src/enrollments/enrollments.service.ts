import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { catalogError } from '../catalog/catalog.errors.js';
import { classesError } from '../classes/classes.errors.js';
import { MANAGE_ENROLLMENTS_PERMISSION } from '../classes/classes.policy.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { InvoicesService } from '../finance/invoices.service.js';
import type { EnrollmentInvoiceRow } from '../finance/invoices.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationBatch } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import type { UsersProjection } from '../users/users.service.js';
import { paymentSettled, refundLeftNothingPaid, requestPayment } from './enrollment-requests.policy.js';
import type { RequestPaymentState } from './enrollment-requests.policy.js';
import { assertEnrollableStudent, EnrollmentRequestsWriter, lockJoinClass } from './enrollment-requests.writer.js';
import { ENROLLMENTS_PAGE_DEFAULT } from './enrollments.dto.js';
import type {
  ChangeEnrollmentStatusDto,
  CreateEnrollmentDto,
  EnrollmentDto,
  EnrollmentListDto,
  ListEnrollmentsQueryDto,
} from './enrollments.dto.js';
import { enrollmentsError } from './enrollments.errors.js';
import {
  allowedEnrollmentActions,
  canReadRoster,
  enrollmentWrite,
  hasFreeSeat,
  isEnrollableClass,
  nextEnrollmentStatus,
  takesSeat,
} from './enrollments.status.js';
import { ROSTER_STUDENT_SELECT, toRosterStudentDto } from './roster-student.js';

export const ENROLLMENTS_AUDIT_ACTIONS = {
  created: 'enrollments.created',
  statusChanged: 'enrollments.status.changed',
  // MOD-19 (D-R125): a pending request with its invoice — the writer records it.
  requested: 'enrollments.requested',
} as const;

/** Audit `entity_type` of enrollment events (`entity_id` = the enrollment). */
export const ENROLLMENTS_ENTITY_TYPE = 'enrollments';

/** The roster keyset sorts by the time-ordered primary key alone (enrollment order). */
const ROSTER_SORT = 'createdAt';
const ROSTER_ORDER = 'asc';

const ENROLLMENT_SELECT = {
  id: true,
  classId: true,
  status: true,
  source: true,
  enrolledAt: true,
  activatedAt: true,
  completedAt: true,
  withdrawnAt: true,
  withdrawalReason: true,
  requestedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  student: { select: ROSTER_STUDENT_SELECT },
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{ select: typeof ENROLLMENT_SELECT }>;

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * What the caller sees of an enrollment: contact identifiers for holders of
 * `users.read_contact` only (D-R07), and the withdrawal and rejection reasons
 * for holders of `enrollments.manage` only — an assigned teacher reading the
 * roster gets `null` (owner decision in the PR #14 review). `student.deletedAt`
 * stays visible to every roster reader.
 */
interface EnrollmentView {
  contact: UsersProjection;
  withdrawalReason: boolean;
}

function viewOf(caller: AuthPrincipal): EnrollmentView {
  return {
    contact: caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced',
    withdrawalReason: caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION),
  };
}

function toEnrollmentDto(row: EnrollmentRow, view: EnrollmentView, paymentState: RequestPaymentState | null): EnrollmentDto {
  return {
    id: row.id,
    classId: row.classId,
    status: row.status,
    source: row.source,
    enrolledAt: row.enrolledAt.toISOString(),
    activatedAt: isoOrNull(row.activatedAt),
    completedAt: isoOrNull(row.completedAt),
    withdrawnAt: isoOrNull(row.withdrawnAt),
    withdrawalReason: view.withdrawalReason ? row.withdrawalReason : null,
    requestedAt: isoOrNull(row.requestedAt),
    rejectedAt: isoOrNull(row.rejectedAt),
    rejectionReason: view.withdrawalReason ? row.rejectionReason : null,
    paymentState,
    student: toRosterStudentDto(row.student, view.contact),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type InvoiceMoneyRow = Pick<EnrollmentInvoiceRow, 'status' | 'totalAmount' | 'paidAmount'>;

/** The invoices a payment state is computed from, by enrollment. */
export function invoicesByEnrollment(rows: ReadonlyArray<{ enrollmentId: string | null } & InvoiceMoneyRow>): Map<string, InvoiceMoneyRow[]> {
  const map = new Map<string, InvoiceMoneyRow[]>();
  for (const row of rows) {
    if (row.enrollmentId === null) continue;
    const list = map.get(row.enrollmentId) ?? [];
    list.push(row);
    map.set(row.enrollmentId, list);
  }
  return map;
}

const REJECTED_INVOICE_REASON = EnrollmentRequestsWriter.invoiceCancelReason('rejected');

/**
 * MOD-05-T04 — enrollments (roadmap §4d.4, D-R16/D-R18), and since MOD-19
 * (roadmap §4p, D-R121..D-R127) the office side of enrollment requests. The
 * roster of a class is read by holders of `enrollments.manage` or by a teacher
 * assigned to the class (everyone else 404); `enrollments.manage` enrolls a
 * student — straight to `active` for a free course, as a `pending` request
 * with an issued invoice for a paid one (D-R127) — and runs the enrollment
 * actions, `approve` and `reject` of a request among them. Enrolling,
 * reactivating and approving check the student, the class state and the hard
 * capacity behind the class-row lock, so two requests for the last seat cannot
 * both succeed. Every write is one transaction with exactly one audit event
 * (`enrollments.*`); a refusal writes and records nothing.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly writer: EnrollmentRequestsWriter,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(classId: string, query: ListEnrollmentsQueryDto, caller: AuthPrincipal): Promise<EnrollmentListDto> {
    const coursePaid = await this.assertRosterReadable(classId, caller);
    const limit = query.limit ?? ENROLLMENTS_PAGE_DEFAULT;
    const filters: Prisma.EnrollmentWhereInput[] = [{ classId }];
    if (query.status) filters.push({ status: query.status });
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, ROSTER_SORT, ROSTER_ORDER, false, () => classesError.cursorInvalid());
      filters.push({ id: { gt: cursor.id } });
    }
    const rows = await this.prisma.db.enrollment.findMany({
      where: { AND: filters },
      orderBy: [{ id: 'asc' }],
      take: limit + 1,
      select: ENROLLMENT_SELECT,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeKeysetCursor({ sort: ROSTER_SORT, order: ROSTER_ORDER, key: null, id: last.id }) : null;
    const view = viewOf(caller);
    const states = await this.paymentStates(
      page.filter((row) => row.status === 'pending').map((row) => row.id),
      coursePaid,
    );
    return { items: page.map((row) => toEnrollmentDto(row, view, states.get(row.id) ?? null)), nextCursor };
  }

  /**
   * Enrolls an invited or active student who holds the `student` role into an
   * open or running class with a free seat. Checks, in order: class (404),
   * student (404 / 422 user_not_eligible / 422 not_a_student), an existing
   * enrollment (409 request_pending for a pending request; 409 already_enrolled
   * for any other row but a closed request, which is reopened — reactivate the
   * others instead), class state (409 class_not_enrollable), capacity (409
   * class_full), and for a paid course a usable plan (409
   * course_price_unavailable). A paid course yields a `pending` request with
   * its issued invoice, never an active enrollment (MOD-19, D-R127).
   */
  async enroll(classId: string, input: CreateEnrollmentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<EnrollmentDto> {
    const studentId = input.studentId;
    let enrollmentId: string;
    let batches: NotificationBatch[];
    try {
      ({ enrollmentId, batches } = await this.prisma.db.$transaction(async (tx) => {
        const klass = await lockJoinClass(tx, classId);
        if (!klass) throw classesError.classNotFound(classId);
        const student = await assertEnrollableStudent(tx, studentId);
        return this.writer.join(tx, klass, student, caller.id, 'admin', ctx);
      }));
    } catch (error) {
      throw await this.translateEnrollError(error, classId, studentId);
    }
    this.writer.dispatch(batches);
    return this.getById(enrollmentId, caller);
  }

  /**
   * withdraw / complete / cancel / reactivate (enrollments.status.ts), and
   * since MOD-19 approve / reject of a request. The class row is locked first,
   * so the action runs one after the other with enrollments, capacity changes
   * and the class's own complete/cancel (which move active enrollments).
   * `reactivate` and `approve` open an active period, so they re-check
   * everything a new enrollment checks: the student (404 / 422
   * user_not_eligible / 422 not_a_student), then the class state and the
   * capacity. `approve` then needs every issued invoice of the enrollment paid
   * in full (409 payment_required — D-R125); so does `reactivate` of a row that
   * never was active in a paid course (D-R127). `reject` needs a reason (400
   * rejection_reason_required), refuses a request with a completed payment
   * (409 request_has_payments) and cancels its unpaid issued invoices in the
   * same transaction (D-R126). The invoices are locked after the class row.
   */
  async changeStatus(id: string, input: ChangeEnrollmentStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<EnrollmentDto> {
    const reason = input.reason ?? null;
    if (input.action === 'reject' && reason === null) throw catalogError.rejectionReasonRequired();
    const target = await this.prisma.db.enrollment.findUnique({ where: { id }, select: { classId: true } });
    if (!target) throw classesError.enrollmentNotFound(id);
    const classId = target.classId;

    const batch = await this.prisma.db.$transaction(async (tx): Promise<NotificationBatch> => {
      // A class with enrollments cannot be deleted (Restrict), so the row exists.
      const klass = await lockJoinClass(tx, classId);
      if (!klass) throw classesError.enrollmentNotFound(id);
      const current = await tx.enrollment.findUnique({ where: { id }, select: { status: true, studentUserId: true, activatedAt: true } });
      if (!current) throw classesError.enrollmentNotFound(id);
      const to = nextEnrollmentStatus(input.action, current.status);
      if (to === null) throw enrollmentsError.invalidTransition(current.status, input.action, allowedEnrollmentActions(current.status));

      if (takesSeat(input.action)) {
        await assertEnrollableStudent(tx, current.studentUserId);
        if (!isEnrollableClass(klass.status)) throw classesError.classNotEnrollable(klass.status);
        const activeCount = await tx.enrollment.count({ where: { classId, status: 'active' } });
        if (!hasFreeSeat(klass.capacity, activeCount)) throw classesError.classFull(klass.capacity, activeCount);
      }

      const coursePaid = klass.feePlanId !== null;
      const neverActive = current.activatedAt === null;
      const readsInvoices = input.action === 'approve' || input.action === 'reject' || (input.action === 'reactivate' && (neverActive || coursePaid));
      const invoices = readsInvoices ? await this.invoices.lockEnrollmentInvoices(tx, id) : [];
      const now = new Date();
      const extra: Record<string, unknown> = {};

      const unpaidInvoices = () =>
        invoices
          .filter((invoice) => invoice.status === 'issued' && invoice.paidAmount.lt(invoice.totalAmount))
          .map((invoice) => ({ id: invoice.id, number: invoice.number, balance: Number(invoice.totalAmount.minus(invoice.paidAmount).toFixed(2)) }));
      if (input.action === 'approve' || (input.action === 'reactivate' && neverActive && coursePaid)) {
        const payment = requestPayment(coursePaid, invoices);
        if (!paymentSettled(payment.state)) throw catalogError.paymentRequired(id, payment.state, unpaidInvoices());
        extra['paymentState'] = payment.state;
      }
      if (input.action === 'reactivate' && !neverActive && coursePaid) {
        const payment = requestPayment(coursePaid, invoices);
        const reversed = await this.invoices.reversedPaymentCount(tx, invoices.map((invoice) => invoice.id));
        if (refundLeftNothingPaid(reversed, payment.state)) throw catalogError.paymentRequired(id, payment.state, unpaidInvoices());
      }
      if (input.action === 'reject') {
        const issuedIds = invoices.filter((invoice) => invoice.status === 'issued').map((invoice) => invoice.id);
        const paymentCount = await this.invoices.completedPaymentCount(tx, issuedIds);
        if (paymentCount > 0) throw catalogError.requestHasPayments(id, paymentCount);
        await this.invoices.cancelForRequest(tx, issuedIds, caller.id, REJECTED_INVOICE_REASON, now);
        if (issuedIds.length > 0) extra['cancelledInvoiceIds'] = issuedIds;
      }

      // Conditional on the status read under the lock (belt and braces: every
      // writer of this class's enrollments takes the same lock).
      const written = await tx.enrollment.updateMany({
        where: { id, status: current.status },
        data: enrollmentWrite(input.action, to, now, reason, caller.id),
      });
      if (written.count !== 1) throw enrollmentsError.invalidTransition(current.status, input.action, allowedEnrollmentActions(current.status));

      await this.audit.record(
        {
          action: ENROLLMENTS_AUDIT_ACTIONS.statusChanged,
          actorUserId: caller.id,
          entityType: ENROLLMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: {
            classId,
            classCode: klass.code,
            studentUserId: current.studentUserId,
            action: input.action,
            from: current.status,
            to,
            ...(reason !== null ? { reason } : {}),
            ...extra,
          },
          ...ctx,
        },
        tx,
      );

      const names = { courseName: klass.courseName, className: klass.name };
      if (input.action === 'approve') {
        return this.notifications.notifyStudents(tx, 'enrollment.activated', [{ studentId: current.studentUserId, params: { enrollmentId: id, classId, ...names } }]);
      }
      if (input.action === 'reject') {
        return this.notifications.notifyStudents(tx, 'enrollment.rejected', [{ studentId: current.studentUserId, params: { enrollmentId: id, ...names } }]);
      }
      return EMPTY_BATCH;
    });
    this.notifications.dispatch(batch);
    return this.getById(id, caller);
  }

  /**
   * D-R16: the roster belongs to enrollment managers and to the class's
   * assigned teachers; anyone else gets 404 as for an unknown class. Returns
   * whether the class's course is paid (the payment state of its requests).
   */
  private async assertRosterReadable(classId: string, caller: AuthPrincipal): Promise<boolean> {
    const klass = await this.prisma.db.class.findUnique({
      where: { id: classId },
      select: {
        teachers: { where: { teacherUserId: caller.id }, select: { teacherUserId: true } },
        course: { select: { enrollmentFeePlanId: true } },
      },
    });
    const manages = caller.permissions.includes(MANAGE_ENROLLMENTS_PERMISSION);
    if (!klass || !canReadRoster(manages, klass.teachers.length > 0)) throw classesError.classNotFound(classId);
    return klass.course.enrollmentFeePlanId !== null;
  }

  /** The payment state of these pending enrollments (MOD-19, computed on read — ADR-068). */
  private async paymentStates(pendingIds: readonly string[], coursePaid: boolean): Promise<Map<string, RequestPaymentState>> {
    if (pendingIds.length === 0) return new Map();
    const rows = await this.prisma.db.invoice.findMany({
      where: { enrollmentId: { in: [...pendingIds] } },
      select: { enrollmentId: true, status: true, totalAmount: true, paidAmount: true },
    });
    const byEnrollment = invoicesByEnrollment(rows);
    return new Map(pendingIds.map((id) => [id, requestPayment(coursePaid, byEnrollment.get(id) ?? []).state]));
  }

  /**
   * The class-row lock serialises enrollments of one class, so the friendly
   * checks normally win; a unique violation (P2002 on
   * uq_enrollments_class_student) or a vanished student (P2003) can still come
   * from a writer that bypassed the API.
   */
  private async translateEnrollError(error: unknown, classId: string, studentId: string): Promise<unknown> {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error;
    if (error.code === 'P2002') {
      const existing = await this.prisma.db.enrollment.findUnique({
        where: { classId_studentUserId: { classId, studentUserId: studentId } },
        select: { id: true, status: true },
      });
      if (existing) return existing.status === 'pending' ? catalogError.requestPending(existing.id) : classesError.alreadyEnrolled(existing.id, existing.status);
    }
    if (error.code === 'P2003') return classesError.userNotFound(studentId);
    return error;
  }

  private async getById(id: string, caller: AuthPrincipal): Promise<EnrollmentDto> {
    const row = await this.prisma.db.enrollment.findUnique({
      where: { id },
      select: { ...ENROLLMENT_SELECT, class: { select: { course: { select: { enrollmentFeePlanId: true } } } } },
    });
    if (!row) throw classesError.enrollmentNotFound(id);
    const states = row.status === 'pending' ? await this.paymentStates([id], row.class.course.enrollmentFeePlanId !== null) : new Map<string, RequestPaymentState>();
    return toEnrollmentDto(row, viewOf(caller), states.get(id) ?? null);
  }
}
