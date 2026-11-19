import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import { catalogError } from '../catalog/catalog.errors.js';
import { classesError } from '../classes/classes.errors.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { INVOICES_MANAGE_PERMISSION, INVOICES_READ_ALL_PERMISSION, PAYMENTS_RECORD_PERMISSION } from '../finance/finance.policy.js';
import { InvoicesService } from '../finance/invoices.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { READ_CONTACT_PERMISSION } from '../users/users.policy.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { REQUESTS_PAGE_DEFAULT } from './enrollment-requests.dto.js';
import type {
  ApproveBlocker,
  EnrollmentRequestDto,
  EnrollmentRequestListDto,
  ListEnrollmentRequestsQueryDto,
  MyEnrollmentRequestDto,
  MyEnrollmentRequestListDto,
  RequestListState,
} from './enrollment-requests.dto.js';
import { paymentSettled, requestPayment, requestStateOf } from './enrollment-requests.policy.js';
import { EnrollmentRequestsWriter, lockJoinClass } from './enrollment-requests.writer.js';
import { enrollmentsError } from './enrollments.errors.js';
import { hasFreeSeat, isEnrollableClass } from './enrollments.status.js';
import { ROSTER_STUDENT_SELECT, toRosterStudentDto } from './roster-student.js';

const ENROLLMENTS_ENTITY_TYPE = 'enrollments';
const STATUS_CHANGED = 'enrollments.status.changed';
const REQUEST_SORT = 'requestedAt';
const REQUEST_ORDER = 'desc';
/** The student's own list is not paged: a student has few requests. */
const MY_REQUESTS_MAX = 200;
const FINANCE_READ_KEYS = [INVOICES_READ_ALL_PERMISSION, INVOICES_MANAGE_PERMISSION, PAYMENTS_RECORD_PERMISSION];
const CANCELLED_INVOICE_REASON = EnrollmentRequestsWriter.invoiceCancelReason('cancelled');

function requestSelect(withPayments: boolean) {
  return {
    id: true,
    status: true,
    source: true,
    requestedAt: true,
    activatedAt: true,
    completedAt: true,
    withdrawnAt: true,
    rejectedAt: true,
    rejectionReason: true,
    student: { select: ROSTER_STUDENT_SELECT },
    class: {
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        capacity: true,
        startsOn: true,
        endsOn: true,
        course: { select: { id: true, code: true, name: true, coverImageUrl: true, enrollmentFeePlanId: true } },
        teachers: { where: { role: 'lead' }, take: 1, select: { teacher: { select: { fullName: true, displayName: true } } } },
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    },
    invoices: {
      orderBy: { id: 'asc' },
      select: {
        id: true,
        number: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        currency: true,
        issuedAt: true,
        ...(withPayments
          ? { payments: { orderBy: { id: 'asc' }, select: { id: true, number: true, amount: true, method: true, status: true, paidAt: true } } }
          : {}),
      },
    },
  } satisfies Prisma.EnrollmentSelect;
}

const LIST_SELECT = requestSelect(false);
const DETAIL_SELECT = requestSelect(true);
type RequestRow = Prisma.EnrollmentGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.EnrollmentGetPayload<{ select: typeof DETAIL_SELECT }>;

const money = (value: Prisma.Decimal): number => Number(value.toFixed(2));
const dateOnly = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** The instant the request was decided, or the enrollment's later life began: activation, rejection, withdrawal. */
function decidedAtOf(row: Pick<RequestRow, 'status' | 'activatedAt' | 'rejectedAt' | 'withdrawnAt' | 'completedAt'>): string | null {
  if (row.rejectedAt) return iso(row.rejectedAt);
  if (row.status === 'cancelled' || row.status === 'withdrawn') return iso(row.withdrawnAt ?? row.activatedAt);
  if (row.status === 'completed') return iso(row.completedAt ?? row.activatedAt);
  return iso(row.activatedAt);
}

