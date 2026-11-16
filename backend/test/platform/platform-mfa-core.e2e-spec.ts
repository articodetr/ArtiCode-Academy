// TEST-231 (part) — PMFA-T05 closure of PMFA-T01's core (roadmap §4o,
// D-R113..D-R120): `PlatformMfaCore` taken from the platform Nest application
// and run against the live development PLATFORM database — the cases (a)–(e)
// of the academy TEST-225 (test/mfa-core.e2e-spec.ts) on the platform's
// accounts and tables. (a) Two transactions accepting the same valid TOTP
// code: exactly one wins — with the row locked first as every route does, and
// with two stale reads where only the conditional `mfa_last_step` update
// decides; (b) two transactions using the same recovery code: exactly one gets
// it; (c) `issueChallenge()` inside a transaction that rolls back leaves no
// `platform_mfa_challenges` row (and retires and prunes nothing), while the
// root client commits one, retires the older open one and deletes this user's
// challenges that ended more than PLATFORM_MFA_CHALLENGE_PRUNE_AFTER_MS ago —
// never another user's; (d) a code for a step at or below `mfa_last_step` is
// refused and writes nothing; (e) a secret sealed for one platform user id does
// not open for another: `503 mfa_unavailable`, never a bypass, nothing written.
// The core itself records no audit event in any of them (its callers do).
//
// Each fixture turns MFA on only through the platform routes (API-214 setup +
// API-215 enable), signed in through API-178 while its MFA is still off — no
// fixture signs in again after enabling, so the suite does not depend on the
// two-step sign-in of PMFA-T03. Its recovery codes come only from the API-215
// answer. The two-way races are made deterministic: the first transaction
// keeps its write open until the second one waits on its row lock (found
// through `pg_blocking_pids()`, never by a sleep). A fixed TEST key (different
// from the academy suites' key) is set before ./helpers.js — which imports the
// platform app module — is imported (process variables beat the env files).
// Every request comes from one address, which is fine here: the platform
// limiter keys a sign-in per (IP, identifier) and the MFA writes per
// (IP, platform user). Skipped when the platform database is unreachable; the
// fixtures are deleted at the end (cascade removes their tokens, recovery codes
// and challenges; their append-only audit rows stay with the actor set to NULL).
import { createHash, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, generateTotpSecret, matchTotp, totpCode, totpStep } from '../../src/auth/mfa/totp.js';
import type { Prisma } from '../../src/generated/platform/client.js';
// Type-only (erased): ./helpers.js itself is imported below, after the key is set.
import type { PlatformUserFixture } from './helpers.js';

/** A fixed TEST key (32 bytes) — never a real one, and not the academy suites' `Buffer.alloc(32, 7)`. */
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');

const {
  PLATFORM_TEST_ORIGIN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformDbReachable,
  platformTestDb,
} = await import('./helpers.js');
const { PLATFORM_REFRESH_COOKIE_NAME } = await import('../../src/platform/auth/platform-cookies.js');
const {
  PLATFORM_MFA_CHALLENGE_PATTERN,
  PLATFORM_MFA_CHALLENGE_PRUNE_AFTER_MS,
  PLATFORM_MFA_CHALLENGE_TTL_MS,
  PLATFORM_MFA_USER_SELECT,
  PlatformMfaCore,
} = await import('../../src/platform/auth/mfa/platform-mfa-core.service.js');
const { PlatformPrismaService } = await import('../../src/platform/prisma/platform-prisma.service.js');

const available = await platformDbReachable();

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const USER_AGENT = 'TEST-231 PlatformMfaCore supertest';
const LOGIN = '/api/auth/login';
const SETUP = '/api/auth/mfa/setup';
const ENABLE = '/api/auth/mfa/enable';
/** How long a race waits for the second transaction to queue behind the first one's row lock. */
const QUEUE_DEADLINE_MS = 10_000;
/** The holder transaction stays open while the second one queues: longer than Prisma's 5 s default. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const HOUR_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = lines.find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

const codeAt = (secret: string, step: number) => totpCode(base32Decode(secret)!, step);

/** A well-formed stored challenge hash (64 lower-case hex) of a random value nobody holds. */
const randomTokenHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');

/** Thrown inside a transaction to roll it back on purpose. */
class Rollback extends Error {}

