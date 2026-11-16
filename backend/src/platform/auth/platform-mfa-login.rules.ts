// PMFA-T03 (roadmap §4o) — the pure rules of the platform's two-step sign-in
// (API-178 answering a challenge, API-218 `POST /api/auth/login/mfa`): which
// second factor a body carries, what one more wrong factor does to a challenge,
// when a challenge no longer proves the account's password, and the answer the
// password step gives instead of a session. A copy of the academy's
// src/auth/mfa-login.rules.ts (MFA-T03, D-R109) — copied, not imported, so the
// platform keeps importing nothing of the academy but the pure MFA helpers
// (ADR-073, D-R120); the one difference is that a platform challenge counts its
// wrong attempts in a COLUMN (`platform_mfa_challenges.attempts`, CHECK 0..5),
// not in a metadata object. Keep the two in step. No I/O.
import type { PlatformMfaChallengeResponseDto } from './platform-session.dto.js';

/** The one second factor of a `POST /api/auth/login/mfa` request. */
export type PlatformMfaFactor = { kind: 'code'; value: string } | { kind: 'recovery_code'; value: string };

/** How a platform session was opened (`via` of `platform.auth.login.succeeded`). */
export type PlatformSessionVia = 'password' | 'mfa' | 'recovery_code';

/** What the password step (API-178) answers for an account with MFA. */
export interface PendingPlatformMfaSignIn {
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
export function pickPlatformMfaFactor(input: { code?: string | null; recoveryCode?: string | null }): PlatformMfaFactor | null {
  const code = present(input.code);
  const recovery = present(input.recoveryCode);
  if (code === recovery) return null;
  return code ? { kind: 'code', value: input.code! } : { kind: 'recovery_code', value: input.recoveryCode! };
}

/**
 * True when a challenge has no attempt left: it has seen `max` wrong factors
 * (or a value that is not a non-negative integer — fail closed). Such a
 * challenge is refused as invalid before any factor is tried, so a sixth
 * increment is never written (the CHECK allows 0..5).
 */
export function challengeExhausted(attempts: number, max: number): boolean {
  return !Number.isSafeInteger(attempts) || attempts < 0 || attempts >= max;
}

/**
 * The challenge's state after one more wrong factor: consumed once it reaches
 * `max`. Never above `max`, whatever it is given.
 */
export function afterWrongPlatformAttempt(attempts: number, max: number): { attempts: number; exhausted: boolean } {
  const next = Math.min(Math.max(0, attempts) + 1, max);
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
export function isPendingPlatformMfa(outcome: object): outcome is PendingPlatformMfaSignIn {
  return 'mfaRequired' in outcome && (outcome as { mfaRequired: unknown }).mfaRequired === true;
}

/** The JSON body of the challenge answer — no cookie goes with it. */
export function toPlatformMfaChallengeResponse(pending: PendingPlatformMfaSignIn): PlatformMfaChallengeResponseDto {
  return { mfaRequired: true, challenge: pending.challenge, expiresAt: pending.expiresAt.toISOString() };
}
