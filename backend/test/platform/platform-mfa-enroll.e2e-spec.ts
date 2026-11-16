// (e2e) — PMFA (roadmap §4o): turning two-step verification ON for a PLATFORM
// account from the server — enrollPlatformUserMfa() of
// src/platform/auth/mfa/platform-mfa-enroll.ts and its command
// scripts/platform-enable-mfa.ts (npm run platform:enable-mfa), the terminal
// way to what API-214 + API-215 do over HTTP (the platform has no frontend).
// Acceptance: after the account's password and a code of the new secret, ONE
// transaction writes what API-215 writes — the secret sealed with the platform
// key and bound to the user, `mfa_enabled_at`, `mfa_last_step` = the matched
// step, the pending columns cleared, ten recovery codes as keyed hashes — plus
// every live session revoked and exactly one `platform.auth.mfa.enabled
// { revokedSessions, via: 'cli' }` without an actor; the account then passes
// the REAL second sign-in step of the platform API (API-178 → API-218) with the
// next code and with a recovery code; nothing is written before the code is
// confirmed; every refusal (wrong password, three wrong codes, MFA already on,
// unknown e-mail, suspended, a change while waiting) writes nothing — no
// lockout counter, no event; the command prints the key and the recovery codes
// to its terminal once and never the password or the key, refuses without a
// usable PLATFORM_MFA_ENCRYPTION_KEY and outside an interactive terminal.
//
// The secrets are sealed with a fixed TEST key set before the platform module
// is imported (process variables beat the env files). Skipped when the platform
// database is unreachable (./helpers.ts). Fixture accounts are deleted in
// afterAll (their tokens, recovery codes and challenges cascade; their audit
// rows stay — the log is append-only). Events are counted above an id
// watermark and by the fixture account they name, so other clients of the
// shared dev platform DB never pollute the counts.
import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PromptAborted, runPlatformEnableMfa } from '../../scripts/platform-enable-mfa.js';
import type { EnableMfaTerminal } from '../../scripts/platform-enable-mfa.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { deriveRecoveryCodeKey, hashRecoveryCode, normalizeRecoveryCode } from '../../src/auth/mfa/recovery-codes.js';
import { SEALED_SECRET_PATTERN, openSecret, sealSecret } from '../../src/auth/mfa/secret-box.js';
import { base32Decode, generateTotpSecret, otpauthUri, totpCode, totpStep } from '../../src/auth/mfa/totp.js';
import {
  PLATFORM_MFA_ENROLL_CODE_ATTEMPTS,
  PLATFORM_MFA_ENROLL_EVENT,
  PLATFORM_MFA_ENROLL_ISSUER,
  enrollPlatformUserMfa,
  groupTotpSecret,
  resolvePlatformMfaKey,
} from '../../src/platform/auth/mfa/platform-mfa-enroll.js';
import type { PlatformMfaEnrollResult, PlatformMfaEnrollSetup } from '../../src/platform/auth/mfa/platform-mfa-enroll.js';
import type { PlatformUserFixture } from './helpers.js';

/** A fixed TEST key (32 bytes) — never a real one, and not the academy suites' key. */
const TEST_KEY = Buffer.alloc(32, 9);
const TEST_KEY_TEXT = TEST_KEY.toString('base64');
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = TEST_KEY_TEXT;

// After the variable: helpers.ts imports PlatformAppModule, whose ConfigModule reads it.
const {
  PLATFORM_TEST_RUN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformDatabaseUrl,
  platformDbReachable,
  platformTestDb,
} = await import('./helpers.js');
const { PLATFORM_MFA_EVENTS, PLATFORM_MFA_ISSUER } = await import('../../src/platform/auth/mfa/platform-mfa.service.js');
const { PLATFORM_REFRESH_COOKIE_NAME } = await import('../../src/platform/auth/platform-cookies.js');

const available = await platformDbReachable();

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASSWORD = 'Correct-Horse-Enrol-9';
const WRONG_PASSWORD = 'Wrong-Horse-Enrol-9!';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RECOVERY_CODE = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}/g;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const recoveryKey = deriveRecoveryCodeKey(TEST_KEY);
/** The stored form of a recovery code: keyed (derived from the MFA key) and bound to the user. */
const storedHash = (userId: string, code: string): string => hashRecoveryCode(recoveryKey, userId, normalizeRecoveryCode(code)!);

/** The TOTP code of the secret `offset` steps from the instant `atMs`. */
function codeFor(secret: string, atMs: number, offset = 0): string {
  return totpCode(base32Decode(secret)!, totpStep(atMs) + offset);
}

/** A six-digit code that matches none of the steps near `atMs`. */
function wrongCodeFor(secret: string, atMs: number): string {
  const near = new Set([-2, -1, 0, 1, 2, 3].map((offset) => codeFor(secret, atMs, offset)));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, '0');
    if (!near.has(candidate)) return candidate;
  }
}

/** `candidate`, unless it happens to be a code the ±1 step window accepts at `atMs` (one chance in ~300,000) — then a surely wrong one. */
function surelyWrong(candidate: string, secret: string, atMs: number): string {
  const accepted = [-1, 0, 1].map((offset) => codeFor(secret, atMs, offset));
  return accepted.includes(candidate) ? wrongCodeFor(secret, atMs) : candidate;
}

/** The newest platform_audit_logs id (UUIDv7 = insertion order), or null on an empty log. */
async function auditMark(): Promise<string | null> {
  const last = await platformTestDb().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return last?.id ?? null;
}

/** Every event naming one fixture account (as entity or actor) written after `mark`, oldest first. */
async function eventsSince(mark: string | null, userId: string) {
  return platformTestDb().platformAuditLog.findMany({
    where: {
      OR: [{ entityId: userId }, { actorPlatformUserId: userId }],
      ...(mark ? { id: { gt: mark } } : {}),
    },
    orderBy: { id: 'asc' },
    select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true, ipAddress: true, userAgent: true },
  });
}

