import { Injectable } from '@nestjs/common';
import { academyError } from '../academy/academy.errors.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { readLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import { STUDENT_ROLE_KEY } from '../classes/classes.policy.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import type { NotificationEventParams } from '../notifications/notifications.events.js';
import { EMPTY_BATCH, NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationBatch } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toLocalizedText } from '../roles/roles.dto.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { canonical, moneyText, splitInstallments } from './fee-plans.rules.js';
import { readPlanLines, readPlanShares } from './fee-plans.service.js';
import { financeError } from './finance.errors.js';
import {
  allocate,
  allowedInvoiceActions,
  balanceOf,
  changedInvoiceFields,
  checkInvoice,
  dayIn,
  formatNumber,
  invoiceTotals,
  nextDueOf,
  nextInvoiceStatus,
  paymentStateOf,
  planFits,
} from './invoices.calc.js';
import type { InvoiceContent, PaymentState } from './invoices.calc.js';
import { INVOICES_PAGE_DEFAULT } from './invoices.dto.js';
import type {
  ChangeInvoiceStatusDto,
  ClassInvoicesResultDto,
  CreateInvoiceDto,
  InvoiceDto,
  InvoiceListDto,
  InvoiceSummaryDto,
  IssueClassInvoicesDto,
  ListInvoicesQueryDto,
  SkippedInvoiceDto,
  UpdateInvoiceDto,
} from './invoices.dto.js';
import { INVOICE_NUMBER_PREFIX, INVOICE_SEQUENCE_KEY, reserveNumbers } from './numbering.js';

export const INVOICES_AUDIT_ACTIONS = {
  created: 'invoices.created',
  updated: 'invoices.updated',
  deleted: 'invoices.deleted',
  issued: 'invoices.issued',
  cancelled: 'invoices.cancelled',
  batchCreated: 'invoices.batch_created',
} as const;

export const INVOICES_ENTITY_TYPE = 'invoices';
const CLASSES_ENTITY_TYPE = 'classes';
const INVOICE_CURSOR_SORT = 'created';

export const INVOICE_SUMMARY_SELECT = {
  id: true,
  number: true,
  status: true,
  studentUserId: true,
  enrollmentId: true,
  feePlanId: true,
  currency: true,
  subtotal: true,
  discountAmount: true,
  discountReason: true,
  totalAmount: true,
  paidAmount: true,
  notes: true,
  issuedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  student: { select: { id: true, fullName: true, displayName: true } },
  enrollment: { select: { id: true, class: { select: { id: true, code: true, name: true } } } },
  feePlan: { select: { id: true, name: true } },
  issuedBy: { select: { fullName: true } },
  installments: { select: { seq: true, amount: true, dueOn: true }, orderBy: { seq: 'asc' } },
} satisfies Prisma.InvoiceSelect;

export const INVOICE_DETAIL_SELECT = {
  ...INVOICE_SUMMARY_SELECT,
  lines: { select: { sortOrder: true, description: true, amount: true }, orderBy: { sortOrder: 'asc' } },
  payments: {
    select: {
      id: true,
      number: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      reference: true,
      payerName: true,
      reversedAt: true,
      reverseReason: true,
      recordedBy: { select: { fullName: true } },
    },
    orderBy: { id: 'desc' },
  },
} satisfies Prisma.InvoiceSelect;

export type InvoiceSummaryRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SUMMARY_SELECT }>;
export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_DETAIL_SELECT }>;
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

interface PlanRow {
  id: string;
  isActive: boolean;
  courseId: string | null;
  classId: string | null;
  lines: Prisma.JsonValue;
  installments: Prisma.JsonValue;
}

interface NewInvoice {
  studentId: string;
  enrollmentId: string | null;
  feePlanId: string | null;
  currency: string;
  content: InvoiceContent;
  issue: { number: string; at: Date } | null;
}

const money = (value: Prisma.Decimal): number => Number(value.toFixed(2));
const dayOf = (value: Date): string => value.toISOString().slice(0, 10);
const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const localized = (value: Prisma.JsonValue, fallback: string): LocalizedText => readLocalizedText(value) ?? { ar: fallback };
/** The earliest of some due days (`YYYY-MM-DD` compares as a date), or null without any — what `invoice.issued` words. */
const firstDueOf = (days: readonly string[]): string | null => days.reduce<string | null>((first, day) => (first === null || day < first ? day : first), null);

