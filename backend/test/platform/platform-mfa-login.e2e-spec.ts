// TEST-233 (e2e) — PMFA-T03 (roadmap §4o): the two-step sign-in of the PLATFORM
// API against the live development platform database, the academy TEST-227
// (test/mfa-login.e2e-spec.ts) on `platform_users`, `platform_mfa_challenges`,
// `platform_mfa_recovery_codes` and the `pla_refresh` cookie. API-178 `POST
// /api/auth/login` answers the challenge instead of a session for an account
// with MFA, and API-218 `POST /api/auth/login/mfa` finishes it with a TOTP code
// or a recovery code. AC: (1) no session before the second factor; (2) the
// challenge is single-use and short-lived; (3) wrong codes lead to the
// lockout; (4) a recovery code is used once; (5) an account without MFA signs
// in as before. MFA is turned on for the fixtures directly through the platform
// Prisma client (the enrolment routes are another task).
//
// Skipped when the platform database is unreachable (./helpers.ts). Fixture
// accounts are deleted in afterAll (their tokens, challenges and recovery codes
// cascade; the actor of their append-only audit rows becomes NULL). Events are
// counted above an id watermark and by the fixture account they name, so other
// clients of the shared dev platform DB never pollute the counts.
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../../src/auth/cookies.js';
import { deriveRecoveryCodeKey, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../../src/auth/mfa/recovery-codes.js';
import { parseMfaKey, sealSecret } from '../../src/auth/mfa/secret-box.js';
import { base32Decode, generateTotpSecret, totpCode, totpStep } from '../../src/auth/mfa/totp.js';
import type { PlatformEnv } from '../../src/platform/platform.env.schema.js';

// A fixed TEST key (never a real one, and not the academy suites' key); process variables beat the env files.
const TEST_MFA_KEY = Buffer.alloc(32, 9).toString('base64');
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = TEST_MFA_KEY;
// The second step carries no identifier and no signed-in user, so PlatformThrottlerGuard counts it per
// IP (10 per 15 minutes). Trusting the loopback peer lets each scenario speak from its own
// documentation address (X-Forwarded-For), as clients behind a proxy do.
process.env['TRUST_PROXY'] = 'loopback';

// After the variables: helpers.ts imports PlatformAppModule, whose ConfigModule reads them.
const {
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformDbReachable,
  platformTestDb,
} = await import('./helpers.js');
const { PlatformMfaCore } = await import('../../src/platform/auth/mfa/platform-mfa-core.service.js');
const { PLATFORM_REFRESH_COOKIE_NAME } = await import('../../src/platform/auth/platform-cookies.js');
const { PlatformTokenService } = await import('../../src/platform/auth/platform-token.service.js');
const { PlatformPrismaService } = await import('../../src/platform/prisma/platform-prisma.service.js');

const available = await platformDbReachable();

const PASSWORD = 'Correct-Horse-Platform-9';
const LOGIN = '/api/auth/login';
const MFA_STEP = '/api/auth/login/mfa';
const SUCCEEDED = 'platform.auth.login.succeeded';
const FAILED = 'platform.auth.login.failed';
const CHALLENGE_KEYS = ['challenge', 'expiresAt', 'mfaRequired'];
const SESSION_KEYS = ['accessToken', 'expiresIn', 'tokenType', 'user'];
const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const MIN = 60 * 1000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function setCookies(res: SupertestResponse): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

/** The `pla_refresh` line of a response, or ''. */
function cookieLine(res: SupertestResponse): string {
  return setCookies(res).find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`)) ?? '';
}

/** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = cookieLine(res);
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

/** The TOTP code of the secret `offset` steps from now. */
function codeAt(secret: string, offset = 0): string {
  return totpCode(base32Decode(secret)!, totpStep(Date.now()) + offset);
}

/** A six-digit code that matches none of the steps the server could accept in the next minute. */
function wrongCode(secret: string): string {
  const step = totpStep(Date.now());
  const near = new Set([-1, 0, 1, 2].map((offset) => totpCode(base32Decode(secret)!, step + offset)));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, '0');
    if (!near.has(candidate)) return candidate;
  }
}

/** Every leaf value of a JSON value, at any depth. */
function leavesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leavesOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leavesOf);
  return [value];
}

/** Every object key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

interface Fixture {
  id: string;
  email: string;
  /** Base32 TOTP secret ('' for an account without MFA). */
  secret: string;
  recoveryCodes: string[];
}

describe.skipIf(!available)('PMFA-T03 platform two-step sign-in — API-178 + API-218 (e2e, TEST-233)', () => {
  let app: NestExpressApplication;
  let keyless: NestExpressApplication;
  let tokens: InstanceType<typeof PlatformTokenService>;
  let lockoutThreshold: number;
  let watermark: string | null;
  const mfaKey = parseMfaKey(TEST_MFA_KEY)!;
  // The stored form of a recovery code: keyed (derived from the MFA key) and bound to the user.
  const recoveryKey = deriveRecoveryCodeKey(mfaKey);
  const storedHash = (userId: string, code: string) => hashRecoveryCode(recoveryKey, userId, normalizeRecoveryCode(code)!);
  const fixtureIds: string[] = [];
  /** Every challenge, recovery code, secret, cookie and hash this suite handled — none may reach an event or an API-218 answer. */
  const secrets = new Set<string>();
  const totpCodes = new Set<string>();
  /** The access tokens of the sessions opened here — they belong in a session answer, never in an event. */
  const accessTokens = new Set<string>();
  /** The bodies API-178 and API-218 answered. */
  const answers: unknown[] = [];
  let ipCounter = 0;

  const db = () => platformTestDb();
  const nextIp = () => `203.0.113.${(ipCounter += 1)}`;
  const api = (target: NestExpressApplication = app) => request(target.getHttpServer());

  async function login(email: string, ip: string, target: NestExpressApplication = app): Promise<SupertestResponse> {
    const res = await api(target).post(LOGIN).set('X-Forwarded-For', ip).send({ identifier: email, password: PASSWORD });
    answers.push(res.body);
    return res;
  }

  async function step(body: Record<string, unknown>, ip: string, target: NestExpressApplication = app): Promise<SupertestResponse> {
    if (typeof body['code'] === 'string') totpCodes.add(body['code']);
    const res = await api(target).post(MFA_STEP).set('X-Forwarded-For', ip).send(body);
    answers.push(res.body);
    const cookie = refreshCookie(res);
    if (cookie) secrets.add(cookie);
    return res;
  }

  /** Signs in with the password and returns the challenge (asserting the challenge shape). */
  async function challengeFor(user: Fixture, ip: string): Promise<string> {
    const res = await login(user.email, ip);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    const challenge = res.body.challenge as string;
    secrets.add(challenge).add(sha256(challenge));
    return challenge;
  }

  async function createUser(options: { mfa?: boolean; role?: 'super_admin' | 'support' } = {}): Promise<Fixture> {
    const user = await createPlatformUserFixture({ role: options.role ?? 'super_admin', password: PASSWORD });
    fixtureIds.push(user.id);
    if (options.mfa === false) return { id: user.id, email: user.email, secret: '', recoveryCodes: [] };

    const secret = generateTotpSecret();
    const sealed = sealSecret(mfaKey, secret, user.id);
    await db().platformUser.update({ where: { id: user.id }, data: { mfaSecret: sealed, mfaEnabledAt: new Date() } });
    const recoveryCodes = generateRecoveryCodes();
    const hashes = recoveryCodes.map((code) => storedHash(user.id, code));
    await db().platformMfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
    for (const value of [secret, sealed, ...recoveryCodes, ...hashes]) secrets.add(value);
    return { id: user.id, email: user.email, secret, recoveryCodes };
  }

  const challengeRow = (challenge: string) =>
    db().platformMfaChallenge.findUniqueOrThrow({ where: { tokenHash: sha256(challenge) } });
  const account = (userId: string) =>
    db().platformUser.findUniqueOrThrow({
      where: { id: userId },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true, mfaLastStep: true },
    });
  const sessionsOf = (userId: string) => db().platformRefreshToken.count({ where: { userId } });

  /** Id of the newest platform event (UUIDv7 = insertion order), or null on an empty log. */
  async function mark(): Promise<string | null> {
    const latest = await db().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? null;
  }

  /** Every event naming one fixture account (as entity or actor) written after `markId`, oldest first. */
  const eventsSince = (markId: string | null, userId: string) =>
    db().platformAuditLog.findMany({
      where: { OR: [{ entityId: userId }, { actorPlatformUserId: userId }], ...(markId ? { id: { gt: markId } } : {}) },
      orderBy: { id: 'asc' },
      select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true, ipAddress: true },
    });
  const trail = async (markId: string | null, userId: string) =>
    (await eventsSince(markId, userId)).map((event) => [event.action, event.metadata]);

  beforeAll(async () => {
    app = await createPlatformTestApp();
    tokens = app.get(PlatformTokenService);
    lockoutThreshold = app.get(ConfigService<PlatformEnv, true>).get('PLATFORM_LOCKOUT_THRESHOLD');

    // The same application on a server WITHOUT the key: PlatformMfaCore sees no PLATFORM_MFA_ENCRYPTION_KEY.
    keyless = await createPlatformTestApp({
      configure: (builder) =>
        builder.overrideProvider(PlatformMfaCore).useFactory({
          factory: (prisma: InstanceType<typeof PlatformPrismaService>, platformTokens: InstanceType<typeof PlatformTokenService>) =>
            new PlatformMfaCore(prisma, platformTokens, { get: () => undefined } as unknown as ConfigService<PlatformEnv, true>),
          inject: [PlatformPrismaService, PlatformTokenService],
        }),
    });
    watermark = await mark();
  });

  afterAll(async () => {
    await app?.close();
    await keyless?.close();
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('the password step of an MFA account answers a challenge: no session, no cookie, no event, the failed-sign-in counter untouched (AC 1)', async () => {
    const user = await createUser();
    const ip = nextIp();
    await db().platformUser.update({ where: { id: user.id }, data: { failedLoginCount: 2 } });
    const m = await mark();

    const before = Date.now();
    const res = await login(user.email, ip);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challenge).toMatch(CHALLENGE_SHAPE);
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * MIN - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * MIN + 1000);
    expect(cookieLine(res)).toBe('');
    secrets.add(res.body.challenge).add(sha256(res.body.challenge));

    // Only the hash is stored, with no attempt yet.
    const row = await challengeRow(res.body.challenge);
    expect(row).toMatchObject({ userId: user.id, consumedAt: null, attempts: 0 });
    expect(await sessionsOf(user.id)).toBe(0);
    expect(await account(user.id)).toMatchObject({ failedLoginCount: 2, lastLoginAt: null });
    expect(await eventsSince(m, user.id)).toEqual([]);

    // A new password step retires the older challenge.
    const second = await challengeFor(user, ip);
    expect((await challengeRow(res.body.challenge)).consumedAt).not.toBeNull();
    const stale = await step({ challenge: res.body.challenge, code: codeAt(user.secret) }, ip);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('mfa_challenge_invalid');
    expect((await challengeRow(second)).consumedAt).toBeNull();
    expect(await eventsSince(m, user.id)).toEqual([]);
  });

  it('a wrong code costs one attempt and one failure; the right code opens the session (via mfa) and uses the challenge up (AC 1, 2)', async () => {
    const user = await createUser({ role: 'support' });
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    const m = await mark();

    const wrong = await step({ challenge, code: wrongCode(user.secret) }, ip);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ statusCode: 401, code: 'mfa_code_invalid' });
    expect(cookieLine(wrong)).toBe('');
    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, attempts: 1 });
    expect((await account(user.id)).failedLoginCount).toBe(1);

    const ok = await step({ challenge, code: codeAt(user.secret) }, ip);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(SESSION_KEYS);
    expect(ok.body.tokenType).toBe('Bearer');
    expect(ok.body.user).toEqual({ id: user.id, email: user.email, fullName: expect.any(String), role: 'support', status: 'active' });
    const line = cookieLine(ok);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Path=\/api\/auth/);
    expect(line).toMatch(/SameSite=Strict/i);
    // The platform cookie only — never the academy's.
    expect(setCookies(ok).some((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(false);
    const cookie = refreshCookie(ok)!;
    accessTokens.add(ok.body.accessToken);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    const refreshed = await api().post('/api/auth/refresh').set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${cookie}`).expect(200);
    secrets.add(refreshCookie(refreshed)!);
    accessTokens.add(refreshed.body.accessToken);

    expect((await challengeRow(challenge)).consumedAt).not.toBeNull();
    const after = await account(user.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.mfaLastStep).not.toBeNull();
    const family = await db().platformRefreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(cookie) }, select: { familyId: true } });

    const events = await eventsSince(m, user.id);
    expect(events.map((event) => [event.action, event.actorPlatformUserId, event.metadata])).toEqual([
      [FAILED, null, { reason: 'invalid_mfa_code', failedAttempts: 1, locked: false }],
      [SUCCEEDED, user.id, { via: 'mfa', familyId: family.familyId }],
    ]);
    expect(events.every((event) => event.ipAddress === ip && event.entityType === 'platform_users' && event.entityId === user.id)).toBe(true);

    // The challenge works once: the next code on it is refused without counting anything.
    const again = await step({ challenge, code: codeAt(user.secret, 1) }, ip);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('mfa_challenge_invalid');
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await eventsSince(m, user.id)).toHaveLength(2);
  });

  it('refuses a malformed, unknown, expired or foreign value with 401 mfa_challenge_invalid — nothing counted, nothing recorded (AC 2)', async () => {
    const user = await createUser();
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    // A live refresh token of the same account has the very shape of a challenge, and is none.
    const plain = await createUser({ mfa: false });
    const session = await login(plain.email, ip);
    expect(session.status).toBe(200);
    const liveRefresh = refreshCookie(session)!;
    secrets.add(liveRefresh);
    accessTokens.add(session.body.accessToken);
    const m = await mark();
    const refused = async (value: unknown) => {
      const res = await step({ challenge: value, code: codeAt(user.secret) }, ip);
      expect(res.status, String(value)).toBe(401);
      expect(res.body.code).toBe('mfa_challenge_invalid');
      expect(cookieLine(res)).toBe('');
    };

    await refused('not-a-challenge');
    await refused('');
    await refused(`${challenge}x`);
    await refused(randomBytes(32).toString('base64url'));
    await refused(liveRefresh);
    // Five minutes are over.
    await db().platformMfaChallenge.update({ where: { tokenHash: sha256(challenge) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await refused(challenge);

    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, attempts: 0 });
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await sessionsOf(user.id)).toBe(0);
    expect(await eventsSince(m, user.id)).toEqual([]);
    expect(await eventsSince(m, plain.id)).toEqual([]);
  });

  it('a challenge dies with a password change or when MFA is turned off; a suspended account gets 403 account_suspended — none of them counted or recorded', async () => {
    const ip = nextIp();
    const refusedWith = async (user: Fixture, challenge: string, status: number, code: string) => {
      const res = await step({ challenge, code: codeAt(user.secret) }, ip);
      expect(res.status, code).toBe(status);
      expect(res.body.code).toBe(code);
      expect(cookieLine(res)).toBe('');
      expect(await sessionsOf(user.id)).toBe(0);
      expect((await account(user.id)).failedLoginCount).toBe(0);
    };

    // The password changed after the challenge was issued: the challenge proved an old password.
    const changed = await createUser();
    const changedChallenge = await challengeFor(changed, ip);
    const m = await mark();
    await db().platformUser.update({ where: { id: changed.id }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
    await refusedWith(changed, changedChallenge, 401, 'mfa_challenge_invalid');
    expect(await challengeRow(changedChallenge)).toMatchObject({ attempts: 0 });

    // MFA turned off between the two steps (here straight in the database): the challenge is consumed.
    const off = await createUser();
    const offChallenge = await challengeFor(off, ip);
    await db().platformUser.update({ where: { id: off.id }, data: { mfaSecret: null, mfaEnabledAt: null } });
    await refusedWith(off, offChallenge, 401, 'mfa_challenge_invalid');
    expect(await challengeRow(offChallenge)).toMatchObject({ attempts: 0, consumedAt: expect.any(Date) });

    const suspended = await createUser();
    const suspendedChallenge = await challengeFor(suspended, ip);
    await db().platformUser.update({ where: { id: suspended.id }, data: { status: 'suspended' } });
    await refusedWith(suspended, suspendedChallenge, 403, 'account_suspended');
    // Nothing was counted against the suspended account, and its challenge is not spent.
    expect(await challengeRow(suspendedChallenge)).toMatchObject({ consumedAt: null, attempts: 0 });

    for (const user of [changed, off, suspended]) expect(await eventsSince(m, user.id)).toEqual([]);
  });

  it('needs exactly one factor: none or both are 400 mfa_factor_required before the challenge is read, and count nothing', async () => {
    const user = await createUser();
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    const m = await mark();
    const factorRequired = async (body: Record<string, unknown>) => {
      const res = await step(body, ip);
      expect(res.status, JSON.stringify(Object.keys(body))).toBe(400);
      expect(res.body.code).toBe('mfa_factor_required');
    };

    await factorRequired({ challenge });
    await factorRequired({ challenge, code: '', recoveryCode: '  ' });
    await factorRequired({ challenge, code: codeAt(user.secret), recoveryCode: user.recoveryCodes[0] });
    await factorRequired({ challenge: 'not-a-challenge' });
    // Validation answers the shape of the body (no code): a missing challenge, an unknown field.
    const missing = await step({ code: codeAt(user.secret) }, ip);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBeUndefined();
    expect((await step({ challenge, code: codeAt(user.secret), identifier: user.email }, ip)).status).toBe(400);

    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, attempts: 0 });
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await eventsSince(m, user.id)).toEqual([]);
  });

  it('accepts a TOTP code once: the same code on a fresh challenge is a wrong code (replay guard)', async () => {
    const user = await createUser();
    const ip = nextIp();
    const code = codeAt(user.secret);
    expect((await step({ challenge: await challengeFor(user, ip), code }, ip)).status).toBe(200);
    const stepAfter = (await account(user.id)).mfaLastStep;
    expect(stepAfter).not.toBeNull();

    const m = await mark();
    const next = await challengeFor(user, ip);
    const replay = await step({ challenge: next, code }, ip);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('mfa_code_invalid');
    expect(await challengeRow(next)).toMatchObject({ consumedAt: null, attempts: 1 });
    expect((await account(user.id)).mfaLastStep).toBe(stepAfter);
    expect(await trail(m, user.id)).toEqual([[FAILED, { reason: 'invalid_mfa_code', failedAttempts: 1, locked: false }]]);
    expect(await sessionsOf(user.id)).toBe(1);
  });

  it('a recovery code signs in once (via recovery_code, recoveryCodesLeft) and is refused the second time (AC 4)', async () => {
    const user = await createUser();
    const ip = nextIp();
    const m = await mark();
    // Case, dashes and spaces do not matter.
    const typed = ` ${user.recoveryCodes[0]!.toLowerCase().replace('-', ' ')} `;
    secrets.add(typed.trim());
    const ok = await step({ challenge: await challengeFor(user, ip), recoveryCode: typed }, ip);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(SESSION_KEYS);
    expect(refreshCookie(ok)).toBeDefined();
    const used = await db().platformMfaRecoveryCode.findUniqueOrThrow({ where: { codeHash: storedHash(user.id, user.recoveryCodes[0]!) } });
    expect(used.usedAt).not.toBeNull();
    const left = user.recoveryCodes.length - 1;
    expect(await db().platformMfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })).toBe(left);
    // A recovery code leaves the TOTP replay guard alone.
    expect((await account(user.id)).mfaLastStep).toBeNull();

    const next = await challengeFor(user, ip);
    const reused = await step({ challenge: next, recoveryCode: user.recoveryCodes[0] }, ip);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('mfa_code_invalid');
    // A string that is no recovery code at all is a wrong code too.
    const junk = await step({ challenge: next, recoveryCode: 'not a code' }, ip);
    expect(junk.status).toBe(401);
    expect(junk.body.code).toBe('mfa_code_invalid');
    expect(await challengeRow(next)).toMatchObject({ consumedAt: null, attempts: 2 });
    expect(await db().platformMfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })).toBe(left);

    const family = await db().platformRefreshToken.findFirstOrThrow({ where: { userId: user.id }, select: { familyId: true } });
    expect(await trail(m, user.id)).toEqual([
      [SUCCEEDED, { via: 'recovery_code', familyId: family.familyId, recoveryCodesLeft: left }],
      [FAILED, { reason: 'invalid_mfa_code', failedAttempts: 1, locked: false }],
      [FAILED, { reason: 'invalid_mfa_code', failedAttempts: 2, locked: false }],
    ]);
  });

  it('PLATFORM_LOCKOUT_THRESHOLD wrong codes over fresh challenges lock the account: the last answers 423, and so do the password and the open challenge (AC 3)', async () => {
    const user = await createUser();
    const ip = nextIp();
    const m = await mark();
    let last = '';
    for (let attempt = 1; attempt < lockoutThreshold; attempt += 1) {
      last = await challengeFor(user, ip);
      const res = await step({ challenge: last, code: wrongCode(user.secret) }, ip);
      expect(res.status, `attempt ${attempt}`).toBe(401);
      expect(res.body.code).toBe('mfa_code_invalid');
      // The password step never resets the counter of an MFA account.
      expect((await account(user.id)).failedLoginCount).toBe(attempt);
    }
    last = await challengeFor(user, ip);
    const locking = await step({ challenge: last, code: wrongCode(user.secret) }, ip);
    expect(locking.status).toBe(423);
    expect(locking.body.code).toBe('account_locked');
    expect(locking.body.retryAfterSeconds).toBeGreaterThan(0);
    const row = await account(user.id);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(row.failedLoginCount).toBe(0);

    // The right password gets no new challenge, and the open one no session even with the right code.
    const password = await login(user.email, ip);
    expect(password.status).toBe(423);
    expect(password.body.code).toBe('account_locked');
    const open = await step({ challenge: last, code: codeAt(user.secret) }, ip);
    expect(open.status).toBe(423);
    expect(open.body.code).toBe('account_locked');
    expect(await sessionsOf(user.id)).toBe(0);
    // The lock refusal spent nothing of the open challenge beyond its one wrong code.
    expect(await challengeRow(last)).toMatchObject({ consumedAt: null, attempts: 1 });

    const failures = Array.from({ length: lockoutThreshold - 1 }, (_, index) => [
      FAILED,
      { reason: 'invalid_mfa_code', failedAttempts: index + 1, locked: false },
    ]);
    expect(await trail(m, user.id)).toEqual([
      ...failures,
      [FAILED, { reason: 'invalid_mfa_code', failedAttempts: lockoutThreshold, locked: true }],
      [FAILED, { reason: 'locked' }],
      [FAILED, { reason: 'locked' }],
    ]);
    expect((await eventsSince(m, user.id)).every((event) => event.actorPlatformUserId === null)).toBe(true);
  });

  it('one challenge takes five wrong codes, then it is used up — the attempts column never passes 5 (AC 2, 3)', async () => {
    const user = await createUser();
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // Keep the ACCOUNT below its lockout so that the challenge's own cap shows.
      await db().platformUser.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
      const res = await step({ challenge, code: wrongCode(user.secret) }, ip);
      expect(res.status, `attempt ${attempt}`).toBe(401);
      expect(res.body.code).toBe('mfa_code_invalid');
      expect(await challengeRow(challenge)).toMatchObject({ attempts: attempt, consumedAt: attempt < 5 ? null : expect.any(Date) });
    }
    expect((await account(user.id)).lockedUntil).toBeNull();

    const late = await step({ challenge, code: codeAt(user.secret) }, ip);
    expect(late.status).toBe(401);
    expect(late.body.code).toBe('mfa_challenge_invalid');
    expect((await challengeRow(challenge)).attempts).toBe(5);
    expect(await sessionsOf(user.id)).toBe(0);
  });

  it('of two simultaneous right answers on one challenge exactly one opens a session', async () => {
    const user = await createUser();
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    const m = await mark();
    const code = codeAt(user.secret);
    const results = await Promise.all([step({ challenge, code }, ip), step({ challenge, code }, ip)]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(results.find((res) => res.status === 401)!.body.code).toBe('mfa_challenge_invalid');
    expect(await sessionsOf(user.id)).toBe(1);
    expect((await trail(m, user.id)).map(([action]) => action)).toEqual([SUCCEEDED]);
    expect((await account(user.id)).failedLoginCount).toBe(0);
  });

  it('an account without MFA signs in exactly as before (AC 5)', async () => {
    const user = await createUser({ mfa: false });
    const ip = nextIp();
    const m = await mark();
    const res = await login(user.email, ip);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    expect(res.body.tokenType).toBe('Bearer');
    const cookie = refreshCookie(res)!;
    secrets.add(cookie);
    accessTokens.add(res.body.accessToken);
    const family = await db().platformRefreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(cookie) }, select: { familyId: true } });
    expect(await trail(m, user.id)).toEqual([[SUCCEEDED, { via: 'password', familyId: family.familyId }]]);
    expect(await db().platformMfaChallenge.count({ where: { userId: user.id } })).toBe(0);
    // The server without the key signs it in all the same.
    const other = await login(user.email, ip, keyless);
    expect(other.status).toBe(200);
    secrets.add(refreshCookie(other)!);
    accessTokens.add(other.body.accessToken);
  });

  it('without the server key, or with a secret that does not open, an MFA account never gets a session: 503 mfa_unavailable, nothing spent', async () => {
    const user = await createUser();
    const ip = nextIp();
    const m = await mark();

    const denied = await login(user.email, ip, keyless);
    expect(denied.status).toBe(503);
    expect(denied.body.code).toBe('mfa_unavailable');
    expect(cookieLine(denied)).toBe('');
    expect(await db().platformMfaChallenge.count({ where: { userId: user.id } })).toBe(0);

    // A challenge issued by a server with the key cannot be finished on one without it — and is not spent.
    const challenge = await challengeFor(user, ip);
    const stepDenied = await step({ challenge, code: codeAt(user.secret) }, ip, keyless);
    expect(stepDenied.status).toBe(503);
    expect(stepDenied.body.code).toBe('mfa_unavailable');
    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, attempts: 0 });

    // A secret sealed under another key (a rotated or wrong key): the password step answers 503, and so
    // does a code on an open challenge — rolled back, so neither the challenge nor the account is touched.
    const stranger = await createUser();
    const otherKey = parseMfaKey(Buffer.alloc(32, 3).toString('base64'))!;
    const foreignSeal = sealSecret(otherKey, stranger.secret, stranger.id);
    secrets.add(foreignSeal);
    await db().platformUser.update({ where: { id: stranger.id }, data: { mfaSecret: foreignSeal } });
    const sealedOut = await login(stranger.email, ip);
    expect(sealedOut.status).toBe(503);
    expect(sealedOut.body.code).toBe('mfa_unavailable');
    expect(await db().platformMfaChallenge.count({ where: { userId: stranger.id } })).toBe(0);
    const planted = randomBytes(32).toString('base64url');
    secrets.add(planted).add(sha256(planted));
    await db().platformMfaChallenge.create({ data: { userId: stranger.id, tokenHash: sha256(planted), expiresAt: new Date(Date.now() + 5 * MIN) } });
    const unopened = await step({ challenge: planted, code: codeAt(stranger.secret) }, ip);
    expect(unopened.status).toBe(503);
    expect(unopened.body.code).toBe('mfa_unavailable');
    expect(await challengeRow(planted)).toMatchObject({ consumedAt: null, attempts: 0 });
    expect((await account(stranger.id)).failedLoginCount).toBe(0);

    expect(await eventsSince(m, user.id)).toEqual([]);
    expect(await eventsSince(m, stranger.id)).toEqual([]);
    expect(await sessionsOf(user.id)).toBe(0);
    expect(await sessionsOf(stranger.id)).toBe(0);
  });

  it('rate-limits the second step per (IP, challenge): 10 per 15 minutes (another challenge or another address is still served)', async () => {
    const ip = nextIp();
    for (let call = 1; call <= 10; call += 1) {
      const res = await step({ challenge: 'not-a-challenge', code: '123456' }, ip);
      expect(res.status, `call ${call}`).toBe(401);
    }
    const limited = await step({ challenge: 'not-a-challenge', code: '123456' }, ip);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    // Per (IP, challenge), like the academy: another challenge from the same address (a colleague behind the same NAT) is served.
    expect((await step({ challenge: 'another-challenge', code: '123456' }, ip)).status).toBe(401);
    expect((await step({ challenge: 'not-a-challenge', code: '123456' }, nextIp())).status).toBe(401);
  });

  it('no API-178/API-218 answer and no event carries a challenge, a code, a recovery code, the secret or a hash of them', async () => {
    const events = await db().platformAuditLog.findMany({
      where: { entityId: { in: fixtureIds }, ...(watermark ? { id: { gt: watermark } } : {}) },
      select: { action: true, metadata: true },
    });
    expect(events.length).toBeGreaterThan(15);
    expect(keysOf(events.map((event) => event.metadata)).filter((key) => /token|secret|challenge|hash|password|code$/i.test(key))).toEqual([]);

    const leaves = [...leavesOf(events.map((event) => event.metadata)), ...leavesOf(answers.filter((body) => !isChallengeAnswer(body)))];
    const long = [...secrets].filter((value) => value.length >= 10);
    expect(long.length).toBeGreaterThan(30);
    for (const leaf of leaves) {
      if (typeof leaf === 'string') {
        for (const value of long) expect(leaf.includes(value), `a handled secret reached ${JSON.stringify(leaf).slice(0, 40)}`).toBe(false);
        expect(totpCodes.has(leaf)).toBe(false);
      }
    }
    // The challenge answers carry their own challenge and nothing else secret.
    for (const body of answers.filter(isChallengeAnswer)) {
      const challenge = (body as { challenge: string }).challenge;
      for (const value of long) if (value !== challenge) expect(JSON.stringify(body).includes(value)).toBe(false);
    }
    // No event carries an access token either.
    const dump = JSON.stringify(events);
    expect(accessTokens.size).toBeGreaterThan(3);
    for (const token of accessTokens) expect(dump.includes(token)).toBe(false);
  });

  it(
    'documents both shapes of API-178 and the new API-218 in the platform OpenAPI document',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const oneOf = [{ $ref: '#/components/schemas/PlatformSessionResponseDto' }, { $ref: '#/components/schemas/PlatformMfaChallengeResponseDto' }];
      const loginOp = docs.body.paths[LOGIN].post;
      expect(loginOp.responses['200'].content['application/json'].schema).toEqual({ oneOf });
      expect(Object.keys(loginOp.responses)).toEqual(expect.arrayContaining(['200', '401', '403', '423', '429', '503']));

      const mfa = docs.body.paths[MFA_STEP].post;
      expect(mfa.tags).toEqual(['auth']);
      expect(mfa.security).toBeUndefined();
      expect(Object.keys(mfa.responses).sort()).toEqual(['200', '400', '401', '403', '423', '429', '503']);
      expect(mfa.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/PlatformSessionResponseDto' });
      expect(mfa.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/PlatformMfaLoginDto' });
      const body = docs.body.components.schemas.PlatformMfaLoginDto;
      expect(Object.keys(body.properties).sort()).toEqual(['challenge', 'code', 'recoveryCode']);
      expect(body.required).toEqual(['challenge']);
      const answer = docs.body.components.schemas.PlatformMfaChallengeResponseDto;
      expect(Object.keys(answer.properties).sort()).toEqual(CHALLENGE_KEYS);
      expect(answer.properties.mfaRequired).toMatchObject({ type: 'boolean' });
      expect(answer.properties.challenge).toMatchObject({ type: 'string' });
      expect(answer.properties.expiresAt).toMatchObject({ type: 'string', format: 'date-time' });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});

/** True for the body of a challenge answer (API-178 for an MFA account). */
function isChallengeAnswer(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { mfaRequired?: unknown }).mfaRequired === true;
}
