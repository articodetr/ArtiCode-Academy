// TEST-134 — MOD-10-T01 schema (migration 20261110200231_mod10_certificates):
// the `number_sequences` and `certificates` tables, the `certificate_status`
// enum, the hand-written CHECKs (trimmed key/period/serial, verification code
// format, percent range, localized band label, trimmed letter, snapshot object,
// revocation fields exactly for a revoked certificate), the "one issued
// certificate per enrollment" partial unique index and the referential actions
// (Restrict on the enrollment, class, course and student; SetNull on the issuer
// and revoker). Runs against the local development database as the APPLICATION
// role and is skipped when no database is reachable (like TEST-127). Every data
// test runs inside a transaction that is rolled back.
import { randomInt } from 'node:crypto';
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
const MIGRATION = '20261110200231_mod10_certificates';
const PREVIOUS_MIGRATION = '20261110165437_mod09_exams_grades';
const TABLES = ['number_sequences', 'certificates'] as const;

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** ON DELETE RESTRICT is checked immediately and reports restrict_violation. */
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

describe.skipIf(!available)('database schema — MOD-10 certificates (e2e, TEST-134)', () => {
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

  /** Runs `fn` in a transaction that is always rolled back. */
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

  /** Asserts that `sql` fails with the given SQLSTATE (and constraint) without aborting the transaction. */
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

  // Unique values per run so a parallel e2e file never collides with this one.
  const tag = `C${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const SEQUENCE_SQL = `INSERT INTO number_sequences (key, period, last_value) VALUES ($1, $2, $3)`;
  const CERT_SQL = `INSERT INTO certificates (serial, verification_code, enrollment_id, class_id, course_id, student_user_id, status, percent, band_label, band_letter, snapshot, issued_by, revoked_at, revoked_by, revoke_reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::certificate_status, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15) RETURNING id`;

  interface Fixture {
    courseId: string;
    classId: string;
    enrollmentId: string;
    studentId: string;
  }
  interface CertOver {
    serial: string;
    code: string;
    status: string;
    percent: number;
    label: string;
    letter: string | null;
    snapshot: string;
    issuedBy: string | null;
    revokedAt: string | null;
    revokedBy: string | null;
    reason: string | null;
  }
  let counter = 0;
  /** A valid issued certificate for the fixture, with a unique serial and code per call. */
  function certParams(f: Fixture, over: Partial<CertOver> = {}): unknown[] {
    counter += 1;
    const n = String(counter).padStart(5, '0');
    const c: CertOver = {
      serial: `${tag}-2026-${n}`,
      code: code(),
      status: 'issued',
      percent: 86.4,
      label: '{"ar":"جيد جداً","en":"Very good"}',
      letter: 'B',
      snapshot: '{"student":{"fullName":"طالب"}}',
      issuedBy: null,
      revokedAt: null,
      revokedBy: null,
      reason: null,
      ...over,
    };
    return [c.serial, c.code, f.enrollmentId, f.classId, f.courseId, f.studentId, c.status, c.percent, c.label, c.letter, c.snapshot, c.issuedBy, c.revokedAt, c.revokedBy, c.reason];
  }
  /** A random base32 verification code (A–Z and 2–7, 20 characters) — unique in practice. */
  function code(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    return Array.from({ length: 20 }, () => alphabet[randomInt(32)]).join('');
  }
  async function cert(client: PoolClient, f: Fixture, over: Partial<CertOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(CERT_SQL, certParams(f, { code: code(), ...over }))).rows[0]!.id;
  }

  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }
  async function fixture(client: PoolClient, suffix: string): Promise<Fixture> {
    const course = await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`]);
    const courseId = course.rows[0]!.id;
    const created = await client.query<{ id: string }>(`INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`, [courseId, `${tag}-${suffix}`]);
    const classId = created.rows[0]!.id;
    const studentId = await user(client, `s${suffix.toLowerCase()}`);
    const enrolled = await client.query<{ id: string }>(`INSERT INTO enrollments (class_id, student_user_id, status) VALUES ($1, $2, 'completed') RETURNING id`, [classId, studentId]);
    return { courseId, classId, studentId, enrollmentId: enrolled.rows[0]!.id };
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-09 migration, with the enum and the defaults of the two tables', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
    expect((await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::certificate_status))::text AS v`)).rows.map((row) => row.v)).toEqual(['issued', 'revoked']);

    await inRollback(async (client) => {
      const sequence = await client.query<Record<string, unknown>>(`INSERT INTO number_sequences (key) VALUES ($1) RETURNING period, last_value::text AS last_value`, [`${tag}-seq`]);
      expect(sequence.rows[0]).toEqual({ period: '', last_value: '0' });
      const f = await fixture(client, 'D');
      const created = await client.query<Record<string, unknown>>(
        `INSERT INTO certificates (serial, verification_code, enrollment_id, class_id, course_id, student_user_id, percent, band_label, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, 75, '{"ar":"جيد"}', '{}')
         RETURNING status, band_letter, issued_by, revoked_at, revoked_by, revoke_reason, issued_at IS NOT NULL AS issued`,
        [`${tag}-2026-00000`, code(), f.enrollmentId, f.classId, f.courseId, f.studentId],
      );
      expect(created.rows[0]).toEqual({ status: 'issued', band_letter: null, issued_by: null, revoked_at: null, revoked_by: null, revoke_reason: null, issued: true });
    });
  });

  it('gives the application role DML without TRUNCATE on the two tables, and adds no extension', async () => {
    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist']);
  });

  it('enforces the number_sequences CHECKs and one row per key and period — AC2', async () => {
    await inRollback(async (client) => {
      await expectSqlError(client, SEQUENCE_SQL, [' cert', '2026', 0], CHECK_VIOLATION, 'ck_number_sequences_key_trimmed');
      await expectSqlError(client, SEQUENCE_SQL, ['', '2026', 0], CHECK_VIOLATION, 'ck_number_sequences_key_trimmed');
      await expectSqlError(client, SEQUENCE_SQL, [`${tag}-k`, '2026 ', 0], CHECK_VIOLATION, 'ck_number_sequences_period_trimmed');
      await expectSqlError(client, SEQUENCE_SQL, [`${tag}-k`, '2026', -1], CHECK_VIOLATION, 'ck_number_sequences_last_value_non_negative');
      await client.query(SEQUENCE_SQL, [`${tag}-k`, '2026', 41]);
      await client.query(SEQUENCE_SQL, [`${tag}-k`, '2027', 0]); // another period
      await expectSqlError(client, SEQUENCE_SQL, [`${tag}-k`, '2026', 1], UNIQUE_VIOLATION, 'number_sequences_pkey');
      // The issuing pattern: lock the row, then take the next value.
      const next = await client.query<{ last_value: string }>(
        `UPDATE number_sequences SET last_value = last_value + 1 WHERE key = $1 AND period = $2 RETURNING last_value::text AS last_value`,
        [`${tag}-k`, '2026'],
      );
      expect(next.rows[0]).toEqual({ last_value: '42' });
    });
  });

  it('enforces the certificate CHECKs (serial, code format, percent, label, letter, snapshot, revocation fields) — AC2', async () => {
    await inRollback(async (client) => {
      const f = await fixture(client, 'C');
      const issuer = await user(client, 'cissuer');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), serial: ' X-1' }), CHECK_VIOLATION, 'ck_certificates_serial_trimmed');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: 'abcdefghijklmnopqrst' }), CHECK_VIOLATION, 'ck_certificates_verification_code_format');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: 'ABCDEFGH01' }), CHECK_VIOLATION, 'ck_certificates_verification_code_format');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), percent: 100.01 }), CHECK_VIOLATION, 'ck_certificates_percent_range');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), label: '{"en":"Very good"}' }), CHECK_VIOLATION, 'ck_certificates_band_label_localized');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), letter: 'B ' }), CHECK_VIOLATION, 'ck_certificates_band_letter_trimmed');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), snapshot: '[]' }), CHECK_VIOLATION, 'ck_certificates_snapshot_object');
      // Revocation fields exist exactly for a revoked certificate, with a non-empty reason.
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), status: 'revoked' }), CHECK_VIOLATION, 'ck_certificates_revocation');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), status: 'revoked', revokedAt: '2026-11-10T12:00:00Z', reason: '  ' }), CHECK_VIOLATION, 'ck_certificates_revocation');
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code(), reason: 'سبب' }), CHECK_VIOLATION, 'ck_certificates_revocation');
      // Valid: an issued certificate with an issuer, then a revoked one (the revoker may be unknown).
      await cert(client, f, { issuedBy: issuer, status: 'revoked', revokedAt: '2026-11-10T12:00:00Z', revokedBy: issuer, reason: 'خطأ في الاسم' });
      await cert(client, f, { issuedBy: issuer, percent: 100, letter: null });
      expect(await count(client, `SELECT count(*)::int AS n FROM certificates WHERE enrollment_id = $1`, [f.enrollmentId])).toBe(2);
    });
  });

  it('keeps one issued certificate per enrollment, unique serials and codes — AC3', async () => {
    await inRollback(async (client) => {
      const f = await fixture(client, 'U');
      const first = await cert(client, f, { serial: `${tag}-2026-90001` });
      await expectSqlError(client, CERT_SQL, certParams(f, { code: code() }), UNIQUE_VIOLATION, 'uq_certificates_enrollment_issued');
      // Revoking the first frees the enrollment for a new certificate with a new serial.
      await client.query(`UPDATE certificates SET status = 'revoked', revoked_at = now(), revoke_reason = 'إعادة إصدار' WHERE id = $1`, [first]);
      const reissued = await cert(client, f, { serial: `${tag}-2026-90002` });
      expect(reissued).not.toBe(first);
      // Serial and code are unique across every certificate, revoked ones included.
      const g = await fixture(client, 'V');
      await expectSqlError(client, CERT_SQL, certParams(g, { code: code(), serial: `${tag}-2026-90001` }), UNIQUE_VIOLATION, 'certificates_serial_key');
      const taken = (await client.query<{ verification_code: string }>(`SELECT verification_code FROM certificates WHERE id = $1`, [first])).rows[0]!.verification_code;
      await expectSqlError(client, CERT_SQL, certParams(g, { code: taken }), UNIQUE_VIOLATION, 'certificates_verification_code_key');
    });
  });

  it('restricts deleting the enrollment, class, course and student of a certificate and clears the issuer and revoker — AC4', async () => {
    await inRollback(async (client) => {
      const f = await fixture(client, 'FK');
      const issuer = await user(client, 'fkissuer');
      const revoker = await user(client, 'fkrevoker');
      const id = await cert(client, f, { issuedBy: issuer, status: 'revoked', revokedAt: '2026-11-10T12:00:00Z', revokedBy: revoker, reason: 'اختبار' });
      await expectSqlError(client, `DELETE FROM enrollments WHERE id = $1`, [f.enrollmentId], RESTRICT_VIOLATION, 'certificates_enrollment_id_fkey');
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [f.studentId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM courses WHERE id = $1`, [f.courseId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM classes WHERE id = $1`, [f.classId], RESTRICT_VIOLATION);
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[issuer, revoker]]);
      expect((await client.query(`SELECT issued_by, revoked_by, status::text AS status FROM certificates WHERE id = $1`, [id])).rows[0]).toEqual({ issued_by: null, revoked_by: null, status: 'revoked' });
    });
  });

  it('names the CHECKs, the keys and the partial unique index as the migration does', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype IN ('c', 'u')
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
      [[...TABLES]],
    );
    expect(constraints.rows).toEqual([
      { table_name: 'certificates', conname: 'ck_certificates_band_label_localized', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_band_letter_trimmed', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_percent_range', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_revocation', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_serial_trimmed', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_snapshot_object', contype: 'c' },
      { table_name: 'certificates', conname: 'ck_certificates_verification_code_format', contype: 'c' },
      { table_name: 'number_sequences', conname: 'ck_number_sequences_key_trimmed', contype: 'c' },
      { table_name: 'number_sequences', conname: 'ck_number_sequences_last_value_non_negative', contype: 'c' },
      { table_name: 'number_sequences', conname: 'ck_number_sequences_period_trimmed', contype: 'c' },
    ]);
    const index = await pool.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_certificates_enrollment_issued'`);
    expect(index.rows[0]!.indexdef).toMatch(/UNIQUE INDEX uq_certificates_enrollment_issued ON public\.certificates USING btree \(enrollment_id\) WHERE \(status = 'issued'::certificate_status\)$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' } });
        const created = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 10, status: 'completed' } });
        const student = await tx.user.create({ data: { fullName: 'Prisma student', email: `${tag.toLowerCase()}-prisma@example.com` } });
        const enrolled = await tx.enrollment.create({ data: { classId: created.id, studentUserId: student.id, status: 'completed' } });
        const sequence = await tx.numberSequence.upsert({
          where: { key_period: { key: `${tag}-P`, period: '2026' } },
          create: { key: `${tag}-P`, period: '2026', lastValue: 1 },
          update: { lastValue: { increment: 1 } },
        });
        expect(sequence.lastValue).toBe(1n);
        const row = await tx.certificate.create({
          data: {
            serial: `${tag}-2026-00001`,
            verificationCode: code(),
            enrollmentId: enrolled.id,
            classId: created.id,
            courseId: course.id,
            studentUserId: student.id,
            percent: 86.4,
            bandLabel: { ar: 'جيد جداً' },
            bandLetter: 'B',
            snapshot: { student: { fullName: 'Prisma student' }, course: { code: `${tag}-P` } },
          },
          include: { enrollment: true },
        });
        expect(row).toMatchObject({ status: 'issued', bandLetter: 'B', issuedById: null, revokedAt: null, revokeReason: null });
        expect(row.percent.toString()).toBe('86.4');
        expect(row.enrollment.id).toBe(enrolled.id);
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.certificate.count({ where: { serial: `${tag}-2026-00001` } })).toBe(0);
  });
});
