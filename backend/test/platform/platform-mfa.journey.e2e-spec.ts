// TEST-235 (e2e) — PMFA-T05 (roadmap §4o, D-R113..D-R120): the WF-18
// «التحقق بخطوتين لمستخدم المنصة» journey end to end through the PLATFORM API
// against the live development platform database — the academy's WF-17
// journey (TEST-229, test/mfa.journey.e2e-spec.ts) on `platform_users`, the
// `pla_refresh` cookie and `platform_audit_logs`. A fixture `super_admin` and a
// fixture `support` account (created through the platform Prisma client like
// the other platform suites — never a real account). One test:
//
//   1. the super admin signs in twice (this device and another one) and the
//      support operator once; MFA is off for both (API-213);
//   2. setup (API-214) + enable (API-215) from this device: ten recovery codes,
//      the other device's refresh dies, this one keeps refreshing; the support
//      operator's session is untouched;
//   3. sign out → the password alone answers a challenge (API-178, no cookie)
//      → the second step with a TOTP code opens a session (API-218) → `GET
//      /api/auth/me` → the same challenge again is `401 mfa_challenge_invalid`;
//   4. sign out → a new challenge → the second step with a recovery code (nine left);
//   5. new recovery codes (API-217); 6. disable with a code (API-216);
//   7. a plain sign-in opens a session at once → enable again from it (the
//      recovery-code session is signed out);
//   8. a password step leaves an open challenge; the server-side reset
//      (`resetPlatformUserMfa()`, PMFA-T04 — the CLI path is TEST-234) answers
//      `{ reset: true }`: every session ends (the old cookie refreshes no more)
//      and the open challenge leads nowhere;
//   9. the super admin signs in with the password alone; MFA is off; the
//      support operator signs in again without MFA, unaffected throughout;
//  10. the exact ordered platform audit trail of both accounts above an id
//      watermark; no answer outside its own step and no event carries the
//      secret, a code, a recovery code, a challenge, a sealed value or a token.
//
// MFA is turned on only through the routes, and the recovery codes come only
// from the API-215/API-217 answers. A code works once in its step
// (`mfa_last_step`) and the server accepts the current step ± 1; this suite
// sends at most two codes per 30-second step (the current one and the next
// one, never a past one), so the four codes of the first secret make it wait
// for the next step at most twice (30–60 s in all; the test allows 120 s).
// A fixed TEST key (not the academy suites' key) is set before the platform app
// module is imported (process variables beat the env files); `TRUST_PROXY=
// loopback` lets each account speak from its own documentation address
// (X-Forwarded-For), so no rate-limit key of the platform throttler is shared.
// Skipped when the platform database is unreachable (./helpers.ts); the
// fixtures are deleted at the end (their tokens, recovery codes and challenges
// cascade; their append-only audit rows stay with the actor set to NULL).
import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertNoSecrets } from '../../src/audit/audit-metadata.js';
import { base32Decode, totpCode, totpStep } from '../../src/auth/mfa/totp.js';
// Type-only (erased): ./helpers.js itself is imported below, after the variables are set.
import type { PlatformUserFixture } from './helpers.js';

/** A fixed TEST key (32 bytes) — never a real one, and not the academy suites' `Buffer.alloc(32, 7)`. */
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
process.env['TRUST_PROXY'] = 'loopback';

// After the variables: helpers.ts imports PlatformAppModule, whose ConfigModule reads them.
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
const { PlatformTokenService } = await import('../../src/platform/auth/platform-token.service.js');
const { resetPlatformUserMfa } = await import('../../src/platform/auth/mfa/platform-mfa-reset.js');

const available = await platformDbReachable();

