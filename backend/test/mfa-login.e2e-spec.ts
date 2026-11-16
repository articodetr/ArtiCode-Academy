// TEST-227 — MFA-T03 (MOD-01-H06, D-R109): the two-step sign-in against the
// live development database. API-005 `POST /api/auth/login` answers the
// challenge instead of a session for an account with MFA, API-211 `POST
// /api/auth/login/mfa` finishes it with a TOTP code or a recovery code, and
// API-020 (password-reset confirm) answers the challenge too. AC: (1) no
// session before the second factor; (2) the challenge is single-use and
// short-lived; (3) wrong codes lead to the lockout; (4) a recovery code is
// used once. MFA is turned on for the fixtures directly through Prisma (the
// enrolment routes are another task). Skipped when no database is reachable;
// fixture users carry a unique suffix and are deleted at the end (cascade
// removes their tokens, codes and challenges; their audit rows stay — the log
// is append-only). Events are counted by fixture actor above an id watermark,
// so other clients of the shared dev DB never pollute the counts.
import { createHash, randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { deriveRecoveryCodeKey, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../src/auth/mfa/recovery-codes.js';
import { parseMfaKey, sealSecret } from '../src/auth/mfa/secret-box.js';
import { base32Decode, generateTotpSecret, totpCode, totpStep } from '../src/auth/mfa/totp.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import type { Env } from '../src/config/env.schema.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
// A fixed TEST key (never a real one); process variables beat the env files.
const TEST_MFA_KEY = Buffer.alloc(32, 7).toString('base64');
process.env['AUTH_MFA_ENCRYPTION_KEY'] = TEST_MFA_KEY;
// The second step carries no identifier, so AuthThrottlerGuard counts it per IP
// (10 per 15 minutes). Trusting the loopback peer lets each scenario speak from
// its own documentation address (X-Forwarded-For), as clients behind a proxy do.
process.env['TRUST_PROXY'] = 'loopback';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MfaCore } = await import('../src/auth/mfa/mfa-core.service.js');
const { TokenService } = await import('../src/auth/token.service.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const LOGIN = '/api/auth/login';
const MFA_STEP = '/api/auth/login/mfa';
const CHALLENGE_KEYS = ['challenge', 'expiresAt', 'mfaRequired'];
const SESSION_KEYS = ['accessToken', 'expiresIn', 'tokenType', 'user'];
const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const MIN = 60 * 1000;

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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function setCookieLine(res: SupertestResponse): string {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
}

/** The refresh cookie value from a response, or undefined when cleared/absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = setCookieLine(res);
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
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

interface EventRow {
  action: string;
  metadata: unknown;
  ipAddress: string | null;
}

describe.skipIf(!available)('MFA-T03 two-step sign-in (e2e, TEST-227)', () => {
  let app: NestExpressApplication;
  let keyless: NestExpressApplication;
  let prisma: PrismaClient;
  let passwordHash: string;
  let watermark: string;
  const mfaKey = parseMfaKey(TEST_MFA_KEY)!;
  // The stored form of a recovery code: keyed (derived from the MFA key) and bound to the user.
  const recoveryKey = deriveRecoveryCodeKey(mfaKey);
  const storedHash = (userId: string, code: string) => hashRecoveryCode(recoveryKey, userId, normalizeRecoveryCode(code)!);
  const createdUserIds: string[] = [];
  /** Every challenge, code, recovery code, secret and hash this suite handled — none may reach an event or an API-211 answer. */
  const secrets = new Set<string>();
  const totpCodes = new Set<string>();
  /** The bodies API-211 answered. */
  const stepBodies: unknown[] = [];
  let ipCounter = 0;

  const nextIp = () => `203.0.113.${(ipCounter += 1)}`;
  const api = (target: NestExpressApplication = app) => request(target.getHttpServer());

  function login(email: string, ip: string, password = PASSWORD, target: NestExpressApplication = app) {
    return api(target).post(LOGIN).set('X-Forwarded-For', ip).send({ identifier: email, password });
  }

  async function step(body: Record<string, unknown>, ip: string, target: NestExpressApplication = app): Promise<SupertestResponse> {
    if (typeof body['code'] === 'string') totpCodes.add(body['code']);
    const res = await api(target).post(MFA_STEP).set('X-Forwarded-For', ip).send(body);
    stepBodies.push(res.body);
    return res;
  }

  /** Signs in with the password and returns the challenge (asserting the challenge shape). */
  async function challengeFor(user: Fixture, ip: string): Promise<string> {
    const res = await login(user.email, ip).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    const challenge = res.body.challenge as string;
    secrets.add(challenge);
    secrets.add(sha256(challenge));
    return challenge;
  }

  async function createUser(name: string, options: { mfa?: boolean } = {}): Promise<Fixture> {
    const user = await prisma.user.create({
      data: { email: `${name}-${RUN}@example.test`, fullName: `MFA ${name}`, passwordHash, status: 'active' },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    if (options.mfa === false) return { id: user.id, email: user.email!, secret: '', recoveryCodes: [] };

    const secret = generateTotpSecret();
    const sealed = sealSecret(mfaKey, secret, user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: sealed, mfaEnabledAt: new Date() } });
    const recoveryCodes = generateRecoveryCodes();
    const hashes = recoveryCodes.map((code) => storedHash(user.id, code));
    // created_at a minute back: `used_at >= created_at` (CHECK) holds whatever this clock says (the
    // server stamps `used_at` with the database clock).
    const createdAt = new Date(Date.now() - MIN);
    await prisma.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash, createdAt })) });
    for (const value of [secret, sealed, ...recoveryCodes, ...hashes]) secrets.add(value);
    return { id: user.id, email: user.email!, secret, recoveryCodes };
  }

  const challengeRow = (challenge: string) => prisma.verificationToken.findUniqueOrThrow({ where: { tokenHash: sha256(challenge) } });
  const account = (userId: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true, mfaLastStep: true },
    });

  /** Id of the newest event (UUIDv7 = insertion order). */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  /** The events of one fixture above a watermark, in order. */
  const eventsSince = (markId: string, userId: string): Promise<EventRow[]> =>
    prisma.auditLog.findMany({
      where: { id: { gt: markId }, actorUserId: userId },
      orderBy: { id: 'asc' },
      select: { action: true, metadata: true, ipAddress: true },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();

    // The same application on a server WITHOUT the key (D-R107): MfaCore sees no AUTH_MFA_ENCRYPTION_KEY.
    const keylessRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MfaCore)
      .useFactory({
        factory: (db: InstanceType<typeof PrismaService>, tokens: InstanceType<typeof TokenService>) =>
          new MfaCore(db, tokens, { get: () => undefined } as unknown as ConfigService<Env, true>),
        inject: [PrismaService, TokenService],
      })
      .compile();
    keyless = keylessRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(keyless);
    await keyless.init();

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwordHash = await new PasswordService().hash(PASSWORD);
    watermark = await mark();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma?.$disconnect();
    await app?.close();
    await keyless?.close();
  });

  it('the password step of an MFA account answers a challenge: no session, no cookie, no event, the failed-login counter untouched (AC 1)', async () => {
    const user = await createUser('challenge');
    const ip = nextIp();
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 2 } });
    const m = await mark();

    const before = Date.now();
    const res = await login(user.email, ip).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challenge).toMatch(CHALLENGE_SHAPE);
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * MIN - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * MIN + 1000);
    expect(setCookieLine(res)).toBe('');
    secrets.add(res.body.challenge).add(sha256(res.body.challenge));

    // Only the hash is stored, with no attempt yet.
    const row = await challengeRow(res.body.challenge);
    expect(row).toMatchObject({ userId: user.id, purpose: 'mfa_challenge', consumedAt: null, metadata: { attempts: 0 } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    expect((await account(user.id)).failedLoginCount).toBe(2);
    expect((await account(user.id)).lastLoginAt).toBeNull();
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
    const user = await createUser('code');
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    const m = await mark();

    const wrong = await step({ challenge, code: wrongCode(user.secret) }, ip);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ statusCode: 401, code: 'mfa_code_invalid' });
    expect(setCookieLine(wrong)).toBe('');
    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 1 } });
    expect((await account(user.id)).failedLoginCount).toBe(1);

    const code = codeAt(user.secret);
    const ok = await step({ challenge, code }, ip);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(SESSION_KEYS);
    expect(ok.body.user).toMatchObject({ id: user.id, email: user.email, status: 'active' });
    const line = setCookieLine(ok);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Path=\/api\/auth/);
    expect(line).toMatch(/SameSite=Strict/i);
    const cookie = refreshCookie(ok)!;
    await api().get('/api/auth/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    await api().post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`).expect(200);

    expect((await challengeRow(challenge)).consumedAt).not.toBeNull();
    const after = await account(user.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.mfaLastStep).not.toBeNull();
    const family = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: { familyId: true } });

    const events = await eventsSince(m, user.id);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 1, locked: false }],
      ['auth.login.succeeded', { familyId: family.familyId, via: 'mfa' }],
    ]);
    expect(events.every((event) => event.ipAddress === ip)).toBe(true);

    // The challenge works once: the next code on it is refused without counting anything.
    const again = await step({ challenge, code: codeAt(user.secret, 1) }, ip);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('mfa_challenge_invalid');
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await eventsSince(m, user.id)).toHaveLength(2);
  });

  it('refuses a malformed, unknown, expired or foreign challenge with 401 mfa_challenge_invalid — nothing counted, nothing recorded (AC 2)', async () => {
    const user = await createUser('refused');
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    const m = await mark();
    const refused = async (value: unknown) => {
      const res = await step({ challenge: value, code: codeAt(user.secret) }, ip);
      expect(res.status, String(value)).toBe(401);
      expect(res.body.code).toBe('mfa_challenge_invalid');
      expect(setCookieLine(res)).toBe('');
    };

    await refused('not-a-challenge');
    await refused('');
    await refused(`${challenge}x`);
    await refused(randomBytes(32).toString('base64url'));
    // A live token of another purpose with the same shape is no challenge.
    const reset = randomBytes(32).toString('base64url');
    secrets.add(reset);
    await prisma.verificationToken.create({
      data: { userId: user.id, purpose: 'password_reset', tokenHash: sha256(reset), expiresAt: new Date(Date.now() + 30 * MIN), metadata: { via: 'admin', issuedBy: null } },
    });
    await refused(reset);
    // Five minutes are over.
    await prisma.verificationToken.update({ where: { tokenHash: sha256(challenge) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await refused(challenge);

    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 0 } });
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await eventsSince(m, user.id)).toEqual([]);
  });

  it('a challenge dies with a password change, when MFA is turned off or the account is archived; a suspended account gets its status code', async () => {
    const ip = nextIp();
    const refusedWith = async (user: Fixture, challenge: string, status: number, code: string) => {
      const res = await step({ challenge, code: codeAt(user.secret) }, ip);
      expect(res.status, code).toBe(status);
      expect(res.body.code).toBe(code);
      expect(setCookieLine(res)).toBe('');
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    };

    // The password changed after the challenge was issued: the challenge proved an old password.
    const changed = await createUser('pw-changed');
    const changedChallenge = await challengeFor(changed, ip);
    await prisma.user.update({ where: { id: changed.id }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
    await refusedWith(changed, changedChallenge, 401, 'mfa_challenge_invalid');

    // MFA turned off between the two steps (here straight in the database): the challenge is consumed.
    const off = await createUser('mfa-off');
    const offChallenge = await challengeFor(off, ip);
    const code = codeAt(off.secret);
    await prisma.user.update({ where: { id: off.id }, data: { mfaSecret: null, mfaEnabledAt: null } });
    const offRes = await step({ challenge: offChallenge, code }, ip);
    expect(offRes.status).toBe(401);
    expect(offRes.body.code).toBe('mfa_challenge_invalid');
    expect((await challengeRow(offChallenge)).consumedAt).not.toBeNull();

    const archived = await createUser('archived');
    const archivedChallenge = await challengeFor(archived, ip);
    await prisma.user.update({ where: { id: archived.id }, data: { status: 'archived' } });
    await refusedWith(archived, archivedChallenge, 401, 'mfa_challenge_invalid');

    const suspended = await createUser('suspended');
    const suspendedChallenge = await challengeFor(suspended, ip);
    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'suspended' } });
    await refusedWith(suspended, suspendedChallenge, 403, 'account_suspended');
    // Nothing was counted against the suspended account.
    expect(await challengeRow(suspendedChallenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 0 } });
  });

  it('needs exactly one factor: none or both are 400 mfa_factor_required before the challenge is read, and count nothing', async () => {
    const user = await createUser('factor');
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
    expect((await step({ challenge, code: codeAt(user.secret), remember: true }, ip)).status).toBe(400);

    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 0 } });
    expect((await account(user.id)).failedLoginCount).toBe(0);
    expect(await eventsSince(m, user.id)).toEqual([]);
  });

  it('accepts a TOTP code once: the same code on a fresh challenge is a wrong code (replay guard)', async () => {
    const user = await createUser('replay');
    const ip = nextIp();
    const code = codeAt(user.secret);
    expect((await step({ challenge: await challengeFor(user, ip), code }, ip)).status).toBe(200);
    const stepAfter = (await account(user.id)).mfaLastStep;

    const m = await mark();
    const next = await challengeFor(user, ip);
    const replay = await step({ challenge: next, code }, ip);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('mfa_code_invalid');
    expect(await challengeRow(next)).toMatchObject({ consumedAt: null, metadata: { attempts: 1 } });
    expect((await account(user.id)).mfaLastStep).toBe(stepAfter);
    expect((await eventsSince(m, user.id)).map((event) => [event.action, event.metadata])).toEqual([
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 1, locked: false }],
    ]);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('a recovery code signs in once (via recovery_code, recoveryCodesLeft 9) and is refused the second time (AC 4)', async () => {
    const user = await createUser('recovery');
    const ip = nextIp();
    const m = await mark();
    // Case, dashes and spaces do not matter.
    const typed = ` ${user.recoveryCodes[0]!.toLowerCase().replace('-', ' ')} `;
    secrets.add(typed.trim());
    const ok = await step({ challenge: await challengeFor(user, ip), recoveryCode: typed }, ip);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(SESSION_KEYS);
    expect(refreshCookie(ok)).toBeDefined();
    const used = await prisma.mfaRecoveryCode.findUniqueOrThrow({ where: { codeHash: storedHash(user.id, user.recoveryCodes[0]!) } });
    expect(used.usedAt).not.toBeNull();
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })).toBe(9);
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
    expect(await challengeRow(next)).toMatchObject({ consumedAt: null, metadata: { attempts: 2 } });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })).toBe(9);

    const family = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id }, select: { familyId: true } });
    expect((await eventsSince(m, user.id)).map((event) => [event.action, event.metadata])).toEqual([
      ['auth.login.succeeded', { familyId: family.familyId, via: 'recovery_code', recoveryCodesLeft: 9 }],
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 1, locked: false }],
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 2, locked: false }],
    ]);
  });

  it('five wrong codes over fresh challenges lock the account: the fifth answers 423, and so do the password and the open challenge (AC 3)', async () => {
    const user = await createUser('lockout');
    const ip = nextIp();
    const m = await mark();
    let last = '';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
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
    const password = await login(user.email, ip).expect(423);
    expect(password.body.code).toBe('account_locked');
    const open = await step({ challenge: last, code: codeAt(user.secret) }, ip);
    expect(open.status).toBe(423);
    expect(open.body.code).toBe('account_locked');
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);

    expect((await eventsSince(m, user.id)).map((event) => [event.action, event.metadata])).toEqual([
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 1, locked: false }],
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 2, locked: false }],
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 3, locked: false }],
      ['auth.login.failed', { stage: 'mfa', failedAttempts: 4, locked: false }],
      ['auth.login.locked', { stage: 'mfa', failedAttempts: 5, locked: true }],
      ['auth.login.locked', null],
      ['auth.login.locked', { stage: 'mfa' }],
    ]);
  });

  it('one challenge takes five wrong codes, then it is used up (AC 2, 3)', async () => {
    const user = await createUser('cap');
    const ip = nextIp();
    const challenge = await challengeFor(user, ip);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await step({ challenge, code: wrongCode(user.secret) }, ip);
      expect(res.status, `attempt ${attempt}`).toBe(401);
      expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: attempt } });
    }
    // Keep the ACCOUNT below its lockout so that the fifth attempt shows the challenge's own cap.
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    const fifth = await step({ challenge, code: wrongCode(user.secret) }, ip);
    expect(fifth.status).toBe(401);
    expect(fifth.body.code).toBe('mfa_code_invalid');
    const row = await challengeRow(challenge);
    expect(row.consumedAt).not.toBeNull();
    expect(row.metadata).toEqual({ attempts: 5 });
    expect((await account(user.id)).lockedUntil).toBeNull();

    const late = await step({ challenge, code: codeAt(user.secret) }, ip);
    expect(late.status).toBe(401);
    expect(late.body.code).toBe('mfa_challenge_invalid');
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('an account without MFA signs in exactly as before', async () => {
    const user = await createUser('plain', { mfa: false });
    const ip = nextIp();
    const m = await mark();
    const res = await login(user.email, ip).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    expect(res.body.tokenType).toBe('Bearer');
    expect(refreshCookie(res)).toBeDefined();
    const events = await eventsSince(m, user.id);
    expect(events.map((event) => event.action)).toEqual(['auth.login.succeeded']);
    expect(Object.keys(events[0]!.metadata as object)).toEqual(['familyId']);
    expect(await prisma.verificationToken.count({ where: { userId: user.id, purpose: 'mfa_challenge' } })).toBe(0);
    // The server without the key signs it in all the same.
    await login(user.email, ip, PASSWORD, keyless).expect(200);
  });

  it('a confirmed password reset of an MFA account answers the challenge; API-211 then opens the session', async () => {
    const user = await createUser('reset');
    const ip = nextIp();
    // A running session first (with a recovery code, so the TOTP replay guard stays untouched).
    const first = await step({ challenge: await challengeFor(user, ip), recoveryCode: user.recoveryCodes[1] }, ip);
    expect(first.status).toBe(200);
    const oldCookie = refreshCookie(first)!;

    const token = randomBytes(32).toString('base64url');
    secrets.add(token);
    const reset = await prisma.verificationToken.create({
      data: { userId: user.id, purpose: 'password_reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * MIN), metadata: { via: 'admin', issuedBy: null } },
      select: { id: true },
    });
    const newPassword = `Reset-With-Mfa-${RUN}`;
    const m = await mark();
    const res = await api().post(`/api/account/password-reset/${token}/confirm`).set('X-Forwarded-For', ip).send({ newPassword }).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challenge).toMatch(CHALLENGE_SHAPE);
    expect(setCookieLine(res)).toBe('');
    secrets.add(res.body.challenge).add(sha256(res.body.challenge));

    // The reset itself happened: new password, every session revoked (the old cookie's family too), the event — and no login yet.
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { tokenHash: sha256(oldCookie), revokedAt: { not: null } } })).toBe(1);
    const afterReset = await eventsSince(m, user.id);
    expect(afterReset.map((event) => [event.action, event.metadata])).toEqual([['auth.password.reset', { resetId: reset.id, revokedSessions: 1 }]]);

    const ok = await step({ challenge: res.body.challenge, code: codeAt(user.secret) }, ip);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: user.id, mustChangePassword: false });
    expect(refreshCookie(ok)).toBeDefined();
    const family = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id, revokedAt: null }, select: { familyId: true } });
    expect((await eventsSince(m, user.id)).map((event) => [event.action, event.metadata])).toEqual([
      ['auth.password.reset', { resetId: reset.id, revokedSessions: 1 }],
      ['auth.login.succeeded', { familyId: family.familyId, via: 'mfa' }],
    ]);
    // The new password is the one the password step takes now.
    const again = await login(user.email, ip, newPassword).expect(200);
    expect(again.body.mfaRequired).toBe(true);
    secrets.add(again.body.challenge).add(sha256(again.body.challenge));
  });

  it('without the server key an MFA account never gets a session: login and API-211 answer 503; a reset is done, then 503 (D-R107)', async () => {
    const user = await createUser('keyless');
    const ip = nextIp();
    const m = await mark();

    const denied = await login(user.email, ip, PASSWORD, keyless).expect(503);
    expect(denied.body.code).toBe('mfa_unavailable');
    expect(setCookieLine(denied)).toBe('');
    expect(await prisma.verificationToken.count({ where: { userId: user.id, purpose: 'mfa_challenge' } })).toBe(0);

    // A challenge issued by a server with the key cannot be finished on one without it — and is not spent.
    const challenge = await challengeFor(user, ip);
    const stepDenied = await step({ challenge, code: codeAt(user.secret) }, ip, keyless);
    expect(stepDenied.status).toBe(503);
    expect(stepDenied.body.code).toBe('mfa_unavailable');
    expect(await challengeRow(challenge)).toMatchObject({ consumedAt: null, metadata: { attempts: 0 } });

    // The reset is the person's real intent: it is done, and only the session is refused.
    const token = randomBytes(32).toString('base64url');
    secrets.add(token);
    await prisma.verificationToken.create({
      data: { userId: user.id, purpose: 'password_reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * MIN), metadata: { via: 'admin', issuedBy: null } },
    });
    const newPassword = `Keyless-Reset-${RUN}`;
    const reset = await api(keyless).post(`/api/account/password-reset/${token}/confirm`).set('X-Forwarded-For', ip).send({ newPassword }).expect(503);
    expect(reset.body.code).toBe('mfa_unavailable');
    expect(setCookieLine(reset)).toBe('');
    expect((await prisma.verificationToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } })).consumedAt).not.toBeNull();
    const after = await login(user.email, ip, newPassword).expect(200);
    expect(after.body.mfaRequired).toBe(true);
    secrets.add(after.body.challenge).add(sha256(after.body.challenge));

    expect((await eventsSince(m, user.id)).map((event) => event.action)).toEqual(['auth.password.reset']);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rate-limits the second step per (IP, challenge): 10 per 15 minutes', async () => {
    const ip = nextIp();
    for (let call = 1; call <= 10; call += 1) {
      const res = await step({ challenge: 'not-a-challenge', code: '123456' }, ip);
      expect(res.status, `call ${call}`).toBe(401);
    }
    const limited = await step({ challenge: 'not-a-challenge', code: '123456' }, ip);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    // Another address, and another challenge from the same address (a colleague behind the same NAT), are still served.
    expect((await step({ challenge: 'not-a-challenge', code: '123456' }, nextIp())).status).toBe(401);
    expect((await step({ challenge: 'another-challenge', code: '123456' }, ip)).status).toBe(401);
  });

  it('no API-211 answer and no event carries a challenge, a code, a recovery code, the secret or a hash of them', async () => {
    const events = await prisma.auditLog.findMany({
      where: { id: { gt: watermark }, actorUserId: { in: createdUserIds } },
      select: { action: true, metadata: true },
    });
    expect(events.length).toBeGreaterThan(20);
    expect(keysOf(events.map((event) => event.metadata)).filter((key) => /token|secret|challenge|hash|password/i.test(key))).toEqual([]);

    const leaves = [...leavesOf(events.map((event) => event.metadata)), ...leavesOf(stepBodies)];
    const long = [...secrets].filter((value) => value.length >= 10);
    expect(long.length).toBeGreaterThan(30);
    for (const leaf of leaves) {
      if (typeof leaf === 'string') {
        for (const value of long) expect(leaf.includes(value), `a handled secret reached ${JSON.stringify(leaf).slice(0, 40)}`).toBe(false);
        expect(totpCodes.has(leaf)).toBe(false);
      }
    }
  });

  it(
    'documents both shapes of API-005 and API-020 and the new API-211 in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const oneOf = [{ $ref: '#/components/schemas/SessionResponseDto' }, { $ref: '#/components/schemas/MfaChallengeResponseDto' }];
      expect(docs.body.paths[LOGIN].post.responses['200'].content['application/json'].schema).toEqual({ oneOf });
      const confirm = docs.body.paths['/api/account/password-reset/{token}/confirm'].post;
      expect(confirm.responses['200'].content['application/json'].schema).toEqual({ oneOf });
      expect(Object.keys(confirm.responses)).toContain('503');

      const mfa = docs.body.paths[MFA_STEP].post;
      expect(mfa.tags).toEqual(['auth']);
      expect(mfa.security).toBeUndefined();
      expect(Object.keys(mfa.responses).sort()).toEqual(['200', '400', '401', '403', '423', '429', '503']);
      expect(mfa.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/SessionResponseDto' });
      const body = docs.body.components.schemas.MfaLoginDto;
      expect(Object.keys(body.properties).sort()).toEqual(['challenge', 'code', 'recoveryCode']);
      expect(body.required).toEqual(['challenge']);
      const answer = docs.body.components.schemas.MfaChallengeResponseDto;
      expect(Object.keys(answer.properties).sort()).toEqual(CHALLENGE_KEYS);
      expect(answer.properties.mfaRequired).toMatchObject({ type: 'boolean' });
      expect(answer.properties.expiresAt).toMatchObject({ type: 'string', format: 'date-time' });
      expect(Object.keys(docs.body.paths[LOGIN].post.responses)).toEqual(expect.arrayContaining(['423', '503']));
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
