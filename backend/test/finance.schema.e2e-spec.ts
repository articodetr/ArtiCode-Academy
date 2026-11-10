// TEST-160 — MOD-11-T01 schema (migration 20261110212431_mod11_finance): the
// `fee_plans`, `invoices`, `invoice_lines`, `invoice_installments` and
// `payments` tables, their three enums, the hand-written CHECKs (localized
// texts, plan scope and arrays, currency, amounts, discount, total, paid
// range, number and issue instant exactly for a non-draft, cancellation and
// reversal fields, positive lines/installments/payments, installment range),
// the order/sequence keys and the referential actions. Runs against the local
// development database as the APPLICATION role and is skipped when no database
// is reachable (like TEST-134). Every data test runs inside a transaction that
// is rolled back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261110212431_mod11_finance';
const PREVIOUS_MIGRATION = '20261110200231_mod10_certificates';
const TABLES = ['fee_plans', 'invoices', 'invoice_lines', 'invoice_installments', 'payments'] as const;

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

async function canConnect(url: string): Promise<boolean> {
  const probe = new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('database schema — MOD-11 payments and installments (e2e, TEST-160)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async function expectSqlError(client: PoolClient, sql: string, params: unknown[], code: string, constraint?: string): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string; constraint?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; constraint?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql}`).toBeDefined();
    expect(caught?.code).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  const tag = `F${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const NAME = '{"ar":"خطة"}';
  const PLAN_SQL = `INSERT INTO fee_plans (name, course_id, class_id, lines, installments) VALUES ($1::jsonb, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`;
  const INVOICE_SQL = `INSERT INTO invoices (number, student_user_id, status, currency, subtotal, discount_amount, discount_reason, total_amount, paid_amount, issued_at, cancelled_at, cancel_reason)
                       VALUES ($1, $2, $3::invoice_status, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`;
  const PAYMENT_SQL = `INSERT INTO payments (number, invoice_id, amount, currency, method, status, paid_at, reversed_at, reverse_reason)
                       VALUES ($1, $2, $3, $4, $5::payment_method, $6::payment_status, now(), $7, $8) RETURNING id`;

  interface InvoiceOver {
    number: string | null;
    status: string;
    currency: string;
    subtotal: number;
    discount: number;
    reason: string | null;
    total: number;
    paid: number;
    issuedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
  }
  let serial = 0;
  /** An issued invoice of 300 with nothing paid, unless overridden. */
  function invoiceParams(studentId: string, over: Partial<InvoiceOver> = {}): unknown[] {
    serial += 1;
    const i: InvoiceOver = {
      number: `${tag}-INV-${serial}`,
      status: 'issued',
      currency: 'SAR',
      subtotal: 300,
      discount: 0,
      reason: null,
      total: 300,
      paid: 0,
      issuedAt: '2026-11-11T09:00:00Z',
      cancelledAt: null,
      cancelReason: null,
      ...over,
    };
    return [i.number, studentId, i.status, i.currency, i.subtotal, i.discount, i.reason, i.total, i.paid, i.issuedAt, i.cancelledAt, i.cancelReason];
  }
  async function invoice(client: PoolClient, studentId: string, over: Partial<InvoiceOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(INVOICE_SQL, invoiceParams(studentId, over))).rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }
  async function course(client: PoolClient, suffix: string): Promise<string> {
    return (await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`])).rows[0]!.id;
  }
  async function klass(client: PoolClient, courseId: string, suffix: string): Promise<string> {
    return (await client.query<{ id: string }>(`INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`, [courseId, `${tag}-${suffix}`])).rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-10 migration, with the three enums and the defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('invoice_status')).toEqual(['draft', 'issued', 'cancelled']);
    expect(await enums('payment_method')).toEqual(['cash', 'bank_transfer', 'card', 'cheque', 'other']);
    expect(await enums('payment_status')).toEqual(['completed', 'reversed']);

    await inRollback(async (client) => {
      const plan = await client.query<Record<string, unknown>>(`INSERT INTO fee_plans (name, lines, installments) VALUES ($1::jsonb, '[]', '[]') RETURNING is_active, course_id, class_id, created_by`, [NAME]);
      expect(plan.rows[0]).toEqual({ is_active: true, course_id: null, class_id: null, created_by: null });
      const student = await user(client, 'd');
      const draft = await client.query<Record<string, unknown>>(
        `INSERT INTO invoices (student_user_id, currency, subtotal, total_amount) VALUES ($1, 'SAR', 100, 100)
         RETURNING status, number, discount_amount::text AS discount, paid_amount::text AS paid, issued_at, enrollment_id, fee_plan_id, notes`,
        [student],
      );
      expect(draft.rows[0]).toEqual({ status: 'draft', number: null, discount: '0.00', paid: '0.00', issued_at: null, enrollment_id: null, fee_plan_id: null, notes: null });
      const issued = await invoice(client, student);
      const payment = await client.query<Record<string, unknown>>(
        `INSERT INTO payments (number, invoice_id, amount, currency, method, paid_at) VALUES ($1, $2, 50, 'SAR', 'cash', now()) RETURNING status, reference, payer_name, recorded_by, reversed_at`,
        [`${tag}-RCPT-D`, issued],
      );
      expect(payment.rows[0]).toEqual({ status: 'completed', reference: null, payer_name: null, recorded_by: null, reversed_at: null });
    });
  });

  it('gives the application role DML without TRUNCATE on the five tables, and adds no extension', async () => {
    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml, has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist']);
  });

  it('enforces the fee plan CHECKs (localized name, a course or a class, arrays) and cascades a plan with its course or class — AC2, AC4', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'P');
      const classId = await klass(client, courseId, 'P');
      await expectSqlError(client, PLAN_SQL, ['{"en":"plan"}', null, null, '[]', '[]'], CHECK_VIOLATION, 'ck_fee_plans_name_localized');
      await expectSqlError(client, PLAN_SQL, [NAME, courseId, classId, '[]', '[]'], CHECK_VIOLATION, 'ck_fee_plans_scope');
      await expectSqlError(client, PLAN_SQL, [NAME, null, null, '{}', '[]'], CHECK_VIOLATION, 'ck_fee_plans_lines_array');
      await expectSqlError(client, PLAN_SQL, [NAME, null, null, '[]', '{}'], CHECK_VIOLATION, 'ck_fee_plans_installments_array');
      const lines = '[{"description":{"ar":"رسوم"},"amount":300}]';
      const shares = '[{"percent":50,"dueOffsetDays":0},{"percent":50,"dueOffsetDays":30}]';
      const forCourse = (await client.query<{ id: string }>(PLAN_SQL, [NAME, courseId, null, lines, shares])).rows[0]!.id;
      const forClass = (await client.query<{ id: string }>(PLAN_SQL, [NAME, null, classId, lines, shares])).rows[0]!.id;
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      await client.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
      expect(await count(client, `SELECT count(*)::int AS n FROM fee_plans WHERE id = ANY($1::uuid[])`, [[forCourse, forClass]])).toBe(0);
    });
  });

  it('enforces the invoice CHECKs (currency, amounts, discount, total, paid, number and issue instant, cancellation) and unique numbers — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const s = await user(client, 'i');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { currency: 'sar' }), CHECK_VIOLATION, 'ck_invoices_currency');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { subtotal: -1, total: -1 }), CHECK_VIOLATION, 'ck_invoices_amounts_non_negative');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { discount: 301, total: -1 }), CHECK_VIOLATION);
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { reason: 'خصم' }), CHECK_VIOLATION, 'ck_invoices_discount_range');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { discount: 50, total: 300 }), CHECK_VIOLATION, 'ck_invoices_total');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { paid: 300.01 }), CHECK_VIOLATION, 'ck_invoices_paid_range');
      // A draft has neither number nor issue instant; an issued one has both.
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { status: 'draft' }), CHECK_VIOLATION, 'ck_invoices_issued');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { number: null }), CHECK_VIOLATION, 'ck_invoices_issued');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { issuedAt: null }), CHECK_VIOLATION, 'ck_invoices_issued');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { number: ' INV-1' }), CHECK_VIOLATION, 'ck_invoices_number_trimmed');
      // Cancellation fields exactly for a cancelled invoice, with a non-empty reason.
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { status: 'cancelled' }), CHECK_VIOLATION, 'ck_invoices_cancellation');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { status: 'cancelled', cancelledAt: '2026-11-11T10:00:00Z', cancelReason: ' ' }), CHECK_VIOLATION, 'ck_invoices_cancellation');
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { cancelReason: 'سبب' }), CHECK_VIOLATION, 'ck_invoices_cancellation');
      // Valid: a draft, a discounted issued invoice, a paid one, a cancelled one; a number is unique.
      await invoice(client, s, { number: null, status: 'draft', issuedAt: null });
      const discounted = await invoice(client, s, { number: `${tag}-UNIQ`, discount: 50, reason: 'منحة', total: 250 });
      await invoice(client, s, { paid: 300 });
      await invoice(client, s, { status: 'cancelled', cancelledAt: '2026-11-11T10:00:00Z', cancelReason: 'خطأ في البنود' });
      await expectSqlError(client, INVOICE_SQL, invoiceParams(s, { number: `${tag}-UNIQ` }), UNIQUE_VIOLATION, 'invoices_number_key');
      expect((await client.query(`SELECT total_amount::text AS total FROM invoices WHERE id = $1`, [discounted])).rows[0]).toEqual({ total: '250.00' });
    });
  });

  it('enforces the line and installment CHECKs and keys, and deletes them with their invoice — AC2, AC3, AC4', async () => {
    await inRollback(async (client) => {
      const id = await invoice(client, await user(client, 'l'));
      const LINE = `INSERT INTO invoice_lines (invoice_id, sort_order, description, amount) VALUES ($1, $2, $3::jsonb, $4)`;
      const INST = `INSERT INTO invoice_installments (invoice_id, seq, amount, due_on) VALUES ($1, $2, $3, $4)`;
      await expectSqlError(client, LINE, [id, 0, NAME, 0], CHECK_VIOLATION, 'ck_invoice_lines_amount_positive');
      await expectSqlError(client, LINE, [id, 0, '{"en":"fee"}', 100], CHECK_VIOLATION, 'ck_invoice_lines_description_localized');
      await expectSqlError(client, LINE, [id, -1, NAME, 100], CHECK_VIOLATION, 'ck_invoice_lines_sort_order');
      await client.query(LINE, [id, 0, '{"ar":"رسوم الدورة"}', 200]);
      await client.query(LINE, [id, 1, '{"ar":"كتب"}', 100]);
      await expectSqlError(client, LINE, [id, 1, NAME, 5], UNIQUE_VIOLATION, 'uq_invoice_lines_order');
      await expectSqlError(client, INST, [id, 0, 100, '2026-12-01'], CHECK_VIOLATION, 'ck_invoice_installments_seq_range');
      await expectSqlError(client, INST, [id, 25, 100, '2026-12-01'], CHECK_VIOLATION, 'ck_invoice_installments_seq_range');
      await expectSqlError(client, INST, [id, 1, 0, '2026-12-01'], CHECK_VIOLATION, 'ck_invoice_installments_amount_positive');
      await client.query(INST, [id, 1, 150, '2026-11-11']);
      await client.query(INST, [id, 2, 150, '2026-12-11']);
      await expectSqlError(client, INST, [id, 2, 1, '2027-01-11'], UNIQUE_VIOLATION, 'uq_invoice_installments_seq');
      await client.query(`DELETE FROM invoices WHERE id = $1`, [id]);
      expect(await count(client, `SELECT count(*)::int AS n FROM invoice_lines WHERE invoice_id = $1`, [id])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM invoice_installments WHERE invoice_id = $1`, [id])).toBe(0);
    });
  });

  it('enforces the payment CHECKs (positive amount, currency, receipt number, reversal fields) and unique receipts — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const id = await invoice(client, await user(client, 'p'));
      const params = (over: Partial<{ number: string; amount: number; currency: string; status: string; reversedAt: string | null; reason: string | null }> = {}) => {
        const p = { number: `${tag}-RCPT-${Math.random().toString(36).slice(2, 7)}`, amount: 100, currency: 'SAR', status: 'completed', reversedAt: null, reason: null, ...over };
        return [p.number, id, p.amount, p.currency, 'bank_transfer', p.status, p.reversedAt, p.reason];
      };
      await expectSqlError(client, PAYMENT_SQL, params({ amount: 0 }), CHECK_VIOLATION, 'ck_payments_amount_positive');
      await expectSqlError(client, PAYMENT_SQL, params({ currency: 'SA' }), CHECK_VIOLATION, 'ck_payments_currency');
      await expectSqlError(client, PAYMENT_SQL, params({ number: 'R-1 ' }), CHECK_VIOLATION, 'ck_payments_number_trimmed');
      await expectSqlError(client, PAYMENT_SQL, params({ status: 'reversed' }), CHECK_VIOLATION, 'ck_payments_reversal');
      await expectSqlError(client, PAYMENT_SQL, params({ status: 'reversed', reversedAt: '2026-11-11T11:00:00Z', reason: '' }), CHECK_VIOLATION, 'ck_payments_reversal');
      await expectSqlError(client, PAYMENT_SQL, params({ reason: 'خطأ' }), CHECK_VIOLATION, 'ck_payments_reversal');
      await client.query(PAYMENT_SQL, params({ number: `${tag}-RCPT-1` }));
      await client.query(PAYMENT_SQL, params({ status: 'reversed', reversedAt: '2026-11-11T11:00:00Z', reason: 'دفعة مكرّرة' }));
      await expectSqlError(client, PAYMENT_SQL, params({ number: `${tag}-RCPT-1` }), UNIQUE_VIOLATION, 'payments_number_key');
    });
  });

  it('restricts deleting a student with an invoice and an invoice with a payment; clears the enrollment, plan and actor links — AC4', async () => {
    await inRollback(async (client) => {
      const student = await user(client, 'fk');
      const actor = await user(client, 'fkactor');
      const courseId = await course(client, 'FK');
      const classId = await klass(client, courseId, 'FK');
      const enrollmentId = (await client.query<{ id: string }>(`INSERT INTO enrollments (class_id, student_user_id, status) VALUES ($1, $2, 'active') RETURNING id`, [classId, student])).rows[0]!.id;
      const planId = (await client.query<{ id: string }>(PLAN_SQL, [NAME, null, null, '[]', '[]'])).rows[0]!.id;
      const id = await invoice(client, student);
      await client.query(`UPDATE invoices SET enrollment_id = $2, fee_plan_id = $3, created_by = $4, issued_by = $4 WHERE id = $1`, [id, enrollmentId, planId, actor]);
      const payment = (await client.query<{ id: string }>(PAYMENT_SQL, [`${tag}-RCPT-FK`, id, 100, 'SAR', 'cash', 'completed', null, null])).rows[0]!.id;
      await client.query(`UPDATE payments SET recorded_by = $2 WHERE id = $1`, [payment, actor]);

      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM invoices WHERE id = $1`, [id], RESTRICT_VIOLATION, 'payments_invoice_id_fkey');
      await client.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
      await client.query(`DELETE FROM fee_plans WHERE id = $1`, [planId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [actor]);
      expect((await client.query(`SELECT enrollment_id, fee_plan_id, created_by, issued_by FROM invoices WHERE id = $1`, [id])).rows[0]).toEqual({ enrollment_id: null, fee_plan_id: null, created_by: null, issued_by: null });
      expect((await client.query(`SELECT recorded_by FROM payments WHERE id = $1`, [payment])).rows[0]).toEqual({ recorded_by: null });
    });
  });

  it('names the CHECKs and the keys as the migration does', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype = 'c'
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
      [[...TABLES]],
    );
    expect(constraints.rows.map((row) => `${row.table_name}.${row.conname}`)).toEqual([
      'fee_plans.ck_fee_plans_installments_array',
      'fee_plans.ck_fee_plans_lines_array',
      'fee_plans.ck_fee_plans_name_localized',
      'fee_plans.ck_fee_plans_scope',
      'invoice_installments.ck_invoice_installments_amount_positive',
      'invoice_installments.ck_invoice_installments_seq_range',
      'invoice_lines.ck_invoice_lines_amount_positive',
      'invoice_lines.ck_invoice_lines_description_localized',
      'invoice_lines.ck_invoice_lines_sort_order',
      'invoices.ck_invoices_amounts_non_negative',
      'invoices.ck_invoices_cancellation',
      'invoices.ck_invoices_currency',
      'invoices.ck_invoices_discount_range',
      'invoices.ck_invoices_issued',
      'invoices.ck_invoices_number_trimmed',
      'invoices.ck_invoices_paid_range',
      'invoices.ck_invoices_total',
      'payments.ck_payments_amount_positive',
      'payments.ck_payments_currency',
      'payments.ck_payments_number_trimmed',
      'payments.ck_payments_reversal',
    ]);
    const indexes = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_invoice_lines_order', 'uq_invoice_installments_seq') ORDER BY 1`);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(['uq_invoice_installments_seq', 'uq_invoice_lines_order']);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const student = await tx.user.create({ data: { fullName: 'Prisma payer', email: `${tag.toLowerCase()}-prisma@example.com` } });
        const plan = await tx.feePlan.create({ data: { name: { ar: 'خطة' }, lines: [{ description: { ar: 'رسوم' }, amount: 300 }], installments: [{ percent: 100, dueOffsetDays: 0 }] } });
        const row = await tx.invoice.create({
          data: {
            studentUserId: student.id,
            feePlanId: plan.id,
            currency: 'SAR',
            subtotal: 300,
            totalAmount: 300,
            lines: { create: [{ sortOrder: 0, description: { ar: 'رسوم' }, amount: 300 }] },
            installments: { create: [{ seq: 1, amount: 300, dueOn: new Date('2026-12-01') }] },
          },
          include: { lines: true, installments: true },
        });
        expect(row).toMatchObject({ status: 'draft', number: null, feePlanId: plan.id });
        expect(row.lines[0]!.amount.toString()).toBe('300');
        expect(row.installments[0]!.dueOn.toISOString().slice(0, 10)).toBe('2026-12-01');
        throw marker;
      }),
    ).rejects.toBe(marker);
  });
});