const PASSWORD = 'Correct-Horse-Platform-Journey-9';
const USER_AGENT = 'TEST-235 WF-18';
const ADMIN_IP = '198.51.100.235';
const SUPPORT_IP = '198.51.100.236';
const RESET_REASON = 'Lost phone; identity confirmed by the platform owner';
const LOGIN = '/api/auth/login';
const MFA_STEP = '/api/auth/login/mfa';
const REFRESH = '/api/auth/refresh';
const LOGOUT = '/api/auth/logout';
const ME = '/api/auth/me';
const MFA = '/api/auth/mfa';
const EVENTS = {
  login: 'platform.auth.login.succeeded',
  logout: 'platform.auth.logout',
  enabled: 'platform.auth.mfa.enabled',
  disabled: 'platform.auth.mfa.disabled',
  regenerated: 'platform.auth.mfa.recovery_codes.regenerated',
  reset: 'platform.users.mfa_reset',
};
const CHALLENGE_KEYS = ['challenge', 'expiresAt', 'mfaRequired'];
const SESSION_KEYS = ['accessToken', 'expiresIn', 'tokenType', 'user'];
const OFF = { available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false };
const RECOVERY_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;
/** No key of an event may name a credential or a factor (`recoveryCodesLeft` is a count, not a code). */
const SENSITIVE_KEY = /token|secret|challenge|hash|password|code$/i;
const STEP_MS = 30_000;
/** Up to two waits for the next 30-second step, the Argon2 sign-ins and the audit reads. */
const JOURNEY_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function setCookieLine(res: SupertestResponse): string {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`)) ?? '';
}

/** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = setCookieLine(res);
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
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

interface Session {
  accessToken: string;
  cookie: string;
  familyId: string;
}

interface TrailEvent {
  action: string;
  actorPlatformUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

describe.skipIf(!available)('PMFA-T05 the platform two-step verification journey WF-18 (e2e, TEST-235)', () => {
  let app: NestExpressApplication;
  let tokens: InstanceType<typeof PlatformTokenService>;
  let admin: PlatformUserFixture;
  let support: PlatformUserFixture;
  let watermark = '00000000-0000-0000-0000-000000000000';
  const fixtureIds: string[] = [];

  /** Every answer of the journey, in order, for the "shown once" checks. */
  const answers: { label: string; body: unknown }[] = [];
  /** Plain values that may appear in exactly one answer (the index of the answer that hands them over). */
  const shownOnce: { value: string; answer: number }[] = [];
  /** Values that no answer at all may carry: sealed secrets, stored hashes, refresh cookies, the password. */
  const neverAnswered: string[] = [PASSWORD];
  /** Every TOTP code sent — no answer and no event may carry one. */
  const sentCodes: string[] = [];
  /** Access tokens of the sessions — in their session answers only, never in an event. */
  const accessTokens: string[] = [];
  /** How often the journey waited for the next 30-second step. */
  let stepWaits = 0;

  const db = () => platformTestDb();
  const api = () => request(app.getHttpServer());
  /** A request as the Super Admin frontend sends it: the Origin, the journey's User-Agent, the actor's own address. */
  const as = (ip: string) => ({ 'X-Forwarded-For': ip, 'User-Agent': USER_AGENT, Origin: PLATFORM_TEST_ORIGIN });
  const cookieHeader = (cookie: string) => `${PLATFORM_REFRESH_COOKIE_NAME}=${cookie}`;
  const familyOf = async (cookie: string): Promise<string> =>
    (await db().platformRefreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(cookie) }, select: { familyId: true } }))
      .familyId;
  const liveSessions = (userId: string) => db().platformRefreshToken.count({ where: { userId, revokedAt: null } });

  /**
   * The code of `secret` for the earliest step this suite may use after
   * `lastStep`: the current step or the next one, never a past one — so at most
   * two codes per 30-second step — waiting for the next step when neither is
   * free. Returns the step too: the caller passes it back as `lastStep`.
   */
  async function nextCode(secret: string, lastStep: number | null): Promise<{ code: string; step: number }> {
    for (;;) {
      const now = Date.now();
      const current = totpStep(now);
      const step = lastStep === null ? current : Math.max(current, lastStep + 1);
      if (step <= current + 1) {
        const code = totpCode(base32Decode(secret)!, step);
        sentCodes.push(code);
        return { code, step };
      }
      stepWaits += 1;
      await sleep(STEP_MS - (now % STEP_MS) + 100);
    }
  }

  function keep(label: string, res: SupertestResponse): number {
    answers.push({ label, body: res.body });
    return answers.length - 1;
  }

  function expectStatus(res: SupertestResponse, status: number, code?: string): void {
    expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);
    if (code) expect(res.body).toMatchObject({ statusCode: status, code });
  }

  /** The answer must be a session of `user`: the four session keys and a refresh cookie. */
  async function sessionOf(res: SupertestResponse, user: PlatformUserFixture): Promise<Session> {
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.user).toEqual({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, status: 'active' });
    const cookie = refreshCookie(res);
    expect(cookie).toEqual(expect.any(String));
    accessTokens.push(res.body.accessToken as string);
    neverAnswered.push(cookie!);
    return { accessToken: res.body.accessToken as string, cookie: cookie!, familyId: await familyOf(cookie!) };
  }

  async function signIn(user: PlatformUserFixture, ip: string, label: string): Promise<SupertestResponse> {
    const res = await api().post(LOGIN).set(as(ip)).send({ identifier: user.email, password: PASSWORD });
    keep(label, res);
    expectStatus(res, 200);
    return res;
  }

  /** The password step of the super admin while MFA is on: the challenge, no cookie, nothing stored but its hash. */
  async function challengeFor(label: string): Promise<string> {
    const res = await signIn(admin, ADMIN_IP, label);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.mfaRequired).toBe(true);
    expect(setCookieLine(res)).toBe('');
    const challenge = res.body.challenge as string;
    shownOnce.push({ value: challenge, answer: answers.length - 1 });
    neverAnswered.push(sha256(challenge));
    expect(await db().platformMfaChallenge.count({ where: { tokenHash: sha256(challenge), userId: admin.id, consumedAt: null } })).toBe(1);
    return challenge;
  }

  async function secondStep(label: string, body: Record<string, unknown>): Promise<SupertestResponse> {
    const res = await api().post(MFA_STEP).set(as(ADMIN_IP)).send(body);
    keep(label, res);
    return res;
  }

  /** A POST to an MFA route as the super admin, with the session's refresh cookie (it marks "this device"). */
  async function mfaPost(label: string, session: Session, path: string, body: Record<string, unknown>): Promise<SupertestResponse> {
    const res = await api()
      .post(`${MFA}${path}`)
      .set(as(ADMIN_IP))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', cookieHeader(session.cookie))
      .send(body);
    keep(label, res);
    return res;
  }

  async function status(label: string, session: Session, ip = ADMIN_IP): Promise<Record<string, unknown>> {
    const res = await api().get(MFA).set(as(ip)).set('Authorization', `Bearer ${session.accessToken}`);
    keep(label, res);
    expectStatus(res, 200);
    return res.body as Record<string, unknown>;
  }

  async function refresh(label: string, cookie: string, ip = ADMIN_IP): Promise<SupertestResponse> {
    const res = await api().post(REFRESH).set(as(ip)).set('Cookie', cookieHeader(cookie));
    keep(label, res);
    return res;
  }

  async function logout(label: string, cookie: string): Promise<void> {
    const res = await api().post(LOGOUT).set(as(ADMIN_IP)).set('Cookie', cookieHeader(cookie));
    keep(label, res);
    expectStatus(res, 204);
  }

  /** The stored recovery-code hashes of the super admin (never in an answer or an event). */
  async function storedRecoveryHashes(): Promise<string[]> {
    const rows = await db().platformMfaRecoveryCode.findMany({ where: { userId: admin.id }, select: { codeHash: true } });
    return rows.map((row) => row.codeHash);
  }

  /** Setup + enable through the routes; returns the secret, the codes and the step the enabling code used. */
  async function turnOn(
    label: string,
    session: Session,
  ): Promise<{ secret: string; recoveryCodes: string[]; step: number; enabledAt: string; revokedSessions: number }> {
    const setup = await mfaPost(`${label} setup`, session, '/setup', { password: PASSWORD });
    expectStatus(setup, 200);
    expect(Object.keys(setup.body).sort()).toEqual(['expiresAt', 'otpauthUri', 'secret']);
    const secret = setup.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/ArtiCode%20Platform:/);
    expect(setup.body.otpauthUri).toContain(`secret=${secret}&issuer=ArtiCode%20Platform`);
    shownOnce.push({ value: secret, answer: answers.length - 1 });
    expect(await status(`${label} status after setup`, session)).toEqual({ ...OFF, pendingSetup: true });
    const pending = await db().platformUser.findUniqueOrThrow({ where: { id: admin.id }, select: { mfaPendingSecret: true, mfaSecret: true } });
    expect(pending.mfaSecret).toBeNull();
    expect(pending.mfaPendingSecret).not.toContain(secret);
    neverAnswered.push(pending.mfaPendingSecret!);

    const { code, step } = await nextCode(secret, null);
    const enable = await mfaPost(`${label} enable`, session, '/enable', { code });
    expectStatus(enable, 200);
    expect(Object.keys(enable.body).sort()).toEqual(['enabledAt', 'recoveryCodes', 'revokedSessions']);
    const recoveryCodes = enable.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const recoveryCode of recoveryCodes) {
      expect(recoveryCode).toMatch(RECOVERY_CODE);
      shownOnce.push({ value: recoveryCode, answer: answers.length - 1 });
    }
    const sealed = await db().platformUser.findUniqueOrThrow({
      where: { id: admin.id },
      select: { mfaSecret: true, mfaPendingSecret: true, mfaPendingAt: true, mfaLastStep: true },
    });
    expect(sealed).toEqual({ mfaSecret: pending.mfaPendingSecret, mfaPendingSecret: null, mfaPendingAt: null, mfaLastStep: BigInt(step) });
    const hashes = await storedRecoveryHashes();
    expect(hashes).toHaveLength(10);
    neverAnswered.push(...hashes);
    return {
      secret,
      recoveryCodes,
      step,
      enabledAt: enable.body.enabledAt as string,
      revokedSessions: enable.body.revokedSessions as number,
    };
  }

  beforeAll(async () => {
    app = await createPlatformTestApp();
    tokens = app.get(PlatformTokenService);
    admin = await createPlatformUserFixture({ role: 'super_admin', password: PASSWORD, fullName: 'WF-18 Super Admin' });
    fixtureIds.push(admin.id);
    support = await createPlatformUserFixture({ role: 'support', password: PASSWORD, fullName: 'WF-18 Support' });
    fixtureIds.push(support.id);
    const latest = await db().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    watermark = latest?.id ?? watermark;
  });

  afterAll(async () => {
    try {
      await app?.close();
      await deletePlatformUserFixtures(fixtureIds);
    } finally {
      await closePlatformTestDb();
    }
  });

  it(
    'walks WF-18: enable, the two-step sign-in with a code and with a recovery code, new codes, disable, enable again, the server-side reset — the support operator unaffected, with the exact audit trail and no secret outside its own answer',
    async () => {
      // 1. Two sessions of the super admin (this device and another one), one of the support operator; MFA is off.
      const first = await sessionOf(await signIn(admin, ADMIN_IP, 'admin: sign in (this device)'), admin);
      const other = await sessionOf(await signIn(admin, ADMIN_IP, 'admin: sign in (another device)'), admin);
      const supportFirst = await sessionOf(await signIn(support, SUPPORT_IP, 'support: sign in'), support);
      expect(await status('admin: status off', first)).toEqual(OFF);
      expect(await status('support: status off', supportFirst, SUPPORT_IP)).toEqual(OFF);

      // 2. Setup + enable from this device: ten recovery codes, the other device is signed out, this one refreshes.
      const one = await turnOn('first', first);
      expect(one.revokedSessions).toBe(1);
      expectStatus(await refresh('admin: refresh of the signed-out device', other.cookie), 401, 'refresh_reused');
      const refreshed = await refresh('admin: refresh of this device', first.cookie);
      expectStatus(refreshed, 200);
      const current = await sessionOf(refreshed, admin);
      expect(current.familyId).toBe(first.familyId);
      expect(await status('admin: status on', current)).toEqual({
        available: true,
        enabled: true,
        enabledAt: one.enabledAt,
        recoveryCodesLeft: 10,
        pendingSetup: false,
      });
      // The support operator's session is not one of the super admin's: it still refreshes.
      const supportRefreshed = await refresh('support: refresh after the enabling', supportFirst.cookie, SUPPORT_IP);
      expectStatus(supportRefreshed, 200);
      const supportCurrent = await sessionOf(supportRefreshed, support);
      expect(supportCurrent.familyId).toBe(supportFirst.familyId);

      // 3. Sign out; the password alone now answers a challenge; the second step with a TOTP code opens a session.
      await logout('admin: sign out (this device)', current.cookie);
      const codeChallenge = await challengeFor('admin: password step (code)');
      const login1 = await nextCode(one.secret, one.step);
      const viaCodeRes = await secondStep('admin: second step with a code', { challenge: codeChallenge, code: login1.code });
      expectStatus(viaCodeRes, 200);
      const viaCode = await sessionOf(viaCodeRes, admin);
      const me = await api().get(ME).set(as(ADMIN_IP)).set('Authorization', `Bearer ${viaCode.accessToken}`);
      keep('admin: me after the second step', me);
      expectStatus(me, 200);
      expect(me.body).toEqual({ id: admin.id, email: admin.email, fullName: admin.fullName, role: 'super_admin', status: 'active' });
      // The challenge worked once: the same challenge again is refused before any factor is looked at.
      const replay = await secondStep('admin: the used challenge again', { challenge: codeChallenge, recoveryCode: one.recoveryCodes[0] });
      expectStatus(replay, 401, 'mfa_challenge_invalid');
      expect(setCookieLine(replay)).toBe('');
      expect(await db().platformUser.findUniqueOrThrow({ where: { id: admin.id }, select: { failedLoginCount: true } })).toEqual({
        failedLoginCount: 0,
      });

      // 4. Sign out; the second step with a recovery code (typed in lower case): nine left.
      await logout('admin: sign out (code session)', viaCode.cookie);
      const recoveryChallenge = await challengeFor('admin: password step (recovery code)');
      const viaRecoveryRes = await secondStep('admin: second step with a recovery code', {
        challenge: recoveryChallenge,
        recoveryCode: one.recoveryCodes[3]!.toLowerCase(),
      });
      expectStatus(viaRecoveryRes, 200);
      const viaRecovery = await sessionOf(viaRecoveryRes, admin);
      expect(await status('admin: status after a recovery code', viaRecovery)).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });

      // 5. New recovery codes (the password and a current code); the old ones are gone.
      const regenerateCode = await nextCode(one.secret, login1.step);
      const regenerated = await mfaPost('admin: new recovery codes', viaRecovery, '/recovery-codes', { password: PASSWORD, code: regenerateCode.code });
      expectStatus(regenerated, 200);
      expect(Object.keys(regenerated.body)).toEqual(['recoveryCodes']);
      const newCodes = regenerated.body.recoveryCodes as string[];
      expect(newCodes).toHaveLength(10);
      for (const recoveryCode of newCodes) {
        expect(recoveryCode).toMatch(RECOVERY_CODE);
        expect(one.recoveryCodes).not.toContain(recoveryCode);
        shownOnce.push({ value: recoveryCode, answer: answers.length - 1 });
      }
      const regeneratedHashes = await storedRecoveryHashes();
      expect(regeneratedHashes).toHaveLength(10);
      neverAnswered.push(...regeneratedHashes);
      expect(await status('admin: status after new codes', viaRecovery)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

      // 6. Disable with the password and a code; this session stays (no other session is live).
      const disableCode = await nextCode(one.secret, regenerateCode.step);
      const disabled = await mfaPost('admin: disable', viaRecovery, '/disable', { password: PASSWORD, code: disableCode.code });
      expectStatus(disabled, 200);
      expect(disabled.body).toEqual({ revokedSessions: 0 });
      expect(await status('admin: status after disable', viaRecovery)).toEqual(OFF);
      expect(await db().platformMfaRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
      expect(await liveSessions(admin.id)).toBe(1);

      // 7. A plain sign-in opens a session at once; enable again from it (the recovery-code session is signed out).
      const plain = await sessionOf(await signIn(admin, ADMIN_IP, 'admin: plain sign-in'), admin);
      const two = await turnOn('second', plain);
      expect(two.secret).not.toBe(one.secret);
      expect(two.revokedSessions).toBe(1);
      expect(await liveSessions(admin.id)).toBe(1);

      // 8. A password step leaves an open challenge; the server-side reset ends every session and that challenge.
      const pendingChallenge = await challengeFor('admin: password step before the reset');
      const reset = await resetPlatformUserMfa(db(), { email: admin.email, reason: RESET_REASON });
      expect(reset).toEqual({ userId: admin.id, reset: true, revokedSessions: 1 });
      expect(await liveSessions(admin.id)).toBe(0);
      expect(
        await db().platformUser.findUniqueOrThrow({
          where: { id: admin.id },
          select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true, mfaPendingSecret: true, mfaPendingAt: true },
        }),
      ).toEqual({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null });
      expect(await db().platformMfaRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
      expect(await db().platformMfaChallenge.count({ where: { userId: admin.id, consumedAt: null } })).toBe(0);
      expectStatus(await refresh('admin: refresh after the reset', plain.cookie), 401, 'refresh_reused');
      const stale = await secondStep('admin: the open challenge after the reset', { challenge: pendingChallenge, recoveryCode: two.recoveryCodes[0] });
      expectStatus(stale, 401, 'mfa_challenge_invalid');
      // The support operator's session is untouched by the reset.
      const supportAfterReset = await refresh('support: refresh after the reset', supportCurrent.cookie, SUPPORT_IP);
      expectStatus(supportAfterReset, 200);
      const supportLatest = await sessionOf(supportAfterReset, support);
      expect(supportLatest.familyId).toBe(supportFirst.familyId);

      // 9. The super admin signs in with the password alone; MFA is off. The support operator signs in without MFA.
      const final = await sessionOf(await signIn(admin, ADMIN_IP, 'admin: sign-in after the reset'), admin);
      expect(await status('admin: status after the reset', final)).toEqual(OFF);
      const supportFinal = await sessionOf(await signIn(support, SUPPORT_IP, 'support: sign in again'), support);
      expect(await status('support: status at the end', supportFinal, SUPPORT_IP)).toEqual(OFF);
      expect(
        await db().platformUser.findUniqueOrThrow({
          where: { id: support.id },
          select: { mfaSecret: true, mfaEnabledAt: true, mfaPendingSecret: true, failedLoginCount: true },
        }),
      ).toEqual({ mfaSecret: null, mfaEnabledAt: null, mfaPendingSecret: null, failedLoginCount: 0 });
      expect(await db().platformMfaChallenge.count({ where: { userId: support.id } })).toBe(0);
      expect(await liveSessions(support.id)).toBe(2);

      // 10. The exact ordered audit trail of the super admin above the watermark (about the account or by it).
      const trailOf = (userId: string): Promise<TrailEvent[]> =>
        db().platformAuditLog.findMany({
          where: { id: { gt: watermark }, OR: [{ entityId: userId }, { actorPlatformUserId: userId }] },
          orderBy: { id: 'asc' },
          select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true, ipAddress: true, userAgent: true },
        });
      const adminTrail = await trailOf(admin.id);
      const expected: { action: string; actor: string | null; metadata: Record<string, unknown> }[] = [
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'password', familyId: first.familyId } },
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'password', familyId: other.familyId } },
        { action: EVENTS.enabled, actor: admin.id, metadata: { revokedSessions: 1 } },
        { action: EVENTS.logout, actor: admin.id, metadata: { scope: 'device', familyId: first.familyId } },
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'mfa', familyId: viaCode.familyId } },
        { action: EVENTS.logout, actor: admin.id, metadata: { scope: 'device', familyId: viaCode.familyId } },
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'recovery_code', familyId: viaRecovery.familyId, recoveryCodesLeft: 9 } },
        { action: EVENTS.regenerated, actor: admin.id, metadata: { count: 10 } },
        { action: EVENTS.disabled, actor: admin.id, metadata: { via: 'code', revokedSessions: 0 } },
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'password', familyId: plain.familyId } },
        { action: EVENTS.enabled, actor: admin.id, metadata: { revokedSessions: 1 } },
        { action: EVENTS.reset, actor: null, metadata: { revokedSessions: 1, reason: RESET_REASON } },
        { action: EVENTS.login, actor: admin.id, metadata: { via: 'password', familyId: final.familyId } },
      ];
      expect(adminTrail.map((event) => event.action)).toEqual(expected.map((event) => event.action));
      adminTrail.forEach((event, index) => {
        const want = expected[index]!;
        expect(event.actorPlatformUserId, `${index} ${event.action}`).toBe(want.actor);
        expect(event.entityType, `${index} ${event.action}`).toBe('platform_users');
        expect(event.entityId, `${index} ${event.action}`).toBe(admin.id);
        expect(event.metadata, `${index} ${event.action}`).toEqual(want.metadata);
        // The reset runs on the server, outside any request: no address and no user agent.
        expect(event.ipAddress, `${index} ${event.action}`).toBe(want.actor === null ? null : ADMIN_IP);
        expect(event.userAgent, `${index} ${event.action}`).toBe(want.actor === null ? null : USER_AGENT);
      });
      // The support operator's trail: its two password sign-ins — the refreshes and the status reads record nothing.
      const supportTrail = await trailOf(support.id);
      expect(supportTrail).toEqual([
        {
          action: EVENTS.login,
          actorPlatformUserId: support.id,
          entityType: 'platform_users',
          entityId: support.id,
          metadata: { via: 'password', familyId: supportFirst.familyId },
          ipAddress: SUPPORT_IP,
          userAgent: USER_AGENT,
        },
        {
          action: EVENTS.login,
          actorPlatformUserId: support.id,
          entityType: 'platform_users',
          entityId: support.id,
          metadata: { via: 'password', familyId: supportFinal.familyId },
          ipAddress: SUPPORT_IP,
          userAgent: USER_AGENT,
        },
      ]);

      // 11. No secret, code, recovery code or challenge outside the one answer that hands it over; none in any event.
      // Five TOTP codes: two enablings, the second sign-in step, the new recovery codes and the disabling — at most
      // two per 30-second step, so the four codes of the first secret waited for the next step at most twice.
      expect(sentCodes).toHaveLength(5);
      expect(stepWaits).toBeLessThanOrEqual(2);
      const serializedAnswers = answers.map((answer) => JSON.stringify(answer.body ?? null));
      for (const { value, answer } of shownOnce) {
        const carriers = serializedAnswers.flatMap((body, index) => (body.includes(value) ? [index] : []));
        expect(carriers, `${value.slice(0, 4)}… shown in ${carriers.map((index) => answers[index]!.label).join(', ')}`).toEqual([answer]);
      }
      for (const value of neverAnswered) {
        expect(serializedAnswers.some((body) => body.includes(value)), `${value.slice(0, 4)}… in an answer`).toBe(false);
      }
      for (const answer of answers) {
        const leaves = leavesOf(answer.body);
        for (const code of sentCodes) expect(leaves, answer.label).not.toContain(code);
      }
      for (const event of [...adminTrail, ...supportTrail]) {
        expect(() => assertNoSecrets(event.metadata as Record<string, unknown> | null)).not.toThrow();
        expect(keysOf(event.metadata).filter((key) => SENSITIVE_KEY.test(key)), event.action).toEqual([]);
        const serialized = JSON.stringify(event.metadata);
        for (const { value } of shownOnce) expect(serialized).not.toContain(value);
        for (const value of [...neverAnswered, ...accessTokens]) expect(serialized).not.toContain(value);
        const leaves = leavesOf(event.metadata);
        for (const code of sentCodes) expect(leaves, event.action).not.toContain(code);
      }
    },
    JOURNEY_TIMEOUT_MS,
  );
});
