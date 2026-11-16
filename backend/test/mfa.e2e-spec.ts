// TEST-226 — MOD-01-H06 MFA-T02: the caller's own two-step verification
// (API-206 GET /api/auth/mfa, API-207 POST …/setup, API-208 POST …/enable,
// API-209 POST …/disable, API-210 POST …/recovery-codes) against the live
// development database. Skipped when no database is reachable.
//
// AC (roadmap §4n.3): the secret is shown once and stored sealed only; a used
// code is refused in its window; recovery codes are stored as hashes only;
// exactly one event per write and none on a refusal.
//
// A fixed TEST key is set before AppModule is imported (process variables beat
// the env files). The "no key" server is a second app of the same module tree
// whose MfaCore is built with a configuration that lacks the key: the
// validated configuration is fixed when app.module.ts is first evaluated
// (ConfigModule.forRoot runs at import), so deleting the variable before a
// second app would change nothing, and MfaCore is the only reader of the key.
// Fixture users carry a unique suffix and are deleted at the end (cascade
// removes their tokens and codes; their audit rows stay — the log is
// append-only). Events are counted by fixture user above an id watermark, so
// other clients of the shared dev DB never pollute the counts. Every sign-in
// happens while the user's MFA is off, so the suite does not depend on the
// two-step sign-in of MFA-T03.
import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { MfaCore } from '../src/auth/mfa/mfa-core.service.js';
import { deriveRecoveryCodeKey, hashRecoveryCode, normalizeRecoveryCode } from '../src/auth/mfa/recovery-codes.js';
import { base32Decode, totpCode, totpStep } from '../src/auth/mfa/totp.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import type { Env } from '../src/config/env.schema.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
/** A fixed TEST key (32 bytes) — never a real one. */
process.env['AUTH_MFA_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
/** The stored form of a recovery code: HMAC under a key derived from the MFA key, bound to the user. */
const RECOVERY_KEY = deriveRecoveryCodeKey(Buffer.alloc(32, 7));
const storedHashOf = (userId: string, code: string): string => hashRecoveryCode(RECOVERY_KEY, userId, normalizeRecoveryCode(code)!);

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const WRONG_PASSWORD = 'Not-The-Password-42';
const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';
const MFA = '/api/auth/mfa';
const SETUP = `${MFA}/setup`;
const ENABLE = `${MFA}/enable`;
const DISABLE = `${MFA}/disable`;
const REGENERATE = `${MFA}/recovery-codes`;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
const RECOVERY_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;
const STATUS_KEYS = ['available', 'enabled', 'enabledAt', 'pendingSetup', 'recoveryCodesLeft'];

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

/** The TOTP code of a Base32 secret at the current step + `offset`. */
function codeOf(secret: string, offset = 0): string {
  return totpCode(base32Decode(secret)!, totpStep(Date.now()) + offset);
}

/** Six digits that match no step from two before to two after the current one. */
function wrongCodeOf(secret: string): string {
  const near = new Set([-2, -1, 0, 1, 2].map((offset) => codeOf(secret, offset)));
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = String(digit).repeat(6);
    if (!near.has(candidate)) return candidate;
  }
  throw new Error('unreachable: five codes cannot cover ten candidates');
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface SignedIn {
  bearer: string;
  cookie: string;
}

interface Fixture {
  id: string;
  email: string;
}

describe.skipIf(!available)('MOD-01-H06 MFA-T02 my two-step verification (e2e, TEST-226)', () => {
  let app: NestExpressApplication;
  /** The same module tree without AUTH_MFA_ENCRYPTION_KEY (see the header). */
  let noKeyApp: NestExpressApplication;
  let prisma: PrismaClient;
  let tokens: TokenService;
  let passwordHash: string;
  let watermark = '00000000-0000-0000-0000-000000000000';
  const createdUserIds: string[] = [];
  /** Every answer of an MFA route, for the "shown once" checks at the end. */
  const answers: { route: string; body: unknown }[] = [];
  /** Plain values that must appear only where the AC allows it. */
  const secrets: { secret: string; shownIn: number }[] = [];
  const codeSets: { codes: string[]; shownIn: number }[] = [];

  const api = () => request(app.getHttpServer());
  const noKeyApi = () => request(noKeyApp.getHttpServer());
  const cookieHeader = (cookie: string) => `${REFRESH_COOKIE_NAME}=${cookie}`;

  // Journey state shared by the ordered tests below.
  const fx = {} as { a: Fixture; b: Fixture; c: Fixture };
  let a1: SignedIn;
  let a2: SignedIn;
  let b1: SignedIn;
  let bNoKey: SignedIn;
  let c1: SignedIn;
  let aSecret = '';
  let bSecret = '';
  let bEnableCode = '';
  let aEnabledCodes: string[] = [];
  let aCodes: string[] = [];
  /** The code that turned A's MFA on (for the replay check). */
  let enableCode = '';
  let noKeySetupCalls = 0;

  async function createUser(name: string): Promise<Fixture> {
    const user = await prisma.user.create({
      data: { email: `mfa-${name}-${RUN}@example.test`, fullName: `MFA ${name}`, passwordHash, status: 'active' },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email: user.email! };
  }

  async function signIn(server: () => ReturnType<typeof request>, email: string): Promise<SignedIn> {
    const res = await server().post(LOGIN).send({ identifier: email, password: PASSWORD }).expect(200);
    return { bearer: `Bearer ${res.body.accessToken}`, cookie: refreshCookie(res)! };
  }

  /** POST to an MFA route of `server` as `who` (with their refresh cookie), keeping the answer for the final checks. */
  async function post(server: () => ReturnType<typeof request>, route: string, who: SignedIn, body: object): Promise<SupertestResponse> {
    const res = await server().post(route).set('Authorization', who.bearer).set('Cookie', cookieHeader(who.cookie)).send(body);
    answers.push({ route, body: res.body });
    return res;
  }

  async function getStatus(server: () => ReturnType<typeof request>, who: SignedIn): Promise<Record<string, unknown>> {
    const res = await server().get(MFA).set('Authorization', who.bearer).expect(200);
    answers.push({ route: MFA, body: res.body });
    expect(Object.keys(res.body).sort()).toEqual(STATUS_KEYS);
    return res.body as Record<string, unknown>;
  }

  function expectError(res: SupertestResponse, status: number, code: string): void {
    expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  }

  const mfaRow = (userId: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true, mfaPendingSecret: true, mfaPendingAt: true, failedLoginCount: true, lockedUntil: true },
    });

  const codeRows = (userId: string) =>
    prisma.mfaRecoveryCode.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { codeHash: true, usedAt: true } });

  /** Id of the newest event (UUIDv7 = insertion order); the events of a step are those above it. */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  /** Events about or by `userId` above `markId`, oldest first. */
  const eventsSince = (markId: string, userId: string) =>
    prisma.auditLog.findMany({
      where: { id: { gt: markId }, OR: [{ actorUserId: userId }, { entityId: userId }] },
      orderBy: { id: 'asc' },
      select: { action: true, actorUserId: true, entityType: true, entityId: true, metadata: true },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();

    const noKeyRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MfaCore)
      .useFactory({
        factory: (db: PrismaService, tokenService: TokenService, config: ConfigService) =>
          new MfaCore(db, tokenService, {
            get: (key: string, options?: unknown) => (key === 'AUTH_MFA_ENCRYPTION_KEY' ? undefined : config.get(key, options as never)),
          } as unknown as ConfigService<Env, true>),
        inject: [PrismaService, TokenService, ConfigService],
      })
      .compile();
    noKeyApp = noKeyRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(noKeyApp);
    await noKeyApp.init();

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    tokens = app.get(TokenService);
    passwordHash = await new PasswordService().hash(PASSWORD);
    watermark = await mark();
    fx.a = await createUser('journey');
    fx.b = await createUser('code');
    fx.c = await createUser('never');
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma?.$disconnect();
    await noKeyApp?.close();
    await app?.close();
  });

  it('reports MFA off before anything happened; the GET is never rate-limited and records nothing', async () => {
    a1 = await signIn(api, fx.a.email);
    a2 = await signIn(api, fx.a.email);
    const m = await mark();
    expect(await getStatus(api, a1)).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });
    // 12 > the "login" throttler's 10 per 15 minutes (KI-082: @SkipThrottle({ login: true })).
    for (let call = 1; call <= 11; call += 1) {
      const res = await api().get(MFA).set('Authorization', a1.bearer);
      expect(res.status, `GET ${MFA} call ${call}`).toBe(200);
    }
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
  });

  it('needs a signed-in caller and an acceptable Origin', async () => {
    expectError(await api().get(MFA), 401, 'unauthenticated');
    expectError(await api().post(SETUP).send({ password: PASSWORD }), 401, 'unauthenticated');
    const foreign = await api().post(SETUP).set('Authorization', a1.bearer).set('Origin', 'https://evil.example').send({ password: PASSWORD });
    expectError(foreign, 403, 'origin_forbidden');
    expect((await mfaRow(fx.a.id)).mfaPendingSecret).toBeNull();
  });

  it('setup: a wrong password is 400 and writes nothing; the right one returns the secret once and stores it sealed only, without an event', async () => {
    const m = await mark();
    expectError(await post(api, SETUP, a1, { password: WRONG_PASSWORD }), 400, 'password_invalid');
    expect(await mfaRow(fx.a.id)).toMatchObject({ mfaPendingSecret: null, mfaPendingAt: null, failedLoginCount: 0, lockedUntil: null });

    const before = Date.now();
    const res = await post(api, SETUP, a1, { password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'otpauthUri', 'secret']);
    expect(res.headers['cache-control']).toBe('no-store');
    const secret = res.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    secrets.push({ secret, shownIn: answers.length - 1 });
    expect(res.body.otpauthUri).toMatch(new RegExp(`^otpauth://totp/[^:]+:${encodeURIComponent(fx.a.email)}\\?secret=${secret}&issuer=`));
    expect(res.body.otpauthUri).toContain('&algorithm=SHA1&digits=6&period=30');
    const expiresAt = new Date(res.body.expiresAt as string).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 50);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

    const row = await mfaRow(fx.a.id);
    expect(row.mfaPendingSecret).toMatch(SEALED);
    expect(row.mfaPendingSecret).not.toContain(secret);
    expect(row.mfaPendingAt).not.toBeNull();
    expect(row.mfaSecret).toBeNull();
    expect(await getStatus(api, a1)).toMatchObject({ enabled: false, pendingSetup: true, recoveryCodesLeft: null });
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
    aSecret = secret;
  });

  it('enable: a wrong code is 400 and a stale setup 409, both without a write or an event; a new setup replaces the old secret', async () => {
    const m = await mark();
    const sealedBefore = (await mfaRow(fx.a.id)).mfaPendingSecret;
    expectError(await post(api, ENABLE, a1, { code: wrongCodeOf(aSecret) }), 400, 'mfa_code_invalid');
    expect(await mfaRow(fx.a.id)).toMatchObject({ mfaSecret: null, mfaPendingSecret: sealedBefore, failedLoginCount: 0 });
    expect(await codeRows(fx.a.id)).toEqual([]);

    await prisma.user.update({ where: { id: fx.a.id }, data: { mfaPendingAt: new Date(Date.now() - 11 * 60 * 1000) } });
    expect(await getStatus(api, a1)).toMatchObject({ pendingSetup: false });
    expectError(await post(api, ENABLE, a1, { code: codeOf(aSecret) }), 409, 'mfa_setup_required');
    expect((await mfaRow(fx.a.id)).mfaSecret).toBeNull();

    const again = await post(api, SETUP, a1, { password: PASSWORD });
    expect(again.status).toBe(200);
    secrets.push({ secret: again.body.secret as string, shownIn: answers.length - 1 });
    expect(again.body.secret).not.toBe(aSecret);
    expect((await mfaRow(fx.a.id)).mfaPendingSecret).not.toBe(sealedBefore);
    // The first secret no longer opens anything: its code does not confirm the new setup.
    const stale = codeOf(aSecret);
    if (![-1, 0, 1].some((offset) => codeOf(again.body.secret as string, offset) === stale)) {
      expectError(await post(api, ENABLE, a1, { code: stale }), 400, 'mfa_code_invalid');
    }
    aSecret = again.body.secret as string;
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
  });

  it('enable with the right code: MFA on, ten recovery codes shown once and stored as hashes, the other session signed out and this one kept, one auth.mfa.enabled', async () => {
    const m = await mark();
    const pending = (await mfaRow(fx.a.id)).mfaPendingSecret;
    const before = Date.now();
    const step = totpStep(before);
    const code = totpCode(base32Decode(aSecret)!, step);
    const res = await post(api, ENABLE, a1, { code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['enabledAt', 'recoveryCodes', 'revokedSessions']);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.revokedSessions).toBe(1);
    const codes = res.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const recovery of codes) expect(recovery).toMatch(RECOVERY_CODE);
    codeSets.push({ codes, shownIn: answers.length - 1 });

    const row = await mfaRow(fx.a.id);
    expect(row.mfaSecret).toBe(pending); // the confirmed secret, still sealed
    expect(row.mfaSecret).toMatch(SEALED);
    expect(row.mfaSecret).not.toContain(aSecret);
    expect(row.mfaPendingSecret).toBeNull();
    expect(row.mfaPendingAt).toBeNull();
    expect(row.mfaEnabledAt!.toISOString()).toBe(res.body.enabledAt);
    expect(row.mfaEnabledAt!.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(Number(row.mfaLastStep)).toBe(step);

    const stored = await codeRows(fx.a.id);
    expect(stored).toHaveLength(10);
    const normalized = codes.map((recovery) => normalizeRecoveryCode(recovery)!);
    for (const { codeHash, usedAt } of stored) {
      expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(usedAt).toBeNull();
      expect(normalized).not.toContain(codeHash);
      expect(codes).not.toContain(codeHash);
    }
    // The stored form is the keyed hash of the normalized code bound to the user (HMAC, derived key), nothing else.
    expect(stored.map((row) => row.codeHash).sort()).toEqual(codes.map((recovery) => storedHashOf(fx.a.id, recovery)).sort());
    // Never the plain SHA-256 of a code (a dump of the table could be swept offline).
    for (const { codeHash } of stored) expect(normalized.map(sha256)).not.toContain(codeHash);

    // The other session ends; this device keeps refreshing.
    expectError(await api().post(REFRESH).set('Cookie', cookieHeader(a2.cookie)), 401, 'refresh_reused');
    const refreshed = await api().post(REFRESH).set('Cookie', cookieHeader(a1.cookie)).expect(200);
    a1 = { bearer: `Bearer ${refreshed.body.accessToken}`, cookie: refreshCookie(refreshed)! };

    expect(await eventsSince(m, fx.a.id)).toEqual([
      { action: 'auth.mfa.enabled', actorUserId: fx.a.id, entityType: 'users', entityId: fx.a.id, metadata: { revokedSessions: 1 } },
      { action: 'auth.refresh.reuse_detected', actorUserId: fx.a.id, entityType: 'users', entityId: fx.a.id, metadata: expect.any(Object) },
    ]);
    aEnabledCodes = codes;
    aCodes = codes;
    enableCode = code;
  });

  it('reports MFA on with ten codes left; setup and enable again are 409 mfa_already_enabled without a write', async () => {
    const status = await getStatus(api, a1);
    expect(status).toMatchObject({ available: true, enabled: true, recoveryCodesLeft: 10, pendingSetup: false });
    expect(status['enabledAt']).toBe((await mfaRow(fx.a.id)).mfaEnabledAt!.toISOString());

    const m = await mark();
    const rowBefore = await mfaRow(fx.a.id);
    expectError(await post(api, SETUP, a1, { password: PASSWORD }), 409, 'mfa_already_enabled');
    expectError(await post(api, ENABLE, a1, { code: codeOf(aSecret) }), 409, 'mfa_already_enabled');
    expect(await mfaRow(fx.a.id)).toEqual(rowBefore);
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
  });

  it('new recovery codes: the code that enabled is refused in its window, a wrong password or code too; a fresh code replaces every code, one event', async () => {
    const m = await mark();
    const lastStep = Number((await mfaRow(fx.a.id)).mfaLastStep);
    // Still inside the ±1 window: only the replay guard refuses it.
    expect(totpStep(Date.now()) - lastStep).toBeLessThanOrEqual(1);
    expectError(await post(api, REGENERATE, a1, { password: PASSWORD, code: enableCode }), 400, 'mfa_code_invalid');
    expectError(await post(api, REGENERATE, a1, { password: WRONG_PASSWORD, code: codeOf(aSecret, 1) }), 400, 'password_invalid');
    expectError(await post(api, REGENERATE, a1, { password: PASSWORD, code: wrongCodeOf(aSecret) }), 400, 'mfa_code_invalid');
    expect(Number((await mfaRow(fx.a.id)).mfaLastStep)).toBe(lastStep);
    expect((await codeRows(fx.a.id)).map((row) => row.codeHash).sort()).toEqual(aCodes.map((c) => storedHashOf(fx.a.id, c)).sort());
    expect(await eventsSince(m, fx.a.id)).toEqual([]);

    // The next step is inside the window too, and newer than the one that enabled.
    const res = await post(api, REGENERATE, a1, { password: PASSWORD, code: codeOf(aSecret, 1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body)).toEqual(['recoveryCodes']);
    expect(res.headers['cache-control']).toBe('no-store');
    const codes = res.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    for (const recovery of codes) expect(recovery).toMatch(RECOVERY_CODE);
    expect(codes.filter((recovery) => aEnabledCodes.includes(recovery))).toEqual([]);
    codeSets.push({ codes, shownIn: answers.length - 1 });

    const hashes = (await codeRows(fx.a.id)).map((row) => row.codeHash);
    expect(hashes.sort()).toEqual(codes.map((c) => storedHashOf(fx.a.id, c)).sort());
    for (const old of aEnabledCodes) expect(hashes).not.toContain(storedHashOf(fx.a.id, old));
    expect(Number((await mfaRow(fx.a.id)).mfaLastStep)).toBeGreaterThan(lastStep);
    expect(await getStatus(api, a1)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    expect(await eventsSince(m, fx.a.id)).toEqual([
      { action: 'auth.mfa.recovery_codes.regenerated', actorUserId: fx.a.id, entityType: 'users', entityId: fx.a.id, metadata: { count: 10 } },
    ]);
    aCodes = codes;
  });

  it('disable: one factor exactly, the password, an old or used recovery code are refused without a write; a fresh recovery code turns MFA off, signs the other session out, one event', async () => {
    // Another live session of A (as a sign-in would leave it), to be signed out.
    const extra = tokens.generateRefreshToken();
    await prisma.refreshToken.create({ data: { userId: fx.a.id, tokenHash: extra.hash, expiresAt: new Date(Date.now() + DAY_MS) } });
    // One code spent elsewhere (the two-step sign-in of MFA-T03 marks it so).
    const spent = aCodes[0]!;
    await prisma.mfaRecoveryCode.updateMany({
      where: { userId: fx.a.id, codeHash: storedHashOf(fx.a.id, spent) },
      data: { usedAt: new Date() },
    });

    const m = await mark();
    const rowBefore = await mfaRow(fx.a.id);
    const codesBefore = await codeRows(fx.a.id);
    expectError(await post(api, DISABLE, a1, { password: PASSWORD, code: codeOf(aSecret), recoveryCode: aCodes[1] }), 400, 'mfa_factor_required');
    expectError(await post(api, DISABLE, a1, { password: PASSWORD }), 400, 'mfa_factor_required');
    expectError(await post(api, DISABLE, a1, { password: WRONG_PASSWORD, recoveryCode: aCodes[1] }), 400, 'password_invalid');
    expectError(await post(api, DISABLE, a1, { password: PASSWORD, recoveryCode: aEnabledCodes[1] }), 400, 'mfa_code_invalid');
    expectError(await post(api, DISABLE, a1, { password: PASSWORD, recoveryCode: spent }), 400, 'mfa_code_invalid');
    expect(await mfaRow(fx.a.id)).toEqual(rowBefore);
    expect(await codeRows(fx.a.id)).toEqual(codesBefore);
    expect(await eventsSince(m, fx.a.id)).toEqual([]);

    // Case, spaces and the dash do not matter.
    const fresh = aCodes[1]!;
    const res = await post(api, DISABLE, a1, { password: PASSWORD, recoveryCode: ` ${fresh.toLowerCase().replace('-', ' ')} ` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ revokedSessions: 1 });

    expect(await mfaRow(fx.a.id)).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null });
    expect(await codeRows(fx.a.id)).toEqual([]);
    expect(await getStatus(api, a1)).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });
    expectError(await api().post(REFRESH).set('Cookie', cookieHeader(extra.token)), 401, 'refresh_reused');
    const refreshed = await api().post(REFRESH).set('Cookie', cookieHeader(a1.cookie)).expect(200);
    a1 = { bearer: `Bearer ${refreshed.body.accessToken}`, cookie: refreshCookie(refreshed)! };

    expect(await eventsSince(m, fx.a.id)).toEqual([
      { action: 'auth.mfa.disabled', actorUserId: fx.a.id, entityType: 'users', entityId: fx.a.id, metadata: { via: 'recovery_code', revokedSessions: 1 } },
      { action: 'auth.refresh.reuse_detected', actorUserId: fx.a.id, entityType: 'users', entityId: fx.a.id, metadata: expect.any(Object) },
    ]);
  });

  it('refuses enable without a setup (409 mfa_setup_required) and disable or new codes while MFA is off (409 mfa_not_enabled)', async () => {
    c1 = await signIn(api, fx.c.email);
    const m = await mark();
    expectError(await post(api, ENABLE, c1, { code: '123456' }), 409, 'mfa_setup_required');
    expectError(await post(api, DISABLE, c1, { password: PASSWORD, code: '123456' }), 409, 'mfa_not_enabled');
    expectError(await post(api, REGENERATE, c1, { password: PASSWORD, code: '123456' }), 409, 'mfa_not_enabled');
    expect(await mfaRow(fx.c.id)).toMatchObject({ mfaSecret: null, mfaPendingSecret: null, failedLoginCount: 0 });
    expect(await eventsSince(m, fx.c.id)).toEqual([]);
  });

  it('without AUTH_MFA_ENCRYPTION_KEY: the GET says available: false (also for an account with MFA on) and every write is 503 mfa_unavailable first', async () => {
    b1 = await signIn(api, fx.b.email);
    // Signed in on the no-key server while B's MFA is still off (its own JWT key in CI).
    bNoKey = await signIn(noKeyApi, fx.b.email);
    expect(await getStatus(noKeyApi, bNoKey)).toEqual({ available: false, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });

    const m = await mark();
    noKeySetupCalls += 2;
    expectError(await post(noKeyApi, SETUP, bNoKey, { password: PASSWORD }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, SETUP, bNoKey, { password: WRONG_PASSWORD }), 503, 'mfa_unavailable');
    expect((await mfaRow(fx.b.id)).mfaPendingSecret).toBeNull();

    // B turns MFA on with the keyed server (the no-key session is the "other" one and is signed out there).
    const setup = await post(api, SETUP, b1, { password: PASSWORD });
    expect(setup.status).toBe(200);
    bSecret = setup.body.secret as string;
    secrets.push({ secret: bSecret, shownIn: answers.length - 1 });
    bEnableCode = codeOf(bSecret);
    const enabled = await post(api, ENABLE, b1, { code: bEnableCode });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body.revokedSessions).toBe(1);
    codeSets.push({ codes: enabled.body.recoveryCodes as string[], shownIn: answers.length - 1 });

    // The no-key server still reads the state — and answers 503 before any other check.
    expect(await getStatus(noKeyApi, bNoKey)).toMatchObject({ available: false, enabled: true, recoveryCodesLeft: 10, pendingSetup: false });
    noKeySetupCalls += 1;
    expectError(await post(noKeyApi, SETUP, bNoKey, { password: PASSWORD }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, ENABLE, bNoKey, { code: codeOf(bSecret, 1) }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, DISABLE, bNoKey, { password: PASSWORD }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, DISABLE, bNoKey, { password: PASSWORD, code: codeOf(bSecret, 1) }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, REGENERATE, bNoKey, { password: PASSWORD, code: codeOf(bSecret, 1) }), 503, 'mfa_unavailable');
    expect(await codeRows(fx.b.id)).toHaveLength(10);

    const events = await eventsSince(m, fx.b.id);
    expect(events.map((event) => event.action)).toEqual(['auth.mfa.enabled']);
    expect(events[0]!.metadata).toEqual({ revokedSessions: 1 });
  });

  it('disable with a current code (via: code) on the keyed server; the code that enabled is refused (replay)', async () => {
    const m = await mark();
    const enabledStep = Number((await mfaRow(fx.b.id)).mfaLastStep);
    expect(totpStep(Date.now()) - enabledStep).toBeLessThanOrEqual(1);
    expectError(await post(api, DISABLE, b1, { password: PASSWORD, code: bEnableCode }), 400, 'mfa_code_invalid');
    expect(await mfaRow(fx.b.id)).toMatchObject({ mfaLastStep: BigInt(enabledStep) });
    expect(await codeRows(fx.b.id)).toHaveLength(10);
    expect(await eventsSince(m, fx.b.id)).toEqual([]);

    const res = await post(api, DISABLE, b1, { password: PASSWORD, code: codeOf(bSecret, 1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ revokedSessions: 0 });
    expect(await mfaRow(fx.b.id)).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null });
    expect(await codeRows(fx.b.id)).toEqual([]);
    expect(await eventsSince(m, fx.b.id)).toEqual([
      { action: 'auth.mfa.disabled', actorUserId: fx.b.id, entityType: 'users', entityId: fx.b.id, metadata: { via: 'code', revokedSessions: 0 } },
    ]);
  });

  it('rate-limits the writes like sign-in: 10 per 15 minutes, then 429 rate_limited', async () => {
    const statuses: number[] = [];
    for (let call = noKeySetupCalls + 1; call <= 11; call += 1) {
      const res = await noKeyApi().post(SETUP).set('Authorization', bNoKey.bearer).send({ password: PASSWORD });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.code).toBe('rate_limited');
    }
    expect(statuses).toEqual([...Array(10 - noKeySetupCalls).fill(503), 429]);
  });

  it('recorded exactly the successful writes for the fixtures, and no answer or event carries a secret or a recovery code where it must not', async () => {
    const actions = async (userId: string) => (await eventsSince(watermark, userId)).map((event) => event.action);
    expect(await actions(fx.a.id)).toEqual([
      'auth.login.succeeded',
      'auth.login.succeeded',
      'auth.mfa.enabled',
      'auth.refresh.reuse_detected',
      'auth.mfa.recovery_codes.regenerated',
      'auth.mfa.disabled',
      'auth.refresh.reuse_detected',
    ]);
    expect(await actions(fx.b.id)).toEqual(['auth.login.succeeded', 'auth.login.succeeded', 'auth.mfa.enabled', 'auth.mfa.disabled']);
    expect(await actions(fx.c.id)).toEqual(['auth.login.succeeded']);

    // Each secret is in its setup answer only; each set of recovery codes in its enable / regenerate answer only.
    const serialized = answers.map((answer) => JSON.stringify(answer.body));
    for (const { secret, shownIn } of secrets) {
      expect(serialized.flatMap((text, index) => (text.includes(secret) ? [index] : []))).toEqual([shownIn]);
    }
    for (const { codes, shownIn } of codeSets) {
      for (const recovery of codes) {
        const normalized = normalizeRecoveryCode(recovery)!;
        expect(serialized.flatMap((text, index) => (text.includes(recovery) || text.includes(normalized) ? [index] : []))).toEqual([shownIn]);
      }
    }

    // No event of the run carries a secret, a code (plain, normalized or hashed) or a sealed value; no metadata key names a token.
    const events = await prisma.auditLog.findMany({
      where: { id: { gt: watermark }, OR: createdUserIds.flatMap((id) => [{ actorUserId: id }, { entityId: id }]) },
      select: { metadata: true },
    });
    const metadata = JSON.stringify(events.map((event) => event.metadata));
    const forbidden = [
      ...secrets.map((entry) => entry.secret),
      ...codeSets.flatMap((entry) => entry.codes.flatMap((c) => [c, normalizeRecoveryCode(c)!, ...[fx.a, fx.b, fx.c].map((user) => storedHashOf(user.id, c))])),
    ];
    for (const value of forbidden) expect(metadata).not.toContain(value);
    expect(metadata).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);
    expect(metadata).not.toMatch(/token|secret|hash/i);
  });

  it(
    'documents the five routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const writeResponses = ['200', '400', '401', '403', '409', '429', '503'];
      expect(Object.keys(docs.body.paths[MFA])).toEqual(['get']);
      expect(Object.keys(docs.body.paths[MFA].get.responses).sort()).toEqual(['200', '401']);
      for (const route of [SETUP, ENABLE, DISABLE, REGENERATE]) {
        const operation = docs.body.paths[route];
        expect(Object.keys(operation), route).toEqual(['post']);
        expect(operation.post.tags, route).toEqual(['auth']);
        expect(operation.post.security, route).toEqual([{ bearer: [] }]);
        expect(Object.keys(operation.post.responses).sort(), route).toEqual(writeResponses);
      }
      expect(docs.body.paths[MFA].get.security).toEqual([{ bearer: [] }]);
      const status = docs.body.components.schemas.MfaStatusDto;
      expect(Object.keys(status.properties).sort()).toEqual(STATUS_KEYS);
      expect(status.properties.enabledAt).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
      expect(status.properties.recoveryCodesLeft).toMatchObject({ type: 'integer', nullable: true });
      expect(docs.body.components.schemas.MfaEnabledDto.properties.recoveryCodes).toMatchObject({ type: 'array', items: { type: 'string' } });
      expect(Object.keys(docs.body.components.schemas.MfaDisableRequestDto.properties).sort()).toEqual(['code', 'password', 'recoveryCode']);
      expect(docs.body.components.schemas.MfaDisableRequestDto.required).toEqual(['password']);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
