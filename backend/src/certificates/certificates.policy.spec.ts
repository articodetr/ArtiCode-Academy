// TEST-135 (unit) — MOD-10-T02 certificate rules (D-R52/D-R53/D-R57): the
// eligibility order, the serial format and year, the verification code and
// its normalisation, and the read keys.
import { describe, expect, it } from 'vitest';
import { certificatesReadMissing, formatSerial, ineligibilityOf, myCertificatesAccess, myCertificatesMissing, newVerificationCode, normalizeVerificationCode, yearIn } from './certificates.policy.js';

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