function allocationOf(row: InvoiceSummaryRow, today: string) {
  const parts = row.installments.map((part) => ({ seq: part.seq, amount: part.amount.toFixed(2), dueOn: dayOf(part.dueOn) }));
  return allocate(parts, row.paidAmount.toFixed(2), today);
}

/** The API shape of an invoice row; paid parts, balance and overdue are computed here, never stored (D-R62). */
export function toInvoiceSummaryDto(row: InvoiceSummaryRow, today: string): InvoiceSummaryDto {
  const total = row.totalAmount.toFixed(2);
  const paid = row.paidAmount.toFixed(2);
  const issued = row.status === 'issued';
  const allocated = allocationOf(row, today);
  const next = issued ? nextDueOf(allocated) : null;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    student: { id: row.student.id, fullName: row.student.fullName, displayName: row.student.displayName },
    enrollment: row.enrollment
      ? { id: row.enrollment.id, class: { id: row.enrollment.class.id, code: row.enrollment.class.code, name: localized(row.enrollment.class.name, row.enrollment.class.code) } }
      : null,
    feePlan: row.feePlan ? { id: row.feePlan.id, name: localized(row.feePlan.name, '') } : null,
    currency: row.currency,
    subtotal: money(row.subtotal),
    discountAmount: money(row.discountAmount),
    discountReason: row.discountReason,
    total: Number(total),
    paid: Number(paid),
    balance: Number(balanceOf(total, paid)),
    paymentState: paymentStateOf(total, paid),
    overdue: issued && allocated.some((part) => part.overdue),
    nextDue: next ? { seq: next.seq, dueOn: next.dueOn, remaining: Number(next.remaining) } : null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    issuedBy: row.issuedBy ? { fullName: row.issuedBy.fullName } : null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toInvoiceDto(row: InvoiceDetailRow, today: string): InvoiceDto {
  const issued = row.status === 'issued';
  return {
    ...toInvoiceSummaryDto(row, today),
    lines: row.lines.map((line) => ({ sortOrder: line.sortOrder, description: localized(line.description, ''), amount: money(line.amount) })),
    installments: allocationOf(row, today).map((part) => ({
      seq: part.seq,
      amount: Number(part.amount),
      dueOn: part.dueOn,
      paid: Number(part.paid),
      remaining: Number(part.remaining),
      status: part.status,
      overdue: issued && part.overdue,
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      number: payment.number,
      amount: money(payment.amount),
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt.toISOString(),
      reference: payment.reference,
      payerName: payment.payerName,
      recordedBy: payment.recordedBy ? { fullName: payment.recordedBy.fullName } : null,
      reversedAt: payment.reversedAt?.toISOString() ?? null,
      reverseReason: payment.reverseReason,
    })),
  };
}

/** A draft's content as PATCH compares it. */
function contentOf(row: InvoiceDetailRow): InvoiceContent {
  return {
    enrollmentId: row.enrollmentId,
    lines: row.lines.map((line) => ({ description: localized(line.description, ''), amount: line.amount.toFixed(2) })),
    installments: row.installments.map((part) => ({ amount: part.amount.toFixed(2), dueOn: dayOf(part.dueOn) })),
    discountAmount: row.discountAmount.toFixed(2),
    discountReason: row.discountReason,
    notes: row.notes,
  };
}

function linesOf(input: NonNullable<CreateInvoiceDto['lines']>): InvoiceContent['lines'] {
  return input.map((line) => ({ description: toLocalizedText(line.description), amount: moneyText(line.amount) }));
}

function partsOf(input: NonNullable<CreateInvoiceDto['installments']>): InvoiceContent['installments'] {
  return input.map((part) => ({ amount: moneyText(part.amount), dueOn: part.dueOn }));
}

/** The issued invoices by what is paid (D-R62); paid ≤ total holds by CHECK. */
function balanceWhere(balance: PaymentState, total: Prisma.FieldRef<'Invoice', 'Decimal'>): Prisma.InvoiceWhereInput {
  if (balance === 'unpaid') return { status: 'issued', paidAmount: { equals: 0 } };
  if (balance === 'partial') return { status: 'issued', paidAmount: { gt: 0, lt: total } };
  return { status: 'issued', paidAmount: { gte: total } };
}

/**
 * MOD-11-T03 — invoices (roadmap §4i.4 API-144..API-150; owner decisions
 * D-R59..D-R62, D-R64, D-R65). A draft is created for a student by hand (lines
 * and installments) or from an active fee plan (its lines are copied and its
 * shares split the total from today in the academy's zone — D-R60), edited
 * and deleted while a draft, issued with `INV-YYYY-NNNNN` from
 * `number_sequences` (the year in the academy's zone), and cancelled with a
 * reason while no completed payment stands (D-R61). Every draft is valid at
 * every step (`invoice_invalid { problems }`). The currency is the academy's
 * at creation (D-R59). Paid parts, partial payment and overdue are computed on
 * read (D-R62 — ADR-068). Reading needs `invoices.read_all`,
 * `invoices.manage` or `payments.record` (the controller); writing needs
 * `invoices.manage`. Academy-wide — no class visibility. Exactly one event per
 * effective write; no difference = no write and no event.
 *
 * MOD-12-T04: an invoice that becomes `issued` (API-149 `issue`, or the class
 * batch with `issue: true`) and one that is cancelled notify the student and
 * their guardians — `invoice.issued` / `invoice.cancelled`, written inside the
 * same transaction and e-mailed after the commit. A draft notifies nobody.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** API-144 */
  async list(query: ListInvoicesQueryDto): Promise<InvoiceListDto> {
    const db = this.prisma.db;
    const limit = query.limit ?? INVOICES_PAGE_DEFAULT;
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, INVOICE_CURSOR_SORT, 'desc', false, () => financeError.cursorInvalid()) : null;
    const today = await this.today(db);
    const and: Prisma.InvoiceWhereInput[] = [];
    if (query.studentId) and.push({ studentUserId: query.studentId });
    if (query.enrollmentId) and.push({ enrollmentId: query.enrollmentId });
    if (query.classId) and.push({ enrollment: { is: { classId: query.classId } } });
    if (query.feePlanId) and.push({ feePlanId: query.feePlanId });
    if (query.status) and.push({ status: query.status });
    if (query.balance) and.push(balanceWhere(query.balance, db.invoice.fields.totalAmount));
    if (query.overdue !== undefined) {
      const ids = await this.overdueIds(db, today);
      and.push(query.overdue ? { id: { in: ids } } : { id: { notIn: ids } });
    }
    if (query.q) and.push({ number: { contains: escapeLikePattern(query.q), mode: 'insensitive' } });
    if (cursor) and.push({ id: { lt: cursor.id } });
    const rows = await db.invoice.findMany({ where: { AND: and }, orderBy: { id: 'desc' }, take: limit + 1, select: INVOICE_SUMMARY_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toInvoiceSummaryDto(row, today)),
      nextCursor: rows.length > limit && last ? encodeKeysetCursor({ sort: INVOICE_CURSOR_SORT, order: 'desc', key: null, id: last.id }) : null,
    };
  }

  /** API-145 */
  async get(id: string): Promise<InvoiceDto> {
    const db = this.prisma.db;
    const row = await db.invoice.findUnique({ where: { id }, select: INVOICE_DETAIL_SELECT });
    if (!row) throw financeError.invoiceNotFound(id);
    return toInvoiceDto(row, await this.today(db));
  }

  /** API-146 */
  async create(input: CreateInvoiceDto, caller: AuthPrincipal, ctx: RequestContext): Promise<InvoiceDto> {
    if (input.feePlanId && (input.lines !== undefined || input.installments !== undefined)) throw financeError.invoiceInvalid(['plan_with_lines']);
    if (!input.feePlanId && (input.lines === undefined || input.installments === undefined)) throw financeError.invoiceInvalid(['lines_required']);
    return this.prisma.db.$transaction(async (tx) => {
      const academy = await this.academyOf(tx);
      const today = dayIn(academy.timezone, new Date());
      await this.assertStudent(tx, input.studentId);
      const enrollment = input.enrollmentId ? await this.enrollmentOf(tx, input.enrollmentId, input.studentId) : null;
      const discountAmount = moneyText(input.discountAmount ?? 0);
      const discountReason = input.discountReason ?? null;
      let lines: InvoiceContent['lines'];
      let installments: InvoiceContent['installments'];
      if (input.feePlanId) {
        const plan = await this.activePlan(tx, input.feePlanId, enrollment);
        lines = readPlanLines(plan.lines).map((line) => ({ description: line.description, amount: moneyText(line.amount) }));
        installments = splitInstallments(invoiceTotals({ lines, discountAmount }).total, readPlanShares(plan.installments), today);
      } else {
        lines = linesOf(input.lines!);
        installments = partsOf(input.installments!);
      }
      const content: InvoiceContent = { enrollmentId: enrollment?.id ?? null, lines, installments, discountAmount, discountReason, notes: input.notes ?? null };
      const problems = checkInvoice(content);
      if (problems.length > 0) throw financeError.invoiceInvalid(problems);
      const id = await this.insertInvoice(
        tx,
        { studentId: input.studentId, enrollmentId: content.enrollmentId, feePlanId: input.feePlanId ?? null, currency: academy.currency, content, issue: null },
        caller.id,
      );
      const { total } = invoiceTotals(content);
      await this.audit.record(
        {
          action: INVOICES_AUDIT_ACTIONS.created,
          actorUserId: caller.id,
          entityType: INVOICES_ENTITY_TYPE,
          entityId: id,
          metadata: {
            studentId: input.studentId,
            enrollmentId: content.enrollmentId,
            feePlanId: input.feePlanId ?? null,
            currency: academy.currency,
            total: Number(total),
            installments: installments.length,
          },
          ...ctx,
        },
        tx,
      );
      return toInvoiceDto(await tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_DETAIL_SELECT }), today);
    });
  }

  /** API-147 */
  async update(id: string, input: UpdateInvoiceDto, caller: AuthPrincipal, ctx: RequestContext): Promise<InvoiceDto> {
    const given = [input.enrollmentId, input.lines, input.installments, input.discountAmount, input.discountReason, input.notes];
    if (given.every((value) => value === undefined)) throw financeError.nothingToUpdate();
    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockedInvoice(tx, id, 'FOR NO KEY UPDATE');
      if (row.status !== 'draft') throw financeError.invoiceNotDraft(row.status);
      const today = await this.today(tx);
      const current = contentOf(row);
      const next: InvoiceContent = {
        enrollmentId: input.enrollmentId === undefined ? current.enrollmentId : input.enrollmentId,
        lines: input.lines === undefined ? current.lines : linesOf(input.lines),
        installments: input.installments === undefined ? current.installments : partsOf(input.installments),
        discountAmount: input.discountAmount === undefined ? current.discountAmount : moneyText(input.discountAmount),
        discountReason: input.discountReason === undefined ? current.discountReason : input.discountReason,
        notes: input.notes === undefined ? current.notes : input.notes,
      };
      const problems = checkInvoice(next);
      if (problems.length > 0) throw financeError.invoiceInvalid(problems);
      const fields = changedInvoiceFields(current, next, canonical);
      if (fields.length === 0) return toInvoiceDto(row, today);
      if (fields.includes('enrollmentId') && next.enrollmentId !== null) await this.enrollmentOf(tx, next.enrollmentId, row.studentUserId);
      const data: Prisma.InvoiceUncheckedUpdateInput = {};
      if (fields.includes('enrollmentId')) data.enrollmentId = next.enrollmentId;
      if (fields.includes('lines') || fields.includes('discountAmount')) {
        const totals = invoiceTotals(next);
        data.subtotal = totals.subtotal;
        data.discountAmount = next.discountAmount;
        data.totalAmount = totals.total;
      }
      if (fields.includes('discountReason')) data.discountReason = next.discountReason;
      if (fields.includes('notes')) data.notes = next.notes;
      if (fields.includes('lines')) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLine.createMany({ data: next.lines.map((line, index) => this.lineData(id, index, line)) });
      }
      if (fields.includes('installments')) {
        await tx.invoiceInstallment.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceInstallment.createMany({ data: next.installments.map((part, index) => this.partData(id, index, part)) });
      }
      await tx.invoice.update({ where: { id }, data });
      await this.audit.record(
        { action: INVOICES_AUDIT_ACTIONS.updated, actorUserId: caller.id, entityType: INVOICES_ENTITY_TYPE, entityId: id, metadata: { fields }, ...ctx },
        tx,
      );
      return toInvoiceDto(await tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_DETAIL_SELECT }), today);
    });
  }

  /** API-148 */
  async remove(id: string, caller: AuthPrincipal, ctx: RequestContext): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockedInvoice(tx, id, 'FOR UPDATE');
      if (row.status !== 'draft') throw financeError.invoiceNotDraft(row.status);
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(
        {
          action: INVOICES_AUDIT_ACTIONS.deleted,
          actorUserId: caller.id,
          entityType: INVOICES_ENTITY_TYPE,
          entityId: id,
          metadata: { studentId: row.studentUserId, feePlanId: row.feePlanId, total: money(row.totalAmount) },
          ...ctx,
        },
        tx,
      );
    });
  }

  /**
   * API-149 — issue (draft → issued, numbered) or cancel (issued → cancelled, with a reason, no completed payment).
   * Either one notifies the student and their guardians (MOD-12-T04) inside this transaction, under the invoice-row lock.
   */
  async changeStatus(id: string, input: ChangeInvoiceStatusDto, caller: AuthPrincipal, ctx: RequestContext): Promise<InvoiceDto> {
    const { dto, batch } = await this.prisma.db.$transaction(async (tx) => {
      const row = await this.lockedInvoice(tx, id, 'FOR NO KEY UPDATE');
      if (!nextInvoiceStatus(input.action, row.status)) throw financeError.invalidTransition(row.status, input.action, allowedInvoiceActions(row.status));
      const academy = await this.academyOf(tx);
      const now = new Date();
      const today = dayIn(academy.timezone, now);
      let batch: NotificationBatch;
      if (input.action === 'issue') {
        const problems = checkInvoice(contentOf(row));
        if (problems.length > 0) throw financeError.invoiceInvalid(problems);
        const year = today.slice(0, 4);
        const number = formatNumber(INVOICE_NUMBER_PREFIX, year, await reserveNumbers(tx, INVOICE_SEQUENCE_KEY, year, 1));
        await tx.invoice.update({ where: { id }, data: { status: 'issued', number, issuedAt: now, issuedById: caller.id } });
        await this.audit.record(
          {
            action: INVOICES_AUDIT_ACTIONS.issued,
            actorUserId: caller.id,
            entityType: INVOICES_ENTITY_TYPE,
            entityId: id,
            metadata: { number, studentId: row.studentUserId, currency: row.currency, total: money(row.totalAmount), installments: row.installments.length },
            ...ctx,
          },
          tx,
        );
        batch = await this.notifications.notifyStudents(tx, 'invoice.issued', [
          {
            studentId: row.studentUserId,
            params: {
              invoiceId: id,
              number,
              total: row.totalAmount.toFixed(2),
              currency: row.currency,
              firstDueOn: firstDueOf(row.installments.map((part) => dayOf(part.dueOn))),
            },
          },
        ]);
      } else {
        const paymentCount = await tx.payment.count({ where: { invoiceId: id, status: 'completed' } });
        if (paymentCount > 0) throw financeError.invoiceHasPayments(paymentCount);
        const reason = input.reason!;
        await tx.invoice.update({ where: { id }, data: { status: 'cancelled', cancelledAt: now, cancelledById: caller.id, cancelReason: reason } });
        await this.audit.record(
          {
            action: INVOICES_AUDIT_ACTIONS.cancelled,
            actorUserId: caller.id,
            entityType: INVOICES_ENTITY_TYPE,
            entityId: id,
            metadata: { number: row.number, studentId: row.studentUserId, reason },
            ...ctx,
          },
          tx,
        );
        // The number only — never the reason. An issued invoice always carries its number (`ck_invoices_issued`).
        batch = await this.notifications.notifyStudents(tx, 'invoice.cancelled', [{ studentId: row.studentUserId, params: { invoiceId: id, number: row.number! } }]);
      }
      const dto = toInvoiceDto(await tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_DETAIL_SELECT }), today);
      return { dto, batch };
    });
    this.notifications.dispatch(batch);
    return dto;
  }

  /**
   * API-150 — one invoice from the plan for every `active` enrollment of the
   * class that has no non-cancelled invoice from the same plan; drafts, or
   * issued at once with consecutive numbers. Under the class-row lock, so two
   * batches never invoice an enrollment twice. One `invoices.batch_created`
   * event on the class; nothing to create = 200 without write or event.
   * Drafts notify nobody; the invoices issued at once (`issue: true`) notify
   * like API-149 `issue` — one `invoice.issued` per invoice, in one call.
   */
  async issueForClass(classId: string, input: IssueClassInvoicesDto, caller: AuthPrincipal, ctx: RequestContext): Promise<ClassInvoicesResultDto> {
    const { result, batch } = await this.prisma.db.$transaction(async (tx): Promise<{ result: ClassInvoicesResultDto; batch: NotificationBatch }> => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM classes WHERE id = ${classId}::uuid FOR NO KEY UPDATE`;
      if (!locked[0]) throw financeError.classNotFound(classId);
      const klass = await tx.class.findUniqueOrThrow({ where: { id: classId }, select: { id: true, code: true, courseId: true } });
      const plan = await this.activePlan(tx, input.feePlanId, { classId: klass.id, courseId: klass.courseId });
      const academy = await this.academyOf(tx);
      const now = new Date();
      const today = dayIn(academy.timezone, now);
      const enrollments = await tx.enrollment.findMany({
        where: { classId, status: 'active' },
        orderBy: { id: 'asc' },
        select: { id: true, studentUserId: true, student: { select: { deletedAt: true } } },
      });
      const invoiced = new Set(
        (
          await tx.invoice.findMany({
            where: { feePlanId: plan.id, status: { not: 'cancelled' }, enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) } },
            select: { enrollmentId: true },
          })
        ).map((invoice) => invoice.enrollmentId),
      );
      const skipped: SkippedInvoiceDto[] = [];
      const targets: typeof enrollments = [];
      for (const enrollment of enrollments) {
        const reason = enrollment.student.deletedAt ? 'student_deleted' : invoiced.has(enrollment.id) ? 'already_invoiced' : null;
        if (reason) skipped.push({ enrollmentId: enrollment.id, studentId: enrollment.studentUserId, reason });
        else targets.push(enrollment);
      }
      if (targets.length === 0) return { result: { created: [], skipped }, batch: EMPTY_BATCH };
      const lines = readPlanLines(plan.lines).map((line) => ({ description: line.description, amount: moneyText(line.amount) }));
      const installments = splitInstallments(invoiceTotals({ lines, discountAmount: '0.00' }).total, readPlanShares(plan.installments), today);
      const template: Omit<InvoiceContent, 'enrollmentId'> = { lines, installments, discountAmount: '0.00', discountReason: null, notes: null };
      const problems = checkInvoice(template);
      if (problems.length > 0) throw financeError.invoiceInvalid(problems);
      const year = today.slice(0, 4);
      const first = input.issue ? await reserveNumbers(tx, INVOICE_SEQUENCE_KEY, year, targets.length) : 0;
      const ids: string[] = [];
      // What every invoice of the batch tells its student once issued: the same total and first due day, its own number.
      const total = invoiceTotals(template).total;
      const firstDueOn = firstDueOf(installments.map((part) => part.dueOn));
      const issued: Array<{ studentId: string; params: NotificationEventParams['invoice.issued'] }> = [];
      for (const [index, enrollment] of targets.entries()) {
        const number = input.issue ? formatNumber(INVOICE_NUMBER_PREFIX, year, first + index) : null;
        const invoiceId = await this.insertInvoice(
          tx,
          {
            studentId: enrollment.studentUserId,
            enrollmentId: enrollment.id,
            feePlanId: plan.id,
            currency: academy.currency,
            content: { ...template, enrollmentId: enrollment.id },
            issue: number ? { number, at: now } : null,
          },
          caller.id,
        );
        ids.push(invoiceId);
        if (number) issued.push({ studentId: enrollment.studentUserId, params: { invoiceId, number, total, currency: academy.currency, firstDueOn } });
      }
      await this.audit.record(
        {
          action: INVOICES_AUDIT_ACTIONS.batchCreated,
          actorUserId: caller.id,
          entityType: CLASSES_ENTITY_TYPE,
          entityId: classId,
          metadata: {
            code: klass.code,
            feePlanId: plan.id,
            issued: input.issue === true,
            count: ids.length,
            invoiceIds: ids,
            skipped: skipped.length,
            currency: academy.currency,
            total: Number(invoiceTotals(template).total),
          },
          ...ctx,
        },
        tx,
      );
      // One call for the whole batch. Empty for a batch of drafts: the engine then writes nothing and asks the database nothing.
      const batch = await this.notifications.notifyStudents(tx, 'invoice.issued', issued);
      const rows = await tx.invoice.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: INVOICE_SUMMARY_SELECT });
      return { result: { created: rows.map((row) => toInvoiceSummaryDto(row, today)), skipped }, batch };
    });
    this.notifications.dispatch(batch);
    return result;
  }

  // ---------------------------------------------------------------------------

  /** The academy row's zone and currency; invoices are not created without it (503 like API-035). */
  private async academyOf(db: Db): Promise<{ timezone: string; currency: string }> {
    const academy = await db.academy.findFirst({ select: { timezone: true, currency: true } });
    if (!academy) throw academyError.notConfigured();
    return academy;
  }

  /** Today in the academy's zone (UTC without the row) — the day overdue is measured against. */
  private async today(db: Db): Promise<string> {
    const academy = await db.academy.findFirst({ select: { timezone: true } });
    return dayIn(academy?.timezone ?? 'UTC', new Date());
  }

  private async lockedInvoice(tx: Tx, id: string, mode: 'FOR UPDATE' | 'FOR NO KEY UPDATE'): Promise<InvoiceDetailRow> {
    const locked =
      mode === 'FOR UPDATE'
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (!locked[0]) throw financeError.invoiceNotFound(id);
    return tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_DETAIL_SELECT });
  }

  /** A user who exists, is not soft-deleted and holds the student role. */
  private async assertStudent(tx: Tx, studentId: string): Promise<void> {
    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null, roles: { some: { role: { key: STUDENT_ROLE_KEY } } } },
      select: { id: true },
    });
    if (!student) throw financeError.studentNotFound(studentId);
  }

  /** An enrollment of this student (any status), with its class and course for the plan scope. */
  private async enrollmentOf(tx: Tx, enrollmentId: string, studentId: string): Promise<{ id: string; classId: string; courseId: string }> {
    const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true, studentUserId: true, classId: true, class: { select: { courseId: true } } } });
    if (!enrollment || enrollment.studentUserId !== studentId) throw financeError.enrollmentMismatch(enrollmentId);
    return { id: enrollment.id, classId: enrollment.classId, courseId: enrollment.class.courseId };
  }

  /** An existing, active plan that prices the target class (when there is one). */
  private async activePlan(tx: Tx, feePlanId: string, target: { classId: string; courseId: string } | null): Promise<PlanRow> {
    const plan = await tx.feePlan.findUnique({
      where: { id: feePlanId },
      select: { id: true, isActive: true, courseId: true, classId: true, lines: true, installments: true },
    });
    if (!plan) throw financeError.feePlanNotFound(feePlanId);
    if (!plan.isActive) throw financeError.feePlanInactive(feePlanId);
    if (target && !planFits(plan, target)) throw financeError.feePlanMismatch(feePlanId, target.classId);
    return plan;
  }

  private lineData(invoiceId: string, index: number, line: InvoiceContent['lines'][number]): Prisma.InvoiceLineCreateManyInput {
    return { invoiceId, sortOrder: index, description: line.description as Prisma.InputJsonValue, amount: line.amount };
  }

  private partData(invoiceId: string, index: number, part: InvoiceContent['installments'][number]): Prisma.InvoiceInstallmentCreateManyInput {
    return { invoiceId, seq: index + 1, amount: part.amount, dueOn: dateOf(part.dueOn) };
  }

  private async insertInvoice(tx: Tx, invoice: NewInvoice, callerId: string): Promise<string> {
    const totals = invoiceTotals(invoice.content);
    const row = await tx.invoice.create({
      data: {
        studentUserId: invoice.studentId,
        enrollmentId: invoice.enrollmentId,
        feePlanId: invoice.feePlanId,
        status: invoice.issue ? 'issued' : 'draft',
        number: invoice.issue?.number ?? null,
        issuedAt: invoice.issue?.at ?? null,
        issuedById: invoice.issue ? callerId : null,
        currency: invoice.currency,
        subtotal: totals.subtotal,
        discountAmount: invoice.content.discountAmount,
        discountReason: invoice.content.discountReason,
        totalAmount: totals.total,
        notes: invoice.content.notes,
        createdById: callerId,
      },
      select: { id: true },
    });
    await tx.invoiceLine.createMany({ data: invoice.content.lines.map((line, index) => this.lineData(row.id, index, line)) });
    await tx.invoiceInstallment.createMany({ data: invoice.content.installments.map((part, index) => this.partData(row.id, index, part)) });
    return row.id;
  }

  /** Issued invoices whose payments do not cover what fell due before `today` (D-R62). */
  private async overdueIds(db: Db, today: string): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM invoices i
      WHERE i.status = 'issued'
        AND i.paid_amount < (SELECT COALESCE(SUM(p.amount), 0) FROM invoice_installments p WHERE p.invoice_id = i.id AND p.due_on < ${today}::date)`;
    return rows.map((row) => row.id);
  }
}
