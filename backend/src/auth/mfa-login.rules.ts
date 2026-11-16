// MFA-T03 (MOD-01-H06, D-R109) — the pure rules of the two-step sign-in: which
// second factor an API-211 body carries, how many wrong codes a challenge has
// seen, when a challenge no longer proves the account's password, and the
// answer the sign-in step gives instead of a session. No I/O.
import type { MfaChallengeResponseDto } from './auth.dto.js';

/** The one second factor of a `POST /api/auth/login/mfa` request. */
export type MfaFactor = { kind: 'code'; value: string } | { kind: 'recovery_code'; value: string };

/** What the password step (API-005) or a confirmed reset (API-020) answers for an account with MFA. */
export interface PendingMfaSignIn {
  mfaRequired: true;
  /** Handed to the client once; only its SHA-256 is stored. */
  challenge: string;
  expiresAt: Date;
}

const present = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * The factor of the body, or null unless EXACTLY one of `code` and
 * `recoveryCode` was sent (`400 mfa_factor_required`). A blank string counts as
 * not sent, so a form that posts both fields with one left empty still works.
 * The value is passed on as typed: the TOTP and recovery-code checks normalise
 * it themselves.
 */
export function pickMfaFactor(input: { code?: string | null; recoveryCode?: string | null }): MfaFactor | null {
  const code = present(input.code);
  const recovery = present(input.recoveryCode);
  if (code === recovery) return null;
  return code ? { kind: 'code', value: input.code! } : { kind: 'recovery_code', value: input.recoveryCode! };
}

/**
 * The wrong attempts a challenge has seen, from its `{ attempts }` metadata.
 * Anything but a non-negative integer fails closed: the challenge counts as
 * exhausted (`max`), never as fresh.
 */
export function challengeAttempts(metadata: unknown, max: number): number {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const attempts = (metadata as Record<string, unknown>)['attempts'];
    if (typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts >= 0) return Math.min(attempts, max);
  }
  return max;
}

/** The challenge's state after one more wrong code: consumed once it reaches `max`. */
export function afterWrongAttempt(attempts: number, max: number): { attempts: number; exhausted: boolean } {
  const next = attempts + 1;
  return { attempts: next, exhausted: next >= max };
}

/**
 * True when the password changed after the challenge was issued: the challenge
 * proved a password the account no longer has, so it is dead. The issue time
 * is `expiresAt − ttl` — both on the application's clock, like
 * `password_changed_at` (never compared with the database's `created_at`).
 */
export function challengeOutlivedPassword(expiresAt: Date, passwordChangedAt: Date | null, ttlMs: number): boolean {
  if (passwordChangedAt === null) return false;
  return passwordChangedAt.getTime() > expiresAt.getTime() - ttlMs;
}

/** True for the challenge answer, false for an issued session. */
export function isPendingMfa(outcome: object): outcome is PendingMfaSignIn {
  return 'mfaRequired' in outcome && (outcome as { mfaRequired: unknown }).mfaRequired === true;
}

/** The JSON body of the challenge answer — no cookie goes with it. */
export function toMfaChallengeResponse(pending: PendingMfaSignIn): MfaChallengeResponseDto {
  return { mfaRequired: true, challenge: pending.challenge, expiresAt: pending.expiresAt.toISOString() };
}
