// TEST-234 (e2e) — PMFA-T04 (roadmap §4o, D-R117): resetting the two-step
// verification of a PLATFORM account from the server —
// resetPlatformUserMfa() of src/platform/auth/mfa/platform-mfa-reset.ts and its
// command scripts/platform-reset-mfa.ts (npm run platform:reset-mfa), the
// platform counterpart of the academy's API-212 (TEST-228). Acceptance: the
// five MFA columns cleared, the recovery codes deleted, the open challenges
// consumed and every live session revoked in one transaction with exactly one
// `platform.users.mfa_reset { revokedSessions, reason? }` without an actor; a
// no-op (no MFA, no pending setup) writes and records nothing; refusals write
// nothing; no secret, code, challenge or hash in the event or the command's output;
// the command needs no PLATFORM_MFA_ENCRYPTION_KEY.
//
// MFA is turned on for the fixtures directly through the platform Prisma client
// (secrets sealed with a fixed TEST key set before the platform module is
// imported — process variables beat the env files). Skipped when the platform
// database is unreachable (./helpers.ts). Fixture accounts are deleted in
// afterAll (their tokens, recovery codes and challenges cascade; their audit
// rows stay — the log is append-only). Events are counted above an id
// watermark and by the fixture account they name, so other clients of the
// shared dev platform DB never pollute the counts.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sealSecret } from '../../src/auth/mfa/secret-box.js';
import { generateTotpSecret, totpStep } from '../../src/auth/mfa/totp.js';
import {
  PLATFORM_MFA_RESET_REASON_MAX_LENGTH,
  PLATFORM_USERS_MFA_RESET_EVENT,
  PlatformMfaResetError,
  resetPlatformUserMfa,
} from '../../src/platform/auth/mfa/platform-mfa-reset.js';
import type { PlatformUserFixture } from './helpers.js';

/** A fixed TEST key (32 bytes) — never a real one, and not the academy suites' key. */
const TEST_KEY = Buffer.alloc(32, 9);
process.env['PLATFORM_MFA_ENCRYPTION_KEY'] = TEST_KEY.toString('base64');

const {
  PLATFORM_TEST_RUN,
  closePlatformTestDb,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformDatabaseUrl,
  platformDbReachable,
  platformTestDb,
} = await import('./helpers.js');

const available = await platformDbReachable();

const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const hex64 = () => randomBytes(32).toString('hex');

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

async function mfaColumns(userId: string) {
  return platformTestDb().platformUser.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true, mfaPendingSecret: true, mfaPendingAt: true, updatedAt: true },
  });
}

interface ArmOptions {
  /** MFA on: a sealed secret, its enabling instant and a last step. */
  enabled?: boolean;
  /** A setup awaiting confirmation: a sealed pending secret and its start. */
  pending?: boolean;
  /** Unused recovery codes (one used code is added when > 0). */
  codes?: number;
  /** Open sign-in challenges (one consumed challenge is added too). */
  openChallenges?: number;
  /** Live refresh tokens (one revoked token is added too). */
  liveTokens?: number;
}

interface Armed {
  /** Every stored secret-ish value of the fixture: none may appear in an event or the command's output. */
  secrets: string[];
  consumedChallengeId: string;
  consumedChallengeAt: Date;
  revokedTokenId: string;
  revokedTokenAt: Date;
}

