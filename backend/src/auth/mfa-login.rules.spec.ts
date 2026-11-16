// TEST-227 (unit part) — MFA-T03 (D-R109): the pure rules of the two-step sign-in.
import { describe, expect, it } from 'vitest';
import {
  afterWrongAttempt,
  challengeAttempts,
  challengeOutlivedPassword,
  isPendingMfa,
  pickMfaFactor,
  toMfaChallengeResponse,
} from './mfa-login.rules.js';

describe('pickMfaFactor', () => {
  it('takes exactly one of code and recoveryCode, as typed', () => {
    expect(pickMfaFactor({ code: ' 123 456 ' })).toEqual({ kind: 'code', value: ' 123 456 ' });
    expect(pickMfaFactor({ recoveryCode: 'abcde-fghjk' })).toEqual({ kind: 'recovery_code', value: 'abcde-fghjk' });
    // A blank or null field counts as not sent, so a form posting both fields with one empty works.
    expect(pickMfaFactor({ code: '123456', recoveryCode: '  ' })).toEqual({ kind: 'code', value: '123456' });
    expect(pickMfaFactor({ code: null, recoveryCode: 'ABCDE-FGHJK' })).toEqual({ kind: 'recovery_code', value: 'ABCDE-FGHJK' });
  });

  it('refuses none and both', () => {
    expect(pickMfaFactor({})).toBeNull();
    expect(pickMfaFactor({ code: '', recoveryCode: '' })).toBeNull();
    expect(pickMfaFactor({ code: null, recoveryCode: null })).toBeNull();
    expect(pickMfaFactor({ code: '123456', recoveryCode: 'ABCDE-FGHJK' })).toBeNull();
  });
});

describe('challengeAttempts / afterWrongAttempt', () => {
  it('reads the attempts of the metadata and fails closed on anything else', () => {
    expect(challengeAttempts({ attempts: 0 }, 5)).toBe(0);
    expect(challengeAttempts({ attempts: 3 }, 5)).toBe(3);
    expect(challengeAttempts({ attempts: 9 }, 5)).toBe(5);
    for (const broken of [null, undefined, [], 'x', {}, { attempts: -1 }, { attempts: 1.5 }, { attempts: '2' }]) {
      expect(challengeAttempts(broken, 5)).toBe(5);
    }
  });

  it('consumes the challenge at the limit', () => {
    expect(afterWrongAttempt(0, 5)).toEqual({ attempts: 1, exhausted: false });
    expect(afterWrongAttempt(3, 5)).toEqual({ attempts: 4, exhausted: false });
    expect(afterWrongAttempt(4, 5)).toEqual({ attempts: 5, exhausted: true });
    expect(afterWrongAttempt(5, 5)).toEqual({ attempts: 6, exhausted: true });
  });
});

describe('challengeOutlivedPassword', () => {
  const ttl = 5 * 60 * 1000;
  const expiresAt = new Date('2026-11-16T10:05:00.000Z'); // issued at 10:00:00

  it('kills a challenge issued before the last password change only', () => {
    expect(challengeOutlivedPassword(expiresAt, null, ttl)).toBe(false);
    expect(challengeOutlivedPassword(expiresAt, new Date('2026-11-16T09:59:59.999Z'), ttl)).toBe(false);
    // The reset (API-020) changes the password, then issues the challenge — same millisecond is fine.
    expect(challengeOutlivedPassword(expiresAt, new Date('2026-11-16T10:00:00.000Z'), ttl)).toBe(false);
    expect(challengeOutlivedPassword(expiresAt, new Date('2026-11-16T10:00:00.001Z'), ttl)).toBe(true);
  });
});

describe('isPendingMfa / toMfaChallengeResponse', () => {
  it('tells the challenge from a session and renders it without anything else', () => {
    const pending = { mfaRequired: true as const, challenge: 'c'.repeat(43), expiresAt: new Date('2026-11-16T10:05:00.000Z') };
    expect(isPendingMfa(pending)).toBe(true);
    expect(isPendingMfa({ accessToken: 'x', refreshToken: 'y' })).toBe(false);
    expect(isPendingMfa({ mfaRequired: 'true' })).toBe(false);
    expect(toMfaChallengeResponse(pending)).toEqual({
      mfaRequired: true,
      challenge: 'c'.repeat(43),
      expiresAt: '2026-11-16T10:05:00.000Z',
    });
  });
});
