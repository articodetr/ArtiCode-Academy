// TEST-228 — MFA-T04 (roadmap §4n): the administrative reset of a user's
// two-step verification, POST /api/users/:id/mfa/reset (API-212), and
// `mfaEnabledAt` in the user detail (API-013), against the live development
// database. Acceptance criteria: (1) SEC-R-15 is checked before the MFA state;
// (2) every session of the user ends; (3) exactly one event per reset, none for
// a no-op or a refusal. MFA is turned on for the fixtures directly through
// Prisma (the enrolment routes are MFA-T02). The encryption key is a fixed TEST
// key set before the application is imported (process variables beat the env
// files). Skipped when no database is reachable. Fixtures carry a unique suffix
// and are deleted at the end (cascade removes their roles, tokens, recovery
// codes and challenges; their audit rows stay — the log is append-only).
// Events are counted by fixture above an `id` watermark, so other clients of
// the shared dev DB never pollute the counts.
import { createHash, randomBytes } from 'node:crypto';
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
import { generateTotpSecret, totpStep } from '../src/auth/mfa/totp.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
/** A fixed TEST key (32 bytes) — never a real one. */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
process.env['AUTH_MFA_ENCRYPTION_KEY'] = TEST_KEY;

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USERS = '/api/users';
const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';
const RESET_EVENT = 'users.mfa.reset';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';
/** No key of a response may name a credential or an MFA secret (TEST-011 rule + MFA-T04). */
const SENSITIVE_KEY = /hash|password|secret|mfa_?last|recovery|challenge/i;
const RESULT_KEYS = ['reset', 'revokedSessions', 'userId'];
/** The first `GET /api/docs-json` builds the whole document; under a parallel e2e load it can exceed the 5 s default (KI-040). */
const OPENAPI_TIMEOUT_MS = 20_000;

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

/** Every object key anywhere inside a JSON value. */
function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out.add(key);
      collectKeys(nested, out);
    }
  }
  return out;
}

/** The refresh cookie value from a response, or undefined when absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = lines.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** What a fixture's MFA looked like when it was turned on (the plain values never leave the test). */
interface MfaFixture {
  sealed: string;
  pendingSealed: string;
  enabledAt: Date;
  recoveryCodes: string[];
}

