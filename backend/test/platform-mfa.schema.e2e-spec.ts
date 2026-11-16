// TEST-231 — PMFA-T01 schema (the second platform migration
// prisma/platform/migrations/20261116140605_platform_mfa, roadmap §4o,
// D-R113..D-R120): the five MFA columns of `platform_users` (sealed secret,
// enabling instant, last accepted TOTP step, pending setup and its start), the
// new tables `platform_mfa_recovery_codes` and `platform_mfa_challenges`, the
// hand-written CHECKs (secret and its instant together, pending pair, replay
// guard only with a secret, the sealed `v<n>.<iv>.<ciphertext>.<tag>` format of
// both secrets, the hash format of codes and challenges, a challenge's 0..5
// wrong attempts), the unique hashes and the cascades with the user — the
// shape of the academy TEST-225, without its "used after created" CHECK (no
// CHECK compares a column the application stamps with one the database stamps).
//
// Runs against the platform database as the platform APPLICATION role (like
// TEST-206) and is skipped when it is unreachable. Every data test runs inside
// a transaction that is rolled back, the Prisma one included — the suite
// leaves no row behind.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/platform/client.js';
import { platformPostgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const PLATFORM_URL = process.env['PLATFORM_DATABASE_URL'] || platformPostgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261116140605_platform_mfa';
const PREVIOUS_MIGRATION = '20261113182048_platform_init';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';
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

const available = PLATFORM_URL ? await canConnect(PLATFORM_URL) : false;

describe.skipIf(!available)('platform database schema — PMFA MFA for platform users (e2e, TEST-231)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: PLATFORM_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: PLATFORM_URL! }) });
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

  const tag = `p${Date.now().toString(36)}`.toLowerCase();
  /** A sealed secret in the shape of the academy's D-R107 — base64url parts, obviously not a real one. */
  const SEALED = 'v1.AAECAwQFBgcICQoL.c2VhbGVkLXNlY3JldA.AAAAAAAAAAAAAAAAAAAAAA';
  const SEALED_PENDING = 'v1.DA0ODxAREhMUFRYX.cGVuZGluZy1zZWNyZXQ.AQEBAQEBAQEBAQEBAQEBAQ';
  const ENABLED_AT = '2026-11-16T09:00:00Z';
  const USER_MFA_SQL = `INSERT INTO platform_users (email, full_name, role, mfa_secret, mfa_enabled_at, mfa_last_step, mfa_pending_secret, mfa_pending_at)
                        VALUES ($1, $2, 'super_admin', $3, $4, $5, $6, $7) RETURNING id`;
  const CODE_SQL = `INSERT INTO platform_mfa_recovery_codes (user_id, code_hash, used_at) VALUES ($1, $2, $3) RETURNING id`;
  const CHALLENGE_SQL = `INSERT INTO platform_mfa_challenges (user_id, token_hash, expires_at, attempts) VALUES ($1, $2, now() + interval '5 minutes', $3) RETURNING id`;

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
  /** A platform user without MFA unless overridden. */
  function userParams(name: string, over: Partial<MfaOver> = {}): unknown[] {
    const m: MfaOver = { secret: null, enabledAt: null, lastStep: null, pending: null, pendingAt: null, ...over };
    return [email(name), `MFA ${name}`, m.secret, m.enabledAt, m.lastStep, m.pending, m.pendingAt];
  }
  async function user(client: PoolClient, name: string, over: Partial<MfaOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(USER_MFA_SQL, userParams(name, over))).rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the platform_init migration', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(PREVIOUS_MIGRATION);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
  });

  it('adds the five nullable MFA columns to platform_users and the two tables, with the expected types and defaults', async () => {
    const columns = await pool.query<{ table_name: string; column_name: string; data_type: string; precision: number | null; max_length: number | null; is_nullable: string; column_default: string | null }>(
      `SELECT table_name::text, column_name::text, data_type::text, datetime_precision AS precision, character_maximum_length AS max_length, is_nullable::text, column_default::text
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'platform_users' AND column_name LIKE 'mfa\\_%') OR table_name IN ('platform_mfa_recovery_codes', 'platform_mfa_challenges'))
        ORDER BY table_name::text COLLATE "C", ordinal_position`,
    );
    const shape = Object.fromEntries(
      columns.rows.map((c) => [`${c.table_name}.${c.column_name}`, `${c.data_type}${c.precision !== null && c.data_type.startsWith('timestamp') ? `(${c.precision})` : ''}${c.max_length !== null ? `(${c.max_length})` : ''} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`]),
    );
    expect(shape).toEqual({
      'platform_mfa_challenges.id': 'uuid NOT NULL',
      'platform_mfa_challenges.user_id': 'uuid NOT NULL',
      'platform_mfa_challenges.token_hash': 'character(64) NOT NULL',
      'platform_mfa_challenges.expires_at': 'timestamp with time zone(6) NOT NULL',
      'platform_mfa_challenges.consumed_at': 'timestamp with time zone(6) NULL',
      'platform_mfa_challenges.attempts': 'smallint NOT NULL',
      'platform_mfa_challenges.created_at': 'timestamp with time zone(6) NOT NULL',
      'platform_mfa_recovery_codes.id': 'uuid NOT NULL',
      'platform_mfa_recovery_codes.user_id': 'uuid NOT NULL',
      'platform_mfa_recovery_codes.code_hash': 'character(64) NOT NULL',
      'platform_mfa_recovery_codes.used_at': 'timestamp with time zone(6) NULL',
      'platform_mfa_recovery_codes.created_at': 'timestamp with time zone(6) NOT NULL',
      'platform_users.mfa_enabled_at': 'timestamp with time zone(6) NULL',
      'platform_users.mfa_last_step': 'bigint NULL',
      'platform_users.mfa_pending_at': 'timestamp with time zone(6) NULL',
      'platform_users.mfa_pending_secret': 'text NULL',
      'platform_users.mfa_secret': 'text NULL',
    });
    // MFA is off by default: none of the new platform_users columns has a default.
    expect(columns.rows.filter((c) => c.table_name === 'platform_users').every((c) => c.column_default === null)).toBe(true);
    const defaults = Object.fromEntries(columns.rows.filter((c) => c.column_default !== null).map((c) => [`${c.table_name}.${c.column_name}`, c.column_default]));
    expect(defaults).toEqual({
      'platform_mfa_challenges.id': 'uuidv7()',
      'platform_mfa_challenges.attempts': '0',
      'platform_mfa_challenges.created_at': 'CURRENT_TIMESTAMP',
      'platform_mfa_recovery_codes.id': 'uuidv7()',
      'platform_mfa_recovery_codes.created_at': 'CURRENT_TIMESTAMP',
    });

    await inRollback(async (client) => {
      const off = await client.query<Record<string, unknown>>(
        `INSERT INTO platform_users (email, full_name, role) VALUES ($1, 'MFA default', 'support') RETURNING id, mfa_secret, mfa_enabled_at, mfa_last_step, mfa_pending_secret, mfa_pending_at`,
        [email('default')],
      );
      const { id: owner, ...mfa } = off.rows[0]! as { id: string } & Record<string, unknown>;
      expect(mfa).toEqual({ mfa_secret: null, mfa_enabled_at: null, mfa_last_step: null, mfa_pending_secret: null, mfa_pending_at: null });
      const code = await client.query<Record<string, unknown>>(
        `INSERT INTO platform_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2) RETURNING used_at, created_at IS NOT NULL AS stamped, substr(id::text, 15, 1) AS version`,
        [owner, sha256('first-code')],
      );
      expect(code.rows[0]).toEqual({ used_at: null, stamped: true, version: '7' });
      const challenge = await client.query<Record<string, unknown>>(
        `INSERT INTO platform_mfa_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '5 minutes') RETURNING attempts, consumed_at, created_at IS NOT NULL AS stamped, substr(id::text, 15, 1) AS version`,
        [owner, sha256('first-challenge')],
      );
      expect(challenge.rows[0]).toEqual({ attempts: 0, consumed_at: null, stamped: true, version: '7' });
      await expectSqlError(client, `INSERT INTO platform_mfa_recovery_codes (user_id) VALUES ($1)`, [owner], NOT_NULL_VIOLATION);
      await expectSqlError(client, `INSERT INTO platform_mfa_challenges (user_id, token_hash) VALUES ($1, $2)`, [owner, sha256('no-expiry')], NOT_NULL_VIOLATION);
      await expectSqlError(client, `INSERT INTO platform_mfa_challenges (user_id, token_hash, expires_at, attempts) VALUES ($1, $2, now(), NULL)`, [owner, sha256('null-attempts')], NOT_NULL_VIOLATION);
      await expectSqlError(client, CODE_SQL, ['00000000-0000-7000-8000-000000000000', sha256('orphan'), null], FOREIGN_KEY_VIOLATION);
      await expectSqlError(client, CHALLENGE_SQL, ['00000000-0000-7000-8000-000000000000', sha256('orphan-challenge'), 0], FOREIGN_KEY_VIOLATION);
    });
  });

  it('gives platform_app DML without TRUNCATE on the two new tables, and adds no extension', async () => {
    for (const table of ['platform_mfa_recovery_codes', 'platform_mfa_challenges']) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml, has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual([]);
  });

  it('keeps the secret and its enabling instant together, the pending pair together, and the replay guard with a secret only', async () => {
    await inRollback(async (client) => {
      // A secret without its instant, or an instant without a secret.
      await expectSqlError(client, USER_MFA_SQL, userParams('a', { secret: SEALED }), CHECK_VIOLATION, 'ck_platform_users_mfa_enabled');
      await expectSqlError(client, USER_MFA_SQL, userParams('b', { enabledAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_platform_users_mfa_enabled');
      // A pending setup without its start, or a start without a pending secret.
      await expectSqlError(client, USER_MFA_SQL, userParams('c', { pending: SEALED_PENDING }), CHECK_VIOLATION, 'ck_platform_users_mfa_pending');
      await expectSqlError(client, USER_MFA_SQL, userParams('d', { pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_platform_users_mfa_pending');
      // The last step only while MFA is on (a pending setup is not enough), and never negative.
      await expectSqlError(client, USER_MFA_SQL, userParams('e', { lastStep: 0 }), CHECK_VIOLATION, 'ck_platform_users_mfa_last_step');
      await expectSqlError(client, USER_MFA_SQL, userParams('f', { lastStep: 1, pending: SEALED_PENDING, pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_platform_users_mfa_last_step');
      await expectSqlError(client, USER_MFA_SQL, userParams('g', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: -1 }), CHECK_VIOLATION, 'ck_platform_users_mfa_last_step');

      // Valid states: off, a pending setup, on, on with a step (bigint holds more than 2^53), on while re-enrolling.
      await user(client, 'off');
      const pending = await user(client, 'pending', { pending: SEALED_PENDING, pendingAt: ENABLED_AT });
      await user(client, 'on', { secret: SEALED, enabledAt: ENABLED_AT });
      const stepped = await user(client, 'stepped', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: '59012345' });
      await user(client, 'huge', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: '9007199254740993' });
      const both = await user(client, 'both', { secret: SEALED, enabledAt: ENABLED_AT, lastStep: 0, pending: SEALED_PENDING, pendingAt: ENABLED_AT });
      expect((await client.query<{ step: string }>(`SELECT mfa_last_step::text AS step FROM platform_users WHERE id = $1`, [stepped])).rows[0]).toEqual({ step: '59012345' });

      // The replay guard moves forward with a conditional update; the same step a second time touches nothing.
      const advance = `UPDATE platform_users SET mfa_last_step = 59012346 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < 59012346)`;
      expect((await client.query(advance, [stepped])).rowCount).toBe(1);
      expect((await client.query(advance, [stepped])).rowCount).toBe(0);

      // Turning MFA off is one statement that clears the secret, its instant and the step; a half-written change is refused.
      await expectSqlError(client, `UPDATE platform_users SET mfa_secret = NULL WHERE id = $1`, [stepped], CHECK_VIOLATION, 'ck_platform_users_mfa_enabled');
      await expectSqlError(client, `UPDATE platform_users SET mfa_secret = NULL, mfa_enabled_at = NULL WHERE id = $1`, [stepped], CHECK_VIOLATION, 'ck_platform_users_mfa_last_step');
      expect((await client.query(`UPDATE platform_users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = $1`, [stepped])).rowCount).toBe(1);
      // Confirming a setup moves the pending secret into place in one statement; dropping half of a pending pair is refused.
      await expectSqlError(client, `UPDATE platform_users SET mfa_pending_at = NULL WHERE id = $1`, [both], CHECK_VIOLATION, 'ck_platform_users_mfa_pending');
      const confirmed = await client.query(
        `UPDATE platform_users SET mfa_secret = mfa_pending_secret, mfa_enabled_at = now(), mfa_pending_secret = NULL, mfa_pending_at = NULL WHERE id = $1 AND mfa_pending_secret IS NOT NULL`,
        [pending],
      );
      expect(confirmed.rowCount).toBe(1);
      const after = await client.query<Record<string, unknown>>(
        `SELECT mfa_secret, mfa_enabled_at IS NOT NULL AS enabled, mfa_pending_secret, mfa_pending_at FROM platform_users WHERE id = $1`,
        [pending],
      );
      expect(after.rows[0]).toEqual({ mfa_secret: SEALED_PENDING, enabled: true, mfa_pending_secret: null, mfa_pending_at: null });
    });
  });

  it('stores both secrets sealed only, in the v<n>.<iv>.<ciphertext>.<tag> base64url shape', async () => {
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
        await expectSqlError(client, USER_MFA_SQL, userParams('s', { secret, enabledAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_platform_users_mfa_secret_format');
        await expectSqlError(client, USER_MFA_SQL, userParams('p', { pending: secret, pendingAt: ENABLED_AT }), CHECK_VIOLATION, 'ck_platform_users_mfa_pending_secret_format');
      }
      // Valid: the first version, a later version (key rotation), base64url with `-` and `_`.
      for (const secret of [SEALED, 'v2.AAAA.BBBB.CCCC', 'v10.a-b_.c-_d.EF-_', 'v1.A.B.C']) {
        await user(client, 'ok', { secret, enabledAt: ENABLED_AT });
        await user(client, 'okp', { pending: secret, pendingAt: ENABLED_AT });
      }
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_users WHERE email LIKE $1`, [`${tag}-ok%`])).toBe(8);
    });
  });

  it('keeps recovery codes as unique lower-case SHA-256 hex, spent once by a conditional update', async () => {
    await inRollback(async (client) => {
      const owner = await user(client, 'codes', { secret: SEALED, enabledAt: ENABLED_AT });
      const other = await user(client, 'other', { secret: SEALED, enabledAt: ENABLED_AT });
      const hash = sha256('ABCD-EFGH-1234');
      // Not a hash: upper-case hex, a non-hex letter, 63 characters (char(64) pads it, the CHECK still refuses it), the code itself, blanks.
      for (const codeHash of [hash.toUpperCase(), `${hash.slice(0, 63)}g`, hash.slice(0, 63), 'ABCD-EFGH-1234', ' '.repeat(64)]) {
        await expectSqlError(client, CODE_SQL, [owner, codeHash, null], CHECK_VIOLATION, 'ck_platform_mfa_recovery_codes_hash_format');
      }
      await expectSqlError(client, CODE_SQL, [owner, `${hash}0`, null], VALUE_TOO_LONG);

      const first = (await client.query<{ id: string }>(CODE_SQL, [owner, hash, null])).rows[0]!.id;
      for (let i = 1; i < 10; i += 1) await client.query(CODE_SQL, [owner, sha256(`code-${tag}-${i}`), null]);
      // The hash is unique across every user, not per user.
      await expectSqlError(client, CODE_SQL, [owner, hash, null], UNIQUE_VIOLATION, 'platform_mfa_recovery_codes_code_hash_key');
      await expectSqlError(client, CODE_SQL, [other, hash, null], UNIQUE_VIOLATION, 'platform_mfa_recovery_codes_code_hash_key');
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [owner])).toBe(10);

      // Spending a code is a conditional update on the database clock: the second use of the same code touches nothing.
      // Another user cannot spend it (the update is bound to the owner).
      const spend = `UPDATE platform_mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`;
      expect((await client.query(spend, [other, hash])).rowCount).toBe(0);
      expect((await client.query(spend, [owner, hash])).rowCount).toBe(1);
      expect((await client.query(spend, [owner, hash])).rowCount).toBe(0);
      // No CHECK ties used_at to created_at (the two clocks need not agree) — an instant before the issue is stored as given.
      await client.query(`UPDATE platform_mfa_recovery_codes SET used_at = created_at - interval '1 second' WHERE id = $1`, [first]);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [owner])).toBe(9);
    });
  });

  it('keeps sign-in challenges as unique lower-case SHA-256 hex with 0..5 wrong attempts, consumed once', async () => {
    await inRollback(async (client) => {
      const owner = await user(client, 'challenge', { secret: SEALED, enabledAt: ENABLED_AT });
      const other = await user(client, 'challenge-other', { secret: SEALED, enabledAt: ENABLED_AT });
      const hash = sha256(`challenge-${tag}`);
      for (const tokenHash of [hash.toUpperCase(), `${hash.slice(0, 63)}z`, hash.slice(0, 63), 'not-a-hash', ' '.repeat(64)]) {
        await expectSqlError(client, CHALLENGE_SQL, [owner, tokenHash, 0], CHECK_VIOLATION, 'ck_platform_mfa_challenges_hash_format');
      }
      await expectSqlError(client, CHALLENGE_SQL, [owner, `${hash}0`, 0], VALUE_TOO_LONG);
      // The wrong attempts stay within 0..5 (PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS).
      for (const attempts of [-1, 6, 100]) {
        await expectSqlError(client, CHALLENGE_SQL, [owner, sha256(`attempts-${tag}-${attempts}`), attempts], CHECK_VIOLATION, 'ck_platform_mfa_challenges_attempts');
      }
      for (const attempts of [0, 1, 4, 5]) await client.query(CHALLENGE_SQL, [owner, sha256(`ok-${tag}-${attempts}`), attempts]);

      const id = (await client.query<{ id: string }>(CHALLENGE_SQL, [owner, hash, 0])).rows[0]!.id;
      // The hash is unique across every user.
      await expectSqlError(client, CHALLENGE_SQL, [owner, hash, 0], UNIQUE_VIOLATION, 'platform_mfa_challenges_token_hash_key');
      await expectSqlError(client, CHALLENGE_SQL, [other, hash, 0], UNIQUE_VIOLATION, 'platform_mfa_challenges_token_hash_key');

      // A wrong factor counts one attempt; the count stops at 5 — a sixth is refused by the CHECK.
      for (let i = 1; i <= 5; i += 1) {
        expect((await client.query(`UPDATE platform_mfa_challenges SET attempts = attempts + 1 WHERE id = $1 AND consumed_at IS NULL`, [id])).rowCount).toBe(1);
      }
      await expectSqlError(client, `UPDATE platform_mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [id], CHECK_VIOLATION, 'ck_platform_mfa_challenges_attempts');
      // A challenge is consumed once (a conditional update, like the refresh tokens).
      const consume = `UPDATE platform_mfa_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`;
      expect((await client.query(consume, [id])).rowCount).toBe(1);
      expect((await client.query(consume, [id])).rowCount).toBe(0);
      // No CHECK ties expires_at or consumed_at to created_at: an already expired challenge can be stored (the service refuses it).
      await client.query(`INSERT INTO platform_mfa_challenges (user_id, token_hash, expires_at, consumed_at) VALUES ($1, $2, now() - interval '1 minute', now() - interval '2 minutes')`, [owner, sha256(`expired-${tag}`)]);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_challenges WHERE user_id = $1`, [owner])).toBe(6);
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
      await client.query(CHALLENGE_SQL, [gone, sha256(`gone-challenge-${tag}`), 2]);
      await client.query(CHALLENGE_SQL, [kept, sha256(`kept-challenge-${tag}`), 0]);
      await client.query(`DELETE FROM platform_users WHERE id = $1`, [gone]);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_recovery_codes WHERE user_id = $1`, [gone])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_challenges WHERE user_id = $1`, [gone])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_recovery_codes WHERE user_id = $1`, [kept])).toBe(3);
      expect(await count(client, `SELECT count(*)::int AS n FROM platform_mfa_challenges WHERE user_id = $1`, [kept])).toBe(1);
    });
  });

  it('names the CHECKs, the indexes and the foreign keys as the migration does', async () => {
    const constraints = await pool.query<{ name: string }>(
      `SELECT conrelid::regclass::text || '.' || conname::text AS name FROM pg_constraint
        WHERE contype = 'c'
          AND (conrelid IN ('platform_mfa_recovery_codes'::regclass, 'platform_mfa_challenges'::regclass)
               OR (conrelid = 'platform_users'::regclass AND conname LIKE 'ck\\_platform\\_users\\_mfa\\_%'))
        ORDER BY (conrelid::regclass::text || '.' || conname::text) COLLATE "C"`,
    );
    expect(constraints.rows.map((row) => row.name)).toEqual([
      'platform_mfa_challenges.ck_platform_mfa_challenges_attempts',
      'platform_mfa_challenges.ck_platform_mfa_challenges_hash_format',
      'platform_mfa_recovery_codes.ck_platform_mfa_recovery_codes_hash_format',
      'platform_users.ck_platform_users_mfa_enabled',
      'platform_users.ck_platform_users_mfa_last_step',
      'platform_users.ck_platform_users_mfa_pending',
      'platform_users.ck_platform_users_mfa_pending_secret_format',
      'platform_users.ck_platform_users_mfa_secret_format',
    ]);
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname::text AS indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('platform_mfa_recovery_codes', 'platform_mfa_challenges')
        ORDER BY indexname::text COLLATE "C"`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'platform_mfa_challenges_pkey',
      'platform_mfa_challenges_token_hash_key',
      'platform_mfa_challenges_user_id_idx',
      'platform_mfa_recovery_codes_code_hash_key',
      'platform_mfa_recovery_codes_pkey',
      'platform_mfa_recovery_codes_user_id_idx',
    ]);
    const definition = (name: string) => indexes.rows.find((row) => row.indexname === name)!.indexdef;
    expect(definition('platform_mfa_recovery_codes_code_hash_key')).toMatch(/^CREATE UNIQUE INDEX .*\(code_hash\)$/);
    expect(definition('platform_mfa_challenges_token_hash_key')).toMatch(/^CREATE UNIQUE INDEX .*\(token_hash\)$/);
    const foreignKeys = await pool.query<{ conname: string; action: string; target: string }>(
      `SELECT conname::text, confdeltype::text AS action, confrelid::regclass::text AS target FROM pg_constraint
        WHERE contype = 'f' AND conrelid IN ('platform_mfa_recovery_codes'::regclass, 'platform_mfa_challenges'::regclass)
        ORDER BY conname::text COLLATE "C"`,
    );
    expect(foreignKeys.rows).toEqual([
      { conname: 'platform_mfa_challenges_user_id_fkey', action: 'c', target: 'platform_users' },
      { conname: 'platform_mfa_recovery_codes_user_id_fkey', action: 'c', target: 'platform_users' },
    ]);
  });

  it('round-trips through the generated platform client (BigInt step, nested codes and challenges) and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const enabledAt = new Date(ENABLED_AT);
        const expiresAt = new Date(Date.now() + 5 * 60_000);
        const created = await tx.platformUser.create({
          data: {
            email: `${tag}-prisma@example.com`,
            fullName: 'Prisma MFA',
            role: 'super_admin',
            mfaSecret: SEALED,
            mfaEnabledAt: enabledAt,
            mfaLastStep: 59012345n,
            mfaRecoveryCodes: { create: [{ codeHash: sha256(`prisma-${tag}-1`) }, { codeHash: sha256(`prisma-${tag}-2`) }] },
            mfaChallenges: { create: [{ tokenHash: sha256(`prisma-challenge-${tag}`), expiresAt }] },
          },
          select: {
            id: true,
            mfaSecret: true,
            mfaEnabledAt: true,
            mfaLastStep: true,
            mfaPendingSecret: true,
            mfaPendingAt: true,
            mfaRecoveryCodes: { select: { codeHash: true, usedAt: true } },
            mfaChallenges: { select: { tokenHash: true, expiresAt: true, consumedAt: true, attempts: true } },
          },
        });
        expect(created).toMatchObject({ mfaSecret: SEALED, mfaEnabledAt: enabledAt, mfaLastStep: 59012345n, mfaPendingSecret: null, mfaPendingAt: null });
        expect(typeof created.mfaLastStep).toBe('bigint');
        expect(created.mfaRecoveryCodes).toHaveLength(2);
        expect(created.mfaRecoveryCodes.every((code) => /^[0-9a-f]{64}$/.test(code.codeHash) && code.usedAt === null)).toBe(true);
        expect(created.mfaChallenges).toEqual([{ tokenHash: sha256(`prisma-challenge-${tag}`), expiresAt, consumedAt: null, attempts: 0 }]);

        // The delegates of the brief: platformMfaRecoveryCode and platformMfaChallenge.
        const spent = await tx.$executeRaw`UPDATE platform_mfa_recovery_codes SET used_at = now() WHERE user_id = ${created.id}::uuid AND code_hash = ${sha256(`prisma-${tag}-1`)} AND used_at IS NULL`;
        expect(spent).toBe(1);
        expect(await tx.platformMfaRecoveryCode.count({ where: { userId: created.id, usedAt: null } })).toBe(1);
        const counted = await tx.platformMfaChallenge.updateMany({ where: { userId: created.id, consumedAt: null }, data: { attempts: { increment: 1 } } });
        expect(counted.count).toBe(1);
        expect(await tx.platformMfaChallenge.findFirst({ where: { userId: created.id }, select: { attempts: true } })).toEqual({ attempts: 1 });

        const off = await tx.platformUser.update({ where: { id: created.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null }, select: { mfaSecret: true, mfaLastStep: true } });
        expect(off).toEqual({ mfaSecret: null, mfaLastStep: null });
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.platformUser.count({ where: { email: `${tag}-prisma@example.com` } })).toBe(0);
  });
});
