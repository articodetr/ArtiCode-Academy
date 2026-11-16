// PMFA (roadmap §4o, D-R113..D-R120) — turning two-step verification ON for a
// PLATFORM account from the server. The platform has no frontend, so without
// this an operator could enrol only with hand-written calls of API-214/API-215
// (platform-mfa.service.ts). The command is scripts/platform-enable-mfa.ts →
// npm run platform:enable-mfa; the logic lives here so the tests call it
// directly and the script only wires the terminal to it (the pattern of
// platform-mfa-reset.ts). Rules:
//   - the account is found by its login e-mail, normalised as the platform
//     stores it (normalizePlatformEmail());
//   - the caller proves to be the account's holder with its CURRENT password
//     (Argon2id, the platform's PasswordService). A wrong password — or an
//     account without one — is refused and writes nothing: no
//     `failed_login_count`, no lock, no event (as the password check of
//     API-214/216/217, which never counts towards the sign-in lockout);
//   - checks before anything is shown, in order: unknown e-mail → password →
//     suspended → MFA already on. A sign-in lock (`locked_until`) does not stop
//     the command and is not lifted by it: a lock blocks NEW sign-ins only
//     (platform-session.service.ts), and this is not one;
//   - the TOTP secret is generated here and stays in memory: NOTHING is written
//     until a code of that secret is confirmed (at most three tries, the ±1 step
//     window of matchTotp()), so an abandoned run leaves no pending setup;
//   - then ONE transaction behind a `FOR NO KEY UPDATE` lock on the
//     `platform_users` row (never `FOR UPDATE` — KI-079; the lock of
//     PlatformMfaCore.lockUser()) re-checks that the account still exists, still
//     has the password that was proved, is still active and still has MFA off,
//     and writes exactly what API-215 writes: `mfa_secret` sealed with the
//     platform key and bound to the user id, `mfa_enabled_at`, `mfa_last_step` =
//     the matched step (that code is spent), the pending columns cleared, ten
//     new recovery codes stored as keyed hashes — plus EVERY live refresh token
//     of the account revoked (API-215 keeps the caller's own session; here the
//     holder is at the server's terminal, in no session), and exactly one
//     `platform.auth.mfa.enabled { revokedSessions, via: 'cli' }` with actor
//     NULL (nobody is signed in — like `platform.users.mfa_reset`);
//   - the plain secret and the plain recovery codes leave this function once
//     (`onSetup`, the result) and are never stored, logged or recorded.
// Not a Nest provider: plain Prisma calls on the platform client, the key and
// the password verifier handed in, and only the pure helpers of src/auth/mfa/
// (D-R120, ADR-073) — keep the writes in step with PlatformMfaService.enable()
// and PlatformMfaCore.
import { assertNoSecrets } from '../../../audit/audit-metadata.js';
import { mfaAccountLabel } from '../../../auth/mfa/mfa.rules.js';
import { deriveRecoveryCodeKey, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../../../auth/mfa/recovery-codes.js';
import { MFA_KEY_BYTES, parseMfaKey, sealSecret } from '../../../auth/mfa/secret-box.js';
import { generateTotpSecret, matchTotp, otpauthUri } from '../../../auth/mfa/totp.js';
import type { PrismaClient } from '../../../generated/platform/client.js';
import { PLATFORM_USERS_ENTITY, isPlatformEmail, normalizePlatformEmail } from '../platform-session.rules.js';

/** The event of an enrolment — the name API-215 records (`PLATFORM_MFA_EVENTS.enabled` of platform-mfa.service.ts). */
export const PLATFORM_MFA_ENROLL_EVENT = 'platform.auth.mfa.enabled';
/** `via` of the event: the server command, as opposed to API-215 (which records no `via`). */
export const PLATFORM_MFA_ENROLL_VIA = 'cli';
/** The issuer an authenticator app shows — the same as API-214 (`PLATFORM_MFA_ISSUER` of platform-mfa.service.ts). */
export const PLATFORM_MFA_ENROLL_ISSUER = 'ArtiCode Platform';
/** Codes the holder may type before the run is refused (a new run issues a new secret). */
export const PLATFORM_MFA_ENROLL_CODE_ATTEMPTS = 3;

/** Why PLATFORM_MFA_ENCRYPTION_KEY cannot be used. */
export type PlatformMfaKeyProblem = 'key_missing' | 'key_invalid' | 'key_shared_with_academy';

export type ResolvedPlatformMfaKey = { key: Buffer; problem: null } | { key: null; problem: PlatformMfaKeyProblem };

/**
 * Reads PLATFORM_MFA_ENCRYPTION_KEY exactly as the platform API accepts it at
 * boot (platform.env.schema.ts): unset or empty = no key; otherwise 32 bytes of
 * canonical base64 or base64url (parseMfaKey(), the parser PlatformMfaCore
 * uses); and never the academy's AUTH_MFA_ENCRYPTION_KEY, in any encoding — the
 * API refuses to start with a shared key, so a secret sealed with it here could
 * never be opened by a running platform.
 */
export function resolvePlatformMfaKey(env: Record<string, string | undefined>): ResolvedPlatformMfaKey {
  const raw = env['PLATFORM_MFA_ENCRYPTION_KEY'];
  if (raw === undefined || raw === '') return { key: null, problem: 'key_missing' };
  const key = parseMfaKey(raw);
  if (key === null) return { key: null, problem: 'key_invalid' };
  const academyRaw = env['AUTH_MFA_ENCRYPTION_KEY'];
  const academyKey = academyRaw === undefined || academyRaw === '' ? null : parseMfaKey(academyRaw);
  if (academyKey !== null && academyKey.equals(key)) return { key: null, problem: 'key_shared_with_academy' };
  return { key, problem: null };
}

/** The Base32 secret in groups of four, for typing it into an authenticator app (apps and base32Decode() ignore the spaces). */
export function groupTotpSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** What the holder needs to add the account to an authenticator app. Shown once, never stored in plain text. */
export interface PlatformMfaEnrollSetup {
  userId: string;
  /** The account's login e-mail as stored. */
  email: string;
  issuer: string;
  /** The account name inside the `otpauth://` URI (mfaAccountLabel(), as API-214). */
  account: string;
  /** The Base32 TOTP secret (32 characters). */
  secret: string;
  otpauthUri: string;
}

export interface PlatformMfaEnrollInput {
  /** The account's login e-mail (trimmed and lower-cased here). */
  email: string;
  /** The account's current password — the proof that the caller holds the account. */
  password: string;
  /** Called once, after every check passed and before the first code is asked: hand the secret to the holder. */
  onSetup: (setup: PlatformMfaEnrollSetup) => void | Promise<void>;
  /** Asks for the 6-digit code of the new secret; `attempt` runs from 1 to PLATFORM_MFA_ENROLL_CODE_ATTEMPTS. An error it throws ends the run with nothing written. */
  readCode: (attempt: number) => Promise<string>;
  /** The clock (tests); read when a code arrives. */
  now?: () => Date;
}

export interface PlatformMfaEnrollDeps {
  /** The platform MFA key (32 bytes) — resolvePlatformMfaKey(). */
  key: Buffer;
  /** The platform's PasswordService (Argon2id). */
  passwords: { verify(hash: string, plain: string): Promise<boolean> };
}

/**
 * Why an enrolment was refused — nothing was written:
 *  - `user_not_found`      no platform account has this e-mail (or it was deleted meanwhile);
 *  - `password_invalid`    not the account's current password, or the account has none;
 *  - `account_suspended`   the account is not active;
 *  - `mfa_already_enabled` MFA is on already (reset it first — platform-mfa-reset.ts);
 *  - `code_invalid`        no typed code matched the new secret;
 *  - `account_changed`     the account's password changed between its proof and the write.
 */
export type PlatformMfaEnrollRefusal =
  | 'user_not_found'
  | 'password_invalid'
  | 'account_suspended'
  | 'mfa_already_enabled'
  | 'code_invalid'
  | 'account_changed';

export type PlatformMfaEnrollResult =
  | {
      outcome: 'enabled';
      userId: string;
      enabledAt: Date;
      /** Ten codes in plain text ('XXXXX-XXXXX') — show them once; only their keyed hashes are stored. */
      recoveryCodes: string[];
      /** Live refresh tokens revoked: every session of the account. */
      revokedSessions: number;
    }
  | { outcome: 'refused'; reason: PlatformMfaEnrollRefusal; userId: string | null };

/** Validation problems of the input (empty when acceptable). */
export function platformMfaEnrollInputProblems(input: Pick<PlatformMfaEnrollInput, 'email'>): string[] {
  return isPlatformEmail(normalizePlatformEmail(input.email)) ? [] : ['email must be a valid address'];
}

/**
 * Turns two-step verification on for the platform account with this e-mail.
 * Resolves to `enabled` or to a refusal that wrote nothing; throws only for
 * invalid input (a malformed e-mail, a key that is not 32 bytes), what
 * `onSetup` / `readCode` throw, and the database's own errors.
 */
export async function enrollPlatformUserMfa(
  db: PrismaClient,
  input: PlatformMfaEnrollInput,
  deps: PlatformMfaEnrollDeps,
): Promise<PlatformMfaEnrollResult> {
  const problems = platformMfaEnrollInputProblems(input);
  if (problems.length > 0) throw new Error(`Platform MFA enrolment input is invalid: ${problems.join('; ')}`);
  // Checked before anything is asked: sealSecret() would refuse such a key only after the holder typed a code.
  if (!Buffer.isBuffer(deps.key) || deps.key.length !== MFA_KEY_BYTES) {
    throw new Error(`The platform MFA key must be ${MFA_KEY_BYTES} bytes`);
  }
  const now = input.now ?? (() => new Date());
  const email = normalizePlatformEmail(input.email);
  const refused = (reason: PlatformMfaEnrollRefusal, userId: string | null): PlatformMfaEnrollResult => ({
    outcome: 'refused',
    reason,
    userId,
  });

  const account = await db.platformUser.findUnique({
    where: { email },
    select: { id: true, email: true, status: true, passwordHash: true, mfaSecret: true },
  });
  if (!account) return refused('user_not_found', null);
  const userId = account.id;
  const provedHash = account.passwordHash;
  // Never counted towards the sign-in lockout, never recorded: this is not a sign-in (see the header).
  if (provedHash === null || !(await deps.passwords.verify(provedHash, input.password))) return refused('password_invalid', userId);
  if (account.status !== 'active') return refused('account_suspended', userId);
  if (account.mfaSecret !== null) return refused('mfa_already_enabled', userId);

  // In memory only until a code is confirmed.
  const secret = generateTotpSecret();
  const label = mfaAccountLabel({ id: userId, email: account.email, username: null });
  await input.onSetup({
    userId,
    email: account.email,
    issuer: PLATFORM_MFA_ENROLL_ISSUER,
    account: label,
    secret,
    otpauthUri: otpauthUri({ issuer: PLATFORM_MFA_ENROLL_ISSUER, account: label, secret }),
  });

  let step: number | null = null;
  let confirmedAt = now();
  for (let attempt = 1; attempt <= PLATFORM_MFA_ENROLL_CODE_ATTEMPTS && step === null; attempt += 1) {
    const code = await input.readCode(attempt);
    confirmedAt = now();
    step = matchTotp(secret, code, confirmedAt.getTime(), null);
  }
  if (step === null) return refused('code_invalid', userId);
  const matchedStep = step;
  const enabledAt = confirmedAt;

  const sealed = sealSecret(deps.key, secret, userId);
  // The HMAC key of the recovery codes is derived from the platform key — never the sealing key itself.
  const recoveryKey = deriveRecoveryCodeKey(deps.key);
  const recoveryCodes = generateRecoveryCodes();
  const codeRows = recoveryCodes.map((code) => ({
    userId,
    codeHash: hashRecoveryCode(recoveryKey, userId, normalizeRecoveryCode(code)!),
  }));

  return db.$transaction(async (tx): Promise<PlatformMfaEnrollResult> => {
    // The row lock of PlatformMfaCore.lockUser(): serialises this write with the holder's own MFA routes, a sign-in step and a reset.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) return refused('user_not_found', null);
    // Re-read under the lock: the holder may have typed the code minutes after the checks above.
    const state = await tx.platformUser.findUnique({
      where: { id: userId },
      select: { status: true, passwordHash: true, mfaSecret: true },
    });
    if (!state) return refused('user_not_found', null);
    if (state.passwordHash !== provedHash) return refused('account_changed', userId);
    if (state.status !== 'active') return refused('account_suspended', userId);
    if (state.mfaSecret !== null) return refused('mfa_already_enabled', userId);

    await tx.platformUser.update({
      where: { id: userId },
      data: {
        mfaSecret: sealed,
        mfaEnabledAt: enabledAt,
        mfaLastStep: BigInt(matchedStep),
        mfaPendingSecret: null,
        mfaPendingAt: null,
      },
    });
    await tx.platformMfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.platformMfaRecoveryCode.createMany({ data: codeRows });
    const revoked = await tx.platformRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: enabledAt },
    });
    const revokedSessions = revoked.count;
    // The number of ended sessions and where the enrolment came from — never the secret, a code or a hash.
    const metadata = { revokedSessions, via: PLATFORM_MFA_ENROLL_VIA };
    assertNoSecrets(metadata);
    await tx.platformAuditLog.create({
      data: {
        action: PLATFORM_MFA_ENROLL_EVENT,
        actorPlatformUserId: null,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: userId,
        metadata,
      },
    });
    return { outcome: 'enabled', userId, enabledAt, recoveryCodes, revokedSessions };
  });
}
