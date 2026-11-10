import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/principal.js';
import { relationOf, seesChildren } from '../enrollments/my-classes.policy.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayIn } from './invoices.calc.js';
import { INVOICE_DETAIL_SELECT, toInvoiceDto } from './invoices.service.js';
import type { ListMyInvoicesQueryDto, MyInvoiceItemDto, MyInvoiceListDto } from './my-invoices.dto.js';
import { myInvoicesAccess, ownerPayments } from './my-invoices.policy.js';

/**
 * MOD-11-T05 — «my invoices» (`GET /api/me/invoices`, API-155; owner decision
 * D-R65, the pattern of «my certificates»). The caller's own invoices with
 * `invoices.read_own` (`self`), and — while the caller holds the `guardian`
 * role — those of their linked, not soft-deleted children with
 * `invoices.read_linked` (`child`; links alone grant nothing); the controller
 * refuses a caller with neither key. Issued and cancelled invoices only (a
 * draft is the office's), newest first, with the lines, the installments
 * (paid, remaining and overdue computed as in API-145 — ADR-068) and the
 * valid receipts — never the internal note, the issuer, the fee plan, a
 * recorder or a reversed payment. No pagination (a student holds few).
 * Read-only.
 */
@Injectable()
export class MyInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMyInvoicesQueryDto, caller: AuthPrincipal): Promise<MyInvoiceListDto> {
    const access = myInvoicesAccess(caller.permissions);
    const owned: Prisma.InvoiceWhereInput[] = [];
    if (access.self) owned.push({ studentUserId: caller.id });
    if (access.child && seesChildren(caller.roles)) owned.push({ student: { deletedAt: null, guardians: { some: { guardianUserId: caller.id } } } });
    if (owned.length === 0) return { items: [] };
    const where: Prisma.InvoiceWhereInput = { OR: owned, status: query.status ?? { in: ['issued', 'cancelled'] } };
    if (query.studentId) where.studentUserId = query.studentId;
    if (query.classId) where.enrollment = { is: { classId: query.classId } };
    const db = this.prisma.db;
    const academy = await db.academy.findFirst({ select: { timezone: true } });
    const today = dayIn(academy?.timezone ?? 'UTC', new Date());
    const rows = await db.invoice.findMany({ where, orderBy: { id: 'desc' }, select: INVOICE_DETAIL_SELECT });
    return {
      items: rows.map((row): MyInvoiceItemDto => {
        const full = toInvoiceDto(row, today);
        return {
          id: full.id,
          number: full.number,
          status: full.status,
          student: full.student,
          enrollment: full.enrollment,
          currency: full.currency,
          subtotal: full.subtotal,
          discountAmount: full.discountAmount,
          discountReason: full.discountReason,
          total: full.total,
          paid: full.paid,
          balance: full.balance,
          paymentState: full.paymentState,
          overdue: full.overdue,
          nextDue: full.nextDue,
          issuedAt: full.issuedAt,
          cancelledAt: full.cancelledAt,
          cancelReason: full.cancelReason,
          createdAt: full.createdAt,
          updatedAt: full.updatedAt,
          lines: full.lines,
          installments: full.installments,
          payments: ownerPayments(full.payments),
          relation: relationOf(row.studentUserId, caller.id),
        };
      }),
    };
  }
}