function toMyRequest(row: RequestRow | DetailRow, withPayments: boolean): MyEnrollmentRequestDto {
  const coursePaid = row.class.course.enrollmentFeePlanId !== null;
  const payment = requestPayment(coursePaid, row.invoices);
  const lead = row.class.teachers[0]?.teacher ?? null;
  const issued = row.invoices.filter((invoice) => invoice.status === 'issued');
  return {
    id: row.id,
    status: row.status,
    state: requestStateOf(row, payment.state),
    source: row.source,
    requestedAt: iso(row.requestedAt),
    decidedAt: row.status === 'pending' ? null : decidedAtOf(row),
    rejectionReason: row.rejectionReason,
    class: {
      id: row.class.id,
      code: row.class.code,
      name: readLocalizedText(row.class.name) ?? { ar: row.class.code },
      status: row.class.status,
      startsOn: dateOnly(row.class.startsOn),
      endsOn: dateOnly(row.class.endsOn),
      capacity: row.class.capacity,
      enrolledCount: row.class._count.enrollments,
      leadTeacher: lead ? { fullName: lead.fullName, displayName: lead.displayName } : null,
    },
    course: {
      id: row.class.course.id,
      code: row.class.course.code,
      name: readLocalizedText(row.class.course.name) ?? { ar: row.class.course.code },
      coverImageUrl: row.class.course.coverImageUrl,
      pricing: coursePaid ? 'paid' : 'free',
    },
    payment: {
      state: payment.state,
      required: coursePaid || issued.length > 0,
      total: Number(payment.total),
      paid: Number(payment.paid),
      balance: Number(payment.balance),
      currency: row.invoices[0]?.currency ?? null,
      invoices: row.invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: money(invoice.totalAmount),
        paid: money(invoice.paidAmount),
        balance: money(invoice.totalAmount.minus(invoice.paidAmount)),
        currency: invoice.currency,
        issuedAt: iso(invoice.issuedAt),
        payments:
          withPayments && 'payments' in invoice
            ? (invoice as DetailRow['invoices'][number]).payments.map((line) => ({
                id: line.id,
                number: line.number,
                amount: money(line.amount),
                method: line.method,
                status: line.status,
                paidAt: line.paidAt.toISOString(),
              }))
            : null,
      })),
    },
  };
}

function approveBlockerOf(dto: MyEnrollmentRequestDto): ApproveBlocker | null {
  if (dto.status !== 'pending') return null;
  if (!paymentSettled(dto.payment.state)) return 'payment_required';
  if (!isEnrollableClass(dto.class.status)) return 'class_not_enrollable';
  if (!hasFreeSeat(dto.class.capacity, dto.class.enrolledCount)) return 'class_full';
  return null;
}

/**
 * The payment condition of a pending request in SQL, as `requestPayment()`
 * computes it (D-R125): no issued invoice with a balance, and either an issued
 * invoice or a free course. Prisma compares the two money columns of the same
 * invoice through a field reference.
 */
function settledWhere(db: PrismaService['db']): Prisma.EnrollmentWhereInput {
  return {
    AND: [
      { invoices: { none: { status: 'issued', paidAmount: { lt: db.invoice.fields.totalAmount } } } },
      { OR: [{ invoices: { some: { status: 'issued' } } }, { class: { course: { enrollmentFeePlanId: null } } }] },
    ],
  };
}

function stateWhere(state: RequestListState, db: PrismaService['db']): Prisma.EnrollmentWhereInput {
  switch (state) {
    case 'pending':
      return { status: 'pending' };
    case 'pending_payment':
      return { status: 'pending', NOT: settledWhere(db) };
    case 'pending_approval':
      return { AND: [{ status: 'pending' }, settledWhere(db)] };
    case 'approved':
      return { status: { in: ['active', 'completed', 'withdrawn'] } };
    case 'rejected':
      return { rejectedAt: { not: null } };
    case 'cancelled':
      return { status: 'cancelled', rejectedAt: null };
    case 'all':
      return {};
  }
}

/**
 * MOD-19 (roadmap §4p, D-R121..D-R127) — the reads of enrollment requests and
 * the student's own cancel. A request is an enrollment with a `requested_at`;
 * the office lists and reads them with `enrollments.manage` (API-224/225) and
 * approves or rejects them through API-059; a student reads their own
 * (API-222) and cancels a pending one (API-223). The payment state is
 * computed from the enrollment's issued invoices on every read (ADR-068).
 */
