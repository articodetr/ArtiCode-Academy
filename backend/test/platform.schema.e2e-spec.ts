// TEST-206 — MOD-18-T01 the platform database `articode_platform` (master doc
// 6.6.2/6.6.3; migration prisma/platform/migrations/20261113182048_platform_init):
// the eight tables and six enums, the generated platform client
// (src/generated/platform) over @prisma/adapter-pg, the role boundaries (DML
// only for `platform_app`, no DDL; the academy roles cannot connect to the
// platform database and the platform roles cannot connect to the academy one),
// the hand-written CHECKs, the two partial unique indexes, the referential
// actions and the append-only triggers of platform_audit_logs.
//
// Runs as the platform APPLICATION role and is skipped when the platform
// database is unreachable (no PLATFORM_DATABASE_URL and no
// PLATFORM_DB_APP_PASSWORD, or no server). Every SQL test runs inside a
// transaction that is rolled back — the audit rows too, so the suite leaves no
// append-only row behind; the rows the Prisma client writes outside a
// transaction are deleted in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Client, Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/platform/client.js';
import { platformPostgresUrlFromEnv, postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const PLATFORM_URL = process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
const ACADEMY_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261113182048_platform_init';
const TABLES = [
  'academies',
  'academy_health_checks',
  'domains',
  'plans',
  'platform_audit_logs',
  'platform_refresh_tokens',
  'platform_users',
  'subscriptions',
] as const;

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';
/** RAISE EXCEPTION without an explicit code (the append-only trigger). */
const RAISE_EXCEPTION = 'P0001';

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

/** The SQLSTATE of a refused connection (null when it connects). */
async function connectError(url: string): Promise<string | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** `url` with another database name (same role and credentials). */
function onDatabase(url: string, databaseOf: string): string {
  const target = new URL(url);
  target.pathname = new URL(databaseOf).pathname;
  return target.toString();
}

const available = PLATFORM_URL ? await canConnect(PLATFORM_URL) : false;

describe.skipIf(!available)('platform database schema — MOD-18-T01 (e2e, TEST-206)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  const tag = `t${Date.now().toString(36)}`;

  beforeAll(() => {
    pool = new Pool({ connectionString: PLATFORM_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: PLATFORM_URL! }) });
  });

  afterAll(async () => {
    // The rows written by the client test (academies cascade to their domains,
    // subscriptions and health checks; the plan only after its subscription).
    if (prisma) {
      await prisma.academy.deleteMany({ where: { slug: { startsWith: tag } } });
      await prisma.plan.deleteMany({ where: { key: { startsWith: tag } } });
      await prisma.platformUser.deleteMany({ where: { email: { startsWith: `${tag}-` } } });
      await prisma.$disconnect();
    }
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
    let caught: { code?: string; constraint?: string; message?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; constraint?: string; message?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql} ${JSON.stringify(params)}`).toBeDefined();
    expect(caught?.code, caught?.message).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  const USER_SQL = `INSERT INTO platform_users (email, full_name, role, failed_login_count) VALUES ($1, $2, $3::platform_role, $4) RETURNING id`;
  const ACADEMY_SQL = `INSERT INTO academies (slug, name, status, origin, contact_email, notes, archived_at)
                       VALUES ($1, $2::jsonb, $3::academy_status, $4, $5, $6, $7) RETURNING id`;
  const PLAN_SQL = `INSERT INTO plans (key, name, limits) VALUES ($1, $2::jsonb, $3::jsonb) RETURNING id`;
  const SUBSCRIPTION_SQL = `INSERT INTO subscriptions (academy_id, plan_id, status, starts_at, ends_at, trial_ends_at)
                            VALUES ($1, $2, $3::subscription_status, $4, $5, $6) RETURNING id`;
  const DOMAIN_SQL = `INSERT INTO domains (academy_id, hostname, kind, is_primary) VALUES ($1, $2, $3::domain_kind, $4) RETURNING id`;
  const HEALTH_SQL = `INSERT INTO academy_health_checks (academy_id, outcome, latency_ms, error) VALUES ($1, $2::probe_outcome, $3, $4) RETURNING id`;
  const AUDIT_SQL = `INSERT INTO platform_audit_logs (actor_platform_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`;
  const STARTS = '2026-11-01T00:00:00Z';

  let seq = 0;
  const unique = (prefix: string) => `${tag}${prefix}${(seq += 1)}`;

  async function user(client: PoolClient): Promise<string> {
    return (await client.query<{ id: string }>(USER_SQL, [`${unique('u')}@example.com`, 'مستخدم المنصة', 'super_admin', 0])).rows[0]!.id;
  }
  interface AcademyOver {
    slug: string;
    name: string;
    status: string;
    origin: string | null;
    contactEmail: string | null;
    notes: string | null;
    archivedAt: string | null;
  }
  function academyParams(over: Partial<AcademyOver> = {}): unknown[] {
    const a: AcademyOver = { slug: unique('a'), name: '{"ar":"أكاديمية"}', status: 'provisioning', origin: null, contactEmail: null, notes: null, archivedAt: null, ...over };
    return [a.slug, a.name, a.status, a.origin, a.contactEmail, a.notes, a.archivedAt];
  }
  async function academy(client: PoolClient, over: Partial<AcademyOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(ACADEMY_SQL, academyParams(over))).rows[0]!.id;
  }
  async function plan(client: PoolClient): Promise<string> {
    return (await client.query<{ id: string }>(PLAN_SQL, [unique('p'), '{"ar":"خطة"}', '{}'])).rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('holds the eight tables and six enums of the applied platform_init migration', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    expect(migrations.rows.map((row) => row.migration_name)).toContain(MIGRATION);
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([...TABLES]);

    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('platform_role')).toEqual(['super_admin', 'support']);
    expect(await enums('platform_user_status')).toEqual(['active', 'suspended']);
    expect(await enums('academy_status')).toEqual(['provisioning', 'active', 'suspended', 'archived']);
    expect(await enums('domain_kind')).toEqual(['platform_subdomain', 'custom']);
    expect(await enums('subscription_status')).toEqual(['trial', 'active', 'past_due', 'canceled', 'expired']);
    expect(await enums('probe_outcome')).toEqual(['ready', 'not_ready', 'unreachable', 'invalid']);

    // No table of the academy schema leaked into this database.
    const academyTables = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'academy', 'audit_logs', 'refresh_tokens')`);
    expect(academyTables.rowCount).toBe(0);
  });

  it('writes and reads through the generated platform client, with the defaults of the schema', async () => {
    const admin = await prisma.platformUser.create({ data: { email: `${tag}-admin@example.com`, fullName: 'مدير المنصة', role: 'super_admin' } });
    expect(admin.id[14]).toBe('7'); // UUIDv7 from PostgreSQL 18
    expect(admin).toMatchObject({ status: 'active', failedLoginCount: 0, passwordHash: null, lockedUntil: null, lastLoginAt: null });

    const basic = await prisma.plan.create({ data: { key: `${tag}-basic`, name: { ar: 'أساسية', en: 'Basic' } } });
    expect(basic).toMatchObject({ limits: {}, isActive: true });

    const created = await prisma.academy.create({
      data: {
        slug: `${tag}-academy`,
        name: { ar: 'أكاديمية الاختبار', en: 'Test Academy' },
        origin: 'https://academy.example.com',
        createdById: admin.id,
        domains: { create: [{ hostname: `${tag}.academies.example.com`, kind: 'platform_subdomain', isPrimary: true }] },
        subscriptions: { create: [{ planId: basic.id, status: 'trial', startsAt: new Date(STARTS), trialEndsAt: new Date('2026-12-01T00:00:00Z') }] },
        healthChecks: { create: [{ outcome: 'ready', httpStatus: 200, latencyMs: 12, triggeredById: admin.id }] },
      },
      include: { domains: true, subscriptions: { include: { plan: true } }, healthChecks: true, createdBy: true },
    });
    expect(created).toMatchObject({ status: 'provisioning', archivedAt: null, contactEmail: null, notes: null });
    expect(created.createdBy?.email).toBe(`${tag}-admin@example.com`);
    expect(created.domains).toHaveLength(1);
    expect(created.domains[0]).toMatchObject({ isPrimary: true, verifiedAt: null });
    expect(created.subscriptions[0]?.plan.key).toBe(`${tag}-basic`);
    expect(created.healthChecks[0]).toMatchObject({ outcome: 'ready', httpStatus: 200, latencyMs: 12 });
    expect(await prisma.academy.count({ where: { slug: { startsWith: tag } } })).toBe(1);
  });

  it('gives platform_app DML without TRUNCATE and without DDL', async () => {
    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml, has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const role = await pool.query<{ create_schema: boolean; create_db: boolean; superuser: boolean }>(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS create_schema, rolcreatedb AS create_db, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({ create_schema: false, create_db: false, superuser: false });
    await inRollback(async (client) => {
      await expectSqlError(client, `CREATE TABLE platform_schema_probe (id int)`, [], INSUFFICIENT_PRIVILEGE);
      await expectSqlError(client, `ALTER TABLE academies ADD COLUMN probe int`, [], INSUFFICIENT_PRIVILEGE);
      await expectSqlError(client, `DROP TABLE plans`, [], INSUFFICIENT_PRIVILEGE);
      await expectSqlError(client, `TRUNCATE platform_audit_logs`, [], INSUFFICIENT_PRIVILEGE);
    });
  });

  it.skipIf(!ACADEMY_URL)('keeps the academy and the platform roles out of each other\'s database', async () => {
    // articode_app on articode_platform, and platform_app on the academy database.
    expect(await connectError(onDatabase(ACADEMY_URL!, PLATFORM_URL!))).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await connectError(onDatabase(PLATFORM_URL!, ACADEMY_URL!))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('enforces the platform_users CHECKs (normalized e-mail, name, counter)', async () => {
    await inRollback(async (client) => {
      for (const email of ['Admin@example.com', ' admin@example.com', 'admin@example.com ', 'admin.example.com', '@example.com']) {
        const constraint = email.includes('@') && !email.startsWith('@') ? 'ck_platform_users_email_normalized' : 'ck_platform_users_email_format';
        await expectSqlError(client, USER_SQL, [email, 'اسم', 'support', 0], CHECK_VIOLATION, constraint);
      }
      await expectSqlError(client, USER_SQL, [`${unique('u')}@example.com`, '   ', 'support', 0], CHECK_VIOLATION, 'ck_platform_users_full_name_not_blank');
      await expectSqlError(client, USER_SQL, [`${unique('u')}@example.com`, 'اسم', 'support', -1], CHECK_VIOLATION, 'ck_platform_users_failed_login_count');
      const email = `${unique('u')}@example.com`;
      await client.query(USER_SQL, [email, 'اسم', 'support', 0]);
      await expectSqlError(client, USER_SQL, [email, 'آخر', 'super_admin', 0], UNIQUE_VIOLATION, 'platform_users_email_key');
    });
  });

  it('enforces the academies CHECKs (slug, Arabic name, origin, contact e-mail, notes, archived_at)', async () => {
    await inRollback(async (client) => {
      for (const slug of ['Bad', '-a', 'a-', 'a_b', '', 'a'.repeat(33), 'a.b']) {
        await expectSqlError(client, ACADEMY_SQL, academyParams({ slug }), CHECK_VIOLATION, 'ck_academies_slug_format');
      }
      for (const name of ['{"ar":""}', '{"ar":"   "}', '{"en":"Academy"}', '{"ar":5}', '{"ar":null}', '[]', '"أكاديمية"', 'null']) {
        await expectSqlError(client, ACADEMY_SQL, academyParams({ name }), CHECK_VIOLATION, 'ck_academies_name_localized');
      }
      for (const origin of ['http://academy.example.com', 'http://localhost.example.com', 'https://Academy.example.com', 'https://academy.example.com/', 'https://academy.example.com/path', 'ftp://academy.example.com', 'https://', '']) {
        await expectSqlError(client, ACADEMY_SQL, academyParams({ origin }), CHECK_VIOLATION, 'ck_academies_origin_format');
      }
      for (const contactEmail of ['Office@example.com', ' office@example.com', 'office.example.com']) {
        await expectSqlError(client, ACADEMY_SQL, academyParams({ contactEmail }), CHECK_VIOLATION, 'ck_academies_contact_email_normalized');
      }
      await expectSqlError(client, ACADEMY_SQL, academyParams({ notes: 'x'.repeat(2001) }), CHECK_VIOLATION, 'ck_academies_notes_length');
      // archived_at exists exactly for `archived`.
      await expectSqlError(client, ACADEMY_SQL, academyParams({ status: 'archived' }), CHECK_VIOLATION, 'ck_academies_archived_at');
      await expectSqlError(client, ACADEMY_SQL, academyParams({ status: 'active', archivedAt: STARTS }), CHECK_VIOLATION, 'ck_academies_archived_at');

      // Valid rows — the nullable columns pass as NULL (no CHECK evaluates to NULL).
      await academy(client);
      await academy(client, { slug: `${tag}${'b'.repeat(32 - tag.length)}` });
      await academy(client, { slug: unique('a-b-c') });
      await academy(client, { name: '{"ar":"أكاديمية","en":"Academy","tr":"Akademi"}', status: 'active', origin: 'https://academy.example.com:8443', contactEmail: 'office@example.com', notes: 'x'.repeat(2000) });
      await academy(client, { origin: 'http://localhost:5173' });
      await academy(client, { origin: 'http://127.0.0.1' });
      await academy(client, { status: 'archived', archivedAt: STARTS });
      const slug = unique('dup');
      await academy(client, { slug });
      await expectSqlError(client, ACADEMY_SQL, academyParams({ slug }), UNIQUE_VIOLATION, 'academies_slug_key');
    });
  });

  it('enforces the domains hostname CHECK and at most one primary domain per academy', async () => {
    await inRollback(async (client) => {
      const a = await academy(client);
      const b = await academy(client);
      for (const hostname of ['Academy.example.com', 'academy', 'academy example.com', 'academy_x.example.com', '']) {
        await expectSqlError(client, DOMAIN_SQL, [a, hostname, 'custom', false], CHECK_VIOLATION, 'ck_domains_hostname_format');
      }
      await client.query(DOMAIN_SQL, [a, `${tag}-a.example.com`, 'platform_subdomain', true]);
      await client.query(DOMAIN_SQL, [a, `${tag}-b.example.com`, 'custom', false]);
      await client.query(DOMAIN_SQL, [a, 'localhost', 'custom', false]);
      await expectSqlError(client, DOMAIN_SQL, [a, `${tag}-c.example.com`, 'custom', true], UNIQUE_VIOLATION, 'uq_domains_academy_primary');
      // Another academy has its own primary domain; a hostname belongs to one academy only.
      await client.query(DOMAIN_SQL, [b, `${tag}-d.example.com`, 'custom', true]);
      await expectSqlError(client, DOMAIN_SQL, [b, `${tag}-a.example.com`, 'custom', false], UNIQUE_VIOLATION, 'domains_hostname_key');
      // Moving the primary flag: clear the old one first, then set the new one.
      await client.query(`UPDATE domains SET is_primary = false WHERE academy_id = $1 AND is_primary`, [a]);
      await client.query(`UPDATE domains SET is_primary = true WHERE hostname = $1`, [`${tag}-b.example.com`]);
      expect(await count(client, `SELECT count(*)::int AS n FROM domains WHERE academy_id = $1 AND is_primary`, [a])).toBe(1);
    });
  });

  it('enforces the plans CHECKs (key, Arabic name, object limits)', async () => {
    await inRollback(async (client) => {
      for (const key of ['Pro', '_pro', '-pro', 'pro plan', '', 'p'.repeat(41)]) {
        await expectSqlError(client, PLAN_SQL, [key, '{"ar":"خطة"}', '{}'], CHECK_VIOLATION, 'ck_plans_key_format');
      }
      for (const name of ['{}', '{"ar":""}', '{"en":"Pro"}', '[]']) {
        await expectSqlError(client, PLAN_SQL, [unique('p'), name, '{}'], CHECK_VIOLATION, 'ck_plans_name_localized');
      }
      for (const limits of ['[]', '"students"', '10', 'null']) {
        await expectSqlError(client, PLAN_SQL, [unique('p'), '{"ar":"خطة"}', limits], CHECK_VIOLATION, 'ck_plans_limits_object');
      }
      await client.query(PLAN_SQL, [unique('p'), '{"ar":"خطة"}', '{"students":500,"storageGb":10}']);
      await client.query(PLAN_SQL, [`${tag}-${'p'.repeat(39 - tag.length)}`, '{"ar":"خطة"}', '{}']);
    });
  });

  it('enforces the subscription dates and at most one current subscription per academy', async () => {
    await inRollback(async (client) => {
      const a = await academy(client);
      const p = await plan(client);
      await expectSqlError(client, SUBSCRIPTION_SQL, [a, p, 'active', STARTS, '2026-10-01T00:00:00Z', null], CHECK_VIOLATION, 'ck_subscriptions_ends_after_start');
      await expectSqlError(client, SUBSCRIPTION_SQL, [a, p, 'active', STARTS, STARTS, null], CHECK_VIOLATION, 'ck_subscriptions_ends_after_start');
      await expectSqlError(client, SUBSCRIPTION_SQL, [a, p, 'trial', STARTS, null, '2026-10-31T00:00:00Z'], CHECK_VIOLATION, 'ck_subscriptions_trial_ends_after_start');

      // One current (trial | active | past_due) subscription; finished ones pile up.
      await client.query(SUBSCRIPTION_SQL, [a, p, 'canceled', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', null]);
      await client.query(SUBSCRIPTION_SQL, [a, p, 'expired', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', null]);
      await client.query(SUBSCRIPTION_SQL, [a, p, 'expired', '2026-03-01T00:00:00Z', null, null]);
      const trial = (await client.query<{ id: string }>(SUBSCRIPTION_SQL, [a, p, 'trial', STARTS, null, '2026-12-01T00:00:00Z'])).rows[0]!.id;
      for (const status of ['trial', 'active', 'past_due']) {
        await expectSqlError(client, SUBSCRIPTION_SQL, [a, p, status, STARTS, null, null], UNIQUE_VIOLATION, 'uq_subscriptions_academy_current');
      }
      // The trial becomes active in place; another academy has its own current subscription.
      await client.query(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [trial]);
      await client.query(SUBSCRIPTION_SQL, [await academy(client), p, 'active', STARTS, null, null]);
      expect(await count(client, `SELECT count(*)::int AS n FROM subscriptions WHERE academy_id = $1`, [a])).toBe(4);
    });
  });

  it('enforces the health check CHECKs', async () => {
    await inRollback(async (client) => {
      const a = await academy(client);
      await expectSqlError(client, HEALTH_SQL, [a, 'ready', -1, null], CHECK_VIOLATION, 'ck_academy_health_checks_latency');
      await expectSqlError(client, HEALTH_SQL, [a, 'unreachable', null, 'e'.repeat(501)], CHECK_VIOLATION, 'ck_academy_health_checks_error_length');
      await client.query(HEALTH_SQL, [a, 'ready', 0, null]);
      await client.query(HEALTH_SQL, [a, 'unreachable', null, 'e'.repeat(500)]);
      const row = await client.query<Record<string, unknown>>(
        `INSERT INTO academy_health_checks (academy_id, outcome) VALUES ($1, 'not_ready') RETURNING checked_at IS NOT NULL AS stamped, triggered_by, http_status`,
        [a],
      );
      expect(row.rows[0]).toEqual({ stamped: true, triggered_by: null, http_status: null });
    });
  });

  it('applies the referential actions (Cascade from academies and users, Restrict on plans, SetNull on creators)', async () => {
    await inRollback(async (client) => {
      const u = await user(client);
      const a = (await client.query<{ id: string }>(`INSERT INTO academies (slug, name, created_by) VALUES ($1, '{"ar":"أكاديمية"}', $2) RETURNING id`, [unique('r'), u])).rows[0]!.id;
      const p = await plan(client);
      await client.query(SUBSCRIPTION_SQL, [a, p, 'active', STARTS, null, null]);
      await client.query(DOMAIN_SQL, [a, `${tag}-r.example.com`, 'custom', true]);
      await client.query(`INSERT INTO academy_health_checks (academy_id, outcome, triggered_by) VALUES ($1, 'ready', $2)`, [a, u]);
      await client.query(`INSERT INTO platform_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [u, 'a'.repeat(64)]);

      // A plan in use cannot go.
      await expectSqlError(client, `DELETE FROM plans WHERE id = $1`, [p], RESTRICT_VIOLATION, 'subscriptions_plan_id_fkey');
      // Deleting the user clears the creator and the trigger, and drops the sessions.
      await client.query(`DELETE FROM platform_users WHERE id = $1`, [u]);
      expect((await client.query(`SELECT created_by FROM academies WHERE id = $1`, [a])).rows[0]).toEqual({ created_by: null });
      expect(await count(client, `SELECT count(*)::int AS n FROM academy_health_checks WHERE academy_id = $1 AND triggered_by IS NULL`, [a])).toBe(1);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_refresh_tokens WHERE user_id = $1`, [u])).toBe(0);
      // Deleting the academy takes its domains, subscriptions and health checks; then the plan may go.
      await client.query(`DELETE FROM academies WHERE id = $1`, [a]);
      for (const table of ['domains', 'subscriptions', 'academy_health_checks']) {
        expect(await count(client, `SELECT count(*)::int AS n FROM ${table} WHERE academy_id = $1`, [a]), table).toBe(0);
      }
      await client.query(`DELETE FROM plans WHERE id = $1`, [p]);
    });
  });

  it('keeps platform_audit_logs append-only: only clearing the actor passes (the SetNull action)', async () => {
    await inRollback(async (client) => {
      await expectSqlError(client, AUDIT_SQL, [null, '', null, null, null], CHECK_VIOLATION, 'ck_platform_audit_logs_action_not_blank');
      await expectSqlError(client, AUDIT_SQL, [null, '   ', null, null, null], CHECK_VIOLATION, 'ck_platform_audit_logs_action_not_blank');
      for (const metadata of ['[]', '"x"', '1', 'null']) {
        await expectSqlError(client, AUDIT_SQL, [null, 'test.platform_schema', null, null, metadata], CHECK_VIOLATION, 'ck_platform_audit_logs_metadata_object');
      }

      const actor = await user(client);
      const academyId = await academy(client);
      const first = (await client.query<{ id: string }>(AUDIT_SQL, [actor, 'test.platform_schema', 'academies', academyId, '{"fields":["name"]}'])).rows[0]!.id;
      const second = (await client.query<{ id: string }>(AUDIT_SQL, [actor, 'test.platform_schema', null, null, null])).rows[0]!.id;
      await client.query(AUDIT_SQL, [null, 'test.platform_schema', null, null, '{}']);

      // Any other change, and any delete, is refused.
      const refused = async (sql: string, params: unknown[]) => {
        await client.query('SAVEPOINT audit_refusal');
        let caught: { code?: string; message?: string } | undefined;
        try {
          await client.query(sql, params);
        } catch (error) {
          caught = error as { code?: string; message?: string };
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT audit_refusal');
        }
        expect(caught?.code, sql).toBe(RAISE_EXCEPTION);
        expect(caught?.message).toBe('platform_audit_logs is append-only');
      };
      await refused(`UPDATE platform_audit_logs SET action = 'test.tampered' WHERE id = $1`, [first]);
      await refused(`UPDATE platform_audit_logs SET metadata = '{}' WHERE id = $1`, [first]);
      await refused(`UPDATE platform_audit_logs SET actor_platform_user_id = NULL, action = 'test.tampered' WHERE id = $1`, [first]);
      await refused(`DELETE FROM platform_audit_logs WHERE id = $1`, [second]);

      // Clearing the actor alone passes — by hand, and through ON DELETE SET NULL.
      expect((await client.query(`UPDATE platform_audit_logs SET actor_platform_user_id = NULL WHERE id = $1`, [first])).rowCount).toBe(1);
      await client.query(`DELETE FROM platform_users WHERE id = $1`, [actor]);
      const rows = await client.query<{ id: string; actor: string | null; action: string }>(
        `SELECT id, actor_platform_user_id AS actor, action FROM platform_audit_logs WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[first, second]],
      );
      expect(rows.rows.map((row) => row.actor)).toEqual([null, null]);
      expect(rows.rows.every((row) => row.action === 'test.platform_schema')).toBe(true);
    });
  });
});
