// MOD-18-T03 — pure rules of the platform sessions (D-R100), shared by the
// session service, the bootstrap / create-user functions and their specs. No
// framework or database imports.
import { BOOTSTRAP_PASSWORD_MIN_LENGTH, passwordProblems } from '../../auth/password.service.js';

/** Event names of the platform authentication (roadmap §4m.4; master doc 12.4). */
export const PLATFORM_AUTH_EVENTS = {
  loginSucceeded: 'platform.auth.login.succeeded',
  loginFailed: 'platform.auth.login.failed',
  refreshReused: 'platform.auth.refresh.reuse_detected',
  logout: 'platform.auth.logout',
  passwordChanged: 'platform.auth.password.changed',
  usersCreated: 'platform.users.created',
} as const;

/** `entity_type` of every event about a platform account. */
export const PLATFORM_USERS_ENTITY = 'platform_users';

/**
 * Every platform account is privileged (it reaches the control plane of every
 * academy), so the academy policy (passwordProblems() of
 * src/auth/password.service.ts) applies with the stricter minimum the academy
 * keeps for its out-of-band first admin: 12 characters, at most 128, not only
 * whitespace.
 */
export const PLATFORM_PASSWORD_MIN_LENGTH = BOOTSTRAP_PASSWORD_MIN_LENGTH;

/** Policy violations of a candidate platform password (empty when acceptable). */
export function platformPasswordProblems(plain: string): string[] {
  return passwordProblems(plain, PLATFORM_PASSWORD_MIN_LENGTH);
}

/** Violations of a new password chosen by its holder: the policy, and it must differ from the current one. */
export function platformNewPasswordProblems(newPassword: string, currentPassword: string): string[] {
  const problems = platformPasswordProblems(newPassword);
  if (newPassword === currentPassword) problems.push('different from the current password');
  return problems;
}

/** The login e-mail as stored (`ck_platform_users_email_normalized`): trimmed and lower-case. */
export function normalizePlatformEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A plausible, normalized e-mail of at most 320 characters. */
export function isPlatformEmail(email: string): boolean {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

/** Seconds left on a sign-in lock (rounded up), or null when the account is not locked at `now`. */
export function lockRemainingSeconds(lockedUntil: Date | null, now: Date = new Date()): number | null {
  if (!lockedUntil || lockedUntil.getTime() <= now.getTime()) return null;
  return Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
}

/** The attempt that reaches the threshold locks the account (the academy rule of AuthService.registerFailedLogin()). */
export function failedLoginLocks(failedAttempts: number, threshold: number): boolean {
  return failedAttempts >= threshold;
}

/** The parts of a stored refresh token the rotation decision reads. */
export interface StoredRefreshState {
  revokedAt: Date | null;
  replacedById: string | null;
  expiresAt: Date;
}

/**
 * What to do with a presented refresh token:
 *  - `reused`  — it was rotated or revoked already: someone may hold a copy, the family is revoked;
 *  - `expired` — its own expiry or the family's absolute deadline (PLATFORM_REFRESH_FAMILY_MAX_DAYS,
 *                read from the UUIDv7 `family_id`; null = not a UUIDv7 = expired, fail closed) has passed;
 *  - `rotate`  — still good: it is retired and a successor issued in the same family.
 */
export function refreshVerdict(
  stored: StoredRefreshState,
  deadline: Date | null,
  now: Date = new Date(),
): 'reused' | 'expired' | 'rotate' {
  if (stored.revokedAt !== null || stored.replacedById !== null) return 'reused';
  if (stored.expiresAt.getTime() <= now.getTime() || deadline === null || deadline.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'rotate';
}
