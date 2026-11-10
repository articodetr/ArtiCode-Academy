// MOD-10 certificates (roadmap §4h.10; owner decisions D-R50..D-R57) as pure
// rules, unit-tested in certificates.policy.spec.ts: who reads and issues,
// which enrollment may receive a certificate, and the serial and the
// verification code (D-R53).
import { randomInt } from 'node:crypto';

export const ISSUE_CERTIFICATES_PERMISSION = 'certificates.issue';
export const READ_ALL_CERTIFICATES_PERMISSION = 'certificates.read_all';
export const REVOKE_CERTIFICATES_PERMISSION = 'certificates.revoke';
export const READ_OWN_CERTIFICATES_PERMISSION = 'certificates.read_own';
export const READ_LINKED_CERTIFICATES_PERMISSION = 'certificates.read_linked';

/** D-R57: the list, the details and the class preview open with either key (the staff role issues without read_all). */
export const CERTIFICATE_READ_PERMISSIONS = [READ_ALL_CERTIFICATES_PERMISSION, ISSUE_CERTIFICATES_PERMISSION] as const;

/** The keys to report in `permission_denied` when the caller holds neither, else null. */
export function certificatesReadMissing(permissions: readonly string[]): string[] | null {
  return CERTIFICATE_READ_PERMISSIONS.some((key) => permissions.includes(key)) ? null : [...CERTIFICATE_READ_PERMISSIONS];
}

/** Why an enrollment of a class gets no certificate (D-R52), checked in this order. */
export const INELIGIBLE_REASONS = ['already_issued', 'not_completed', 'no_final_grade', 'not_passed', 'stale'] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export interface EligibilityInput {
  /** An issued (not revoked) certificate already exists for the enrollment. */
  issued: boolean;
  /** The enrollment's status (`completed` is required). */
  enrollmentStatus: string;
  /** The final grade fixed by MOD-09, or null. */
  final: { isPass: boolean; stale: boolean } | null;
}

/** The reason the enrollment gets no certificate, or null when it is eligible. */
export function ineligibilityOf(input: EligibilityInput): IneligibleReason | null {
  if (input.issued) return 'already_issued';
  if (input.enrollmentStatus !== 'completed') return 'not_completed';
  if (input.final === null) return 'no_final_grade';
  if (!input.final.isPass) return 'not_passed';
  if (input.final.stale) return 'stale';
  return null;
}

/** The `number_sequences` key of the certificate serials; the period is the year. */
export const CERTIFICATE_SEQUENCE_KEY = 'certificate';

/** `PREFIX-YYYY-NNNNN` (D-R53); a number above 99999 simply grows. */
export function formatSerial(prefix: string, year: string, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(5, '0')}`;
}

/** The calendar year of an instant in a time zone (`UTC` when the zone is unknown to Intl). */
export function yearIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(at);
  } catch {
    return String(at.getUTCFullYear());
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const VERIFICATION_CODE_LENGTH = 20;
const VERIFICATION_CODE_PATTERN = /^[A-Z2-7]{16,32}$/;

/** A random verification code: 20 base32 characters (100 bits) from `crypto`. */
export function newVerificationCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i += 1) code += BASE32[random(BASE32.length)];
  return code;
}

/**
 * A code as a person may type it (lower case, spaces, hyphens) → its stored
 * form, or null when it cannot be one (so the lookup is skipped and the answer
 * is the same 404 — D-R56).
 */
export function normalizeVerificationCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return VERIFICATION_CODE_PATTERN.test(code) ? code : null;
}