/** Gives a fixture account MFA state, recovery codes, challenges and sessions straight through Prisma. */
async function arm(user: PlatformUserFixture, options: ArmOptions): Promise<Armed> {
  const db = platformTestDb();
  const now = Date.now();
  const secrets: string[] = [];
  const data: Record<string, unknown> = {};
  if (options.enabled) {
    const base32 = generateTotpSecret();
    const sealed = sealSecret(TEST_KEY, base32, user.id);
    secrets.push(base32, sealed);
    Object.assign(data, { mfaSecret: sealed, mfaEnabledAt: new Date(now - DAY_MS), mfaLastStep: BigInt(totpStep(now)) });
  }
  if (options.pending) {
    const base32 = generateTotpSecret();
    const sealed = sealSecret(TEST_KEY, base32, user.id);
    secrets.push(base32, sealed);
    Object.assign(data, { mfaPendingSecret: sealed, mfaPendingAt: new Date(now - MINUTE_MS) });
  }
  if (Object.keys(data).length > 0) await db.platformUser.update({ where: { id: user.id }, data });

  const codes = options.codes ?? 0;
  if (codes > 0) {
    const rows = [
      ...Array.from({ length: codes }, () => ({ userId: user.id, codeHash: hex64() })),
      { userId: user.id, codeHash: hex64(), usedAt: new Date(now - MINUTE_MS) },
    ];
    secrets.push(...rows.map((row) => row.codeHash));
    await db.platformMfaRecoveryCode.createMany({ data: rows });
  }

  for (let index = 0; index < (options.openChallenges ?? 0); index += 1) {
    const tokenHash = hex64();
    secrets.push(tokenHash);
    await db.platformMfaChallenge.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(now + 5 * MINUTE_MS) } });
  }
  const consumedChallengeAt = new Date(now - 10 * MINUTE_MS);
  const consumedHash = hex64();
  secrets.push(consumedHash);
  const consumed = await db.platformMfaChallenge.create({
    data: { userId: user.id, tokenHash: consumedHash, expiresAt: new Date(now - 5 * MINUTE_MS), consumedAt: consumedChallengeAt },
    select: { id: true },
  });

  for (let index = 0; index < (options.liveTokens ?? 0); index += 1) {
    const tokenHash = hex64();
    secrets.push(tokenHash);
    await db.platformRefreshToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(now + DAY_MS) } });
  }
  const revokedTokenAt = new Date(now - DAY_MS);
  const revokedHash = hex64();
  secrets.push(revokedHash);
  const revokedToken = await db.platformRefreshToken.create({
    data: { userId: user.id, tokenHash: revokedHash, expiresAt: new Date(now + DAY_MS), revokedAt: revokedTokenAt },
    select: { id: true },
  });

  return { secrets, consumedChallengeId: consumed.id, consumedChallengeAt, revokedTokenId: revokedToken.id, revokedTokenAt };
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `scripts/platform-reset-mfa.ts` through tsx in a child process (cwd backend/), WITHOUT the MFA key. */
function runCli(args: string[]): Promise<CliRun> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/platform-reset-mfa.ts', ...args],
      {
        cwd: BACKEND_DIR,
        env: { ...process.env, PLATFORM_DATABASE_URL: platformDatabaseUrl() ?? '', PLATFORM_MFA_ENCRYPTION_KEY: '' },
        timeout: 60_000,
        windowsHide: true,
      },
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

function expectNoSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of [...secrets, TEST_KEY.toString('base64'), TEST_KEY.toString('base64url')]) {
    expect(text.includes(secret), 'a secret leaked').toBe(false);
  }
}