/** Everything an enrolment could touch of one account — equal before and after a refusal. */
async function snapshot(userId: string) {
  const db = platformTestDb();
  const row = await db.platformUser.findUniqueOrThrow({
    where: { id: userId },
    select: {
      status: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      lastLoginAt: true,
      mfaSecret: true,
      mfaEnabledAt: true,
      mfaLastStep: true,
      mfaPendingSecret: true,
      mfaPendingAt: true,
      updatedAt: true,
    },
  });
  const codes = await db.platformMfaRecoveryCode.findMany({
    where: { userId },
    orderBy: { id: 'asc' },
    select: { id: true, codeHash: true, usedAt: true },
  });
  const tokens = await db.platformRefreshToken.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: { id: true, revokedAt: true } });
  return { row, codes, tokens };
}

/** A live refresh token of the account, straight through Prisma. */
async function liveToken(userId: string): Promise<string> {
  const token = await platformTestDb().platformRefreshToken.create({
    data: { userId, tokenHash: sha256(`${userId}:${Math.random()}:${Date.now()}`), expiresAt: new Date(Date.now() + DAY_MS) },
    select: { id: true },
  });
  return token.id;
}

function expectNoSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of [...secrets, TEST_KEY_TEXT, TEST_KEY.toString('base64url'), PASSWORD, WRONG_PASSWORD]) {
    expect(text.includes(secret), 'a secret leaked').toBe(false);
  }
}

interface EnrollRun {
  result: PlatformMfaEnrollResult;
  /** What onSetup received — once, or never when the run was refused before it. */
  setups: PlatformMfaEnrollSetup[];
  /** The attempt numbers readCode was called with. */
  attempts: number[];
}

const passwords = new PasswordService();

/** Runs enrollPlatformUserMfa() with the test key; `code` answers each prompt from the secret that was handed out. */
async function enroll(
  email: string,
  options: {
    password?: string;
    code: (setup: PlatformMfaEnrollSetup, attempt: number) => string | Promise<string>;
    at?: Date;
  },
): Promise<EnrollRun> {
  const setups: PlatformMfaEnrollSetup[] = [];
  const attempts: number[] = [];
  const at = options.at;
  const result = await enrollPlatformUserMfa(
    platformTestDb(),
    {
      email,
      password: options.password ?? PASSWORD,
      onSetup: (setup) => {
        setups.push(setup);
      },
      readCode: async (attempt) => {
        attempts.push(attempt);
        return options.code(setups[0]!, attempt);
      },
      ...(at ? { now: () => at } : {}),
    },
    { key: TEST_KEY, passwords },
  );
  return { result, setups, attempts };
}

