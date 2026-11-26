// TEST-135 (unit) — MOD-10-T02 certificate rules (D-R52/D-R53/D-R57): the
// eligibility order, the serial format and year, the verification code and
// its normalisation, and the read keys.
import { describe, expect, it } from 'vitest';
import { certificatesReadMissing, completionStateOf, formatSerial, ineligibilityOf, myCertificatesAccess, myCertificatesMissing, newVerificationCode, normalizeVerificationCode, yearIn } from './certificates.policy.js';

describe('a student on the way to their own certificate (TEST-189 — ADR-049)', () => {
  const ready = { certificate: null, selfIssue: true, classStatus: 'running', lessonsComplete: true, workCount: 2, pending: 0, isPass: true } as const;

  it('is ready only when every condition holds, in a running or a completed class', () => {
    expect(completionStateOf(ready)).toBe('ready');
    expect(completionStateOf({ ...ready, classStatus: 'completed' })).toBe('ready');
  });

  it('gives the first reason in the server’s order', () => {
    expect(completionStateOf({ ...ready, certificate: 'issued', selfIssue: false, lessonsComplete: false })).toBe('issued');
    expect(completionStateOf({ ...ready, certificate: 'revoked' })).toBe('revoked');
    expect(completionStateOf({ ...ready, selfIssue: false, classStatus: 'cancelled' })).toBe('not_offered');
    for (const classStatus of ['planned', 'open', 'cancelled']) expect(completionStateOf({ ...ready, classStatus, lessonsComplete: false }), classStatus).toBe('class_not_running');
    expect(completionStateOf({ ...ready, lessonsComplete: false, workCount: 0 })).toBe('lessons_pending');
    expect(completionStateOf({ ...ready, workCount: 0, isPass: null })).toBe('no_assessments');
    expect(completionStateOf({ ...ready, pending: 1, isPass: null })).toBe('assessments_pending');
    expect(completionStateOf({ ...ready, isPass: false })).toBe('not_passed');
  });

  it('has nothing to give when every assessment is excused (no grade can be computed)', () => {
    expect(completionStateOf({ ...ready, isPass: null })).toBe('no_assessments');
  });
});

describe('certificate rules (TEST-135)', () => {
  it('gives the first reason in order: already issued, not completed, no final grade, not passed, stale; null when eligible', () => {
    const pass = { isPass: true, stale: false };
    expect(ineligibilityOf({ issued: true, enrollmentStatus: 'active', final: null })).toBe('already_issued');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'active', final: pass })).toBe('not_completed');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'withdrawn', final: pass })).toBe('not_completed');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'completed', final: null })).toBe('no_final_grade');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'completed', final: { isPass: false, stale: true } })).toBe('not_passed');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'completed', final: { isPass: true, stale: true } })).toBe('stale');
    expect(ineligibilityOf({ issued: false, enrollmentStatus: 'completed', final: pass })).toBeNull();
  });

  it('formats PREFIX-YYYY-NNNNN and takes the year in the academy’s time zone', () => {
    expect(formatSerial('CERT', '2026', 1)).toBe('CERT-2026-00001');
    expect(formatSerial('ACA', '2027', 123456)).toBe('ACA-2027-123456');
    const newYearsEve = new Date('2026-12-31T22:30:00Z');
    expect(yearIn('UTC', newYearsEve)).toBe('2026');
    expect(yearIn('Asia/Riyadh', newYearsEve)).toBe('2027');
    expect(yearIn('Not/AZone', newYearsEve)).toBe('2026');
  });

  it('makes 20-character base32 codes and reads a typed code back, refusing what cannot be one', () => {
    const code = newVerificationCode();
    expect(code).toMatch(/^[A-Z2-7]{20}$/);
    expect(newVerificationCode(() => 0)).toBe('A'.repeat(20));
    expect(newVerificationCode(() => 31)).toBe('7'.repeat(20));
    expect(normalizeVerificationCode(` ${code.slice(0, 5).toLowerCase()}-${code.slice(5, 10)} ${code.slice(10)} `)).toBe(code);
    for (const bad of ['', 'ABC', 'A'.repeat(33), 'ABCDEFGHIJKLMNOP0189', 'ABCDEFGHIJKLMNOP!@#$']) expect(normalizeVerificationCode(bad), bad).toBeNull();
  });

  it('opens the reading routes with certificates.read_all or certificates.issue', () => {
    expect(certificatesReadMissing(['certificates.read_all'])).toBeNull();
    expect(certificatesReadMissing(['certificates.issue'])).toBeNull();
    expect(certificatesReadMissing(['certificates.read_own', 'certificates.revoke'])).toEqual(['certificates.read_all', 'certificates.issue']);
  });

  it('TEST-137 — «my certificates»: each relation opens with its own key; neither key is a 403', () => {
    expect(myCertificatesAccess(['certificates.read_own'])).toEqual({ self: true, child: false });
    expect(myCertificatesAccess(['certificates.read_linked'])).toEqual({ self: false, child: true });
    expect(myCertificatesMissing(['certificates.read_all', 'certificates.issue'])).toEqual(['certificates.read_own', 'certificates.read_linked']);
    expect(myCertificatesMissing(['certificates.read_linked'])).toBeNull();
  });
});
