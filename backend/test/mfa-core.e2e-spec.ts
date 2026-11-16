// TEST-225 (part) — MFA-T05 closure of MFA-T01's core (MOD-01-H06, roadmap
// §4n): `MfaCore` taken from the Nest application and run against the live
// development database. (a) Two transactions accepting the same valid TOTP
// code: exactly one wins — with the row locked first as every route does, and
// with two stale reads where only the conditional `mfa_last_step` update
// decides; (b) two transactions using the same recovery code: exactly one
// gets it; (c) `issueChallenge()` inside a transaction that rolls back leaves
// no challenge (and retires nothing), while the root client commits one and
// retires the older open one; (d) a code for a step at or below
// `mfa_last_step` is refused and writes nothing; (e) a secret sealed for one
// user id does not open for another: `503 mfa_unavailable`, never a bypass.
//
// Each fixture turns MFA on only through the routes (API-207 setup + API-208
// enable); its recovery codes come only from the API-208 answer. The two-way
// races are made deterministic: the first transaction keeps its write open
// until the second one waits on its row lock (found through
// `pg_blocking_pids()`, never by a sleep). A fixed TEST key is set before
// AppModule is imported (process variables beat the env files) and
// `TRUST_PROXY=loopback` gives each fixture its own documentation address
// (X-Forwarded-For), so no rate-limit key is shared. Skipped when no database
// is reachable; the fixtures carry a unique suffix and are deleted at the end
// (cascade removes their tokens, codes and challenges; their audit rows stay).
import { HttpException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { base32Decode, generateTotpSecret, matchTotp, totpCode, totpStep } from '../src/auth/mfa/totp.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
/** A fixed TEST key (32 bytes) — never a real one. */
process.env['AUTH_MFA_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
process.env['TRUST_PROXY'] = 'loopback';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MFA_USER_SELECT, MfaCore } = await import('../src/auth/mfa/mfa-core.service.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-225 MfaCore supertest';
const LOGIN = '/api/auth/login';
const MFA_STEP = '/api/auth/login/mfa';
const SETUP = '/api/auth/mfa/setup';
const ENABLE = '/api/auth/mfa/enable';
/** How long a race waits for the second transaction to queue behind the first one's row lock. */
const QUEUE_DEADLINE_MS = 10_000;
/** The holder transaction stays open while the second one queues: longer than Prisma's 5 s default. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The refresh cookie value from a response, or undefined when absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = lines.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

const codeAt = (secret: string, step: number) => totpCode(base32Decode(secret)!, step);

/** Thrown inside a transaction to roll it back on purpose. */
class Rollback extends Error {}

interface EnabledUser {
  id: string;
  email: string;
  ip: string;
  /** Base32 secret from the setup answer. */
  secret: string;
  /** The ten codes of the enable answer. */
  recoveryCodes: string[];
  /** The step of the code that turned MFA on (= `mfa_last_step`). */
  step: number;
}

describe.skipIf(!available)('MFA-T01 MfaCore against the database: replay guards, recovery codes and the challenge (e2e, TEST-225)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let core: InstanceType<typeof MfaCore>;
  let db: InstanceType<typeof PrismaService>['db'];
  let passwordHash: string;
  const createdUserIds: string[] = [];
  let ipCounter = 40;

  const api = () => request(app.getHttpServer());
  const nextIp = () => `198.51.100.${(ipCounter += 1)}`;

  /** A fresh account with MFA turned on through API-207/API-208; the enabling code is for `currentStep + stepOffset` (0 or 1). */
  async function enabledUser(name: string, stepOffset: 0 | 1 = 0): Promise<EnabledUser> {
    const email = `mfa-core-${name}-${RUN}@example.test`;
    const user = await prisma.user.create({
      data: { email, fullName: `MfaCore ${name}`, passwordHash, status: 'active' },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    const ip = nextIp();
    const headers = { 'X-Forwarded-For': ip, 'User-Agent': USER_AGENT };

    const login = await api().post(LOGIN).set(headers).send({ identifier: email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const signedIn = { ...headers, Authorization: `Bearer ${login.body.accessToken as string}`, Cookie: `${REFRESH_COOKIE_NAME}=${refreshCookie(login)!}` };
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
    return { id: user.id, email, ip, secret, recoveryCodes, step };
  }

  async function lastStep(userId: string): Promise<number | null> {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaLastStep: true } });
    return row.mfaLastStep === null ? null : Number(row.mfaLastStep);
  }

  /** The sessions waiting on a lock held — or queued ahead of them — by `pid`. */
  async function blockedBy(pid: number): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY (pg_blocking_pids(pid))`;
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    core = app.get(MfaCore);
    db = app.get(PrismaService).db;
    passwordHash = await new PasswordService().hash(PASSWORD);
    expect(core.available).toBe(true);
  });

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) await prisma?.user.deleteMany({ where: { id: { in: createdUserIds } } });
    } finally {
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('(a) acceptCode(): of two transactions that lock the row and present the same valid code, exactly one wins', async () => {
    const user = await enabledUser('locked-race');
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
  });

  it('(a) acceptCode(): two transactions on the same stale state with the same code — the conditional mfa_last_step update lets exactly one win', async () => {
    const user = await enabledUser('stale-race');
    // Both read the state before either writes: only the database can tell them apart.
    const stale = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: MFA_USER_SELECT });
    expect(Number(stale.mfaLastStep)).toBe(user.step);
    const code = codeAt(user.secret, user.step + 1);
    const [first, second] = await race((tx) => core.acceptCode(tx, stale, code));
    expect([first, second]).toEqual([true, false]);
    expect(await lastStep(user.id)).toBe(user.step + 1);
  });

  it('(b) consumeRecoveryCode(): two transactions using the same recovery code — exactly one gets it, nine stay', async () => {
    const user = await enabledUser('recovery-race');
    const recoveryCode = user.recoveryCodes[4]!;
    const [first, second] = await race((tx) => core.consumeRecoveryCode(tx, user.id, recoveryCode));
    expect([first, second]).toEqual([9, null]);
    expect(await core.recoveryCodesLeft(prisma, user.id)).toBe(9);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1);
    // Once used it stays used, also in a later transaction.
    expect(await db.$transaction((tx) => core.consumeRecoveryCode(tx, user.id, recoveryCode))).toBeNull();
  });

  it('(c) issueChallenge(): a rolled-back transaction leaves no challenge and retires nothing; the root client commits one and retires the older one', async () => {
    const user = await enabledUser('challenge');
    const challengeRow = (challenge: string) =>
      prisma.verificationToken.findUnique({
        where: { tokenHash: core.hashChallenge(challenge) },
        select: { userId: true, purpose: true, consumedAt: true, expiresAt: true, metadata: true },
      });
    const openChallenges = () => prisma.verificationToken.count({ where: { userId: user.id, purpose: 'mfa_challenge', consumedAt: null } });

    const older = await core.issueChallenge(db, user.id);
    expect(await challengeRow(older.challenge)).toMatchObject({ userId: user.id, purpose: 'mfa_challenge', consumedAt: null, metadata: { attempts: 0 } });
    expect(await openChallenges()).toBe(1);

    const inside = { challenge: '' };
    await expect(
      db.$transaction(async (tx) => {
        inside.challenge = (await core.issueChallenge(tx, user.id)).challenge;
        // Written in that transaction (and the older one retired there)…
        expect(await tx.verificationToken.count({ where: { userId: user.id, purpose: 'mfa_challenge', consumedAt: null } })).toBe(1);
        throw new Rollback('roll back on purpose');
      }, TX_OPTIONS),
    ).rejects.toBeInstanceOf(Rollback);
    // …and gone with it: no row, and the older challenge is still the open one.
    expect(inside.challenge).not.toBe('');
    expect(await challengeRow(inside.challenge)).toBeNull();
    expect(await challengeRow(older.challenge)).toMatchObject({ consumedAt: null });
    expect(await openChallenges()).toBe(1);

    const newer = await core.issueChallenge(db, user.id);
    expect(await challengeRow(newer.challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 0 } });
    expect((await challengeRow(older.challenge))?.consumedAt).toBeInstanceOf(Date);
    expect(await openChallenges()).toBe(1);

    // Through API-211: the retired and the rolled-back challenges lead nowhere, the newer one opens the session.
    const headers = { 'X-Forwarded-For': user.ip, 'User-Agent': USER_AGENT };
    const code = codeAt(user.secret, user.step + 1);
    for (const challenge of [older.challenge, inside.challenge]) {
      const refused = await api().post(MFA_STEP).set(headers).send({ challenge, code });
      expect(refused.status, JSON.stringify(refused.body)).toBe(401);
      expect(refused.body).toMatchObject({ code: 'mfa_challenge_invalid' });
    }
    const opened = await api().post(MFA_STEP).set(headers).send({ challenge: newer.challenge, code });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(refreshCookie(opened)).toEqual(expect.any(String));
    expect(await openChallenges()).toBe(0);
  });

  it('(d) acceptCode(): a code for a step at or below mfa_last_step is refused and writes nothing — with a fresh state and with a stale one', async () => {
    // Enabled with the NEXT step's code: that step and the current one are both inside the window for the rest of the test.
    const user = await enabledUser('replay', 1);
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
      const stale = { ...(await db.user.findUniqueOrThrow({ where: { id: user.id }, select: MFA_USER_SELECT })), mfaLastStep: null };
      expect(await db.$transaction((tx) => core.acceptCode(tx, stale, code))).toBe(false);
      expect(await lastStep(user.id)).toBe(user.step);
    }
  });

  it('(e) open(): a secret sealed for one user id does not open for another — 503 mfa_unavailable, never a bypass', async () => {
    const owner = await enabledUser('seal-owner');
    const stranger = await enabledUser('seal-stranger');
    const sealed = (await prisma.user.findUniqueOrThrow({ where: { id: owner.id }, select: { mfaSecret: true } })).mfaSecret!;
    expect(core.open(owner.id, sealed)).toBe(owner.secret);
    expect(errorOf(() => core.open(stranger.id, sealed))).toEqual({ status: 503, code: 'mfa_unavailable' });

    // The same for a value sealed by seal(): bound to the id it was sealed for.
    const secret = generateTotpSecret();
    const forStranger = core.seal(stranger.id, secret);
    expect(core.open(stranger.id, forStranger)).toBe(secret);
    expect(errorOf(() => core.open(owner.id, forStranger))).toEqual({ status: 503, code: 'mfa_unavailable' });

    // acceptCode() opens the secret first: a row whose secret was sealed for someone else never accepts a code.
    const state = await db.user.findUniqueOrThrow({ where: { id: stranger.id }, select: MFA_USER_SELECT });
    const borrowed = { ...state, mfaSecret: sealed };
    const failure: unknown = await db.$transaction((tx) => core.acceptCode(tx, borrowed, codeAt(owner.secret, owner.step + 1))).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(503);
    expect(((failure as HttpException).getResponse() as { code?: unknown }).code).toBe('mfa_unavailable');
    expect(await lastStep(stranger.id)).toBe(stranger.step);
  });
});