/** A terminal that answers from a script and records everything the command showed. */
function scriptedTerminal(script: {
  password?: string;
  /** Answers a code prompt; `secret` is read from the `otpauth://` link the command printed, as an authenticator app would. */
  code?: (secret: string, attempt: number) => string | Promise<string>;
  interactive?: boolean;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const hiddenPrompts: string[] = [];
  const linePrompts: string[] = [];
  const printedSecret = (): string => {
    const uri = out.join('\n').match(/otpauth:\/\/\S+/)?.[0];
    return uri ? (new URL(uri).searchParams.get('secret') ?? '') : '';
  };
  const terminal: EnableMfaTerminal = {
    interactive: script.interactive ?? true,
    readHidden: async (question) => {
      hiddenPrompts.push(question);
      return script.password ?? PASSWORD;
    },
    readLine: async (question) => {
      linePrompts.push(question);
      if (!script.code) throw new Error('no code was scripted for this run');
      return script.code(printedSecret(), linePrompts.length);
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return {
    terminal,
    out,
    err,
    hiddenPrompts,
    linePrompts,
    printedSecret,
    /** Everything the command wrote or asked, as one text. */
    all: () => [...out, ...err, ...hiddenPrompts, ...linePrompts].join('\n'),
  };
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `scripts/platform-enable-mfa.ts` through tsx in a child process (cwd backend/) — its stdin and stdout are pipes, never a terminal. */
function runCli(args: string[], env: Record<string, string>): Promise<CliRun> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/platform-enable-mfa.ts', ...args],
      { cwd: BACKEND_DIR, env: { ...process.env, ...env }, timeout: 60_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          rejectRun(error);
          return;
        }
        resolveRun({ code: error ? (error.code as number) : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

describe('platform MFA enrolment — the key and the typed form of the secret (pure)', () => {
  it('reads PLATFORM_MFA_ENCRYPTION_KEY as the platform API does: unset or empty, invalid, or shared with the academy is no key', () => {
    expect(resolvePlatformMfaKey({})).toEqual({ key: null, problem: 'key_missing' });
    expect(resolvePlatformMfaKey({ PLATFORM_MFA_ENCRYPTION_KEY: '' })).toEqual({ key: null, problem: 'key_missing' });
    for (const invalid of ['   ', 'not-a-key', Buffer.alloc(31, 1).toString('base64'), Buffer.alloc(33, 1).toString('base64'), `${TEST_KEY_TEXT}x`]) {
      expect(resolvePlatformMfaKey({ PLATFORM_MFA_ENCRYPTION_KEY: invalid }), invalid).toEqual({ key: null, problem: 'key_invalid' });
    }

    const other = Buffer.alloc(32, 200);
    for (const text of [other.toString('base64'), other.toString('base64url'), ` ${other.toString('base64')} `]) {
      const resolved = resolvePlatformMfaKey({ PLATFORM_MFA_ENCRYPTION_KEY: text });
      expect(resolved.problem, text).toBeNull();
      expect(resolved.key?.equals(other), text).toBe(true);
    }

    // The same 32 bytes as the academy's key, whatever the two encodings: the platform API would refuse to start.
    expect(
      resolvePlatformMfaKey({ PLATFORM_MFA_ENCRYPTION_KEY: other.toString('base64'), AUTH_MFA_ENCRYPTION_KEY: other.toString('base64url') }),
    ).toEqual({ key: null, problem: 'key_shared_with_academy' });
    // Another academy key, an empty one or one that is no key at all does not stand in the way.
    for (const academy of [TEST_KEY_TEXT, '', 'not-a-key']) {
      expect(
        resolvePlatformMfaKey({ PLATFORM_MFA_ENCRYPTION_KEY: other.toString('base64'), AUTH_MFA_ENCRYPTION_KEY: academy }).problem,
        academy,
      ).toBeNull();
    }
  });

  it('groups the Base32 secret in fours without changing what an app reads', () => {
    const secret = generateTotpSecret();
    const grouped = groupTotpSecret(secret);
    expect(grouped).toMatch(/^(?:[A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(grouped.replaceAll(' ', '')).toBe(secret);
    expect(base32Decode(grouped)?.equals(base32Decode(secret)!)).toBe(true);
    expect(groupTotpSecret('ABCDEFG')).toBe('ABCD EFG');
    expect(groupTotpSecret('')).toBe('');
  });

  it('names the event and the issuer exactly as API-214/API-215 do, and allows three codes', () => {
    expect(PLATFORM_MFA_ENROLL_EVENT).toBe(PLATFORM_MFA_EVENTS.enabled);
    expect(PLATFORM_MFA_ENROLL_ISSUER).toBe(PLATFORM_MFA_ISSUER);
    expect(PLATFORM_MFA_ENROLL_CODE_ATTEMPTS).toBe(3);
  });
});

describe.skipIf(!available)('platform MFA enrolment by a server command — enrollPlatformUserMfa() and platform:enable-mfa (e2e)', () => {
  let app: NestExpressApplication;
  const fixtureIds: string[] = [];
  /** The environment the command gets in-process: the platform database and the test key, nothing else. */
  const cliEnv = (): Record<string, string | undefined> => ({
    PLATFORM_DATABASE_URL: platformDatabaseUrl(),
    PLATFORM_MFA_ENCRYPTION_KEY: TEST_KEY_TEXT,
  });

  const api = () => request(app.getHttpServer());

  async function fixture(input: Partial<Parameters<typeof createPlatformUserFixture>[0]> = {}): Promise<PlatformUserFixture> {
    const user = await createPlatformUserFixture({ role: 'support', password: PASSWORD, ...input });
    fixtureIds.push(user.id);
    return user;
  }

  /** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
  function refreshCookie(res: SupertestResponse): string | undefined {
    const header = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
    const line = cookies.find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`));
    const value = line?.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
    return value && value.length > 0 ? value : undefined;
  }

  beforeAll(async () => {
    app = await createPlatformTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('enables MFA after the password and a right code: sealed secret, last step, ten keyed hashes, every session revoked, one event without an actor — and nothing before the code', async () => {
    const db = platformTestDb();
    const target = await fixture({ failedLoginCount: 3 });
    const bystander = await fixture();
    // What a real account may carry: two live sessions and an older revoked one, a setup started over
    // HTTP (API-214) and never confirmed, and a stray recovery code that must not survive.
    const liveIds = [await liveToken(target.id), await liveToken(target.id)];
    const revokedAt = new Date(Date.now() - DAY_MS);
    const revokedId = await liveToken(target.id);
    await db.platformRefreshToken.update({ where: { id: revokedId }, data: { revokedAt } });
    const pendingSealed = sealSecret(TEST_KEY, generateTotpSecret(), target.id);
    await db.platformUser.update({
      where: { id: target.id },
      data: { mfaPendingSecret: pendingSealed, mfaPendingAt: new Date(Date.now() - MINUTE_MS) },
    });
    const strayHash = sha256(`stray:${target.id}`);
    await db.platformMfaRecoveryCode.create({ data: { userId: target.id, codeHash: strayHash } });
    await liveToken(bystander.id);
    const before = await snapshot(target.id);
    const bystanderBefore = await snapshot(bystander.id);
    const mark = await auditMark();

    const at = new Date();
    let seenWhileAsking: Awaited<ReturnType<typeof snapshot>> | undefined;
    let eventsWhileAsking = -1;
    // The e-mail as an operator may type it: spaces and capitals.
    const run = await enroll(`  ${target.email.toUpperCase()} `, {
      at,
      code: async (setup) => {
        // The secret is in the holder's hands and nothing has been written yet.
        seenWhileAsking = await snapshot(target.id);
        eventsWhileAsking = (await eventsSince(mark, target.id)).length;
        return codeFor(setup.secret, at.getTime());
      },
    });

    expect(seenWhileAsking).toEqual(before);
    expect(eventsWhileAsking).toBe(0);
    expect(run.attempts).toEqual([1]);
    expect(run.setups).toHaveLength(1);
    const setup = run.setups[0]!;
    expect(setup).toEqual({
      userId: target.id,
      email: target.email,
      issuer: PLATFORM_MFA_ISSUER,
      account: target.email,
      secret: expect.stringMatching(/^[A-Z2-7]{32}$/),
      // The very link API-214 answers for this account.
      otpauthUri: otpauthUri({ issuer: PLATFORM_MFA_ISSUER, account: target.email, secret: setup.secret }),
    });

    expect(run.result).toEqual({
      outcome: 'enabled',
      userId: target.id,
      enabledAt: at,
      recoveryCodes: expect.any(Array),
      revokedSessions: 2,
    });
    if (run.result.outcome !== 'enabled') throw new Error('unreachable');
    const { recoveryCodes } = run.result;
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);

    // The row: exactly what API-215 leaves behind.
    const after = await snapshot(target.id);
    expect(after.row.mfaSecret).toMatch(SEALED_SECRET_PATTERN);
    expect(openSecret(TEST_KEY, after.row.mfaSecret!, target.id)).toBe(setup.secret);
    // Bound to this user and to this key.
    expect(openSecret(TEST_KEY, after.row.mfaSecret!, bystander.id)).toBeNull();
    expect(openSecret(Buffer.alloc(32, 8), after.row.mfaSecret!, target.id)).toBeNull();
    expect(after.row.mfaEnabledAt?.getTime()).toBe(at.getTime());
    expect(after.row.mfaLastStep).toBe(BigInt(totpStep(at.getTime())));
    expect(after.row.mfaPendingSecret).toBeNull();
    expect(after.row.mfaPendingAt).toBeNull();
    // Not a sign-in: the lockout counters, the last sign-in, the status and the password are untouched.
    expect(after.row).toMatchObject({
      status: 'active',
      passwordHash: before.row.passwordHash,
      failedLoginCount: 3,
      lockedUntil: null,
      lastLoginAt: null,
    });

    // Ten recovery codes, stored as HMACs under the derived key — the stray row is gone.
    expect(after.codes).toHaveLength(10);
    expect(after.codes.every((code) => code.usedAt === null)).toBe(true);
    const stored = after.codes.map((code) => code.codeHash);
    expect([...stored].sort()).toEqual(recoveryCodes.map((code) => storedHash(target.id, code)).sort());
    expect(stored).not.toContain(strayHash);
    for (const code of recoveryCodes) {
      const normalized = normalizeRecoveryCode(code)!;
      const unkeyed = [code, normalized, normalized.toLowerCase(), `${target.id}:${normalized}`, `${target.id}:${code}`].map(sha256);
      // Never a plain SHA-256, and never an HMAC under the sealing key itself.
      const underSealingKey = createHmac('sha256', TEST_KEY).update(`${target.id}:${normalized}`, 'utf8').digest('hex');
      for (const forbidden of [...unkeyed, underSealingKey]) expect(stored).not.toContain(forbidden);
    }

    // Every live session ended at the enabling instant; the one revoked earlier keeps its own.
    expect(after.tokens).toHaveLength(3);
    for (const id of liveIds) expect(after.tokens.find((token) => token.id === id)?.revokedAt?.getTime()).toBe(at.getTime());
    expect(after.tokens.find((token) => token.id === revokedId)?.revokedAt?.getTime()).toBe(revokedAt.getTime());

    // Another account is untouched.
    expect(await snapshot(bystander.id)).toEqual(bystanderBefore);
    expect(await eventsSince(mark, bystander.id)).toHaveLength(0);

    const events = await eventsSince(mark, target.id);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toEqual({
      action: 'platform.auth.mfa.enabled',
      actorPlatformUserId: null,
      entityType: 'platform_users',
      entityId: target.id,
      metadata: { revokedSessions: 2, via: 'cli' },
      ipAddress: null,
      userAgent: null,
    });
    expect(Object.keys(event!.metadata as object).sort()).toEqual(['revokedSessions', 'via']);
    expectNoSecrets(JSON.stringify(event), [setup.secret, after.row.mfaSecret!, pendingSealed, ...recoveryCodes, ...stored]);
  });

  it('the enrolled account passes the real second sign-in step of the platform API — with the next code and with a recovery code — and its older session is dead', async () => {
    const target = await fixture({ role: 'super_admin' });
    const mark = await auditMark();

    // A session opened with the password alone, while MFA is still off.
    const plain = await api().post('/api/auth/login').send({ identifier: target.email, password: PASSWORD });
    expect(plain.status).toBe(200);
    expect(plain.body.mfaRequired).toBeUndefined();
    const oldCookie = refreshCookie(plain)!;
    expect(oldCookie).toBeTruthy();

    let typed = '';
    const run = await enroll(target.email, {
      code: (setup) => {
        typed = codeFor(setup.secret, Date.now());
        return typed;
      },
    });
    expect(run.result).toMatchObject({ outcome: 'enabled', userId: target.id, revokedSessions: 1 });
    if (run.result.outcome !== 'enabled') throw new Error('unreachable');
    const secret = run.setups[0]!.secret;
    const recoveryCodes = run.result.recoveryCodes;

    // The session from before the enrolment cannot be refreshed any more.
    const stale = await api().post('/api/auth/refresh').set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${oldCookie}`);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('refresh_reused');

    // The password is now only the first step.
    const first = await api().post('/api/auth/login').send({ identifier: target.email, password: PASSWORD });
    expect(first.status).toBe(200);
    expect(Object.keys(first.body).sort()).toEqual(['challenge', 'expiresAt', 'mfaRequired']);
    expect(refreshCookie(first)).toBeUndefined();

    // The code typed at the terminal is spent (`mfa_last_step`): the API refuses to take it again…
    const laterCodes = [1, 2, 3].map((offset) => codeFor(secret, Date.now(), offset));
    if (!laterCodes.includes(typed)) {
      const replay = await api().post('/api/auth/login/mfa').send({ challenge: first.body.challenge, code: typed });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('mfa_code_invalid');
    }
    // …and opens the session with the next one.
    const withCode = await api().post('/api/auth/login/mfa').send({ challenge: first.body.challenge, code: codeFor(secret, Date.now(), 1) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.user).toMatchObject({ id: target.id, email: target.email, role: 'super_admin', status: 'active' });
    expect(refreshCookie(withCode)).toBeTruthy();
    const status = await api().get('/api/auth/mfa').set('Authorization', `Bearer ${withCode.body.accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      available: true,
      enabled: true,
      enabledAt: run.result.enabledAt.toISOString(),
      recoveryCodesLeft: 10,
      pendingSetup: false,
    });

    // A recovery code printed by the command, typed in lower case without its dash, works once.
    const second = await api().post('/api/auth/login').send({ identifier: target.email, password: PASSWORD });
    expect(second.status).toBe(200);
    expect(second.body.mfaRequired).toBe(true);
    const recoveryCode = recoveryCodes[3]!.replace('-', '').toLowerCase();
    const withRecovery = await api().post('/api/auth/login/mfa').send({ challenge: second.body.challenge, recoveryCode });
    expect(withRecovery.status).toBe(200);
    expect(withRecovery.body.user.id).toBe(target.id);
    const statusAfter = await api().get('/api/auth/mfa').set('Authorization', `Bearer ${withRecovery.body.accessToken}`);
    expect(statusAfter.body).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });
    expect(await platformTestDb().platformMfaRecoveryCode.count({ where: { userId: target.id, usedAt: { not: null } } })).toBe(1);

    const trail = (await eventsSince(mark, target.id)).map((event) => [
      event.action,
      event.actorPlatformUserId,
      (event.metadata as Record<string, unknown> | null)?.['via'] ?? (event.metadata as Record<string, unknown> | null)?.['reason'] ?? null,
    ]);
    expect(trail[0]).toEqual(['platform.auth.login.succeeded', target.id, 'password']);
    expect(trail).toContainEqual(['platform.auth.mfa.enabled', null, 'cli']);
    expect(trail.slice(-2)).toEqual([
      ['platform.auth.login.succeeded', target.id, 'mfa'],
      ['platform.auth.login.succeeded', target.id, 'recovery_code'],
    ]);
  });

  it('refuses a wrong password — and an account without one — before anything is shown: no code asked, nothing written, no lockout counter, no event', async () => {
    const db = platformTestDb();
    const target = await fixture({ failedLoginCount: 4 });
    await liveToken(target.id);
    const noPassword = await fixture();
    await db.platformUser.update({ where: { id: noPassword.id }, data: { passwordHash: null } });
    const before = await snapshot(target.id);
    const noPasswordBefore = await snapshot(noPassword.id);
    const mark = await auditMark();

    for (const password of [WRONG_PASSWORD, '', `${PASSWORD} `, PASSWORD.toLowerCase()]) {
      const run = await enroll(target.email, { password, code: () => '000000' });
      expect(run.result, JSON.stringify(password)).toEqual({ outcome: 'refused', reason: 'password_invalid', userId: target.id });
      expect(run.setups).toEqual([]);
      expect(run.attempts).toEqual([]);
    }
    const run = await enroll(noPassword.email, { code: () => '000000' });
    expect(run.result).toEqual({ outcome: 'refused', reason: 'password_invalid', userId: noPassword.id });
    expect(run.setups).toEqual([]);

    // One failure short of the lock before, and still so: four wrong passwords here counted nothing.
    expect(await snapshot(target.id)).toEqual(before);
    expect(await snapshot(noPassword.id)).toEqual(noPasswordBefore);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);
    expect(await eventsSince(mark, noPassword.id)).toHaveLength(0);
  });

  it('refuses after three wrong codes — and writes nothing when the prompt fails — while a third right code within the ±1 step window still enables', async () => {
    const target = await fixture();
    const tokenId = await liveToken(target.id);
    const before = await snapshot(target.id);
    const mark = await auditMark();
    const at = new Date();

    const otherSecret = generateTotpSecret();
    const wrongs = (setup: PlatformMfaEnrollSetup): string[] => [
      wrongCodeFor(setup.secret, at.getTime()),
      // A right code of ANOTHER secret, and text that is no code at all.
      surelyWrong(codeFor(otherSecret, at.getTime()), setup.secret, at.getTime()),
      'not a code',
    ];
    const refused = await enroll(target.email, { at, code: (setup, attempt) => wrongs(setup)[attempt - 1]! });
    expect(refused.result).toEqual({ outcome: 'refused', reason: 'code_invalid', userId: target.id });
    expect(refused.attempts).toEqual([1, 2, 3]);
    expect(refused.setups).toHaveLength(1);
    expect(await snapshot(target.id)).toEqual(before);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);

    // A code two steps old is outside the window: three of them are three wrong codes.
    const tooOld = await enroll(target.email, {
      at,
      code: (setup) => surelyWrong(codeFor(setup.secret, at.getTime(), -2), setup.secret, at.getTime()),
    });
    expect(tooOld.result).toMatchObject({ outcome: 'refused', reason: 'code_invalid' });
    expect(tooOld.attempts).toEqual([1, 2, 3]);

    // An interrupted prompt (the command's Ctrl+C) ends the run with its own error and nothing written.
    await expect(
      enroll(target.email, {
        at,
        code: () => {
          throw new PromptAborted();
        },
      }),
    ).rejects.toBeInstanceOf(PromptAborted);
    expect(await snapshot(target.id)).toEqual(before);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);

    // Two wrong tries, then the code of the PREVIOUS step (a phone 30 s behind): enabled, and that step is the spent one.
    const third = await enroll(target.email, {
      at,
      code: (setup, attempt) => {
        if (attempt < 3) return wrongCodeFor(setup.secret, at.getTime());
        const previous = codeFor(setup.secret, at.getTime(), -1);
        // Typed the way apps show it: '123 456'.
        return ` ${previous.slice(0, 3)} ${previous.slice(3)} `;
      },
    });
    expect(third.attempts).toEqual([1, 2, 3]);
    expect(third.result).toMatchObject({ outcome: 'enabled', userId: target.id, revokedSessions: 1 });
    const after = await snapshot(target.id);
    expect(openSecret(TEST_KEY, after.row.mfaSecret!, target.id)).toBe(third.setups[0]!.secret);
    // Every run hands out a new secret; only the confirmed one is stored.
    expect(new Set([refused.setups[0]!.secret, tooOld.setups[0]!.secret, third.setups[0]!.secret]).size).toBe(3);
    expect(after.row.mfaLastStep).toBe(BigInt(totpStep(at.getTime()) - 1));
    expect(after.tokens.find((token) => token.id === tokenId)?.revokedAt).not.toBeNull();
    expect((await eventsSince(mark, target.id)).map((event) => [event.action, event.metadata])).toEqual([
      ['platform.auth.mfa.enabled', { revokedSessions: 1, via: 'cli' }],
    ]);
  });

  it('refuses an account that has MFA on already — before the code and again under the row lock — and never overwrites it', async () => {
    const db = platformTestDb();
    // On already (here through the command itself).
    const enrolled = await fixture();
    const first = await enroll(enrolled.email, { code: (setup) => codeFor(setup.secret, Date.now()) });
    expect(first.result.outcome).toBe('enabled');
    await liveToken(enrolled.id);
    const before = await snapshot(enrolled.id);
    const mark = await auditMark();

    const again = await enroll(enrolled.email, { code: (setup) => codeFor(setup.secret, Date.now()) });
    expect(again.result).toEqual({ outcome: 'refused', reason: 'mfa_already_enabled', userId: enrolled.id });
    expect(again.setups).toEqual([]);
    expect(again.attempts).toEqual([]);
    // The password is still asked first: a stranger learns nothing about the account's MFA.
    const stranger = await enroll(enrolled.email, { password: WRONG_PASSWORD, code: () => '000000' });
    expect(stranger.result).toMatchObject({ outcome: 'refused', reason: 'password_invalid' });
    expect(await snapshot(enrolled.id)).toEqual(before);
    expect(await eventsSince(mark, enrolled.id)).toHaveLength(0);

    // Turned on by somebody else (API-215 in another session) while the command waits for its code.
    const raced = await fixture();
    const racedToken = await liveToken(raced.id);
    const otherSealed = sealSecret(TEST_KEY, generateTotpSecret(), raced.id);
    const otherAt = new Date(Date.now() - 1000);
    const racedMark = await auditMark();
    const lost = await enroll(raced.email, {
      code: async (setup) => {
        await db.platformUser.update({ where: { id: raced.id }, data: { mfaSecret: otherSealed, mfaEnabledAt: otherAt } });
        return codeFor(setup.secret, Date.now());
      },
    });
    expect(lost.result).toEqual({ outcome: 'refused', reason: 'mfa_already_enabled', userId: raced.id });
    const racedAfter = await snapshot(raced.id);
    expect(racedAfter.row.mfaSecret).toBe(otherSealed);
    expect(racedAfter.row.mfaEnabledAt?.getTime()).toBe(otherAt.getTime());
    expect(racedAfter.row.mfaLastStep).toBeNull();
    expect(racedAfter.codes).toEqual([]);
    expect(racedAfter.tokens).toEqual([{ id: racedToken, revokedAt: null }]);
    expect(await eventsSince(racedMark, raced.id)).toHaveLength(0);
  });

  it('refuses an unknown e-mail and a suspended account, re-checks the account under the lock, and throws on invalid input — nothing written', async () => {
    const db = platformTestDb();

    const unknown = await enroll(`${PLATFORM_TEST_RUN}-nobody@example.test`, { code: () => '000000' });
    expect(unknown.result).toEqual({ outcome: 'refused', reason: 'user_not_found', userId: null });
    expect(unknown.setups).toEqual([]);

    const suspended = await fixture({ status: 'suspended' });
    await liveToken(suspended.id);
    const suspendedBefore = await snapshot(suspended.id);
    const mark = await auditMark();
    const refused = await enroll(suspended.email, { code: () => '000000' });
    expect(refused.result).toEqual({ outcome: 'refused', reason: 'account_suspended', userId: suspended.id });
    expect(refused.setups).toEqual([]);
    // The status is told only to who knows the password (the order of the sign-in).
    expect((await enroll(suspended.email, { password: WRONG_PASSWORD, code: () => '000000' })).result).toMatchObject({ reason: 'password_invalid' });
    expect(await snapshot(suspended.id)).toEqual(suspendedBefore);

    // Suspended, or given another password, while the command waits for its code: the right code changes nothing.
    const suspendedMeanwhile = await fixture();
    const lateSuspension = await enroll(suspendedMeanwhile.email, {
      code: async (setup) => {
        await db.platformUser.update({ where: { id: suspendedMeanwhile.id }, data: { status: 'suspended' } });
        return codeFor(setup.secret, Date.now());
      },
    });
    expect(lateSuspension.result).toEqual({ outcome: 'refused', reason: 'account_suspended', userId: suspendedMeanwhile.id });
    const rekeyed = await fixture();
    const newHash = await passwords.hash('Another-Password-After-All-7');
    const latePassword = await enroll(rekeyed.email, {
      code: async (setup) => {
        await db.platformUser.update({ where: { id: rekeyed.id }, data: { passwordHash: newHash } });
        return codeFor(setup.secret, Date.now());
      },
    });
    expect(latePassword.result).toEqual({ outcome: 'refused', reason: 'account_changed', userId: rekeyed.id });
    const deleted = await fixture();
    const lateDeletion = await enroll(deleted.email, {
      code: async (setup) => {
        await db.platformUser.delete({ where: { id: deleted.id } });
        return codeFor(setup.secret, Date.now());
      },
    });
    expect(lateDeletion.result).toEqual({ outcome: 'refused', reason: 'user_not_found', userId: null });
    for (const user of [suspendedMeanwhile, rekeyed]) {
      const after = await snapshot(user.id);
      expect(after.row, user.email).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null });
      expect(after.codes).toEqual([]);
    }
    for (const user of [suspended, suspendedMeanwhile, rekeyed, deleted]) expect(await eventsSince(mark, user.id), user.email).toHaveLength(0);

    // A sign-in lock neither stops the command (it is not a sign-in) nor is lifted by it.
    const lockedUntil = new Date(Date.now() + 10 * MINUTE_MS);
    const locked = await fixture({ lockedUntil, failedLoginCount: 0 });
    const lockedRun = await enroll(locked.email, { code: (setup) => codeFor(setup.secret, Date.now()) });
    expect(lockedRun.result.outcome).toBe('enabled');
    expect((await snapshot(locked.id)).row.lockedUntil?.getTime()).toBe(lockedUntil.getTime());

    // Programming errors, before any read or prompt: a malformed e-mail, a key that is not 32 bytes.
    const never = { password: PASSWORD, onSetup: () => expect.unreachable('no setup'), readCode: async () => expect.unreachable('no prompt') };
    await expect(enrollPlatformUserMfa(db, { ...never, email: 'not an address' }, { key: TEST_KEY, passwords })).rejects.toThrow(
      'Platform MFA enrolment input is invalid: email must be a valid address',
    );
    const valid = await fixture();
    await expect(enrollPlatformUserMfa(db, { ...never, email: valid.email }, { key: Buffer.alloc(31, 9), passwords })).rejects.toThrow(
      'The platform MFA key must be 32 bytes',
    );
    expect((await snapshot(valid.id)).row.mfaSecret).toBeNull();
  });

  it('the command prints the key by groups and as a link, asks the password hidden and the code visibly, and shows the ten recovery codes once — never the password or the key', async () => {
    const target = await fixture();
    await liveToken(target.id);
    const mark = await auditMark();

    const session = scriptedTerminal({ code: (secret) => codeFor(secret, Date.now()) });
    const exit = await runPlatformEnableMfa(['--email', ` ${target.email.toUpperCase()}`], cliEnv(), session.terminal);
    expect(exit).toBe(0);
    expect(session.err).toEqual([]);

    // One hidden prompt for the password, then one visible prompt for the code.
    expect(session.hiddenPrompts).toEqual([`Current password of ${target.email} (not echoed): `]);
    expect(session.linePrompts).toEqual(['6-digit code from the app (try 1 of 3): ']);

    const stdout = session.out.join('\n');
    const secret = session.printedSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(stdout).toContain(otpauthUri({ issuer: PLATFORM_MFA_ISSUER, account: target.email, secret }));
    expect(stdout).toContain(`Key     : ${groupTotpSecret(secret)}`);
    expect(stdout).toContain('BY KEY (this command shows no QR code)');
    expect(stdout).toContain('nothing is saved until a code is confirmed');
    expect(stdout).toContain(`Two-step verification is ON for platform user ${target.id}; 1 session(s) of the account were signed out.`);
    expect(stdout).toContain('Store them now in a safe place: they are not shown again');

    // The ten codes, each printed exactly once — and they are the ones the database holds, hashed.
    const printed = stdout.match(RECOVERY_CODE) ?? [];
    expect(printed).toHaveLength(10);
    expect(new Set(printed).size).toBe(10);
    const after = await snapshot(target.id);
    expect(after.codes.map((code) => code.codeHash).sort()).toEqual(printed.map((code) => storedHash(target.id, code)).sort());
    expect(openSecret(TEST_KEY, after.row.mfaSecret!, target.id)).toBe(secret);
    expect(after.tokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect((await eventsSince(mark, target.id)).map((event) => [event.action, event.actorPlatformUserId, event.metadata])).toEqual([
      ['platform.auth.mfa.enabled', null, { revokedSessions: 1, via: 'cli' }],
    ]);
    // What may never reach the terminal: the password, the key, the sealed secret, a stored hash.
    expectNoSecrets(session.all(), [after.row.mfaSecret!, after.row.passwordHash!, ...after.codes.map((code) => code.codeHash)]);

    // Again on the same account: refused, pointing at the reset command.
    const again = scriptedTerminal({ code: (s) => codeFor(s, Date.now()) });
    expect(await runPlatformEnableMfa(['--email', target.email], cliEnv(), again.terminal)).toBe(2);
    expect(again.err.join('\n')).toContain('two-step verification is already on for this account');
    expect(again.err.join('\n')).toContain('npm run platform:reset-mfa -- --email <address>');
    expect(again.out).toEqual([]);
    expect(again.linePrompts).toEqual([]);
    expect(await snapshot(target.id)).toEqual(after);
    expect(await eventsSince(mark, target.id)).toHaveLength(1);
  });

  it('the command exits 2 on a refusal and 1 on an error or an interrupted prompt — with nothing written, and no prompt when it cannot run', async () => {
    const target = await fixture();
    await liveToken(target.id);
    const suspended = await fixture({ status: 'suspended' });
    const before = await snapshot(target.id);
    const mark = await auditMark();
    const args = ['--email', target.email];

    // Exit 2 — refusals.
    const wrongPassword = scriptedTerminal({ password: WRONG_PASSWORD });
    expect(await runPlatformEnableMfa(args, cliEnv(), wrongPassword.terminal)).toBe(2);
    expect(wrongPassword.err).toEqual(['Refused: that is not the current password of this account. Nothing was changed.']);
    expect(wrongPassword.out).toEqual([]);
    expect(wrongPassword.linePrompts).toEqual([]);

    const wrongCodes = scriptedTerminal({ code: (secret) => wrongCodeFor(secret, Date.now()) });
    expect(await runPlatformEnableMfa(args, cliEnv(), wrongCodes.terminal)).toBe(2);
    expect(wrongCodes.linePrompts).toEqual([
      '6-digit code from the app (try 1 of 3): ',
      '6-digit code from the app (try 2 of 3): ',
      '6-digit code from the app (try 3 of 3): ',
    ]);
    expect(wrongCodes.err).toEqual([
      'That code does not match. 2 tries left.',
      'That code does not match. 1 try left.',
      expect.stringContaining('Refused: no code matched in 3 tries. Nothing was changed.'),
    ]);
    expect(wrongCodes.out.join('\n')).not.toMatch(RECOVERY_CODE);

    const unknown = scriptedTerminal({});
    expect(await runPlatformEnableMfa(['--email', `${PLATFORM_TEST_RUN}-nobody@example.test`], cliEnv(), unknown.terminal)).toBe(2);
    expect(unknown.err).toEqual(['Refused: no platform account has this e-mail.']);
    const suspendedRun = scriptedTerminal({});
    expect(await runPlatformEnableMfa(['--email', suspended.email], cliEnv(), suspendedRun.terminal)).toBe(2);
    expect(suspendedRun.err).toEqual(['Refused: this platform account is suspended. Nothing was changed.']);

    // Exit 1 — an interrupted code prompt (Ctrl+C): the key was shown, nothing was saved.
    const interrupted = scriptedTerminal({
      code: () => {
        throw new PromptAborted();
      },
    });
    expect(await runPlatformEnableMfa(args, cliEnv(), interrupted.terminal)).toBe(1);
    expect(interrupted.err).toEqual(['Interrupted. Nothing was changed.']);
    expect(interrupted.printedSecret()).toMatch(/^[A-Z2-7]{32}$/);

    // Exit 1 — it cannot run at all: no password is asked and no database is opened.
    const cannotRun = async (argv: string[], env: Record<string, string | undefined>, message: string | RegExp, interactive = true) => {
      const session = scriptedTerminal({ interactive });
      expect(await runPlatformEnableMfa(argv, env, session.terminal), String(message)).toBe(1);
      expect(session.err.join('\n')).toMatch(message);
      expect(session.out).toEqual([]);
      expect(session.hiddenPrompts).toEqual([]);
      expect(session.linePrompts).toEqual([]);
      return session;
    };
    const url = platformDatabaseUrl();
    await cannotRun(args, { PLATFORM_DATABASE_URL: url }, /^PLATFORM_MFA_ENCRYPTION_KEY is not set/);
    await cannotRun(args, { PLATFORM_DATABASE_URL: url, PLATFORM_MFA_ENCRYPTION_KEY: '' }, /^PLATFORM_MFA_ENCRYPTION_KEY is not set/);
    const invalidKey = await cannotRun(
      args,
      { PLATFORM_DATABASE_URL: url, PLATFORM_MFA_ENCRYPTION_KEY: 'invalid-key-value-for-the-test' },
      /^PLATFORM_MFA_ENCRYPTION_KEY is not a valid key/,
    );
    // The configured value is never echoed, valid or not.
    expect(invalidKey.all()).not.toContain('invalid-key-value-for-the-test');
    await cannotRun(
      args,
      { PLATFORM_DATABASE_URL: url, PLATFORM_MFA_ENCRYPTION_KEY: TEST_KEY_TEXT, AUTH_MFA_ENCRYPTION_KEY: TEST_KEY.toString('base64url') },
      /^PLATFORM_MFA_ENCRYPTION_KEY must differ from AUTH_MFA_ENCRYPTION_KEY/,
    );
    await cannotRun(args, { PLATFORM_MFA_ENCRYPTION_KEY: TEST_KEY_TEXT }, /^No platform database URL/);
    await cannotRun(args, cliEnv(), /run it in an interactive terminal/, false);
    await cannotRun([], cliEnv(), /email must be a valid address[\s\S]*Usage: npm run platform:enable-mfa -- --email <address>/);
    await cannotRun(['--email', 'not an address'], cliEnv(), /email must be a valid address/);
    await cannotRun([...args, '--password', PASSWORD], cliEnv(), /Unknown option '--password'[\s\S]*Usage:/);
    await cannotRun([...args, 'stray'], cliEnv(), /Usage: npm run platform:enable-mfa/);

    // After all of that the account is exactly as it was: no MFA, its session alive, its counters untouched, no event.
    expect(await snapshot(target.id)).toEqual(before);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);
    expect(await eventsSince(mark, suspended.id)).toHaveLength(0);
    for (const session of [wrongPassword, wrongCodes, unknown, suspendedRun, interrupted]) expectNoSecrets(session.all(), []);
  });

  it('runs as the platform:enable-mfa command: without a terminal it refuses before any prompt, and without the key before that', { timeout: 120_000 }, async () => {
    // The npm script runs exactly the file the child processes below run.
    const pkg = JSON.parse(readFileSync(resolve(BACKEND_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['platform:enable-mfa']).toBe('tsx scripts/platform-enable-mfa.ts');
    const target = await fixture();
    const before = await snapshot(target.id);
    const mark = await auditMark();
    const env = { PLATFORM_DATABASE_URL: platformDatabaseUrl() ?? '', PLATFORM_MFA_ENCRYPTION_KEY: TEST_KEY_TEXT };

    // A child process has pipes for stdin and stdout: the secrets would land in them, so nothing is asked or printed.
    const piped = await runCli(['--email', target.email], env);
    expect(piped.code).toBe(1);
    expect(piped.stderr).toContain('run it in an interactive terminal');
    expect(piped.stdout).toBe('');

    // An empty variable is "not set" (and the env files never override a variable of the process).
    const keyless = await runCli(['--email', target.email], { ...env, PLATFORM_MFA_ENCRYPTION_KEY: '' });
    expect(keyless.code).toBe(1);
    expect(keyless.stderr).toContain('PLATFORM_MFA_ENCRYPTION_KEY is not set');
    expect(keyless.stdout).toBe('');

    const usage = await runCli([], env);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Usage: npm run platform:enable-mfa -- --email <address>');

    expectNoSecrets(piped.stdout + piped.stderr + keyless.stdout + keyless.stderr + usage.stdout + usage.stderr, []);
    expect(await snapshot(target.id)).toEqual(before);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);
  });
});
