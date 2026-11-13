// MOD-17-T05 (D-R93): the pure rules of the daily maintenance command — which
// rows are old enough to delete. No framework or database imports.
//
// - verification_tokens (invitations, e-mail verification, password reset): a
//   token is dead once it was consumed or expired; a superseded token is
//   retired by setting `consumed_at` (account.service.ts), so the same rule
//   covers it. Kept for VERIFICATION_TOKEN_RETENTION_DAYS after that moment.
// - refresh_tokens: a family stops rotating AUTH_REFRESH_FAMILY_MAX_DAYS after
//   sign-in (MOD-01-H03, ADR-063); its rows are kept REFRESH_FAMILY_GRACE_DAYS
//   longer, then the whole family goes at once. The family's start is carried
//   by its UUIDv7 `family_id`, so the cutoff is a uuid bound (minUuidV7()).

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Days a consumed or expired verification token is kept. */
export const VERIFICATION_TOKEN_RETENTION_DAYS = 30;

/** Days a refresh-token family is kept after it stopped rotating. */
export const REFRESH_FAMILY_GRACE_DAYS = 7;

/** The largest Unix millisecond a UUIDv7 can carry (48 bits). */
const MAX_UUID_V7_MS = 2 ** 48 - 1;

function timeOf(at: Date, name: string): number {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) throw new RangeError(`${name} is not a valid date`);
  return ms;
}

/** Verification tokens consumed or expired strictly before this instant are deleted. */
export function verificationTokenCutoff(now: Date): Date {
  return new Date(
    timeOf(now, 'now') - VERIFICATION_TOKEN_RETENTION_DAYS * DAY_MS,
  );
}

/**
 * Refresh-token families that started strictly before this instant are dead:
 * `familyMaxDays` (AUTH_REFRESH_FAMILY_MAX_DAYS) + REFRESH_FAMILY_GRACE_DAYS ago.
 */
export function refreshFamilyCutoff(now: Date, familyMaxDays: number): Date {
  if (!Number.isInteger(familyMaxDays) || familyMaxDays < 1) {
    throw new RangeError(
      `familyMaxDays must be a positive integer, got ${familyMaxDays}`,
    );
  }
  return new Date(
    timeOf(now, 'now') - (familyMaxDays + REFRESH_FAMILY_GRACE_DAYS) * DAY_MS,
  );
}

/**
 * The smallest version 7 UUID of the millisecond `at`: the 48-bit Unix
 * millisecond, the version nibble 7, zeros, the variant bits 10 and zeros.
 * PostgreSQL compares uuids byte by byte and a UUIDv7 starts with its
 * timestamp, so `family_id < minUuidV7(t)` holds exactly for the families
 * that started before the millisecond t — a family of that very millisecond
 * stays. The lower-case text form orders the same way.
 */
export function minUuidV7(at: Date): string {
  const ms = timeOf(at, 'at');
  if (ms < 0 || ms > MAX_UUID_V7_MS) {
    throw new RangeError('a UUIDv7 carries a millisecond from 1970 to 10889');
  }
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}

export interface MaintenanceCutoffs {
  /** verification_tokens: `consumed_at` or `expires_at` strictly before it. */
  verificationCutoff: Date;
  /** refresh_tokens: families that started strictly before it. */
  refreshFamilyCutoff: Date;
  /** `family_id` strictly below this uuid = a family that started before refreshFamilyCutoff. */
  refreshFamilyBound: string;
}

export function maintenanceCutoffs(
  now: Date,
  familyMaxDays: number,
): MaintenanceCutoffs {
  const familyCutoff = refreshFamilyCutoff(now, familyMaxDays);
  return {
    verificationCutoff: verificationTokenCutoff(now),
    refreshFamilyCutoff: familyCutoff,
    refreshFamilyBound: minUuidV7(familyCutoff),
  };
}