@Injectable()
export class EnrollmentRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  /** API-224 */
  async list(query: ListEnrollmentRequestsQueryDto, caller: AuthPrincipal): Promise<EnrollmentRequestListDto> {
    const db = this.prisma.db;
    const limit = query.limit ?? REQUESTS_PAGE_DEFAULT;
    const filters: Prisma.EnrollmentWhereInput[] = [{ requestedAt: { not: null } }, stateWhere(query.state ?? 'pending', db)];
    if (query.classId) filters.push({ classId: query.classId });
    if (query.courseId) filters.push({ class: { courseId: query.courseId } });
    if (query.q) {
      const pattern = escapeLikePattern(query.q);
      filters.push({
        OR: [
          { student: { fullName: { contains: pattern, mode: 'insensitive' } } },
          { student: { displayName: { contains: pattern, mode: 'insensitive' } } },
          { class: { code: { contains: pattern, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor, REQUEST_SORT, REQUEST_ORDER, true, () => classesError.cursorInvalid());
      const key = new Date(String(cursor.key));
      if (Number.isNaN(key.getTime())) throw classesError.cursorInvalid();
      filters.push({ OR: [{ requestedAt: { lt: key } }, { requestedAt: key, id: { lt: cursor.id } }] });
    }
    const rows = await db.enrollment.findMany({ where: { AND: filters }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: LIST_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last ? encodeKeysetCursor({ sort: REQUEST_SORT, order: REQUEST_ORDER, key: last.requestedAt!.toISOString(), id: last.id }) : null;
    const pendingCount = await db.enrollment.count({ where: { status: 'pending' } });
    return { items: page.map((row) => this.toOfficeDto(row, caller, false)), nextCursor, pendingCount };
  }

  /** API-225 */
  async get(id: string, caller: AuthPrincipal): Promise<EnrollmentRequestDto> {
    const row = await this.prisma.db.enrollment.findFirst({ where: { id, requestedAt: { not: null } }, select: DETAIL_SELECT });
    if (!row) throw catalogError.requestNotFound(id);
    return this.toOfficeDto(row, caller, FINANCE_READ_KEYS.some((key) => caller.permissions.includes(key)));
  }

  /** API-222 — the caller's own requests, newest first. */
  async mine(caller: AuthPrincipal): Promise<MyEnrollmentRequestListDto> {
    const rows = await this.prisma.db.enrollment.findMany({
      where: { studentUserId: caller.id, requestedAt: { not: null } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: MY_REQUESTS_MAX,
      select: LIST_SELECT,
    });
    return { items: rows.map((row) => toMyRequest(row, false)) };
  }

  /** One of the caller's own enrollments in the request view (the API-221 answer); another user's is 404. */
  async myItem(id: string, caller: AuthPrincipal): Promise<MyEnrollmentRequestDto> {
    const row = await this.prisma.db.enrollment.findFirst({ where: { id, studentUserId: caller.id }, select: LIST_SELECT });
    if (!row) throw catalogError.requestNotFound(id);
    return toMyRequest(row, false);
  }

  /**
   * API-223 — the student withdraws their own pending request (D-R126):
   * pending → cancelled, its unpaid issued invoices cancelled with it in the
   * same transaction, one `enrollments.status.changed { action:
   * cancel_request }`. Someone else's request, or a row that is no request, is
   * 404; a request no longer pending is 409 invalid_transition; one with a
   * completed payment is 409 request_has_payments (the office refunds first).
   * Locks the class row, then the invoices — the order of every enrollment write.
   */
  async cancelOwn(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<MyEnrollmentRequestDto> {
    const target = await this.prisma.db.enrollment.findFirst({ where: { id, studentUserId: caller.id, requestedAt: { not: null } }, select: { classId: true } });
    if (!target) throw catalogError.requestNotFound(id);
    await this.prisma.db.$transaction(async (tx) => {
      const klass = await lockJoinClass(tx, target.classId);
      if (!klass) throw catalogError.requestNotFound(id);
      const current = await tx.enrollment.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw catalogError.requestNotFound(id);
      if (current.status !== 'pending') throw enrollmentsError.invalidTransition(current.status, 'cancel_request', []);
      const invoices = await this.invoices.lockEnrollmentInvoices(tx, id);
      const issuedIds = invoices.filter((invoice) => invoice.status === 'issued').map((invoice) => invoice.id);
      const paymentCount = await this.invoices.completedPaymentCount(tx, issuedIds);
      if (paymentCount > 0) throw catalogError.requestHasPayments(id, paymentCount);
      const now = new Date();
      await this.invoices.cancelForRequest(tx, issuedIds, caller.id, CANCELLED_INVOICE_REASON, now);
      const written = await tx.enrollment.updateMany({ where: { id, status: 'pending' }, data: { status: 'cancelled', withdrawnAt: now } });
      if (written.count !== 1) throw enrollmentsError.invalidTransition(current.status, 'cancel_request', []);
      await this.audit.record(
        {
          action: STATUS_CHANGED,
          actorUserId: caller.id,
          entityType: ENROLLMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: {
            classId: target.classId,
            classCode: klass.code,
            studentUserId: caller.id,
            action: 'cancel_request',
            from: 'pending',
            to: 'cancelled',
            ...(issuedIds.length > 0 ? { cancelledInvoiceIds: issuedIds } : {}),
          },
          ...ctx,
        },
        tx,
      );
    });
    return this.myItem(id, caller);
  }

  private toOfficeDto(row: RequestRow | DetailRow, caller: AuthPrincipal, withPayments: boolean): EnrollmentRequestDto {
    const mine = toMyRequest(row, withPayments);
    return {
      ...mine,
      student: toRosterStudentDto(row.student, caller.permissions.includes(READ_CONTACT_PERMISSION) ? 'full' : 'reduced'),
      allowedActions: row.status === 'pending' ? ['approve', 'reject'] : [],
      approveBlocker: approveBlockerOf(mine),
    };
  }
}
