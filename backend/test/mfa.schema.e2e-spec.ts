// TEST-225 — MFA-T01 schema (migration 20261116123656_mfa_totp, MOD-01-H06,
// D-R108): the five MFA columns of `users` (sealed secret, enabling instant,
// last accepted TOTP step, pending setup and its start), the new
// `mfa_recovery_codes` table, the `mfa_challenge` value of `token_purpose`, the
// hand-written CHECKs (secret and its instant together, pending pair, replay
// guard only with a secret, the sealed `v<n>.<iv>.<ciphertext>.<tag>` format of
// both secrets, the hash format, a code spent never before it was issued), the
// unique hash and the cascade with the user. Runs against the local development
// database as the APPLICATION role and is skipped when no database is reachable
// (like TEST-174). Every data test runs inside a transaction that is rolled back.
import { createHash } from 'node:crypto';
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
const MIGRATION = '20261116123656_mfa_totp';
const PREVIOUS_MIGRATION = '20261112083749_mod12_notifications';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_ENUM_VALUE = '22P02';
const VALUE_TOO_LONG = '22001';

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

describe.skipIf(!available)('database schema — MOD-01-H06 MFA (e2e, TEST-225)', () => {
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
    expect(caught, `expected SQLSTATE ${code} for: ${sql} ${JSON.stringify(params)}`).toBeDefined();
    expect(caught?.code).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  const tag = `M${Date.now().toString(36)}`.slice(0, 10).toLowerCase();
  /** A sealed secret in the shape of D-R107 — base64url parts, obviously not a real one. */
  const SEALED = 'v1.AAECAwQFBgcICQoL.c2VhbGVkLXNlY3JldA.AAAAAAAAAAAAAAAAAAAAAA';
  const SEALED_PENDING = 'v1.DA0ODxAREhMUFRYX.cGVuZGluZy1zZWNyZXQ.AQEBAQEBAQEBAQEBAQEBAQ';
  const ENABLED_AT = '2026-11-16T09:00:00Z';
  const USER_MFA_SQL = `INSERT INTO users (full_name, email, mfa_secret, mfa_enabled_at, mfa_last_step, mfa_pending_secret, mfa_pending_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
  const CODE_SQL = `INSERT INTO mfa_recovery_codes (user_id, code_hash, used_at) VALUES ($1, $2, $3) RETURNING id`;
  const TOKEN_SQL = `INSERT INTO verification_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2::token_purpose, $3, now() + interval '5 minutes') RETURNING id`;

  let serial = 0;
  const email = (name: string) => `${tag}-${name}-${(serial += 1)}@example.com`;
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

  interface MfaOver {
    secret: string | null;
    enabledAt: string | null;
    lastStep: string | number | null;
    pending: string | null;
    pendingAt: string | null;
  }
  /** A user without MFA unless overridden. */
  function userParams(name: string, over: Partial<MfaOver> = {}): unknown[] {
    const m: MfaOver = { secret: null, enabledAt: null, lastStep: null, pending: null, pendingAt: null, ...over };
    return [`MFA ${name}`, email(name), m.secret, m.enabledAt, m.lastStep, m.pending, m.pendingAt];
  }
  async function user(client: PoolClient, name: string, over: Partial<MfaOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(USER_MFA_SQL, userParams(name, over))).rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-12 migration and adds mfa_challenge to token_purpose', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
    const purposes = (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::token_purpose))::text AS v`)).rows.map((row) => row.v);
    expect(purposes).toEqual(['invitation', 'email_verification', 'password_reset', 'mfa_challenge']);
  });

  it('adds the five nullable MFA columns to users and the mfa_recovery_codes table, with the expected types and no defaults', async () => {
    const columns = await pool.query<{ table_name: string; column_name: string; data_type: string; precision: number | null; max_length: number | null; is_nullable: string; column_default: string | null }>(
      `SELECT table_name::text, column_name::text, data_type::text, datetime_precision AS precision, character_maximum_length AS max_length, is_nullable::text, column_default::text
         FROM information_schema.columns
        WHERE table_schema = 'public' AND ((table_name = 'users' AND column_name LIKE 'mfa\\_%') OR table_name = 'mfa_recovery_codes')
        ORDER BY table_name::text COLLATE "C", ordinal_position`,
    );
    const shape = Object.fromEntries(
      columns.rows.map((c) => [`${c.table_name}.${c.column_name}`, `${c.data_type}${c.precision !== null && c.data_type.startsWith('timestamp') ? `(${c.precision})` : ''}${c.max_length !== null ? `(${c.max_length})` : ''} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`]),
    );
    expect(shape).toEqual({
      'mfa_recovery_codes.id': 'uuid NOT NULL',
      'mfa_recovery_codes.user_id': 'uuid NOT NULL',
      'mfa_recovery_codes.code_hash': 'character(64) NOT NULL',
      'mfa_recovery_codes.used_at': 'timestamp with time zone(6) NULL',
      'mfa_recovery_codes.created_at': 'timestamp with time zone(6) NOT NULL',
      'users.mfa_enabled_at': 'timestamp with time zone(6) NULL',
      'users.mfa_last_step': 'bigint NULL',
      'users.mfa_pending_at': 'timestamp with time zone(6) NULL',
      'users.mfa_pending_secret': 'text NULL',
      'users.mfa_secret': 'text NULL',
    });
    // MFA is off by default: none of the new users columns has a default.
    expect(columns.rows.filter((c) => c.table_name === 'users').every((c) => c.column_default === null)).toBe(true);

    await inRollback(async (client) => {
      const off = await client.query<Record<string, unknown>>(
        `INSERT INTO users (full_name, email) VALUES ('MFA default', $1) RETURNING id, mfa_secret, mfa_enabled_at, mfa_last_step, mfa_pending_secret, mfa_pending_at`,
        [email('default')],
      );
      const { id: owner, ...mfa } = off.rows[0]! as { id: string } & Record<string, unknown>;
      expect(mfa).toEqual({ mfa_secret: null, mfa_enabled_at: null, mfa_last_step: null, mfa_pending_secret: null, mfa_pending_at: null });
      const code = await client.query<Record<string, unknown>>(
        `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2) RETURNING used_at, created_at IS NOT NULL AS stamped, id IS NOT NULL AS has_id`,
        [owner, sha256('first-code')],
      );
      expect(code.rows[0]).toEqual({ used_at: null, stamped: true, has_id: true });
      await expectSqlError(client, `INSERT INTO mfa_recovery_codes (user_id) VALUES ($1)`, [owner], NOT_NULL_VIOLATION);
      await expectSqlError(client, CODE_SQL, ['00000000-0000-7000-8000-000000000000', sha256('orphan'), null], FOREIGN_KEY_VIOLATION);
    });
  });

  it('gives the application role DML without TRUNCATE on mfa_recovery_codes, and adds no extension', async () => {
    const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
      `SELECT has_table_privilege(current_user, 'mfa_recovery_codes', 'SELECT, INSERT, UPDATE, DELETE') AS dml, has_table_privilege(current_user, 'mfa_recovery_codes', 'TRUNCATE') AS truncate`,
    );
    expect(privileges.rows[0]).toEqual({ dml: true, truncate: false });
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist']);
  });

  it('keeps the secret and its enabling instant together, the pending pair together, and the replay guard with a secret only — AC (D-R108)', async () => {
    await inRollback(async (client) => {
      // A secret without its instant, or an instant without a secret.
      await expectSqlError(client, USER_MFA_SQL, userParams('a', { secret: SEALED }), CHECK_VIOLATION, 'ck_users_mfa_enabled');
      await expectSqlError(client, USER_MFA_SQL, userParams('b', { enabledAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_users_mfa_enabled');
      // A pending setup without its start, or a start without a pending secret.
      await expectSqlError(client, USER_MFA_SQL, userParams('c', { pending: SEALED_PENDING }), CHECK_VIOLATION, 'ck_users_mfa_pending');
      await expectSqlError(client, USER_MFA_SQL, userParams('d', { pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_users_mfa_pending');
      // The last step only while MFA is on (a pending setup is not enough), and never negative.
      await expectSqlError(client, USER_MFA_SQL, userParams('e', { lastStep: 0 }), CHECK_VIOLATION, 'ck_users_mfa_last_step');
      await expectSqlError(client, USER_MFA_SQL, userParams('f', { lastStep: 1, pending: SEALED_PENDING, pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_users_mfa_last_step');
      await expectSqlError(client, USER_MFA_SQL, userParams('g', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: -1 }), CHECK_VIOLATION, 'ck_users_mfa_last_step');

      // Valid states: off, a pending setup, on, on with a step (a 30 s step of today is ~59 million; bigint holds far more), on while re-enrolling.
      await user(client, 'off');
      const pending = await user(client, 'pending', { pending: SEALED_PENDING, pendingAt: ENABLED_AT });
      await user(client, 'on', { secret: SEALED, enabledAt: ENABLED_AT });
      const stepped = await user(client, 'stepped', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: '59012345' });
      await user(client, 'huge', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: '9007199254740993' });
      const both = await user(client, 'both', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: 0, pending: SEALED_PENDING, pendingAt: ENABLED_AT });
      expect((await client.query<{ step: string }>(`SELECT mfa_last_step::text AS step FROM users WHERE id = $1`, [stepped])).rows[0]).toEqual({ step: '59012345' });

      // The replay guard moves forward with a conditional update; the same step a second time touches nothing.
      const advanced = await client.query(`UPDATE users SET mfa_last_step = 59012346 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < 59012346)`, [stepped]);
      expect(advanced.rowCount).toBe(1);
      const replayed = await client.query(`UPDATE users SET mfa_last_step = 59012346 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < 59012346)`, [stepped]);
      expect(replayed.rowCount).toBe(0);

      // Turning MFA off is one statement that clears the secret, its instant and the step; a half-written change is refused.
      await expectSqlError(client, `UPDATE users SET mfa_secret = NULL WHERE id = $1`, [stepped], CHECK_VIOLATION, 'ck_users_mfa_enabled');
      await expectSqlError(client, `UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL WHERE id = $1`, [stepped], CHECK_VIOLATION, 'ck_users_mfa_last_step');
      const cleared = await client.query(`UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = $1`, [stepped]);
      expect(cleared.rowCount).toBe(1);
      // Confirming a setup moves the pending secret into place in one statement; dropping half of a pending pair is refused.
      await expectSqlError(client, `UPDATE users SET mfa_pending_at = NULL WHERE id = $1`, [both], CHECK_VIOLATION, 'ck_users_mfa_pending');
      const confirmed = await client.query(
        `UPDATE users SET mfa_secret = mfa_pending_secret, mfa_enabled_at = now(), mfa_pending_secret = NULL, mfa_pending_at = NULL WHERE id = $1 AND mfa_pending_secret IS NOT NULL`,
        [pending],
      );
      expect(confirmed.rowCount).toBe(1);
      const after = await client.query<Record<string, unknown>>(
        `SELECT mfa_secret, mfa_enabled_at IS NOT NULL AS enabled, mfa_pending_secret, mfa_pending_at FROM users WHERE id = $1`,
        [pending],
      );
      expect(after.rows[0]).toEqual({ mfa_secret: SEALED_PENDING, enabled: true, mfa_pending_secret: null, mfa_pending_at: null });
    });
  });

  it('stores both secrets sealed only, in the v<n>.<iv>.<ciphertext>.<tag> base64url shape — AC (D-R107)', async () => {
    const bad = [
      '',
      'JBSWY3DPEHPK3PXP',
      'v1.AAAA.BBBB',
      'v1.AAAA.BBBB.CCCC.DDDD',
      'v1..BBBB.CCCC',
      'v1.AAAA.BBBB.',
      'v.AAAA.BBBB.CCCC',
      'V1.AAAA.BBBB.CCCC',
      'x1.AAAA.BBBB.CCCC',
      'v1.AA+A.BBBB.CCCC',
      'v1.AAAA.BB/B.CCCC',
      'v1.AAAA.BBBB.CCC=',
      'v1.AAAA.BBBB.CCCC ',
      ' v1.AAAA.BBBB.CCCC',
      'v1.AAAA.BBBB.CCCC\n',
    ];
    await inRollback(async (client) => {
      for (const secret of bad) {
        await expectSqlError(client, USER_MFA_SQL, userParams('s', { secret, enabledAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_users_mfa_secret_format');
        await expectSqlError(client, USER_MFA_SQL, userParams('p', { pending: secret, pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_users_mfa_pending_secret_format');
      }
      // Valid: the first version, a later version (key rotation — D-R107), base64url with `-` and `_`.
      for (const secret of [SEALED, 'v2.AAAA.BBBB.CCCC', 'v10.a-b_.c-_d.EF-_', 'v1.A.B.C']) {
        await user(client, 'ok', { secret, enabledAt: ENABLED_AT });
        await user(client, 'okp', { pending: secret, pendingAt: ENABLED_AT });
      }
      expect(await count(client, `SELECT count(*)::int AS n FROM users WHERE email LIKE $1`, [`${tag}-ok%`])).toBe(8);
    });
  });

  it('keeps recovery codes as unique lower-case SHA-256 hex, spent never before they were issued — AC (D-R108)', async () => {
    await inRollback(async (client) => {
      const owner = await user(client, 'codes', { secret: SEALED, enabledAt: ENABLED_AT });
      const other = await user(client, 'other', { secret: SEALED, enabledAt: ENABLED_AT });
      const hash = sha256('ABCD-EFGH-1234');
      // Not a hash: upper-case hex, a non-hex letter, 63 characters (char(64) pads it, the CHECK still refuses it), the code itself.
      for (const codeHash of [hash.toUpperCase(), `${hash.slice(0, 63)}g`, hash.slice(0, 63), 'ABCD-EFGH-1234', ' '.repeat(64)]) {
        await expectSqlError(client, CODE_SQL, [owner, codeHash, null], CHECK_VIOLATION, 'ck_mfa_recovery_codes_hash_format');
      }
      await expectSqlError(client, CODE_SQL, [owner, `${hash}0`, null], VALUE_TOO_LONG);
      // A spent instant before the code was issued.
      await expectSqlError(client, `INSERT INTO mfa_recovery_codes (user_id, code_hash, used_at, created_at) VALUES ($1, $2, now() - interval '1 second', now())`, [owner, hash], CHECK_VIOLATION, 'ck_mfa_recovery_codes_used_after_created');

      const first = (await client.query<{ id: string }>(CODE_SQL, [owner, hash, null])).rows[0]!.id;
      for (let i = 1; i < 10; i += 1) await client.query(CODE_SQL, [owner, sha256(`code-${tag}-${i}`), null]);
      // The hash is unique across every user, not per user.
      await expectSqlError(client, CODE_SQL, [owner, hash, null], UNIQUE_VIOLATION, 'mfa_recovery_codes_code_hash_key');
      await expectSqlError(client, CODE_SQL, [other, hash, null], UNIQUE_VIOLATION, 'mfa_recovery_codes_code_hash_key');
      expect(await count(client, `SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [owner])).toBe(10);

      // Spending a code is a conditional update: the second use of the same code touches nothing.
      const spent = await client.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, [owner, hash]);
      expect(spent.rowCount).toBe(1);
      const again = await client.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, [owner, hash]);
      expect(again.rowCount).toBe(0);
      await expectSqlError(client, `UPDATE mfa_recovery_codes SET used_at = created_at - interval '1 day' WHERE id = $1`, [first], CHECK_VIOLATION, 'ck_mfa_recovery_codes_used_after_created');
      // The same instant as the issue is allowed.
      await client.query(`UPDATE mfa_recovery_codes SET used_at = created_at WHERE id = $1`, [first]);
      expect(await count(client, `SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [owner])).toBe(9);
    });
  });

  it('accepts an mfa_challenge verification token (hash only) and refuses an unknown purpose', async () => {
    await inRollback(async (client) => {
      const owner = await user(client, 'challenge', { secret: SEALED, enabledAt: ENABLED_AT });
      const id = (await client.query<{ id: string }>(TOKEN_SQL, [owner, 'mfa_challenge', sha256(`challenge-${tag}`)])).rows[0]!.id;
      const row = await client.query<{ purpose: string; consumed_at: Date | null; metadata: unknown }>(`SELECT purpose::text AS purpose, consumed_at, metadata FROM verification_tokens WHERE id = $1`, [id]);
      expect(row.rows[0]).toEqual({ purpose: 'mfa_challenge', consumed_at: null, metadata: null });
      // A challenge is consumed once (the API's rule, written as a conditional update like the other tokens).
      expect((await client.query(`UPDATE verification_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, [id])).rowCount).toBe(1);
      expect((await client.query(`UPDATE verification_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, [id])).rowCount).toBe(0);
      await expectSqlError(client, TOKEN_SQL, [owner, 'mfa', sha256(`mfa-${tag}`)], INVALID_ENUM_VALUE);
    });
  });

  it('deletes the recovery codes and the challenges with their user, and leaves the other users alone', async () => {
    await inRollback(async (client) => {
      const gone = await user(client, 'gone', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: 7 });
      const kept = await user(client, 'kept', { secret: SEALED, enabledAt: ENABLED_AT });
      for (let i = 0; i < 3; i += 1) {
        await client.query(CODE_SQL, [gone, sha256(`gone-${tag}-${i}`), null]);
        await client.query(CODE_SQL, [kept, sha256(`kept-${tag}-${i}`), null]);
      }
      await client.query(TOKEN_SQL, [gone, 'mfa_challenge', sha256(`gone-challenge-${tag}`)]);
      await client.query(`DELETE FROM users WHERE id = $1`, [gone]);
      expect(await count(client, `SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1`, [gone])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM verification_tokens WHERE user_id = $1`, [gone])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1`, [kept])).toBe(3);
    });
  });

  it('names the CHECKs and the indexes as the migration does', async () => {
    const constraints = await pool.query<{ name: string }>(
      `SELECT conrelid::regclass::text || '.' || conname::text AS name FROM pg_constraint
        WHERE contype = 'c' AND (conrelid = 'mfa_recovery_codes'::regclass OR (conrelid = 'users'::regclass AND conname LIKE 'ck\\_users\\_mfa\\_%'))
        ORDER BY (conrelid::regclass::text || '.' || conname::text) COLLATE "C"`,
    );
    expect(constraints.rows.map((row) => row.name)).toEqual([
      'mfa_recovery_codes.ck_mfa_recovery_codes_hash_format',
      'mfa_recovery_codes.ck_mfa_recovery_codes_used_after_created',
      'users.ck_users_mfa_enabled',
      'users.ck_users_mfa_last_step',
      'users.ck_users_mfa_pending',
      'users.ck_users_mfa_pending_secret_format',
      'users.ck_users_mfa_secret_format',
    ]);
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname::text AS indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'mfa_recovery_codes' ORDER BY indexname::text COLLATE "C"`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(['mfa_recovery_codes_code_hash_key', 'mfa_recovery_codes_pkey', 'mfa_recovery_codes_user_id_idx']);
    expect(indexes.rows.find((row) => row.indexname === 'mfa_recovery_codes_code_hash_key')!.indexdef).toMatch(/^CREATE UNIQUE INDEX .*\(code_hash\)$/);
    const cascade = await pool.query<{ action: string }>(
      `SELECT confdeltype::text AS action FROM pg_constraint WHERE conname = 'mfa_recovery_codes_user_id_fkey'`,
    );
    expect(cascade.rows[0]).toEqual({ action: 'c' });
  });

  it('round-trips through the generated Prisma client (BigInt step, nested recovery codes) and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const enabledAt = new Date(ENABLED_AT);
        const created = await tx.user.create({
          data: {
            fullName: 'Prisma MFA',
            email: `${tag}-prisma@example.com`,
            mfaSecret: SEALED,
            mfaEnabledAt: enabledAt,
            mfaLastStep: 59012345n,
            mfaRecoveryCodes: { create: [{ codeHash: sha256(`prisma-${tag}-1`) }, { codeHash: sha256(`prisma-${tag}-2`) }] },
          },
          select: { id: true, mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true, mfaPendingSecret: true, mfaPendingAt: true, mfaRecoveryCodes: { select: { codeHash: true, usedAt: true } } },
        });
        expect(created).toMatchObject({ mfaSecret: SEALED, mfaEnabledAt: enabledAt, mfaLastStep: 59012345n, mfaPendingSecret: null, mfaPendingAt: null });
        expect(typeof created.mfaLastStep).toBe('bigint');
        expect(created.mfaRecoveryCodes).toHaveLength(2);
        expect(created.mfaRecoveryCodes.every((code) => /^[0-9a-f]{64}$/.test(code.codeHash) && code.usedAt === null)).toBe(true);

        const used = await tx.mfaRecoveryCode.updateMany({ where: { userId: created.id, codeHash: sha256(`prisma-${tag}-1`), usedAt: null }, data: { usedAt: new Date() } });
        expect(used.count).toBe(1);
        await tx.verificationToken.create({ data: { userId: created.id, purpose: 'mfa_challenge', tokenHash: sha256(`prisma-challenge-${tag}`), expiresAt: new Date(Date.now() + 5 * 60_000) } });
        expect(await tx.verificationToken.count({ where: { userId: created.id, purpose: 'mfa_challenge' } })).toBe(1);

        const off = await tx.user.update({ where: { id: created.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null }, select: { mfaSecret: true, mfaLastStep: true } });
        expect(off).toEqual({ mfaSecret: null, mfaLastStep: null });
        throw marker;
      }),
    ).rejects.toBe(marker);
  });
});
