// TEST-007 — first schema (migration 20261029150949_init_identity_academy).
// Runs against the local development database as the APPLICATION role and is
// skipped when no database is reachable (like the readiness check in TEST-005).
// Every data test runs inside a transaction that is rolled back; only the seed
// test writes (it is idempotent by design and leaves the catalog in place).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { ACADEMY_ADMIN_ROLE_KEY, SYSTEM_ROLE_KEYS } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { academySeedFromEnv, seedAcademy, seedCatalog } from '../prisma/seed.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');

const TABLES = [
  'academy',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'student_profiles',
  'employee_profiles',
  'guardian_students',
  'refresh_tokens',
  'verification_tokens',
  'audit_logs',
] as const;

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
/** ON DELETE RESTRICT is checked immediately and reports restrict_violation. */
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';
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

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('database schema — first migration (e2e, TEST-007)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
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

  /** Asserts that `sql` fails with the given SQLSTATE without aborting the transaction. */
  async function expectSqlError(
    client: PoolClient,
    sql: string,
    params: unknown[],
    code: string,
    message?: RegExp,
  ): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string; message?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; message?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql}`).toBeDefined();
    expect(caught?.code).toBe(code);
    if (message) expect(caught?.message ?? '').toMatch(message);
  }

  async function insertUser(client: PoolClient, suffix: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`,
      [`Test ${suffix}`, `test-${suffix}@example.com`],
    );
    return rows[0]!.id;
  }

  it('records exactly one applied migration and the 12 tables', async () => {
    const migrations = await pool.query<{ migration_name: string; finished: boolean; rolled_back: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
         FROM _prisma_migrations ORDER BY started_at`,
    );
    expect(migrations.rows.length).toBeGreaterThanOrEqual(1);
    expect(migrations.rows[0]!.migration_name).toBe('20261029150949_init_identity_academy');
    expect(migrations.rows.every((row) => row.finished && !row.rolled_back)).toBe(true);

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    expect(tables.rows.map((row) => row.tablename).sort()).toEqual([...TABLES].sort());
  });

  it('generates UUID v7 primary keys inside the database', async () => {
    await inRollback(async (client) => {
      const id = await insertUser(client, 'uuid');
      const { rows } = await client.query<{ version: number; same_minute: boolean }>(
        `SELECT uuid_extract_version($1::uuid) AS version,
                abs(extract(epoch FROM (uuid_extract_timestamp($1::uuid) - now()))) < 60 AS same_minute`,
        [id],
      );
      expect(rows[0]!.version).toBe(7);
      expect(rows[0]!.same_minute).toBe(true);
    });
  });

  it('applies the designed delete rules: cascade for dependents, restrict for roles and permissions, set null for actors', async () => {
    await inRollback(async (client) => {
      const student = await insertUser(client, 'student');
      const assigner = await insertUser(client, 'assigner');
      const role = await client.query<{ id: string }>(
        `INSERT INTO roles (key, label) VALUES ('test_role', '{"ar":"دور اختبار"}') RETURNING id`,
      );
      const roleId = role.rows[0]!.id;
      await client.query(`INSERT INTO permissions (key, module) VALUES ('test.perm', 'TEST')`);
      await client.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'test.perm')`, [roleId]);
      await client.query(`INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)`, [student, roleId, assigner]);
      await client.query(`INSERT INTO student_profiles (user_id, student_number) VALUES ($1, 'S-1')`, [student]);
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, repeat('a', 64), now() + interval '1 day')`,
        [student],
      );
      await client.query(
        `INSERT INTO verification_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'invitation', repeat('b', 64), now() + interval '1 day')`,
        [student],
      );
      const audit = await client.query<{ id: string }>(
        `INSERT INTO audit_logs (actor_user_id, action) VALUES ($1, 'test.event') RETURNING id`,
        [student],
      );

      // Restrict: a granted role and a referenced permission cannot be deleted.
      await expectSqlError(client, `DELETE FROM roles WHERE id = $1`, [roleId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM permissions WHERE key = 'test.perm'`, [], RESTRICT_VIOLATION);

      // Set null: deleting the assigner keeps the grant.
      await client.query(`DELETE FROM users WHERE id = $1`, [assigner]);
      const grant = await client.query<{ assigned_by: string | null }>(
        `SELECT assigned_by FROM user_roles WHERE user_id = $1`,
        [student],
      );
      expect(grant.rows).toHaveLength(1);
      expect(grant.rows[0]!.assigned_by).toBeNull();

      // Cascade: deleting the user removes grants, profile and tokens; the audit row stays.
      await client.query(`DELETE FROM users WHERE id = $1`, [student]);
      const counts = await client.query<{ grants: number; profiles: number; refresh: number; verification: number }>(
        `SELECT (SELECT count(*) FROM user_roles WHERE user_id = $1)::int AS grants,
                (SELECT count(*) FROM student_profiles WHERE user_id = $1)::int AS profiles,
                (SELECT count(*) FROM refresh_tokens WHERE user_id = $1)::int AS refresh,
                (SELECT count(*) FROM verification_tokens WHERE user_id = $1)::int AS verification`,
        [student],
      );
      expect(counts.rows[0]).toEqual({ grants: 0, profiles: 0, refresh: 0, verification: 0 });
      const auditRow = await client.query<{ actor_user_id: string | null }>(
        `SELECT actor_user_id FROM audit_logs WHERE id = $1`,
        [audit.rows[0]!.id],
      );
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0]!.actor_user_id).toBeNull();

      // Cascade on role delete removes its permission links once no user holds it.
      await client.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
      const links = await client.query(`SELECT 1 FROM role_permissions WHERE role_id = $1`, [roleId]);
      expect(links.rows).toHaveLength(0);
    });
  });

  it('enforces the hand-written constraints (singleton academy, localized text, login identifier, guardians)', async () => {
    await inRollback(async (client) => {
      const existing = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM academy`);
      const academyInsert = `INSERT INTO academy (slug, name, timezone, currency) VALUES ($1, $2::jsonb, $3, $4)`;
      if (existing.rows[0]!.n === 0) {
        await client.query(academyInsert, ['first', '{"ar":"الأولى"}', 'UTC', 'USD']);
      }
      await expectSqlError(client, academyInsert, ['second', '{"ar":"الثانية"}', 'UTC', 'USD'], UNIQUE_VIOLATION);
      await expectSqlError(client, academyInsert, ['third', '{"en":"no arabic"}', 'UTC', 'USD'], CHECK_VIOLATION);
      await expectSqlError(client, academyInsert, ['fourth', '{"ar":"عملة"}', 'UTC', 'usd'], CHECK_VIOLATION);

      await expectSqlError(client, `INSERT INTO roles (key, label) VALUES ('no_ar', '{"en":"x"}')`, [], CHECK_VIOLATION);

      await expectSqlError(client, `INSERT INTO users (full_name) VALUES ('nobody')`, [], CHECK_VIOLATION);
      await expectSqlError(client, `INSERT INTO users (full_name, email) VALUES ('upper', 'Upper@Example.com')`, [], CHECK_VIOLATION);
      await expectSqlError(client, `INSERT INTO users (full_name, username) VALUES ('upper', 'Student1')`, [], CHECK_VIOLATION);
      await client.query(`INSERT INTO users (full_name, username) VALUES ('child', 'student1')`);
      await expectSqlError(client, `INSERT INTO users (full_name, username) VALUES ('twin', 'student1')`, [], UNIQUE_VIOLATION);
      // Phones are deliberately not unique (D21).
      await client.query(`INSERT INTO users (full_name, email, phone) VALUES ('a', 'a@example.com', '+10000000000')`);
      await client.query(`INSERT INTO users (full_name, email, phone) VALUES ('b', 'b@example.com', '+10000000000')`);

      const guardian = await insertUser(client, 'guardian');
      const guardian2 = await insertUser(client, 'guardian2');
      const child = await insertUser(client, 'child');
      await expectSqlError(
        client,
        `INSERT INTO guardian_students (guardian_user_id, student_user_id, relationship) VALUES ($1, $1, 'father')`,
        [guardian],
        CHECK_VIOLATION,
      );
      await client.query(
        `INSERT INTO guardian_students (guardian_user_id, student_user_id, relationship, is_primary) VALUES ($1, $2, 'father', true)`,
        [guardian, child],
      );
      await expectSqlError(
        client,
        `INSERT INTO guardian_students (guardian_user_id, student_user_id, relationship, is_primary) VALUES ($1, $2, 'mother', true)`,
        [guardian2, child],
        UNIQUE_VIOLATION,
      );
      await client.query(
        `INSERT INTO guardian_students (guardian_user_id, student_user_id, relationship, is_primary) VALUES ($1, $2, 'mother', false)`,
        [guardian2, child],
      );
    });
  });

  it('keeps audit_logs append-only even for the application role', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES ('test.insert', 'permissions', 'users.read', '{"k":1}') RETURNING id`,
      );
      const id = rows[0]!.id;
      await expectSqlError(client, `UPDATE audit_logs SET action = 'x' WHERE id = $1`, [id], RAISE_EXCEPTION, /append-only/);
      await expectSqlError(client, `UPDATE audit_logs SET metadata = '{"k":2}' WHERE id = $1`, [id], RAISE_EXCEPTION, /append-only/);
      await expectSqlError(client, `DELETE FROM audit_logs WHERE id = $1`, [id], RAISE_EXCEPTION, /append-only/);

      // The only permitted change is clearing the actor (the ON DELETE SET NULL
      // effect of users.id); clearing it together with anything else is rejected.
      const actor = await insertUser(client, 'actor');
      const withActor = await client.query<{ id: string }>(
        `INSERT INTO audit_logs (actor_user_id, action) VALUES ($1, 'test.actor') RETURNING id`,
        [actor],
      );
      await expectSqlError(
        client,
        `UPDATE audit_logs SET actor_user_id = NULL, action = 'tampered' WHERE id = $1`,
        [withActor.rows[0]!.id],
        RAISE_EXCEPTION,
        /append-only/,
      );
      await client.query(`UPDATE audit_logs SET actor_user_id = NULL WHERE id = $1`, [withActor.rows[0]!.id]);
      await expectSqlError(
        client,
        `UPDATE audit_logs SET actor_user_id = $2 WHERE id = $1`,
        [withActor.rows[0]!.id, actor],
        RAISE_EXCEPTION,
        /append-only/,
      );
    });
  });

  it('connects as a DML-only application role (no DDL, no TRUNCATE)', async () => {
    const who = await pool.query<{ role: string; superuser: boolean; can_create: boolean }>(
      `SELECT current_user AS role,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
              has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`,
    );
    expect(who.rows[0]!.superuser).toBe(false);
    expect(who.rows[0]!.can_create).toBe(false);

    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }

    await inRollback(async (client) => {
      await expectSqlError(client, `CREATE TABLE should_not_exist (id int)`, [], INSUFFICIENT_PRIVILEGE);
      await expectSqlError(client, `TRUNCATE users`, [], INSUFFICIENT_PRIVILEGE);
    });
  });

  it('indexes every foreign key and keeps the partial unique index of primary guardians', async () => {
    const uncovered = await pool.query<{ table_name: string; constraint_name: string }>(
      `SELECT c.conrelid::regclass::text AS table_name, c.conname AS constraint_name
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
          )`,
    );
    expect(uncovered.rows).toEqual([]);

    const partial = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_guardian_students_primary'`,
    );
    expect(partial.rows).toHaveLength(1);
    expect(partial.rows[0]!.indexdef).toMatch(/UNIQUE INDEX .* WHERE is_primary$/);
  });

  it('seeds the permission catalog and system roles idempotently', async () => {
    const first = await prisma.$transaction((tx) => seedCatalog(tx));
    const second = await prisma.$transaction((tx) => seedCatalog(tx));
    expect(second.roles.created).toEqual([]);
    expect(second.rolePermissions.added).toBe(0);
    expect(first.permissions.upserted).toBe(PERMISSION_KEYS.length);

    const active = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM permissions WHERE deprecated_at IS NULL`);
    expect(active.rows[0]!.n).toBe(PERMISSION_KEYS.length);

    const roles = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE is_system`);
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(roles.rows.map((row) => row.key)).toContain(key);
    }

    const admin = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = $1`,
      [ACADEMY_ADMIN_ROLE_KEY],
    );
    expect(admin.rows[0]!.n).toBe(PERMISSION_KEYS.length);

    const signup = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE is_default_for_signup`);
    expect(signup.rows.map((row) => row.key)).toEqual(['student']);
  });

  it('creates the academy row at most once from SEED_ACADEMY_*', async () => {
    let seed: ReturnType<typeof academySeedFromEnv> | undefined;
    try {
      seed = academySeedFromEnv(process.env);
    } catch (error) {
      expect((error as Error).message).toMatch(/SEED_ACADEMY_/);
      return; // not configured locally: validation message is the only thing to check
    }
    await prisma.$transaction((tx) => seedAcademy(tx, seed));
    const again = await prisma.$transaction((tx) => seedAcademy(tx, seed));
    expect(again).toBe('kept');
    const rows = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM academy`);
    expect(rows.rows[0]!.n).toBe(1);
  });
});