describe.skipIf(!available)('PMFA-T04 platform MFA reset by a server command (e2e, TEST-234)', () => {
  const fixtureIds: string[] = [];

  async function fixture(): Promise<PlatformUserFixture> {
    const user = await createPlatformUserFixture({ role: 'support' });
    fixtureIds.push(user.id);
    return user;
  }

  afterAll(async () => {
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('clears MFA, deletes the recovery codes, consumes the open challenges and revokes every live session with one event without an actor', async () => {
    const db = platformTestDb();
    const target = await fixture();
    const bystander = await fixture();
    const armed = await arm(target, { enabled: true, codes: 2, openChallenges: 1, liveTokens: 2 });
    const other = await arm(bystander, { enabled: true, codes: 2, openChallenges: 1, liveTokens: 1 });
    const bystanderBefore = await mfaColumns(bystander.id);
    const mark = await auditMark();

    // The e-mail as an operator may type it: spaces and capitals.
    const result = await resetPlatformUserMfa(db, { email: `  ${target.email.toUpperCase()} `, reason: '  Lost phone; identity confirmed  ' });
    expect(result).toEqual({ userId: target.id, reset: true, revokedSessions: 2 });

    const after = await mfaColumns(target.id);
    expect(after).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null });
    expect(await db.platformMfaRecoveryCode.count({ where: { userId: target.id } })).toBe(0);
    const challenges = await db.platformMfaChallenge.findMany({ where: { userId: target.id }, select: { id: true, consumedAt: true } });
    expect(challenges).toHaveLength(2);
    expect(challenges.every((challenge) => challenge.consumedAt !== null)).toBe(true);
    // An already consumed challenge keeps its instant; an already revoked token keeps its own.
    expect(challenges.find((challenge) => challenge.id === armed.consumedChallengeId)?.consumedAt?.getTime()).toBe(
      armed.consumedChallengeAt.getTime(),
    );
    const tokens = await db.platformRefreshToken.findMany({ where: { userId: target.id }, select: { id: true, revokedAt: true } });
    expect(tokens).toHaveLength(3);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(tokens.find((token) => token.id === armed.revokedTokenId)?.revokedAt?.getTime()).toBe(armed.revokedTokenAt.getTime());

    // Another account is untouched.
    expect(await mfaColumns(bystander.id)).toEqual(bystanderBefore);
    expect(await db.platformMfaRecoveryCode.count({ where: { userId: bystander.id } })).toBe(3);
    expect(await db.platformMfaChallenge.count({ where: { userId: bystander.id, consumedAt: null } })).toBe(1);
    expect(await db.platformRefreshToken.count({ where: { userId: bystander.id, revokedAt: null } })).toBe(1);
    expect(await eventsSince(mark, bystander.id)).toHaveLength(0);

    const events = await eventsSince(mark, target.id);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toEqual({
      action: PLATFORM_USERS_MFA_RESET_EVENT,
      actorPlatformUserId: null,
      entityType: 'platform_users',
      entityId: target.id,
      metadata: { revokedSessions: 2, reason: 'Lost phone; identity confirmed' },
      ipAddress: null,
      userAgent: null,
    });
    expect(Object.keys(event!.metadata as object).sort()).toEqual(['reason', 'revokedSessions']);
    expect(Object.keys(event!.metadata as object).some((key) => /token/i.test(key))).toBe(false);
    expectNoSecrets(JSON.stringify(event), [...armed.secrets, ...other.secrets]);
  });

  it('is a no-op for an account without MFA and without a pending setup: no write, no event', async () => {
    const db = platformTestDb();
    const target = await fixture();
    await arm(target, { enabled: true, codes: 1, openChallenges: 1, liveTokens: 1 });
    await resetPlatformUserMfa(db, { email: target.email });
    // A session opened after the reset must survive the second, empty reset.
    await db.platformRefreshToken.create({ data: { userId: target.id, tokenHash: hex64(), expiresAt: new Date(Date.now() + DAY_MS) } });
    const never = await fixture();
    const before = await mfaColumns(target.id);
    const mark = await auditMark();

    expect(await resetPlatformUserMfa(db, { email: target.email, reason: 'Again' })).toEqual({
      userId: target.id,
      reset: false,
      revokedSessions: 0,
    });
    expect(await resetPlatformUserMfa(db, { email: never.email })).toEqual({ userId: never.id, reset: false, revokedSessions: 0 });

    expect(await mfaColumns(target.id)).toEqual(before);
    expect(await db.platformRefreshToken.count({ where: { userId: target.id, revokedAt: null } })).toBe(1);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);
    expect(await eventsSince(mark, never.id)).toHaveLength(0);
  });

  it('counts a setup awaiting confirmation alone, and records no reason when none (or a blank one) is given', async () => {
    const db = platformTestDb();
    const pendingOnly = await fixture();
    const armed = await arm(pendingOnly, { pending: true, liveTokens: 1 });
    const blank = await fixture();
    await arm(blank, { pending: true });
    const mark = await auditMark();

    expect(await resetPlatformUserMfa(db, { email: pendingOnly.email })).toEqual({ userId: pendingOnly.id, reset: true, revokedSessions: 1 });
    expect(await mfaColumns(pendingOnly.id)).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaPendingSecret: null, mfaPendingAt: null });
    expect(await resetPlatformUserMfa(db, { email: blank.email, reason: '   ' })).toEqual({ userId: blank.id, reset: true, revokedSessions: 0 });

    const events = await eventsSince(mark, pendingOnly.id);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([[PLATFORM_USERS_MFA_RESET_EVENT, { revokedSessions: 1 }]]);
    expectNoSecrets(JSON.stringify(events), armed.secrets);
    const blankEvents = await eventsSince(mark, blank.id);
    expect(blankEvents.map((event) => event.metadata)).toEqual([{ revokedSessions: 0 }]);
  });

  it('refuses an unknown e-mail and invalid input before any write; a reason is counted in characters, up to 500', async () => {
    const db = platformTestDb();
    const target = await fixture();
    await arm(target, { enabled: true, codes: 1, liveTokens: 1 });
    const before = await mfaColumns(target.id);
    const mark = await auditMark();

    const unknown = resetPlatformUserMfa(db, { email: `${PLATFORM_TEST_RUN}-nobody@example.test` });
    await expect(unknown).rejects.toBeInstanceOf(PlatformMfaResetError);
    await expect(resetPlatformUserMfa(db, { email: `${PLATFORM_TEST_RUN}-nobody@example.test` })).rejects.toMatchObject({
      code: 'user_not_found',
    });

    const tooLong = 'x'.repeat(PLATFORM_MFA_RESET_REASON_MAX_LENGTH + 1);
    await expect(resetPlatformUserMfa(db, { email: target.email, reason: tooLong })).rejects.toMatchObject({
      code: 'input_invalid',
      problems: [`reason must have at most ${PLATFORM_MFA_RESET_REASON_MAX_LENGTH} characters`],
    });
    await expect(resetPlatformUserMfa(db, { email: target.email, reason: 'with \u0000 inside' })).rejects.toMatchObject({
      code: 'input_invalid',
    });
    await expect(resetPlatformUserMfa(db, { email: 'not an address' })).rejects.toMatchObject({
      code: 'input_invalid',
      problems: ['email must be a valid address'],
    });
    expect(await mfaColumns(target.id)).toEqual(before);
    expect(await db.platformRefreshToken.count({ where: { userId: target.id, revokedAt: null } })).toBe(1);
    expect(await eventsSince(mark, target.id)).toHaveLength(0);

    // 500 characters outside the BMP (1,000 UTF-16 units) are 500 characters.
    const longest = '\u{1F510}'.repeat(PLATFORM_MFA_RESET_REASON_MAX_LENGTH);
    expect(await resetPlatformUserMfa(db, { email: target.email, reason: longest })).toEqual({ userId: target.id, reset: true, revokedSessions: 1 });
    const events = await eventsSince(mark, target.id);
    expect(events.map((event) => event.metadata)).toEqual([{ revokedSessions: 1, reason: longest }]);
  });

  it('runs end to end as the platform:reset-mfa command without the MFA key, with its exit codes, and prints no secret', { timeout: 120_000 }, async () => {
    // The npm script runs exactly the file the child processes below run.
    const pkg = JSON.parse(readFileSync(resolve(BACKEND_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['platform:reset-mfa']).toBe('tsx scripts/platform-reset-mfa.ts');
    const db = platformTestDb();
    const target = await fixture();
    const armed = await arm(target, { enabled: true, codes: 2, openChallenges: 1, liveTokens: 2 });
    const mark = await auditMark();

    const reset = await runCli(['--email', target.email, '--reason', 'CLI journey']);
    expect(reset.code).toBe(0);
    expect(reset.stdout).toContain(`Two-step verification of platform user ${target.id} was reset; 2 session(s) ended.`);
    expectNoSecrets(reset.stdout + reset.stderr, armed.secrets);
    expect(await mfaColumns(target.id)).toMatchObject({ mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null });
    expect(await db.platformRefreshToken.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    const events = await eventsSince(mark, target.id);
    expect(events.map((event) => [event.action, event.actorPlatformUserId, event.metadata])).toEqual([
      [PLATFORM_USERS_MFA_RESET_EVENT, null, { revokedSessions: 2, reason: 'CLI journey' }],
    ]);

    const again = await runCli(['--email', target.email]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(`Nothing to reset: platform user ${target.id}`);
    expect(await eventsSince(mark, target.id)).toHaveLength(1);

    const unknown = await runCli(['--email', `${PLATFORM_TEST_RUN}-nobody@example.test`]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Refused: no platform account has this e-mail.');

    const invalid = await runCli(['--email', target.email, '--reason', 'x'.repeat(PLATFORM_MFA_RESET_REASON_MAX_LENGTH + 1)]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('reason must have at most 500 characters');
    expectNoSecrets(again.stdout + again.stderr + unknown.stdout + unknown.stderr + invalid.stdout + invalid.stderr, armed.secrets);
  });
});