describe.skipIf(!available)('MFA-T04 administrative MFA reset and mfaEnabledAt in the detail (e2e, TEST-228)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let passwordHash: string;
  const key = parseMfaKey(TEST_KEY)!;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  /** Fixture name → user id. */
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** Refresh cookies of the target, obtained before its MFA was turned on. */
  const targetCookies: string[] = [];
  const mfa: Record<string, MfaFixture> = {};

  const email = (name: string) => `mfa-reset-${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });
  const reset = (caller: string, id: string, body?: Record<string, unknown>) => {
    const req = api().post(`${USERS}/${id}/mfa/reset`).set(bearer(caller));
    return body === undefined ? req : req.send(body);
  };

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_mfa_${name}_${RUN}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, data: Partial<Prisma.UserCreateInput> & { roleIds?: string[] } = {}): Promise<string> {
    const { roleIds, ...rest } = data;
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `MFA reset ${name}`,
        passwordHash,
        status: 'active',
        roles: roleIds ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
        ...rest,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function signIn(name: string): Promise<{ accessToken: string; cookie: string }> {
    const res = await api().post(LOGIN).send({ identifier: email(name), password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cookie = refreshCookie(res);
    expect(cookie).toEqual(expect.any(String));
    return { accessToken: res.body.accessToken as string, cookie: cookie! };
  }

  /** Turns MFA on through Prisma: a sealed secret, a replay step, a setup in progress, two recovery codes and an open sign-in challenge. */
  async function enableMfa(name: string): Promise<void> {
    const userId = fx[name]!;
    const enabledAt = new Date();
    const fixture: MfaFixture = {
      sealed: sealSecret(key, generateTotpSecret(), userId),
      pendingSealed: sealSecret(key, generateTotpSecret(), userId),
      enabledAt,
      recoveryCodes: generateRecoveryCodes().slice(0, 2),
    };
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: fixture.sealed,
        mfaEnabledAt: enabledAt,
        mfaLastStep: BigInt(totpStep(Date.now()) - 1),
        mfaPendingSecret: fixture.pendingSealed,
        mfaPendingAt: enabledAt,
      },
    });
    await prisma.mfaRecoveryCode.createMany({
      data: fixture.recoveryCodes.map((code) => ({ userId, codeHash: hashRecoveryCode(deriveRecoveryCodeKey(key), userId, normalizeRecoveryCode(code)!) })),
    });
    await prisma.verificationToken.create({
      data: {
        userId,
        purpose: 'mfa_challenge',
        tokenHash: sha256(randomBytes(32).toString('base64url')),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        metadata: { attempts: 0 },
      },
    });
    mfa[name] = fixture;
  }

  const mfaColumns = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true, mfaPendingSecret: true, mfaPendingAt: true },
    });
  const recoveryCodesOf = (id: string) => prisma.mfaRecoveryCode.count({ where: { userId: id } });
  const openChallengesOf = (id: string) =>
    prisma.verificationToken.count({ where: { userId: id, purpose: 'mfa_challenge', consumedAt: null } });
  const liveSessionsOf = (id: string) => prisma.refreshToken.count({ where: { userId: id, revokedAt: null } });

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const resetEventsSince = (markId: string, entityId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, action: RESET_EVENT, entityId }, orderBy: { id: 'asc' } });

  /** Every event above the watermark whose actor or entity is one of this suite's fixtures. */
  const fixtureEventsSince = (markId: string) =>
    prisma.auditLog.findMany({
      where: { id: { gt: markId }, OR: [{ actorUserId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }] },
      select: { action: true, actorUserId: true, entityId: true },
    });

  /** A response carries no credential-like key and none of the stored secrets or recovery codes. */
  function expectNoSecrets(body: unknown): void {
    expect([...collectKeys(body)].filter((name) => SENSITIVE_KEY.test(name))).toEqual([]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/\$argon2|Correct-Horse/);
    for (const fixture of Object.values(mfa)) {
      expect(text).not.toContain(fixture.sealed);
      expect(text).not.toContain(fixture.pendingSealed);
      for (const code of fixture.recoveryCodes) expect(text).not.toContain(code);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    passwordHash = await passwords.hash(PASSWORD);

    const teacherRole = await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } });
    const allKeys = await createRole('all', PERMISSION_KEYS);
    const updater = await createRole('updater', ['users.read', 'users.update']);
    const reader = await createRole('reader', ['users.read']);

    // Callers.
    await createUser('admin', { roleIds: [allKeys] });
    await createUser('updater', { roleIds: [updater] });
    await createUser('reader', { roleIds: [reader] });
    // The seeded teacher role holds users.read without users.read_contact (D-R07).
    await createUser('teacher', { roleIds: [teacherRole.id] });
    for (const name of ['admin', 'updater', 'reader', 'teacher']) tokens[name] = (await signIn(name)).accessToken;

    // Targets.
    await createUser('target');
    // Two live sessions, opened BEFORE MFA is turned on (a password sign-in then still opens a session).
    for (let i = 0; i < 2; i += 1) targetCookies.push((await signIn('target')).cookie);
    await enableMfa('target');

    // A target whose roles confer every permission: within reach of `admin` only (SEC-R-15).
    await createUser('privileged', { roleIds: [allKeys] });
    await signIn('privileged');
    await enableMfa('privileged');
    await createUser('privileged-plain', { roleIds: [allKeys] }); // the same reach, no MFA

    await createUser('deleted', { status: 'archived', deletedAt: new Date() });
    await enableMfa('deleted');
  }, 60_000);

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma?.$disconnect();
    await app?.close();
  });

  it('resets the MFA of a user: every MFA column, recovery code and open challenge is gone, every session ends, exactly one event (AC 2, AC 3)', async () => {
    const id = fx['target']!;
    expect(await liveSessionsOf(id)).toBe(2);
    expect(await recoveryCodesOf(id)).toBe(2);
    expect(await openChallengesOf(id)).toBe(1);
    const watermark = await mark();

    const res = await reset('admin', id, { reason: '  Lost phone; identity confirmed at the front desk  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ userId: id, reset: true, revokedSessions: 2 });
    expect(Object.keys(res.body).sort()).toEqual(RESULT_KEYS);
    expectNoSecrets(res.body);

    expect(await mfaColumns(id)).toEqual({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null });
    expect(await recoveryCodesOf(id)).toBe(0);
    expect(await openChallengesOf(id)).toBe(0);
    expect(await liveSessionsOf(id)).toBe(0);

    const events = await resetEventsSince(watermark, id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: RESET_EVENT,
      actorUserId: fx['admin'],
      entityType: 'users',
      entityId: id,
      metadata: { revokedSessions: 2, reason: 'Lost phone; identity confirmed at the front desk' },
    });
    expect(Object.keys(events[0]!.metadata as object).sort()).toEqual(['reason', 'revokedSessions']);
    expectNoSecrets(events[0]!.metadata);

    // Both refresh cookies of the target are dead.
    for (const cookie of targetCookies) {
      await api().post(REFRESH).set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`).expect(401);
    }
    // MFA is off: the password alone opens a session again.
    await signIn('target');
    expect(await liveSessionsOf(id)).toBe(1);
    // The detail follows.
    const detail = await api().get(`${USERS}/${id}`).set(bearer('admin')).expect(200);
    expect(detail.body.mfaEnabledAt).toBeNull();
  });

  it('answers reset: false and writes and records nothing for an account without MFA (the no-op)', async () => {
    const id = fx['target']!;
    const watermark = await mark();
    const res = await reset('admin', id, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ userId: id, reset: false, revokedSessions: 0 });
    expect(await liveSessionsOf(id)).toBe(1); // the session opened after the first reset survives
    expect(await resetEventsSince(watermark, id)).toEqual([]);
    expect(await fixtureEventsSince(watermark)).toEqual([]);
  });

  it('resets a setup awaiting confirmation on a suspended account, with no body and no reason in the event', async () => {
    const id = await createUser('suspended', { status: 'suspended' });
    const pendingAt = new Date();
    await prisma.user.update({
      where: { id },
      data: { mfaPendingSecret: sealSecret(key, generateTotpSecret(), id), mfaPendingAt: pendingAt },
    });
    const watermark = await mark();

    const res = await reset('admin', id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ userId: id, reset: true, revokedSessions: 0 });
    expect(await mfaColumns(id)).toEqual({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe('suspended');

    const events = await resetEventsSince(watermark, id);
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ revokedSessions: 0 });
  });

  it('refuses a caller who holds users.update but not every permission of the target — before anything about MFA, nothing changes (SEC-R-15, AC 1)', async () => {
    const id = fx['privileged']!;
    const before = await mfaColumns(id);
    const watermark = await mark();

    const res = await reset('updater', id, { reason: 'Trying to reach an admin' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'permission_denied' });
    expect(res.body.missing).toEqual(expect.arrayContaining(['users.deactivate', 'roles.manage']));
    expect(res.body.missing).not.toContain('users.update');

    expect(await mfaColumns(id)).toEqual(before);
    expect(before.mfaSecret).toBe(mfa['privileged']!.sealed);
    expect(await recoveryCodesOf(id)).toBe(2);
    expect(await openChallengesOf(id)).toBe(1);
    expect(await liveSessionsOf(id)).toBe(1);

    // The same answer for an equally privileged target WITHOUT MFA: the state is never consulted first.
    const plain = await reset('updater', fx['privileged-plain']!);
    expect(plain.status, JSON.stringify(plain.body)).toBe(403);
    expect(plain.body).toEqual(res.body);

    expect(await fixtureEventsSince(watermark)).toEqual([]);
  });

  it('refuses a caller without users.update, oneself (self_forbidden), unknown and soft-deleted ids, and malformed requests — no event for any refusal', async () => {
    const watermark = await mark();

    const denied = await reset('reader', fx['privileged']!);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['users.update'] });
    // The seeded teacher role holds no users.update either.
    expect((await reset('teacher', fx['privileged']!)).body).toMatchObject({ code: 'permission_denied', missing: ['users.update'] });

    const self = await reset('admin', fx['admin']!, { reason: 'Myself' });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body).toMatchObject({ code: 'self_forbidden', action: 'mfa_reset' });

    const unknown = await reset('admin', UNKNOWN_ID);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('user_not_found');
    const deleted = await reset('admin', fx['deleted']!);
    expect(deleted.status).toBe(404);
    expect(deleted.body.code).toBe('user_not_found');
    // The soft-deleted account keeps its MFA: nothing applies to it.
    expect((await mfaColumns(fx['deleted']!)).mfaSecret).toBe(mfa['deleted']!.sealed);

    await reset('admin', 'not-a-uuid').expect(400);
    await reset('admin', fx['privileged']!, { reason: 'x'.repeat(501) }).expect(400);
    await reset('admin', fx['privileged']!, { note: 'undeclared' }).expect(400);
    await api().post(`${USERS}/${fx['privileged']}/mfa/reset`).expect(401);

    // The privileged target is untouched by all of the above.
    expect((await mfaColumns(fx['privileged']!)).mfaSecret).toBe(mfa['privileged']!.sealed);
    expect(await liveSessionsOf(fx['privileged']!)).toBe(1);
    expect(await fixtureEventsSince(watermark)).toEqual([]);
  });

  it('shows mfaEnabledAt in the detail to holders of users.read_contact only, never in the list, and never an MFA secret (D-R07)', async () => {
    const id = fx['privileged']!;
    const full = await api().get(`${USERS}/${id}`).set(bearer('admin')).expect(200);
    expect(full.body.mfaEnabledAt).toBe(mfa['privileged']!.enabledAt.toISOString());
    expectNoSecrets(full.body);

    // The seeded teacher role: users.read without users.read_contact — the same key, null.
    const reduced = await api().get(`${USERS}/${id}`).set(bearer('teacher')).expect(200);
    expect(reduced.body).toHaveProperty('mfaEnabledAt', null);
    expect(reduced.body.lockedUntil).toBeNull();
    expectNoSecrets(reduced.body);

    // A user without MFA: null for everyone.
    expect((await api().get(`${USERS}/${fx['reader']}`).set(bearer('admin')).expect(200)).body).toHaveProperty('mfaEnabledAt', null);

    // The list items do not carry it.
    const list = await api().get(`${USERS}?q=${RUN}&limit=100`).set(bearer('admin')).expect(200);
    const items = list.body.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item['id'])).toContain(id);
    for (const item of items) expect(item).not.toHaveProperty('mfaEnabledAt');
    expectNoSecrets(list.body);
  });

  it('documents the reset endpoint and mfaEnabledAt in OpenAPI', async () => {
    const res = await api().get('/api/docs-json').expect(200);
    const operation = res.body.paths['/api/users/{id}/mfa/reset']?.post;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404']) expect(operation.responses, code).toHaveProperty(code);
    expect(operation.requestBody).toBeDefined();
    const schemas = res.body.components.schemas as Record<string, { properties: Record<string, Record<string, unknown>> }>;
    expect(Object.keys(schemas['MfaResetResultDto']!.properties).sort()).toEqual(RESULT_KEYS);
    expect(schemas['UserDetailDto']!.properties['mfaEnabledAt']).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(schemas['UserListItemDto']!.properties).not.toHaveProperty('mfaEnabledAt');
  }, OPENAPI_TIMEOUT_MS);
});
