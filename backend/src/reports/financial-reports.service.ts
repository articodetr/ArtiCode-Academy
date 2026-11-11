import { Injectable } from '@nestjs/common';
import { readLocalizedText } from '../authorization/localized-text.js';
import { allocate } from '../finance/invoices.calc.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { inclusiveDays } from '../schedule/lesson-generation.plan.js';
import type {
  AgingDto,
  CollectionRowDto,
  CollectionsReportDto,
  FinancialCollectionsQueryDto,
  FinancialReceivablesQueryDto,
  FinancialRevenueQueryDto,
  ReceivableRowDto,
  ReceivablesReportDto,
  RevenueReportDto,
} from './financial-reports.dto.js';
import { capRows, round2 } from './reports.calc.js';
import { periodWindow, readReportContext, resolvePeriod } from './reports.period.js';
import type { PeriodWindow } from './reports.period.js';
import { ROW_CAP } from './reports.policy.js';

const D = Prisma.Decimal;
/** The course key of an invoice without an enrollment, so a FULL JOIN can match on equality. */
const NO_COURSE = '00000000-0000-0000-0000-000000000000';

function within(column: Prisma.Sql, window: PeriodWindow): Prisma.Sql {
  return Prisma.sql`${column} >= ${window.start.toISOString()}::timestamptz AND ${column} < ${window.end.toISOString()}::timestamptz`;
}

/** Invoice → enrollment → class filters (an invoice without an enrollment matches neither). */
function invoiceClassFilters(filters: { courseId?: string; classId?: string }): Prisma.Sql {
  return Prisma.sql`
    ${filters.courseId ? Prisma.sql`AND c.course_id = ${filters.courseId}::uuid` : Prisma.empty}
    ${filters.classId ? Prisma.sql`AND c.id = ${filters.classId}::uuid` : Prisma.empty}`;
}

const INVOICE_CLASS_JOIN = Prisma.sql`
  LEFT JOIN enrollments e ON e.id = i.enrollment_id
  LEFT JOIN classes c ON c.id = e.class_id`;

/** The aging bucket of an installment overdue by `days` (≥ 1). */
function bucketOf(days: number): keyof AgingDto {
  if (days <= 30) return 'days1To30';
  if (days <= 60) return 'days31To60';
  if (days <= 90) return 'days61To90';
  return 'days91Plus';
}

interface MoneyAgg {
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  overdue: Prisma.Decimal;
  aging: Record<keyof AgingDto, Prisma.Decimal>;
}

const zeroAgg = (): MoneyAgg => ({ total: new D(0), paid: new D(0), overdue: new D(0), aging: { days1To30: new D(0), days31To60: new D(0), days61To90: new D(0), days91Plus: new D(0) } });

function agingOf(agg: MoneyAgg): AgingDto {
  return { days1To30: round2(agg.aging.days1To30), days31To60: round2(agg.aging.days31To60), days61To90: round2(agg.aging.days61To90), days91Plus: round2(agg.aging.days91Plus) };
}

/**
 * MOD-13-T03 — financial reports (API-161..163; D-R66..D-R73). Computed on
 * read from `payments` and `invoices` (+ installments); amounts are summed per
 * currency (each invoice keeps the currency it was created in — D-R59), the
 * overdue part comes from MOD-11's own `allocate()` (the paid amount covers
 * the oldest installment first — ADR-068). Academy-wide, read-only, never audited.
 */
