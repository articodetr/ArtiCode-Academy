// TEST-232 (e2e) — PMFA-T02 (roadmap §4o, D-R113..D-R120): the platform
// user's own two-step verification (API-213 GET /api/auth/mfa, API-214 POST
// …/setup, API-215 POST …/enable, API-216 POST …/disable, API-217 POST
// …/recovery-codes) — the academy TEST-226 (test/mfa.e2e-spec.ts) on the
// platform's accounts, `platform_refresh_tokens` and the `pla_refresh` cookie.
//
// AC: the secret is shown once and stored sealed only; a used code is refused
// in its window; recovery codes are stored as keyed hashes only; exactly one
// platform event per write and none on a refusal; a wrong password or code
// never touches the sign-in lockout.
//
// A fixed TEST key (different from the academy suites' key) is set before the
// platform app module is imported — through ./helpers.js, which imports it —
// because ConfigModule.forRoot validates the configuration when
// platform-app.module.ts is first evaluated (process variables beat the env
// files). The "no key" server is a second app of the same module tree whose
// PlatformMfaCore is built with a configuration that lacks the key (the core
// is the only reader of PLATFORM_MFA_ENCRYPTION_KEY).
//
// Skipped when the platform database is unreachable (./helpers.ts). Fixture
// accounts are deleted in afterAll (their tokens, recovery codes and
// challenges cascade; the actor of their append-only audit rows becomes NULL).
// Events are counted above an id watermark and by the fixture account they
// name, so other clients of the shared dev platform DB never pollute the
// counts. Every sign-in happens while the account's MFA is off, so the suite
// does not depend on the two-step sign-in of PMFA-T03.
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveRecoveryCodeKey, hashRecoveryCode, normalizeRecoveryCode } from '../../src/auth/mfa/recovery-codes.js';
import { base32Decode, totpCode, totpStep } from '../../src/auth/mfa/totp.js';
import type { PlatformEnv } from '../../src/platform/platform.env.schema.js';
// Type-only (erased): ./helpers.js itself is imported below, after the key is set.
import type { PlatformUserFixture as Fixture } from './helpers.js';

/** A fixed TEST key (32 bytes) — never a real one, and not the academy suites' `Buffer.alloc(32, 7)`. */
const TEST_KEY = Buffer.alloc(32, 9);
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = TEST_KEY.toString('base64');
/** The stored form of a recovery code: HMAC under a key derived from the platform MFA key, bound to the user. */
const RECOVERY_KEY = deriveRecoveryCodeKey(TEST_KEY);
const storedHashOf = (userId: string, code: string): string => hashRecoveryCode(RECOVERY_KEY, userId, normalizeRecoveryCode(code)!);

const {
  PLATFORM_TEST_ORIGIN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformAccessTokenFor,
  platformDbReachable,
  platformTestDb,
} = await import('./helpers.js');
const { PLATFORM_REFRESH_COOKIE_NAME } = await import('../../src/platform/auth/platform-cookies.js');
const { PlatformMfaCore } = await import('../../src/platform/auth/mfa/platform-mfa-core.service.js');
const { PlatformTokenService } = await import('../../src/platform/auth/platform-token.service.js');
const { PlatformPrismaService } = await import('../../src/platform/prisma/platform-prisma.service.js');

const available = await platformDbReachable();

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const WRONG_PASSWORD = 'Not-The-Platform-Password-42';
const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';
const MFA = '/api/auth/mfa';
const SETUP = `${MFA}/setup`;
const ENABLE = `${MFA}/enable`;
const DISABLE = `${MFA}/disable`;
const REGENERATE = `${MFA}/recovery-codes`;
const EVENTS = {
  login: 'platform.auth.login.succeeded',
  enabled: 'platform.auth.mfa.enabled',
  disabled: 'platform.auth.mfa.disabled',
  regenerated: 'platform.auth.mfa.recovery_codes.regenerated',
};
const DAY_MS = 24 * 60 * 60 * 1000;
const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
const RECOVERY_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;
const STATUS_KEYS = ['available', 'enabled', 'enabledAt', 'pendingSetup', 'recoveryCodesLeft'];
const OFF = { available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false };

/** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = cookies.find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
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

/** Every object key in a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

interface SignedIn {
  bearer: string;
  cookie: string;
}

type Server = () => ReturnType<typeof request>;

describe.skipIf(!available)('PMFA-T02 my platform two-step verification — API-213..217 (e2e, TEST-232)', () => {
  let app: NestExpressApplication;
  /** The same module tree without PLATFORM_MFA_ENCRYPTION_KEY (see the header). */
  let noKeyApp: NestExpressApplication;
  let watermark: string | null = null;
  const fixtureIds: string[] = [];
  /** Every answer of an MFA route, for the "shown once" checks at the end. */
  const answers: { route: string; body: unknown }[] = [];
  /** Plain values that must appear only where the AC allows it. */
  const secrets: { secret: string; shownIn: number }[] = [];
  const codeSets: { codes: string[]; shownIn: number }[] = [];
  /** Passwords, access tokens and cookies of the run — never in an audit row. */
  const credentials: string[] = [PASSWORD, WRONG_PASSWORD];

  const api: Server = () => request(app.getHttpServer());
  const noKeyApi: Server = () => request(noKeyApp.getHttpServer());
  const cookieHeader = (cookie: string) => `${PLATFORM_REFRESH_COOKIE_NAME}=${cookie}`;

  // Journey state shared by the ordered tests below.
  const fx = {} as { a: Fixture; b: Fixture; c: Fixture; suspended: Fixture };
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

  async function fixture(role: 'super_admin' | 'support', status: 'active' | 'suspended' = 'active'): Promise<Fixture> {
    const user = await createPlatformUserFixture({ role, status, password: PASSWORD });
    fixtureIds.push(user.id);
    return user;
  }

  /** Signs in through API-178 (MFA is off for the account) and keeps the bearer and the `pla_refresh` cookie. */
  async function signIn(server: Server, user: Fixture): Promise<SignedIn> {
    const res = await server().post(LOGIN).set('Origin', PLATFORM_TEST_ORIGIN).send({ identifier: user.email, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cookie = refreshCookie(res)!;
    credentials.push(res.body.accessToken as string, cookie);
    return { bearer: `Bearer ${res.body.accessToken}`, cookie };
  }

  async function refreshOf(who: SignedIn): Promise<SignedIn> {
    const res = await api().post(REFRESH).set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', cookieHeader(who.cookie)).expect(200);
    const cookie = refreshCookie(res)!;
    credentials.push(res.body.accessToken as string, cookie);
    return { bearer: `Bearer ${res.body.accessToken}`, cookie };
  }

  /** POST to an MFA route of `server` as `who` (with their refresh cookie), keeping the answer for the final checks. */
  async function post(server: Server, route: string, who: SignedIn, body: object): Promise<SupertestResponse> {
    const res = await server()
      .post(route)
      .set('Origin', PLATFORM_TEST_ORIGIN)
      .set('Authorization', who.bearer)
      .set('Cookie', cookieHeader(who.cookie))
      .send(body);
    answers.push({ route, body: res.body });
    return res;
  }

  async function getStatus(server: Server, who: SignedIn): Promise<Record<string, unknown>> {
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
    platformTestDb().platformUser.findUniqueOrThrow({
      where: { id: userId },
      select: {
        mfaSecret: true,
        mfaEnabledAt: true,
        mfaLastStep: true,
        mfaPendingSecret: true,
        mfaPendingAt: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    });

  const codeRows = (userId: string) =>
    platformTestDb().platformMfaRecoveryCode.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { codeHash: true, usedAt: true } });

  /** The newest platform_audit_logs id (UUIDv7 = insertion order), or null on an empty log. */
  async function mark(): Promise<string | null> {
    const last = await platformTestDb().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return last?.id ?? null;
  }

  /** Every event naming one fixture account (as entity or actor) written after `markId`, oldest first. */
  const eventsSince = (markId: string | null, userId: string) =>
    platformTestDb().platformAuditLog.findMany({
      where: { OR: [{ entityId: userId }, { actorPlatformUserId: userId }], ...(markId ? { id: { gt: markId } } : {}) },
      orderBy: { id: 'asc' },
      select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true },
    });

  beforeAll(async () => {
    app = await createPlatformTestApp();
    noKeyApp = await createPlatformTestApp({
      configure: (builder: TestingModuleBuilder) =>
        builder.overrideProvider(PlatformMfaCore).useFactory({
          factory: (prisma: InstanceType<typeof PlatformPrismaService>, tokens: InstanceType<typeof PlatformTokenService>, config: ConfigService) =>
            new PlatformMfaCore(prisma, tokens, {
              get: (key: string, options?: unknown) =>
                key === 'PLATFORM_MFA_ENCRYPTION_KEY' ? undefined : config.get(key, options as never),
            } as unknown as ConfigService<PlatformEnv, true>),
          inject: [PlatformPrismaService, PlatformTokenService, ConfigService],
        }),
    });
    expect(app.get(PlatformMfaCore).available).toBe(true);
    expect(noKeyApp.get(PlatformMfaCore).available).toBe(false);
    watermark = await mark();
    fx.a = await fixture('super_admin');
    fx.b = await fixture('support');
    fx.c = await fixture('support');
    fx.suspended = await fixture('support', 'suspended');
  });

  afterAll(async () => {
    await noKeyApp?.close();
    await app?.close();
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('reports MFA off before anything happened; the GET is never rate-limited and records nothing', async () => {
    a1 = await signIn(api, fx.a);
    a2 = await signIn(api, fx.a);
    const m = await mark();
    expect(await getStatus(api, a1)).toEqual(OFF);
    // 12 > the platform_auth limiter's 10 per 15 minutes: the GET is not under PlatformThrottlerGuard.
    for (let call = 1; call <= 11; call += 1) {
      const res = await api().get(MFA).set('Authorization', a1.bearer);
      expect(res.status, `GET ${MFA} call ${call}`).toBe(200);
    }
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
  });

  it('needs a signed-in, active platform account and an acceptable Origin', async () => {
    const m = await mark();
    expectError(await api().get(MFA), 401, 'unauthenticated');
    expectError(await api().post(SETUP).send({ password: PASSWORD }), 401, 'unauthenticated');
    expectError(await api().get(MFA).set('Authorization', 'Bearer not-a-token'), 401, 'token_invalid');
    const foreign = await api().post(SETUP).set('Authorization', a1.bearer).set('Origin', 'https://evil.example').send({ password: PASSWORD });
    expectError(foreign, 403, 'origin_forbidden');
    // A suspended account is refused by the guard before anything is read or written.
    const suspended = `Bearer ${await platformAccessTokenFor(app, fx.suspended)}`;
    expectError(await api().get(MFA).set('Authorization', suspended), 403, 'account_suspended');
    expectError(await api().post(SETUP).set('Origin', PLATFORM_TEST_ORIGIN).set('Authorization', suspended).send({ password: PASSWORD }), 403, 'account_suspended');
    expect((await mfaRow(fx.a.id)).mfaPendingSecret).toBeNull();
    expect((await mfaRow(fx.suspended.id)).mfaPendingSecret).toBeNull();
    expect(await eventsSince(m, fx.a.id)).toEqual([]);
    expect(await eventsSince(m, fx.suspended.id)).toEqual([]);
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
    // Issuer "ArtiCode Platform", account = the platform user's e-mail.
    expect(res.body.otpauthUri).toBe(
      `otpauth://totp/ArtiCode%20Platform:${encodeURIComponent(fx.a.email)}?secret=${secret}&issuer=ArtiCode%20Platform&algorithm=SHA1&digits=6&period=30`,
    );
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

    await platformTestDb().platformUser.update({ where: { id: fx.a.id }, data: { mfaPendingAt: new Date(Date.now() - 11 * 60 * 1000) } });
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

  it('enable with the right code: MFA on, ten recovery codes shown once and stored as keyed hashes, the other session signed out and this one kept, one platform.auth.mfa.enabled', async () => {
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
    expect(row.failedLoginCount).toBe(0);

    const stored = await codeRows(fx.a.id);
    expect(stored).toHaveLength(10);
    const normalized = codes.map((recovery) => normalizeRecoveryCode(recovery)!);
    for (const { codeHash, usedAt } of stored) {
      expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(usedAt).toBeNull();
      expect(normalized).not.toContain(codeHash);
      expect(codes).not.toContain(codeHash);
    }
    // The stored form is the keyed hash of the normalized code bound to the user (HMAC, derived from the platform key).
    expect(stored.map((entry) => entry.codeHash).sort()).toEqual(codes.map((recovery) => storedHashOf(fx.a.id, recovery)).sort());
    // Never the plain SHA-256 of a code (a dump of the table could be swept offline).
    for (const { codeHash } of stored) expect(normalized.map(sha256)).not.toContain(codeHash);

    // The other session ends; this device keeps refreshing (D-R118).
    const ended = await api().post(REFRESH).set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', cookieHeader(a2.cookie));
    expectError(ended, 401, 'refresh_reused');
    a1 = await refreshOf(a1);

    // A replayed refresh of an already revoked family revokes nothing more and records nothing (platform-session.service.ts).
    expect(await eventsSince(m, fx.a.id)).toEqual([
      { action: EVENTS.enabled, actorPlatformUserId: fx.a.id, entityType: 'platform_users', entityId: fx.a.id, metadata: { revokedSessions: 1 } },
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
    expect(await mfaRow(fx.a.id)).toMatchObject({ mfaLastStep: BigInt(lastStep), failedLoginCount: 0, lockedUntil: null });
    expect((await codeRows(fx.a.id)).map((entry) => entry.codeHash).sort()).toEqual(aCodes.map((c) => storedHashOf(fx.a.id, c)).sort());
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

    const hashes = (await codeRows(fx.a.id)).map((entry) => entry.codeHash);
    expect(hashes.sort()).toEqual(codes.map((c) => storedHashOf(fx.a.id, c)).sort());
    for (const old of aEnabledCodes) expect(hashes).not.toContain(storedHashOf(fx.a.id, old));
    expect(Number((await mfaRow(fx.a.id)).mfaLastStep)).toBeGreaterThan(lastStep);
    expect(await getStatus(api, a1)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    expect(await eventsSince(m, fx.a.id)).toEqual([
      { action: EVENTS.regenerated, actorPlatformUserId: fx.a.id, entityType: 'platform_users', entityId: fx.a.id, metadata: { count: 10 } },
    ]);
    aCodes = codes;
  });

  it('disable: one factor exactly, the password, an old or spent recovery code are refused without a write; a fresh recovery code turns MFA off, retires an open sign-in step, signs the other session out, one event', async () => {
    const db = platformTestDb();
    // Another live session of A (as a sign-in would leave it), to be signed out.
    const extra = app.get(PlatformTokenService).newRefreshToken();
    await db.platformRefreshToken.create({ data: { userId: fx.a.id, tokenHash: extra.hash, expiresAt: new Date(Date.now() + DAY_MS) } });
    credentials.push(extra.token);
    // An open sign-in step (PMFA-T03 issues it after the password): disabling retires it.
    const challenge = await db.platformMfaChallenge.create({
      data: { userId: fx.a.id, tokenHash: sha256(randomBytes(32).toString('base64url')), expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      select: { id: true },
    });
    // One code spent elsewhere (the two-step sign-in marks it so).
    const spent = aCodes[0]!;
    await db.platformMfaRecoveryCode.updateMany({ where: { userId: fx.a.id, codeHash: storedHashOf(fx.a.id, spent) }, data: { usedAt: new Date() } });

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

    expect(await mfaRow(fx.a.id)).toMatchObject({
      mfaSecret: null,
      mfaEnabledAt: null,
      mfaLastStep: null,
      mfaPendingSecret: null,
      mfaPendingAt: null,
      failedLoginCount: 0,
    });
    expect(await codeRows(fx.a.id)).toEqual([]);
    expect((await db.platformMfaChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).consumedAt).not.toBeNull();
    expect(await getStatus(api, a1)).toEqual(OFF);
    const ended = await api().post(REFRESH).set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', cookieHeader(extra.token));
    expectError(ended, 401, 'refresh_reused');
    a1 = await refreshOf(a1);

    expect(await eventsSince(m, fx.a.id)).toEqual([
      {
        action: EVENTS.disabled,
        actorPlatformUserId: fx.a.id,
        entityType: 'platform_users',
        entityId: fx.a.id,
        metadata: { via: 'recovery_code', revokedSessions: 1 },
      },
    ]);
  });

  it('refuses in the documented order while MFA is off: enable without a setup 409 mfa_setup_required; disable 400 factor → 400 password → 409 mfa_not_enabled; new codes 400 password → 409 mfa_not_enabled', async () => {
    c1 = await signIn(api, fx.c);
    const m = await mark();
    expectError(await post(api, ENABLE, c1, { code: '123456' }), 409, 'mfa_setup_required');
    expectError(await post(api, DISABLE, c1, { password: PASSWORD }), 400, 'mfa_factor_required');
    expectError(await post(api, DISABLE, c1, { password: WRONG_PASSWORD, code: '123456' }), 400, 'password_invalid');
    expectError(await post(api, DISABLE, c1, { password: PASSWORD, code: '123456' }), 409, 'mfa_not_enabled');
    expectError(await post(api, REGENERATE, c1, { password: WRONG_PASSWORD, code: '123456' }), 400, 'password_invalid');
    expectError(await post(api, REGENERATE, c1, { password: PASSWORD, code: '123456' }), 409, 'mfa_not_enabled');
    // A body that fails validation never reaches the service.
    const invalid = await post(api, ENABLE, c1, { code: '' });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
    expect(invalid.body.code).toBeUndefined();
    expect(await mfaRow(fx.c.id)).toMatchObject({ mfaSecret: null, mfaPendingSecret: null, failedLoginCount: 0, lockedUntil: null });
    expect(await eventsSince(m, fx.c.id)).toEqual([]);
  });

  it('without PLATFORM_MFA_ENCRYPTION_KEY: the GET says available: false (also for an account with MFA on) and every write is 503 mfa_unavailable first', async () => {
    b1 = await signIn(api, fx.b);
    // Signed in on the no-key server while B's MFA is still off (its own JWT secret when PLATFORM_JWT_SECRET is unset).
    bNoKey = await signIn(noKeyApi, fx.b);
    expect(await getStatus(noKeyApi, bNoKey)).toEqual({ ...OFF, available: false });

    const m = await mark();
    noKeySetupCalls += 2;
    expectError(await post(noKeyApi, SETUP, bNoKey, { password: PASSWORD }), 503, 'mfa_unavailable');
    expectError(await post(noKeyApi, SETUP, bNoKey, { password: WRONG_PASSWORD }), 503, 'mfa_unavailable');
    expect((await mfaRow(fx.b.id)).mfaPendingSecret).toBeNull();

    // B (support) turns MFA on with the keyed server (the no-key session is the "other" one and is signed out there).
    const setup = await post(api, SETUP, b1, { password: PASSWORD });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    bSecret = setup.body.secret as string;
    secrets.push({ secret: bSecret, shownIn: answers.length - 1 });
    expect(setup.body.otpauthUri).toContain(`ArtiCode%20Platform:${encodeURIComponent(fx.b.email)}?`);
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
    expectError(await post(noKeyApi, REGENERATE, bNoKey, { password: WRONG_PASSWORD, code: codeOf(bSecret, 1) }), 503, 'mfa_unavailable');
    expect(await codeRows(fx.b.id)).toHaveLength(10);

    const events = await eventsSince(m, fx.b.id);
    expect(events.map((event) => event.action)).toEqual([EVENTS.enabled]);
    expect(events[0]!.metadata).toEqual({ revokedSessions: 1 });
  });

  it('disable with a current code (via: code) on the keyed server; the code that enabled is refused (replay)', async () => {
    const m = await mark();
    const enabledStep = Number((await mfaRow(fx.b.id)).mfaLastStep);
    expect(totpStep(Date.now()) - enabledStep).toBeLessThanOrEqual(1);
    expectError(await post(api, DISABLE, b1, { password: PASSWORD, code: bEnableCode }), 400, 'mfa_code_invalid');
    expect(await mfaRow(fx.b.id)).toMatchObject({ mfaLastStep: BigInt(enabledStep), failedLoginCount: 0 });
    expect(await codeRows(fx.b.id)).toHaveLength(10);
    expect(await eventsSince(m, fx.b.id)).toEqual([]);

    const res = await post(api, DISABLE, b1, { password: PASSWORD, code: codeOf(bSecret, 1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ revokedSessions: 0 });
    expect(await mfaRow(fx.b.id)).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null });
    expect(await codeRows(fx.b.id)).toEqual([]);
    expect(await eventsSince(m, fx.b.id)).toEqual([
      { action: EVENTS.disabled, actorPlatformUserId: fx.b.id, entityType: 'platform_users', entityId: fx.b.id, metadata: { via: 'code', revokedSessions: 0 } },
    ]);
  });

  it('rate-limits each write per (IP, platform user): 10 per 15 minutes, then 429 rate_limited', async () => {
    const statuses: number[] = [];
    for (let call = noKeySetupCalls + 1; call <= 11; call += 1) {
      const res = await noKeyApi().post(SETUP).set('Origin', PLATFORM_TEST_ORIGIN).set('Authorization', bNoKey.bearer).send({ password: PASSWORD });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    }
    expect(statuses).toEqual([...Array<number>(10 - noKeySetupCalls).fill(503), 429]);
    // Another route of the same account keeps its own budget; the GET is never limited.
    expectError(await post(noKeyApi, REGENERATE, bNoKey, { password: PASSWORD, code: '123456' }), 503, 'mfa_unavailable');
    expect((await getStatus(noKeyApi, bNoKey))['available']).toBe(false);
  });

  it('recorded exactly the successful writes for the fixtures, never touched the lockout, and no answer or event carries a secret or a recovery code where it must not', async () => {
    const actions = async (userId: string) => (await eventsSince(watermark, userId)).map((event) => event.action);
    expect(await actions(fx.a.id)).toEqual([EVENTS.login, EVENTS.login, EVENTS.enabled, EVENTS.regenerated, EVENTS.disabled]);
    expect(await actions(fx.b.id)).toEqual([EVENTS.login, EVENTS.login, EVENTS.enabled, EVENTS.disabled]);
    expect(await actions(fx.c.id)).toEqual([EVENTS.login]);
    expect(await actions(fx.suspended.id)).toEqual([]);
    for (const user of [fx.a, fx.b, fx.c]) {
      expect(await mfaRow(user.id)).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    }

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
    // No answer names a stored form (sealed secret, hash).
    for (const text of serialized) expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);

    // No event of the run carries a secret, a code (plain, normalized or hashed), a sealed value or a credential; no metadata key names a token.
    const events = await platformTestDb().platformAuditLog.findMany({
      where: {
        OR: fixtureIds.flatMap((id) => [{ actorPlatformUserId: id }, { entityId: id }]),
        ...(watermark ? { id: { gt: watermark } } : {}),
      },
      select: { metadata: true },
    });
    expect(events.length).toBeGreaterThan(0);
    const metadata = JSON.stringify(events.map((event) => event.metadata));
    const forbidden = [
      ...secrets.map((entry) => entry.secret),
      ...codeSets.flatMap((entry) =>
        entry.codes.flatMap((c) => [c, normalizeRecoveryCode(c)!, ...[fx.a, fx.b, fx.c].map((user) => storedHashOf(user.id, c))]),
      ),
      ...credentials,
    ];
    for (const value of forbidden) expect(metadata).not.toContain(value);
    expect(metadata).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);
    expect(keysOf(events.map((event) => event.metadata)).filter((key) => /token|secret|hash|code|password/i.test(key))).toEqual([]);
  });

  it('documents the five routes in the platform OpenAPI document', async () => {
    const docs = await api().get('/api/docs-json').expect(200);
    const writeResponses = ['200', '400', '401', '403', '409', '429', '503'];
    expect(Object.keys(docs.body.paths[MFA])).toEqual(['get']);
    expect(docs.body.paths[MFA].get.tags).toEqual(['auth']);
    expect(docs.body.paths[MFA].get.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(docs.body.paths[MFA].get.responses).sort()).toEqual(['200', '401', '403']);
    for (const route of [SETUP, ENABLE, DISABLE, REGENERATE]) {
      const operation = docs.body.paths[route];
      expect(Object.keys(operation), route).toEqual(['post']);
      expect(operation.post.tags, route).toEqual(['auth']);
      expect(operation.post.security, route).toEqual([{ bearer: [] }]);
      expect(Object.keys(operation.post.responses).sort(), route).toEqual(writeResponses);
    }
    const schemas = docs.body.components.schemas;
    const status = schemas.PlatformMfaStatusDto;
    expect(Object.keys(status.properties).sort()).toEqual(STATUS_KEYS);
    expect(status.properties.enabledAt).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(status.properties.recoveryCodesLeft).toMatchObject({ type: 'integer', nullable: true });
    expect(Object.keys(schemas.PlatformMfaSetupDto.properties).sort()).toEqual(['expiresAt', 'otpauthUri', 'secret']);
    expect(schemas.PlatformMfaEnabledDto.properties.recoveryCodes).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(schemas.PlatformMfaEnabledDto.properties.revokedSessions).toMatchObject({ type: 'integer' });
    expect(schemas.PlatformMfaRecoveryCodesDto.properties.recoveryCodes).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(Object.keys(schemas.PlatformMfaDisableRequestDto.properties).sort()).toEqual(['code', 'password', 'recoveryCode']);
    expect(schemas.PlatformMfaDisableRequestDto.required).toEqual(['password']);
    expect(schemas.PlatformMfaRegenerateRequestDto.required.sort()).toEqual(['code', 'password']);
    // The academy's DTO names never leak into the platform document (ADR-073).
    expect(schemas).not.toHaveProperty('MfaStatusDto');
  });
});
