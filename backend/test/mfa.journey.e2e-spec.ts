// TEST-229 — MFA-T05 (MOD-01-H06, roadmap §4n): the WF-17 «التحقق بخطوتين»
// journey end to end through the API against the live development database,
// with a fixture student holding the seeded `student` role and a fixture
// administrator holding a custom role with every permission key. One test:
// sign in → status off → setup → enable (ten recovery codes; the other session
// dies, this one refreshes) → sign out → the password step answers a challenge
// (no cookie) → the second step with a TOTP code opens a session → sign out →
// the second step with a recovery code (nine left) → new recovery codes →
// disable with a code → a plain sign-in → enable again → the administrator
// resets it with a reason (every session of the student ends) → the student
// signs in with the password alone → the detail shows `mfaEnabledAt: null` →
// the exact ordered audit trail of the student. No answer outside its own step
// and no event metadata carries the secret, a code, a recovery code or a
// challenge.
//
// MFA is turned on only through the routes (API-207 + API-208), and recovery
// codes come only from the API-208/API-210 answers. A code works once in its
// step (`mfa_last_step`) and the server accepts the current step ± 1, so the
// codes of one secret use rising steps; the fourth code of the first secret
// may have to wait for the next 30-second step (the test allows 2 minutes).
// A fixed TEST key is set before AppModule is imported (process variables beat
// the env files); `TRUST_PROXY=loopback` lets each actor speak from its own
// documentation address (X-Forwarded-For), so no rate-limit key of the auth
// throttler is shared with anything else. Skipped when no database is
// reachable; the fixtures carry a unique suffix and are deleted at the end
// (cascade removes their roles, tokens, codes and challenges; their audit rows
// stay — the log is append-only). Events are read by fixture above an `id`
// watermark, so other clients of the shared dev DB never pollute the trail.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertNoSecrets } from '../src/audit/audit-metadata.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { base32Decode, totpCode, totpStep } from '../src/auth/mfa/totp.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
/** A fixed TEST key (32 bytes) — never a real one. */
process.env['AUTH_MFA_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
process.env['TRUST_PROXY'] = 'loopback';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { TokenService } = await import('../src/auth/token.service.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-229 supertest';
const STUDENT_IP = '198.51.100.29';
const ADMIN_IP = '198.51.100.30';
const RESET_REASON = 'Lost phone; identity confirmed at the front desk';
const LOGIN = '/api/auth/login';
const MFA_STEP = '/api/auth/login/mfa';
const REFRESH = '/api/auth/refresh';
const LOGOUT = '/api/auth/logout';
const MFA = '/api/auth/mfa';
const USERS = '/api/users';
const CHALLENGE_KEYS = ['challenge', 'expiresAt', 'mfaRequired'];
const SESSION_KEYS = ['accessToken', 'expiresIn', 'tokenType', 'user'];
const RECOVERY_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;
/** No key of a user detail may name an MFA secret, a code or a challenge (only `mfaEnabledAt` is exposed). */
const SENSITIVE_DETAIL_KEY = /secret|recovery|laststep|pending|challenge|hash|password/i;
const STEP_MS = 30_000;
/** A code one step back is used only while this much of the current step is left: a request may cross the boundary. */
const BOUNDARY_MARGIN_MS = 5_000;
/** Up to one wait for the next 30-second step, the Argon2 sign-ins and the audit reads. */
const JOURNEY_TIMEOUT_MS = 120_000;

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

/**
 * The code of `secret` for the earliest step the server still accepts after
 * `lastStep` (its window is the current step ± 1, and a step is accepted
 * once), waiting for the next 30-second step when the window does not reach
 * it yet. Returns the step too: the caller passes it back as `lastStep`.
 */
async function nextCode(secret: string, lastStep: number | null): Promise<{ code: string; step: number }> {
  for (;;) {
    const now = Date.now();
    const current = totpStep(now);
    const left = STEP_MS - (now % STEP_MS);
    const earliest = left > BOUNDARY_MARGIN_MS ? current - 1 : current;
    const step = lastStep === null ? earliest : Math.max(earliest, lastStep + 1);
    if (step <= current + 1) return { code: totpCode(base32Decode(secret)!, step), step };
    await sleep(left + 100);
  }
}

interface Session {
  accessToken: string;
  cookie: string;
}

interface TrailEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

describe.skipIf(!available)('MFA-T05 the two-step verification journey WF-17 (e2e, TEST-229)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let tokens: InstanceType<typeof TokenService>;
  let watermark = '00000000-0000-0000-0000-000000000000';
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx = { student: '', admin: '', studentEmail: '', adminEmail: '' };

  /** Every answer of the journey, in order, for the "shown once" checks. */
  const answers: { label: string; body: unknown }[] = [];
  /** Plain values that may appear in exactly one answer (the index of the answer that hands them over). */
  const shownOnce: { value: string; answer: number }[] = [];
  /** Values that no answer at all may carry (sealed secrets as stored). */
  const neverAnswered: string[] = [];
  /** Every TOTP code sent — no answer and no event may carry one. */
  const sentCodes: string[] = [];
  /** Session material — never in an event. */
  const sessionValues: string[] = [];

  const api = () => request(app.getHttpServer());
  const as = (ip: string) => ({ 'X-Forwarded-For': ip, 'User-Agent': USER_AGENT });
  const cookieHeader = (cookie: string) => `${REFRESH_COOKIE_NAME}=${cookie}`;
  const familyOf = async (cookie: string): Promise<string> =>
    (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(cookie) }, select: { familyId: true } })).familyId;

  function keep(label: string, res: SupertestResponse): number {
    answers.push({ label, body: res.body });
    return answers.length - 1;
  }

  function expectStatus(res: SupertestResponse, status: number, code?: string): void {
    expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);
    if (code) expect(res.body).toMatchObject({ statusCode: status, code });
  }

  /** The answer must be a session: the four session keys, a refresh cookie. */
  function sessionOf(res: SupertestResponse): Session {
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    const cookie = refreshCookie(res);
    expect(cookie).toEqual(expect.any(String));
    sessionValues.push(res.body.accessToken as string, cookie!);
    return { accessToken: res.body.accessToken as string, cookie: cookie! };
  }

  async function signIn(email: string, ip: string, label: string): Promise<SupertestResponse> {
    const res = await api().post(LOGIN).set(as(ip)).send({ identifier: email, password: PASSWORD });
    keep(label, res);
    expectStatus(res, 200);
    return res;
  }

  /** The password step of an MFA account: the challenge, no cookie. */
  async function challengeFor(label: string): Promise<string> {
    const res = await signIn(fx.studentEmail, STUDENT_IP, label);
    expect(Object.keys(res.body).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.mfaRequired).toBe(true);
    expect(setCookieLine(res)).toBe('');
    shownOnce.push({ value: res.body.challenge as string, answer: answers.length - 1 });
    return res.body.challenge as string;
  }

  async function secondStep(label: string, body: Record<string, unknown>): Promise<Session> {
    if (typeof body['code'] === 'string') sentCodes.push(body['code']);
    const res = await api().post(MFA_STEP).set(as(STUDENT_IP)).send(body);
    keep(label, res);
    expectStatus(res, 200);
    return sessionOf(res);
  }

  /** A POST to an MFA route as the student, with the session's refresh cookie (it marks "this device"). */
  async function mfaPost(label: string, session: Session, path: string, body: Record<string, unknown>): Promise<SupertestResponse> {
    if (typeof body['code'] === 'string') sentCodes.push(body['code']);
    const res = await api()
      .post(`${MFA}${path}`)
      .set(as(STUDENT_IP))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', cookieHeader(session.cookie))
      .send(body);
    keep(label, res);
    return res;
  }

  async function status(label: string, session: Session): Promise<Record<string, unknown>> {
    const res = await api().get(MFA).set(as(STUDENT_IP)).set('Authorization', `Bearer ${session.accessToken}`);
    keep(label, res);
    expectStatus(res, 200);
    return res.body as Record<string, unknown>;
  }

  async function refresh(label: string, cookie: string): Promise<SupertestResponse> {
    const res = await api().post(REFRESH).set(as(STUDENT_IP)).set('Cookie', cookieHeader(cookie));
    keep(label, res);
    return res;
  }

  async function logout(cookie: string): Promise<void> {
    const res = await api().post(LOGOUT).set(as(STUDENT_IP)).set('Cookie', cookieHeader(cookie));
    expectStatus(res, 204);
  }

  /** Setup + enable through the routes; returns the secret, the codes and the step the enabling code used. */
  async function turnOn(label: string, session: Session): Promise<{ secret: string; recoveryCodes: string[]; step: number; enabledAt: string; revokedSessions: number }> {
    const setup = await mfaPost(`${label} setup`, session, '/setup', { password: PASSWORD });
    expectStatus(setup, 200);
    expect(Object.keys(setup.body).sort()).toEqual(['expiresAt', 'otpauthUri', 'secret']);
    const secret = setup.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain(`secret=${secret}`);
    shownOnce.push({ value: secret, answer: answers.length - 1 });
    expect(await status(`${label} status after setup`, session)).toMatchObject({ enabled: false, pendingSetup: true });
    const pending = await prisma.user.findUniqueOrThrow({ where: { id: fx.student }, select: { mfaPendingSecret: true } });
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
    const sealed = await prisma.user.findUniqueOrThrow({ where: { id: fx.student }, select: { mfaSecret: true } });
    expect(sealed.mfaSecret).toBe(pending.mfaPendingSecret);
    return { secret, recoveryCodes, step, enabledAt: enable.body.enabledAt as string, revokedSessions: enable.body.revokedSessions as number };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    tokens = app.get(TokenService);
    const passwordHash = await new PasswordService().hash(PASSWORD);

    const superuser = await prisma.role.create({
      data: {
        key: `test_mfa_journey_admin_${RUN}`,
        label: { ar: 'دور اختبار رحلة التحقق بخطوتين' },
        permissions: { create: PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(superuser.id);
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } });

    fx.studentEmail = `mfa-journey-student-${RUN}@example.test`;
    fx.adminEmail = `mfa-journey-admin-${RUN}@example.test`;
    const student = await prisma.user.create({
      data: { email: fx.studentEmail, fullName: 'MFA journey student', passwordHash, status: 'active', roles: { create: [{ roleId: studentRole.id }] } },
      select: { id: true },
    });
    createdUserIds.push(student.id);
    const admin = await prisma.user.create({
      data: { email: fx.adminEmail, fullName: 'MFA journey administrator', passwordHash, status: 'active', roles: { create: [{ roleId: superuser.id }] } },
      select: { id: true },
    });
    createdUserIds.push(admin.id);
    fx.student = student.id;
    fx.admin = admin.id;

    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    watermark = latest?.id ?? watermark;
  });

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) await prisma?.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma?.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    } finally {
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it(
    'walks WF-17: enable, the two-step sign-in with a code and with a recovery code, new codes, disable, enable again, the administrative reset — with the exact audit trail and no secret outside its own answer',
    async () => {
      // 1. Two sessions of the student (this device and another one); MFA is off.
      const first = sessionOf(await signIn(fx.studentEmail, STUDENT_IP, 'sign in (this device)'));
      const other = sessionOf(await signIn(fx.studentEmail, STUDENT_IP, 'sign in (another device)'));
      const familyFirst = await familyOf(first.cookie);
      const familyOther = await familyOf(other.cookie);
      expect(await status('status off', first)).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });

      // 2. Setup + enable from this device: ten recovery codes, the other session is signed out, this one refreshes.
      const one = await turnOn('first', first);
      expect(one.revokedSessions).toBe(1);
      expectStatus(await refresh('refresh of the signed-out device', other.cookie), 401, 'refresh_reused');
      const refreshed = await refresh('refresh of this device', first.cookie);
      expectStatus(refreshed, 200);
      const current = sessionOf(refreshed);
      expect(await familyOf(current.cookie)).toBe(familyFirst);
      expect(await status('status on', current)).toEqual({ available: true, enabled: true, enabledAt: one.enabledAt, recoveryCodesLeft: 10, pendingSetup: false });

      // 3. Sign out; the password alone now answers a challenge; the second step with a TOTP code opens a session.
      await logout(current.cookie);
      const codeChallenge = await challengeFor('password step (code)');
      const login1 = await nextCode(one.secret, one.step);
      const viaCode = await secondStep('second step with a code', { challenge: codeChallenge, code: login1.code });
      const familyViaCode = await familyOf(viaCode.cookie);
      // The challenge worked once.
      const replay = await api().post(MFA_STEP).set(as(STUDENT_IP)).send({ challenge: codeChallenge, recoveryCode: one.recoveryCodes[0] });
      keep('the used challenge again', replay);
      expectStatus(replay, 401, 'mfa_challenge_invalid');

      // 4. Sign out; the second step with a recovery code (nine left).
      await logout(viaCode.cookie);
      const recoveryChallenge = await challengeFor('password step (recovery code)');
      const viaRecovery = await secondStep('second step with a recovery code', { challenge: recoveryChallenge, recoveryCode: one.recoveryCodes[3]!.toLowerCase() });
      const familyViaRecovery = await familyOf(viaRecovery.cookie);
      expect(await status('status after a recovery code', viaRecovery)).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });

      // 5. New recovery codes (the password and a current code); the old ones stop counting.
      const regenerateCode = await nextCode(one.secret, login1.step);
      const regenerated = await mfaPost('new recovery codes', viaRecovery, '/recovery-codes', { password: PASSWORD, code: regenerateCode.code });
      expectStatus(regenerated, 200);
      expect(Object.keys(regenerated.body)).toEqual(['recoveryCodes']);
      const newCodes = regenerated.body.recoveryCodes as string[];
      expect(newCodes).toHaveLength(10);
      for (const recoveryCode of newCodes) {
        expect(recoveryCode).toMatch(RECOVERY_CODE);
        expect(one.recoveryCodes).not.toContain(recoveryCode);
        shownOnce.push({ value: recoveryCode, answer: answers.length - 1 });
      }
      expect(await status('status after new codes', viaRecovery)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

      // 6. Disable with the password and a code; this session stays (no other session is live).
      const disableCode = await nextCode(one.secret, regenerateCode.step);
      const disabled = await mfaPost('disable', viaRecovery, '/disable', { password: PASSWORD, code: disableCode.code });
      expectStatus(disabled, 200);
      expect(disabled.body).toEqual({ revokedSessions: 0 });
      expect(await status('status after disable', viaRecovery)).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });
      expect(await prisma.mfaRecoveryCode.count({ where: { userId: fx.student } })).toBe(0);

      // 7. A plain sign-in opens a session at once; enable again from it (the recovery-code session is signed out).
      const plain = sessionOf(await signIn(fx.studentEmail, STUDENT_IP, 'plain sign-in'));
      const familyPlain = await familyOf(plain.cookie);
      const two = await turnOn('second', plain);
      expect(two.secret).not.toBe(one.secret);
      expect(two.revokedSessions).toBe(1);

      // 8. The administrator sees when MFA was turned on and resets it with a reason: every session of the student ends.
      const adminSession = sessionOf(await signIn(fx.adminEmail, ADMIN_IP, 'administrator sign-in'));
      const adminHeaders = { ...as(ADMIN_IP), Authorization: `Bearer ${adminSession.accessToken}` };
      const before = await api().get(`${USERS}/${fx.student}`).set(adminHeaders);
      keep('detail before the reset', before);
      expectStatus(before, 200);
      expect(before.body.mfaEnabledAt).toBe(two.enabledAt);
      const reset = await api().post(`${USERS}/${fx.student}/mfa/reset`).set(adminHeaders).send({ reason: RESET_REASON });
      keep('administrative reset', reset);
      expectStatus(reset, 200);
      expect(reset.body).toEqual({ userId: fx.student, reset: true, revokedSessions: 1 });
      expect(await prisma.refreshToken.count({ where: { userId: fx.student, revokedAt: null } })).toBe(0);
      expectStatus(await refresh('refresh after the reset', plain.cookie), 401, 'refresh_reused');

      // 9. The student signs in with the password alone; the detail shows MFA off.
      const final = sessionOf(await signIn(fx.studentEmail, STUDENT_IP, 'sign-in after the reset'));
      const familyFinal = await familyOf(final.cookie);
      expect(await status('status after the reset', final)).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesLeft: null, pendingSetup: false });
      const after = await api().get(`${USERS}/${fx.student}`).set(adminHeaders);
      keep('detail after the reset', after);
      expectStatus(after, 200);
      expect(after.body.mfaEnabledAt).toBeNull();
      for (const detail of [before.body, after.body]) {
        expect(keysOf(detail).filter((key) => SENSITIVE_DETAIL_KEY.test(key))).toEqual([]);
      }

      // 10. The student's exact audit trail above the watermark (events about the student or by the student).
      const trail: TrailEvent[] = await prisma.auditLog.findMany({
        where: { id: { gt: watermark }, OR: [{ entityId: fx.student }, { actorUserId: fx.student }] },
        orderBy: { id: 'asc' },
        select: { id: true, action: true, actorUserId: true, entityType: true, entityId: true, metadata: true, ipAddress: true, userAgent: true },
      });
      const expected: { action: string; actor: string; metadata: Record<string, unknown> }[] = [
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyFirst } },
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyOther } },
        { action: 'auth.mfa.enabled', actor: fx.student, metadata: { revokedSessions: 1 } },
        { action: 'auth.refresh.reuse_detected', actor: fx.student, metadata: { familyId: familyOther } },
        { action: 'auth.logout', actor: fx.student, metadata: { familyId: familyFirst } },
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyViaCode, via: 'mfa' } },
        { action: 'auth.logout', actor: fx.student, metadata: { familyId: familyViaCode } },
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyViaRecovery, via: 'recovery_code', recoveryCodesLeft: 9 } },
        { action: 'auth.mfa.recovery_codes.regenerated', actor: fx.student, metadata: { count: 10 } },
        { action: 'auth.mfa.disabled', actor: fx.student, metadata: { via: 'code', revokedSessions: 0 } },
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyPlain } },
        { action: 'auth.mfa.enabled', actor: fx.student, metadata: { revokedSessions: 1 } },
        { action: 'users.mfa.reset', actor: fx.admin, metadata: { revokedSessions: 1, reason: RESET_REASON } },
        { action: 'auth.refresh.reuse_detected', actor: fx.student, metadata: { familyId: familyPlain } },
        { action: 'auth.login.succeeded', actor: fx.student, metadata: { familyId: familyFinal } },
      ];
      expect(trail.map((event) => event.action)).toEqual(expected.map((event) => event.action));
      trail.forEach((event, index) => {
        const want = expected[index]!;
        expect(event.actorUserId, `${index} ${event.action}`).toBe(want.actor);
        expect(event.entityType).toBe('users');
        expect(event.entityId).toBe(fx.student);
        expect(event.metadata, `${index} ${event.action}`).toEqual(want.metadata);
        expect(event.ipAddress).toBe(want.actor === fx.admin ? ADMIN_IP : STUDENT_IP);
        expect(event.userAgent).toBe(USER_AGENT);
      });
      // The administrator's own events: the sign-in and the reset — the two detail reads record nothing.
      const adminEvents = await prisma.auditLog.findMany({
        where: { id: { gt: watermark }, actorUserId: fx.admin },
        orderBy: { id: 'asc' },
        select: { action: true, entityId: true },
      });
      expect(adminEvents).toEqual([
        { action: 'auth.login.succeeded', entityId: fx.admin },
        { action: 'users.mfa.reset', entityId: fx.student },
      ]);

      // 11. No secret, code, recovery code or challenge outside the one answer that hands it over; none in any event.
      // Five TOTP codes: two enablings, the second sign-in step, the new recovery codes and the disabling.
      expect(sentCodes).toHaveLength(5);
      const serializedAnswers = answers.map((answer) => JSON.stringify(answer.body));
      for (const { value, answer } of shownOnce) {
        const carriers = serializedAnswers.flatMap((body, index) => (body.includes(value) ? [index] : []));
        expect(carriers, `${value.slice(0, 4)}… shown in ${carriers.map((index) => answers[index]!.label).join(', ')}`).toEqual([answer]);
      }
      for (const value of neverAnswered) {
        expect(serializedAnswers.some((body) => body.includes(value))).toBe(false);
      }
      for (const answer of answers) {
        const leaves = leavesOf(answer.body);
        for (const code of sentCodes) expect(leaves, answer.label).not.toContain(code);
      }
      const everyEvent = [...trail, ...(await prisma.auditLog.findMany({ where: { id: { gt: watermark }, actorUserId: fx.admin } }))];
      for (const event of everyEvent) {
        expect(() => assertNoSecrets(event.metadata as Record<string, unknown> | null)).not.toThrow();
        const serialized = JSON.stringify(event.metadata);
        for (const { value } of shownOnce) expect(serialized).not.toContain(value);
        for (const value of [...neverAnswered, ...sessionValues]) expect(serialized).not.toContain(value);
        const leaves = leavesOf(event.metadata);
        for (const code of sentCodes) expect(leaves).not.toContain(code);
      }
    },
    JOURNEY_TIMEOUT_MS,
  );
});
