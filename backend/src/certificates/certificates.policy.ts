// MOD-10 certificates (roadmap §4h.10; owner decisions D-R50..D-R57) as pure
// rules, unit-tested in certificates.policy.spec.ts: who reads and issues,
// which enrollment may receive a certificate, and the serial and the
// verification code (D-R53).
import { randomInt } from 'node:crypto';
import { isResultReleased } from '../exams/attempts.policy.js';
import type { ExamDeliveryValue, ExamResultsReleaseValue } from '../exams/exams.online.js';
import type { ResultSourceValue } from '../exams/my-exams.policy.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ExamResultStatus, ExamStatus } from '../generated/prisma/client.js';

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

/** «My certificates» (D-R57, as «my grades» — D-R48): each relation opens with its own key. */
export interface MyCertificatesAccess {
  self: boolean;
  child: boolean;
}

export function myCertificatesAccess(permissions: readonly string[]): MyCertificatesAccess {
  return { self: permissions.includes(READ_OWN_CERTIFICATES_PERMISSION), child: permissions.includes(READ_LINKED_CERTIFICATES_PERMISSION) };
}

/** The keys to report in `permission_denied` when the caller holds neither, else null. */
export function myCertificatesMissing(permissions: readonly string[]): string[] | null {
  const access = myCertificatesAccess(permissions);
  return access.self || access.child ? null : [READ_OWN_CERTIFICATES_PERMISSION, READ_LINKED_CERTIFICATES_PERMISSION];
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

/**
 * CH-0363: the automatic course-completion certificate. A student receives one
 * per course: every required published lesson completed, an active or completed
 * enrollment, and no certificate for the course yet — a revoked one counts, so
 * a revocation is never undone automatically. Since J-F67 (Jallal's request:
 * the subject examined and the curriculum taken in full) also every exam of the
 * class — and since CH-0244 (Jallal's decision: the student must PASS them, not
 * just take them) every exam passed — `examPassed()` + `examsComplete()`.
 */
export function earnsAutomaticCertificate(input: { hasCertificateForCourse: boolean; enrolled: boolean; courseComplete: boolean; examsPassed: boolean }): boolean {
  return !input.hasCertificateForCourse && input.enrolled && input.courseComplete && input.examsPassed;
}

/**
 * J-F67 / CH-0244: every scheduled or published exam of the class is in `passedExamIds` (`examPassed()`). A class
 * without such an exam has nothing to wait for.
 */
export function examsComplete(examIds: readonly string[], passedExamIds: ReadonlySet<string>): boolean {
  return examIds.every((id) => passedExamIds.has(id));
}

/** The exam fields `examPassed()` reads (`passScore` as `numeric(6,2)` text, or null when the exam has no pass mark). */
export interface CertificateExamView {
  status: ExamStatus;
  delivery: ExamDeliveryValue;
  resultsRelease: ExamResultsReleaseValue;
  passScore: string | null;
}

/** The student's `exam_results` row for that exam (`score` as `numeric(6,2)` text), or null when there is none. */
export interface CertificateResultView {
  status: ExamResultStatus;
  score: string | null;
  source: ResultSourceValue;
}

/**
 * CH-0244 — the student passed this exam, as far as they may know it:
 *   1. the result is visible to them — the rule of «my exams» (`visibleResult()` of my-exams.policy.ts): once the
 *      exam is published, or at once for the counted result of an online exam that releases on submit. A certificate
 *      never tells a learner they passed before their result is out;
 *   2. and it is `excused` (left out, as in the gradebook), or `scored` at or above the exam's pass mark (`passScore`;
 *      an exam without one only needs a score). An `absent` result, or none, is not a pass. An online exam's
 *      counted result is its highest finished attempt (D-R153), so a learner with an attempt left can still pass.
 */
export function examPassed(exam: CertificateExamView, result: CertificateResultView | null): boolean {
  if (result === null) return false;
  const visible = exam.status === 'published' || (isResultReleased(exam) && result.source === 'online');
  if (!visible) return false;
  if (result.status === 'excused') return true;
  if (result.status !== 'scored' || result.score === null) return false;
  return exam.passScore === null || new Prisma.Decimal(result.score).gte(exam.passScore);
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
