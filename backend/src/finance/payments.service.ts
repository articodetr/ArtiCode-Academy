import { Injectable } from '@nestjs/common';
import { academyError } from '../academy/academy.errors.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthPrincipal, RequestContext } from '../auth/principal.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toInstant } from '../lessons/lessons.time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { escapeLikePattern } from '../users/users.validation.js';
import { moneyText } from './fee-plans.rules.js';
import { financeError } from './finance.errors.js';
import { balanceOf, dayIn, formatNumber, paymentStateOf } from './invoices.calc.js';
import { RECEIPT_NUMBER_PREFIX, RECEIPT_SEQUENCE_KEY, reserveNumbers } from './numbering.js';
import { PAYMENTS_PAGE_DEFAULT } from './payments.dto.js';
import type { ListPaymentsQueryDto, PaymentDto, PaymentListDto, RecordPaymentDto, ReversePaymentDto } from './payments.dto.js';
import { exceedsBalance } from './payments.rules.js';

export const PAYMENTS_AUDIT_ACTIONS = {
  recorded: 'payments.recorded',
  reversed: 'payments.reversed',
} as const;

export const PAYMENTS_ENTITY_TYPE = 'payments';
const PAYMENT_CURSOR_SORT = 'created';

export const PAYMENT_SELECT = {
  id: true,
  number: true,
  invoiceId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  paidAt: true,
  reference: true,
  payerName: true,
  notes: true,
  reversedAt: true,
  reverseReason: true,
  createdAt: true,
  recordedBy: { select: { fullName: true } },
  reversedBy: { select: { fullName: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      totalAmount: true,
      paidAmount: true,
      student: { select: { id: true, fullName: true, displayName: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;
type Tx = Prisma.TransactionClient;

const money = (value: Prisma.Decimal): number => Number(value.toFixed(2));

/** A receipt as the API returns it, with its invoice as it stands now. */
export function toPaymentDto(row: PaymentRow): PaymentDto {
  const total = row.invoice.totalAmount.toFixed(2);
  const paid = row.invoice.paidAmount.toFixed(2);
  return {
    id: row.id,
    number: row.number,
    invoice: {
      id: row.invoice.id,
      number: row.invoice.number,
      status: row.invoice.status,
      currency: row.invoice.currency,
      total: Number(total),
      paid: Number(paid),
      balance: Number(balanceOf(total, paid)),
      paymentState: paymentStateOf(total, paid),
    },
    student: { id: row.invoice.student.id, fullName: row.invoice.student.fullName, displayName: row.invoice.student.displayName },
    amount: money(row.amount),
    currency: row.currency,
    method: row.method,
    status: row.status,
    paidAt: row.paidAt.toISOString(),
    reference: row.reference,
    payerName: row.payerName,
    notes: row.notes,
    recordedBy: row.recordedBy ? { fullName: row.recordedBy.fullName } : null,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversedBy: row.reversedBy ? { fullName: row.reversedBy.fullName } : null,
    reverseReason: row.reverseReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * MOD-11-T04 — payments and receipts (roadmap §4i.4 API-151..API-154; owner
 * decision D-R63). A payment is recorded by hand on an issued invoice, never
 * above its balance, with a receipt `RCPT-YYYY-NNNNN` from `number_sequences`
 * (the year in the academy's zone) and the invoice currency; it is never
 * edited — a wrong one is reversed with a reason and stays on record. Every
 * write locks the invoice row first (`FOR NO KEY UPDATE`) and keeps
 * `invoices.paid_amount` in the same transaction (D-R62, ADR-068), so two
 * payments at once never exceed the balance. Reading needs
 * `invoices.read_all`, `invoices.manage` or `payments.record` (the
 * controller); recording needs `payments.record`, reversing
 * `payments.refund`. One `payments.*` event per write.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** API-151 */
  async record(invoiceId: string, input: RecordPaymentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<PaymentDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockInvoice(tx, invoiceId);
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { id: true, number: true, status: true, currency: true, totalAmount: true, paidAmount: true },
      });
      if (invoice.status !== 'issued') throw financeError.invoiceNotIssued(invoice.status);
      const amount = moneyText(input.amount);
      const total = invoice.totalAmount.toFixed(2);
      const paid = invoice.paidAmount.toFixed(2);
      if (exceedsBalance(amount, total, paid)) throw financeError.paymentExceedsBalance(Number(amount), Number(balanceOf(total, paid)));
      const academy = await tx.academy.findFirst({ select: { timezone: true } });
      if (!academy) throw academyError.notConfigured();
      const now = new Date();
      const year = dayIn(academy.timezone, now).slice(0, 4);
      const number = formatNumber(RECEIPT_NUMBER_PREFIX, year, await reserveNumbers(tx, RECEIPT_SEQUENCE_KEY, year, 1));
      const payment = await tx.payment.create({
        data: {
          number,
          invoiceId,
          amount,
          currency: invoice.currency,
          method: input.method,
          status: 'completed',
          paidAt: input.paidAt ? toInstant(input.paidAt) : now,
          reference: input.reference ?? null,
          payerName: input.payerName ?? null,
          notes: input.notes ?? null,
          recordedById: caller.id,
        },
        select: { id: true },
      });
      await tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount: { increment: amount } } });
      await this.audit.record(
        {
          action: PAYMENTS_AUDIT_ACTIONS.recorded,
          actorUserId: caller.id,
          entityType: PAYMENTS_ENTITY_TYPE,
          entityId: payment.id,
          metadata: { invoiceId, invoiceNumber: invoice.number, number, amount: Number(amount), currency: invoice.currency, method: input.method },
          ...ctx,
        },
        tx,
      );
      return toPaymentDto(await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, select: PAYMENT_SELECT }));
    });
  }

  /** API-152 */
  async list(query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    const limit = query.limit ?? PAYMENTS_PAGE_DEFAULT;
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, PAYMENT_CURSOR_SORT, 'desc', false, () => financeError.cursorInvalid()) : null;
    const and: Prisma.PaymentWhereInput[] = [];
    if (query.invoiceId) and.push({ invoiceId: query.invoiceId });
    if (query.studentId) and.push({ invoice: { studentUserId: query.studentId } });
    if (query.method) and.push({ method: query.method });
    if (query.status) and.push({ status: query.status });
    if (query.from) and.push({ paidAt: { gte: toInstant(query.from) } });
    if (query.to) and.push({ paidAt: { lt: toInstant(query.to) } });
    if (query.q) and.push({ number: { contains: escapeLikePattern(query.q), mode: 'insensitive' } });
    if (cursor) and.push({ id: { lt: cursor.id } });
    const rows = await this.prisma.db.payment.findMany({ where: { AND: and }, orderBy: { id: 'desc' }, take: limit + 1, select: PAYMENT_SELECT });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toPaymentDto),
      nextCursor: rows.length > limit && last ? encodeKeysetCursor({ sort: PAYMENT_CURSOR_SORT, order: 'desc', key: null, id: last.id }) : null,
    };
  }

  /** API-153 */
  async get(id: string): Promise<PaymentDto> {
    const row = await this.prisma.db.payment.findUnique({ where: { id }, select: PAYMENT_SELECT });
    if (!row) throw financeError.paymentNotFound(id);
    return toPaymentDto(row);
  }

  /** API-154 — completed → reversed, for good; the amount leaves the invoice's paid amount. */
  async reverse(id: string, input: ReversePaymentDto, caller: AuthPrincipal, ctx: RequestContext): Promise<PaymentDto> {
    return this.prisma.db.$transaction(async (tx) => {
      // A payment never moves to another invoice, so its invoice is read unlocked and locked
      // before the payment is read again — the lock order of every payment write.
      const target = await tx.payment.findUnique({ where: { id }, select: { invoiceId: true } });
      if (!target) throw financeError.paymentNotFound(id);
      await this.lockInvoice(tx, target.invoiceId);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id },
        select: { id: true, number: true, amount: true, status: true, reversedAt: true, invoiceId: true, invoice: { select: { number: true } } },
      });
      if (payment.status === 'reversed') throw financeError.paymentReversed(id, payment.reversedAt!.toISOString());
      await tx.payment.update({ where: { id }, data: { status: 'reversed', reversedAt: new Date(), reversedById: caller.id, reverseReason: input.reason } });
      await tx.invoice.update({ where: { id: payment.invoiceId }, data: { paidAmount: { decrement: payment.amount } } });
      await this.audit.record(
        {
          action: PAYMENTS_AUDIT_ACTIONS.reversed,
          actorUserId: caller.id,
          entityType: PAYMENTS_ENTITY_TYPE,
          entityId: id,
          metadata: { invoiceId: payment.invoiceId, invoiceNumber: payment.invoice.number, number: payment.number, amount: money(payment.amount), reason: input.reason },
          ...ctx,
        },
        tx,
      );
      return toPaymentDto(await tx.payment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT }));
    });
  }

  private async lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR NO KEY UPDATE`;
    if (!locked[0]) throw financeError.invoiceNotFound(invoiceId);
  }
}