@Injectable()
export class FinancialReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** API-161: completed (and, apart, reversed) payments paid in the period by month × method × currency. */
  async collections(query: FinancialCollectionsQueryDto, now: Date = new Date()): Promise<CollectionsReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const read = await this.prisma.db.$queryRaw<{ month: string; method: PaymentMethod; currency: string; status: 'completed' | 'reversed'; payments: number; amount: string }[]>`
      SELECT to_char(p.paid_at AT TIME ZONE ${context.timeZone}, 'YYYY-MM') AS month, p.method::text AS method, p.currency, p.status::text AS status,
             count(*)::int AS payments, sum(p.amount)::text AS amount
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      ${INVOICE_CLASS_JOIN}
      WHERE ${within(Prisma.sql`p.paid_at`, window)}
        ${query.method ? Prisma.sql`AND p.method = ${query.method}::payment_method` : Prisma.empty}
        ${invoiceClassFilters(query)}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4`;

    const toRow = (row: (typeof read)[number]): CollectionRowDto => ({ month: row.month, method: row.method, currency: row.currency, payments: row.payments, amount: round2(row.amount) });
    const totals = new Map<string, { payments: number; amount: Prisma.Decimal; reversedPayments: number; reversedAmount: Prisma.Decimal }>();
    for (const row of read) {
      const entry = totals.get(row.currency) ?? { payments: 0, amount: new D(0), reversedPayments: 0, reversedAmount: new D(0) };
      if (row.status === 'completed') {
        entry.payments += row.payments;
        entry.amount = entry.amount.plus(row.amount);
      } else {
        entry.reversedPayments += row.payments;
        entry.reversedAmount = entry.reversedAmount.plus(row.amount);
      }
      totals.set(row.currency, entry);
    }
    const completed = capRows(read.filter((row) => row.status === 'completed'));
    const reversed = capRows(read.filter((row) => row.status === 'reversed'));
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated: completed.truncated || reversed.truncated,
      rows: completed.rows.map(toRow),
      reversed: reversed.rows.map(toRow),
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, entry]) => ({ currency, payments: entry.payments, amount: round2(entry.amount), reversedPayments: entry.reversedPayments, reversedAmount: round2(entry.reversedAmount) })),
    };
  }

  /** API-162: issued invoices with a balance, per (student × currency), as of today. */
  async receivables(query: FinancialReceivablesQueryDto, now: Date = new Date()): Promise<ReceivablesReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const today = context.today;
    const open = Prisma.sql`
      SELECT i.id, i.student_user_id, i.currency, i.total_amount, i.paid_amount
      FROM invoices i
      ${INVOICE_CLASS_JOIN}
      WHERE i.status = 'issued' AND i.total_amount > i.paid_amount ${invoiceClassFilters(query)}`;
    const [invoices, parts] = await Promise.all([
      this.prisma.db.$queryRaw<{ id: string; student_user_id: string; full_name: string; display_name: string | null; currency: string; total: string; paid: string }[]>`
        WITH open AS (${open})
        SELECT o.id, o.student_user_id, u.full_name, u.display_name, o.currency, o.total_amount::text AS total, o.paid_amount::text AS paid
        FROM open o JOIN users u ON u.id = o.student_user_id`,
      this.prisma.db.$queryRaw<{ invoice_id: string; seq: number; amount: string; due_on: string }[]>`
        WITH open AS (${open})
        SELECT ii.invoice_id, ii.seq::int AS seq, ii.amount::text AS amount, to_char(ii.due_on, 'YYYY-MM-DD') AS due_on
        FROM invoice_installments ii JOIN open o ON o.id = ii.invoice_id`,
    ]);

    const partsByInvoice = new Map<string, { seq: number; amount: string; dueOn: string }[]>();
    for (const part of parts) {
      const list = partsByInvoice.get(part.invoice_id) ?? [];
      list.push({ seq: part.seq, amount: part.amount, dueOn: part.due_on });
      partsByInvoice.set(part.invoice_id, list);
    }

    interface Row {
      student: { id: string; fullName: string; displayName: string | null };
      currency: string;
      invoices: number;
      agg: MoneyAgg;
      oldest: string | null;
    }
    const rows = new Map<string, Row>();
    for (const invoice of invoices) {
      const key = `${invoice.student_user_id}|${invoice.currency}`;
      const row = rows.get(key) ?? { student: { id: invoice.student_user_id, fullName: invoice.full_name, displayName: invoice.display_name }, currency: invoice.currency, invoices: 0, agg: zeroAgg(), oldest: null };
      row.invoices += 1;
      row.agg.total = row.agg.total.plus(invoice.total);
      row.agg.paid = row.agg.paid.plus(invoice.paid);
      for (const part of allocate(partsByInvoice.get(invoice.id) ?? [], invoice.paid, today)) {
        if (!part.overdue) continue;
        row.agg.overdue = row.agg.overdue.plus(part.remaining);
        const bucket = bucketOf(inclusiveDays(part.dueOn, today) - 1);
        row.agg.aging[bucket] = row.agg.aging[bucket].plus(part.remaining);
        if (row.oldest === null || part.dueOn < row.oldest) row.oldest = part.dueOn;
      }
      rows.set(key, row);
    }

    const all = [...rows.values()]
      .filter((row) => !query.overdueOnly || row.agg.overdue.gt(0))
      .sort(
        (a, b) =>
          b.agg.overdue.cmp(a.agg.overdue) ||
          b.agg.total.minus(b.agg.paid).cmp(a.agg.total.minus(a.agg.paid)) ||
          a.student.fullName.localeCompare(b.student.fullName) ||
          a.student.id.localeCompare(b.student.id) ||
          a.currency.localeCompare(b.currency),
      );
    const totals = new Map<string, { students: Set<string>; invoices: number; agg: MoneyAgg }>();
    for (const row of all) {
      const entry = totals.get(row.currency) ?? { students: new Set<string>(), invoices: 0, agg: zeroAgg() };
      entry.students.add(row.student.id);
      entry.invoices += row.invoices;
      entry.agg.total = entry.agg.total.plus(row.agg.total);
      entry.agg.paid = entry.agg.paid.plus(row.agg.paid);
      entry.agg.overdue = entry.agg.overdue.plus(row.agg.overdue);
      for (const bucket of Object.keys(entry.agg.aging) as (keyof AgingDto)[]) entry.agg.aging[bucket] = entry.agg.aging[bucket].plus(row.agg.aging[bucket]);
      totals.set(row.currency, entry);
    }

    const { rows: shown, truncated } = capRows(all);
    return {
      period: null,
      asOf: today,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: shown.map(
        (row): ReceivableRowDto => ({
          student: row.student,
          currency: row.currency,
          invoices: row.invoices,
          total: round2(row.agg.total),
          paid: round2(row.agg.paid),
          balance: round2(row.agg.total.minus(row.agg.paid)),
          overdue: round2(row.agg.overdue),
          oldestOverdueDueOn: row.oldest,
          daysOverdue: row.oldest === null ? null : inclusiveDays(row.oldest, today) - 1,
          aging: agingOf(row.agg),
        }),
      ),
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, entry]) => ({
          currency,
          students: entry.students.size,
          invoices: entry.invoices,
          total: round2(entry.agg.total),
          paid: round2(entry.agg.paid),
          balance: round2(entry.agg.total.minus(entry.agg.paid)),
          overdue: round2(entry.agg.overdue),
          aging: agingOf(entry.agg),
        })),
    };
  }

  /** API-163: invoiced (issued, not cancelled — by `issued_at`) and collected (completed — by `paid_at`) per course × month × currency. */
  async revenue(query: FinancialRevenueQueryDto, now: Date = new Date()): Promise<RevenueReportDto> {
    const context = await readReportContext(this.prisma.db, now);
    const window = periodWindow(resolvePeriod(query, context.today), context.timeZone);
    const courseFilter = query.courseId ? Prisma.sql`AND c.course_id = ${query.courseId}::uuid` : Prisma.empty;
    const grouped = Prisma.sql`
      inv AS (
        SELECT coalesce(c.course_id, ${NO_COURSE}::uuid) AS course_key, to_char(i.issued_at AT TIME ZONE ${context.timeZone}, 'YYYY-MM') AS month, i.currency,
               count(*) AS invoices, sum(i.total_amount) AS invoiced, sum(i.discount_amount) AS discounts
        FROM invoices i
        ${INVOICE_CLASS_JOIN}
        WHERE i.status = 'issued' AND ${within(Prisma.sql`i.issued_at`, window)} ${courseFilter}
        GROUP BY 1, 2, 3
      ),
      col AS (
        SELECT coalesce(c.course_id, ${NO_COURSE}::uuid) AS course_key, to_char(p.paid_at AT TIME ZONE ${context.timeZone}, 'YYYY-MM') AS month, p.currency,
               count(*) AS payments, sum(p.amount) AS collected
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        ${INVOICE_CLASS_JOIN}
        WHERE p.status = 'completed' AND ${within(Prisma.sql`p.paid_at`, window)} ${courseFilter}
        GROUP BY 1, 2, 3
      ),
      joined AS (
        SELECT coalesce(inv.course_key, col.course_key) AS course_key, coalesce(inv.month, col.month) AS month, coalesce(inv.currency, col.currency) AS currency,
               coalesce(inv.invoices, 0) AS invoices, coalesce(inv.invoiced, 0) AS invoiced, coalesce(inv.discounts, 0) AS discounts,
               coalesce(col.payments, 0) AS payments, coalesce(col.collected, 0) AS collected
        FROM inv FULL OUTER JOIN col ON col.course_key = inv.course_key AND col.month = inv.month AND col.currency = inv.currency
      )`;

    const [read, totalsRows] = await Promise.all([
      this.prisma.db.$queryRaw<{ course_key: string; course_code: string | null; course_name: unknown; month: string; currency: string; invoices: number; invoiced: string; discounts: string; payments: number; collected: string }[]>`
        WITH ${grouped}
        SELECT j.course_key, co.code AS course_code, co.name AS course_name, j.month, j.currency,
               j.invoices::int AS invoices, j.invoiced::text AS invoiced, j.discounts::text AS discounts, j.payments::int AS payments, j.collected::text AS collected
        FROM joined j
        LEFT JOIN courses co ON co.id = j.course_key
        ORDER BY co.code NULLS LAST, j.course_key, j.month, j.currency
        LIMIT ${ROW_CAP + 1}`,
      this.prisma.db.$queryRaw<{ currency: string; invoices: number; invoiced: string; discounts: string; payments: number; collected: string }[]>`
        WITH ${grouped}
        SELECT currency, sum(invoices)::int AS invoices, sum(invoiced)::text AS invoiced, sum(discounts)::text AS discounts, sum(payments)::int AS payments, sum(collected)::text AS collected
        FROM joined
        GROUP BY currency
        ORDER BY currency`,
    ]);

    const { rows, truncated } = capRows(read);
    return {
      period: window.period,
      timeZone: context.timeZone,
      generatedAt: context.generatedAt,
      truncated,
      rows: rows.map((row) => ({
        course: row.course_key === NO_COURSE || row.course_code === null ? null : { id: row.course_key, code: row.course_code, name: readLocalizedText(row.course_name) ?? { ar: row.course_code } },
        month: row.month,
        currency: row.currency,
        invoices: row.invoices,
        invoiced: round2(row.invoiced),
        discounts: round2(row.discounts),
        payments: row.payments,
        collected: round2(row.collected),
      })),
      totals: totalsRows.map((row) => ({ currency: row.currency, invoices: row.invoices, invoiced: round2(row.invoiced), discounts: round2(row.discounts), payments: row.payments, collected: round2(row.collected) })),
    };
  }
}