interface EnabledUser {
  id: string;
  email: string;
  /** Base32 secret from the setup answer. */
  secret: string;
  /** The ten codes of the enable answer. */
  recoveryCodes: string[];
  /** The step of the code that turned MFA on (= `mfa_last_step`). */
  step: number;
}

describe.skipIf(!available)(
  'PMFA-T01 PlatformMfaCore against the platform database: replay guards, recovery codes and the challenge (e2e, TEST-231)',
  () => {
    let app: NestExpressApplication;
    let core: InstanceType<typeof PlatformMfaCore>;
    let db: InstanceType<typeof PlatformPrismaService>['db'];
    const fixtureIds: string[] = [];

    const api = () => request(app.getHttpServer());

    async function fixture(): Promise<PlatformUserFixture> {
      const user = await createPlatformUserFixture({ role: 'support', password: PASSWORD });
      fixtureIds.push(user.id);
      return user;
    }

    /**
     * A fresh platform account with MFA turned on through API-214/API-215, signed
     * in through API-178 before (never after) enabling; the enabling code is for
     * `currentStep + stepOffset` (0 or 1).
     */
    async function enabledUser(stepOffset: 0 | 1 = 0): Promise<EnabledUser> {
      const user = await fixture();
      const login = await api()
        .post(LOGIN)
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('User-Agent', USER_AGENT)
        .send({ identifier: user.email, password: PASSWORD });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      const signedIn = {
        Origin: PLATFORM_TEST_ORIGIN,
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${login.body.accessToken as string}`,
        Cookie: `${PLATFORM_REFRESH_COOKIE_NAME}=${refreshCookie(login)!}`,
      };
      const setup = await api().post(SETUP).set(signedIn).send({ password: PASSWORD });
      expect(setup.status, JSON.stringify(setup.body)).toBe(200);
      const secret = setup.body.secret as string;
      const step = totpStep(Date.now()) + stepOffset;
      const enable = await api().post(ENABLE).set(signedIn).send({ code: codeAt(secret, step) });
      expect(enable.status, JSON.stringify(enable.body)).toBe(200);
      const recoveryCodes = enable.body.recoveryCodes as string[];
      expect(recoveryCodes).toHaveLength(10);
      // The enabling code's step is the replay guard from now on.
      expect(await lastStep(user.id)).toBe(step);
      return { id: user.id, email: user.email, secret, recoveryCodes, step };
    }

    async function lastStep(userId: string): Promise<number | null> {
      const row = await platformTestDb().platformUser.findUniqueOrThrow({ where: { id: userId }, select: { mfaLastStep: true } });
      return row.mfaLastStep === null ? null : Number(row.mfaLastStep);
    }

    /**
     * The row's MFA columns, its `updated_at` and its tuple version (`xmin`): a
     * row lock (`FOR NO KEY UPDATE`) leaves `xmin` alone, any UPDATE — even one
     * that changes nothing — gives the row a new one.
     */
    async function rowVersion(userId: string) {
      const [tuple] = await platformTestDb().$queryRaw<{ xmin: string }[]>`SELECT xmin::text AS xmin FROM platform_users WHERE id = ${userId}::uuid`;
      const row = await platformTestDb().platformUser.findUniqueOrThrow({
        where: { id: userId },
        select: { ...PLATFORM_MFA_USER_SELECT, updatedAt: true },
      });
      return { xmin: tuple!.xmin, ...row };
    }

    /** The newest platform_audit_logs id (UUIDv7 = insertion order), or null on an empty log. */
    async function auditMark(): Promise<string | null> {
      const last = await platformTestDb().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
      return last?.id ?? null;
    }

    /** Every event naming one fixture account (as entity or actor) written after `mark`. */
    const eventsSince = (mark: string | null, userId: string) =>
      platformTestDb().platformAuditLog.findMany({
        where: { OR: [{ entityId: userId }, { actorPlatformUserId: userId }], ...(mark ? { id: { gt: mark } } : {}) },
        select: { action: true },
      });

    /** The sessions waiting on a lock held — or queued ahead of them — by `pid`. */
    async function blockedBy(pid: number): Promise<number[]> {
      const rows = await platformTestDb().$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY (pg_blocking_pids(pid))`;
      return rows.map((row) => row.pid);
    }

    async function waitUntilBlocked(pid: number): Promise<void> {
      const deadline = Date.now() + QUEUE_DEADLINE_MS;
      while ((await blockedBy(pid)).length === 0) {
        if (Date.now() > deadline) throw new Error(`no transaction queued behind backend ${pid} within ${QUEUE_DEADLINE_MS} ms`);
        await sleep(25);
      }
    }

    /**
     * Runs `write` in two transactions at once, deterministically interleaved:
     * the first one writes and keeps its transaction (and so its row locks) open
     * until the second one's write waits behind it; then the first commits and
     * the second finishes. Resolves with [first, second].
     */
    async function race<T>(write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<[T, T]> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let wrote!: (pid: number) => void;
      const holderWrote = new Promise<number>((resolve) => (wrote = resolve));

      const first = db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const result = await write(tx);
        wrote(pid!);
        await released;
        return result;
      }, TX_OPTIONS);
      // Should the holder fail before it wrote, the race ends with its error instead of waiting.
      const holderPid = await Promise.race([holderWrote, first.then(() => Promise.reject(new Error('the holder finished before it wrote')))]);
      const second = db.$transaction((tx) => write(tx), TX_OPTIONS);
      try {
        await waitUntilBlocked(holderPid);
      } finally {
        release();
      }
      return Promise.all([first, second]);
    }

    /** Status and dictionary code of a thrown HttpException. */
    function errorOf(run: () => unknown): { status: number; code: unknown } {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const http = error as HttpException;
        return { status: http.getStatus(), code: (http.getResponse() as { code?: unknown }).code };
      }
      throw new Error('expected an HttpException');
    }

    beforeAll(async () => {
      app = await createPlatformTestApp();
      core = app.get(PlatformMfaCore);
      db = app.get(PlatformPrismaService).db;
      expect(core.available).toBe(true);
    });

    afterAll(async () => {
      try {
        await deletePlatformUserFixtures(fixtureIds);
      } finally {
        await closePlatformTestDb();
        await app?.close();
      }
    });

    it('(a) acceptCode(): of two transactions that lock the row and present the same valid code, exactly one wins', async () => {
      const user = await enabledUser();
      const mark = await auditMark();
      const code = codeAt(user.secret, user.step + 1);
      const results = await Promise.all(
        [0, 1].map(() =>
          db.$transaction(async (tx) => {
            const state = await core.lockUser(tx, user.id);
            return core.acceptCode(tx, state!, code);
          }, TX_OPTIONS),
        ),
      );
      expect([...results].sort()).toEqual([false, true]);
      expect(await lastStep(user.id)).toBe(user.step + 1);
      expect(await eventsSince(mark, user.id)).toEqual([]);
    });

    it('(a) acceptCode(): two transactions on the same stale state with the same code — the conditional mfa_last_step update lets exactly one win', async () => {
      const user = await enabledUser();
      // Both read the state before either writes: only the database can tell them apart.
      const stale = await db.platformUser.findUniqueOrThrow({ where: { id: user.id }, select: PLATFORM_MFA_USER_SELECT });
      expect(Number(stale.mfaLastStep)).toBe(user.step);
      const code = codeAt(user.secret, user.step + 1);
      const [first, second] = await race((tx) => core.acceptCode(tx, stale, code));
      expect([first, second]).toEqual([true, false]);
      expect(await lastStep(user.id)).toBe(user.step + 1);
    });

    it('(b) consumeRecoveryCode(): two transactions using the same recovery code — exactly one gets it, nine stay', async () => {
      const user = await enabledUser();
      const mark = await auditMark();
      const recoveryCode = user.recoveryCodes[4]!;
      const [first, second] = await race((tx) => core.consumeRecoveryCode(tx, user.id, recoveryCode));
      expect([first, second]).toEqual([9, null]);
      expect(await core.recoveryCodesLeft(platformTestDb(), user.id)).toBe(9);
      expect(await platformTestDb().platformMfaRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1);
      // Once used it stays used, also in a later transaction.
      expect(await db.$transaction((tx) => core.consumeRecoveryCode(tx, user.id, recoveryCode))).toBeNull();
      expect(await core.recoveryCodesLeft(platformTestDb(), user.id)).toBe(9);
      expect(await eventsSince(mark, user.id)).toEqual([]);
    });

    it('(c) issueChallenge(): a rolled-back transaction leaves no challenge, retires and prunes nothing; the root client commits one, retires the older one and prunes only this user’s challenges that ended over a day ago', async () => {
      const user = await enabledUser();
      const other = await fixture();
      const challenges = () => platformTestDb().platformMfaChallenge;
      const challengeRow = (challenge: string) =>
        challenges().findUnique({
          where: { tokenHash: core.hashChallenge(challenge) },
          select: { userId: true, consumedAt: true, expiresAt: true, attempts: true },
        });
      const openChallenges = (userId: string) => challenges().count({ where: { userId, consumedAt: null } });
      const surviving = async (ids: string[]) =>
        (await challenges().findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id).sort();

      const before = Date.now();
      const older = await core.issueChallenge(db, user.id);
      expect(older.challenge).toMatch(PLATFORM_MFA_CHALLENGE_PATTERN);
      expect(older.expiresAt.getTime() - before).toBeGreaterThanOrEqual(PLATFORM_MFA_CHALLENGE_TTL_MS);
      expect(older.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(PLATFORM_MFA_CHALLENGE_TTL_MS);
      expect(await challengeRow(older.challenge)).toEqual({ userId: user.id, consumedAt: null, expiresAt: older.expiresAt, attempts: 0 });
      expect(await openChallenges(user.id)).toBe(1);

      // Rows that ended long ago or recently, for this user and for another one: a consumed row was
      // used a minute after it was issued, an unconsumed one simply ran out at `endedAt`.
      const now = Date.now();
      const longAgo = now - PLATFORM_MFA_CHALLENGE_PRUNE_AFTER_MS - 2 * HOUR_MS;
      const ended = (userId: string, endedAt: number, consumed: boolean) => {
        const issuedAt = endedAt - (consumed ? 60_000 : PLATFORM_MFA_CHALLENGE_TTL_MS);
        return challenges().create({
          data: {
            userId,
            tokenHash: randomTokenHash(),
            createdAt: new Date(issuedAt),
            expiresAt: new Date(issuedAt + PLATFORM_MFA_CHALLENGE_TTL_MS),
            consumedAt: consumed ? new Date(endedAt) : null,
          },
          select: { id: true },
        });
      };
      // Consumed over a day ago, and expired over a day ago without ever being consumed (still open): both go.
      const prunable = [(await ended(user.id, longAgo, true)).id, (await ended(user.id, longAgo, false)).id].sort();
      // Consumed an hour ago: stays.
      const recent = (await ended(user.id, now - HOUR_MS, true)).id;
      // Another user's old rows (one consumed, one never consumed): never touched by this user's sign-in.
      const othersOld = [(await ended(other.id, longAgo, true)).id, (await ended(other.id, longAgo, false)).id].sort();
      const othersBefore = await challenges().findMany({ where: { userId: other.id }, orderBy: { id: 'asc' } });
      expect(await openChallenges(user.id)).toBe(2);

      const inside = { challenge: '' };
      await expect(
        db.$transaction(async (tx) => {
          inside.challenge = (await core.issueChallenge(tx, user.id)).challenge;
          // Written in that transaction (the older ones retired and the old ones pruned there)…
          expect(await tx.platformMfaChallenge.count({ where: { userId: user.id, consumedAt: null } })).toBe(1);
          expect(await tx.platformMfaChallenge.count({ where: { id: { in: prunable } } })).toBe(0);
          throw new Rollback('roll back on purpose');
        }, TX_OPTIONS),
      ).rejects.toBeInstanceOf(Rollback);
      // …and gone with it: no row, the older challenge is still open, nothing was pruned.
      expect(inside.challenge).toMatch(PLATFORM_MFA_CHALLENGE_PATTERN);
      expect(await challengeRow(inside.challenge)).toBeNull();
      expect(await challengeRow(older.challenge)).toMatchObject({ consumedAt: null });
      expect(await surviving(prunable)).toEqual(prunable);
      expect(await openChallenges(user.id)).toBe(2);

      const newer = await core.issueChallenge(db, user.id);
      expect(await challengeRow(newer.challenge)).toEqual({ userId: user.id, consumedAt: null, expiresAt: newer.expiresAt, attempts: 0 });
      // The older one is retired (ended just now — kept), the two long-ended rows are deleted, the recent one stays.
      expect((await challengeRow(older.challenge))?.consumedAt).toBeInstanceOf(Date);
      expect(await surviving(prunable)).toEqual([]);
      expect(await surviving([recent])).toEqual([recent]);
      expect(await openChallenges(user.id)).toBe(1);
      // The other user's rows are exactly as they were — not deleted, not retired.
      expect(await surviving(othersOld)).toEqual(othersOld);
      expect(await challenges().findMany({ where: { userId: other.id }, orderBy: { id: 'asc' } })).toEqual(othersBefore);
      expect(await openChallenges(other.id)).toBe(1);
      // Only the hash is stored: no row carries a plain challenge.
      const rows = await challenges().findMany({ where: { userId: user.id }, select: { tokenHash: true } });
      for (const challenge of [older.challenge, inside.challenge, newer.challenge]) {
        expect(rows.some((row) => row.tokenHash === challenge)).toBe(false);
      }
    });

    it('(d) acceptCode(): a code for a step at or below mfa_last_step is refused and writes nothing — with a fresh state and with a stale one', async () => {
      // Enabled with the NEXT step's code: that step and the current one are both inside the window for the rest of the test.
      const user = await enabledUser(1);
      const mark = await auditMark();
      const version = await rowVersion(user.id);
      for (const step of [user.step, user.step - 1]) {
        const code = codeAt(user.secret, step);
        // Precondition: without the replay guard the code would be accepted right now.
        expect(matchTotp(user.secret, code, Date.now(), null)).toBe(step);
        const fresh = await db.$transaction(async (tx) => {
          const state = await core.lockUser(tx, user.id);
          return core.acceptCode(tx, state!, code);
        });
        expect(fresh).toBe(false);
        // A state read before the enabling (no last step): the TOTP check passes, the conditional update refuses.
        const stale = { ...(await db.platformUser.findUniqueOrThrow({ where: { id: user.id }, select: PLATFORM_MFA_USER_SELECT })), mfaLastStep: null };
        expect(await db.$transaction((tx) => core.acceptCode(tx, stale, code))).toBe(false);
        expect(await lastStep(user.id)).toBe(user.step);
      }
      // Not a single write: the same tuple, the same columns, no event.
      expect(await rowVersion(user.id)).toEqual(version);
      expect(await eventsSince(mark, user.id)).toEqual([]);
    });

    it('(e) open()/acceptCode(): a secret sealed for one platform user id does not open for another — 503 mfa_unavailable, never a bypass, nothing written', async () => {
      const owner = await enabledUser();
      const stranger = await enabledUser();
      const sealed = (await platformTestDb().platformUser.findUniqueOrThrow({ where: { id: owner.id }, select: { mfaSecret: true } })).mfaSecret!;
      expect(core.open(owner.id, sealed)).toBe(owner.secret);
      expect(errorOf(() => core.open(stranger.id, sealed))).toEqual({ status: 503, code: 'mfa_unavailable' });

      // The same for a value sealed by seal(): bound to the id it was sealed for.
      const secret = generateTotpSecret();
      const forStranger = core.seal(stranger.id, secret);
      expect(core.open(stranger.id, forStranger)).toBe(secret);
      expect(errorOf(() => core.open(owner.id, forStranger))).toEqual({ status: 503, code: 'mfa_unavailable' });

      // acceptCode() opens the secret first: a row whose secret was sealed for someone else never accepts a code.
      const mark = await auditMark();
      const version = await rowVersion(stranger.id);
      const state = await db.platformUser.findUniqueOrThrow({ where: { id: stranger.id }, select: PLATFORM_MFA_USER_SELECT });
      const borrowed = { ...state, mfaSecret: sealed };
      for (const code of [codeAt(owner.secret, owner.step + 1), codeAt(stranger.secret, stranger.step + 1)]) {
        const failure: unknown = await db.$transaction((tx) => core.acceptCode(tx, borrowed, code)).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(HttpException);
        expect((failure as HttpException).getStatus()).toBe(503);
        expect(((failure as HttpException).getResponse() as { code?: unknown }).code).toBe('mfa_unavailable');
      }
      expect(await lastStep(stranger.id)).toBe(stranger.step);
      expect(await rowVersion(stranger.id)).toEqual(version);
      expect(await eventsSince(mark, stranger.id)).toEqual([]);
      expect(await eventsSince(mark, owner.id)).toEqual([]);
    });
  },
);
