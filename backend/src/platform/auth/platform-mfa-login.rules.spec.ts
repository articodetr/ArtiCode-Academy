// TEST-233 (unit) — PMFA-T03: the pure rules of the platform's two-step sign-in
// (platform-mfa-login.rules.ts) — the factor of an API-218 body, the attempts
// of a challenge (a column capped at 5 by a CHECK), a challenge outlived by a
// password change, and the challenge answer of API-178.
import { describe, expect, it } from 'vitest';
import {
  afterWrongPlatformAttempt,
  challengeExhausted,
  challengeOutlivedPassword,
  isPendingPlatformMfa,
  pickPlatformMfaFactor,
  toPlatformMfaChallengeResponse,
} from './platform-mfa-login.rules.js';

const MAX = 5;
const TTL = 5 * 60 * 1000;

describe('pickPlatformMfaFactor', () => {
  it('takes exactly one of code and recoveryCode, as typed', () => {
    expect(pickPlatformMfaFactor({ code: ' 123 456 ' })).toEqual({ kind: 'code', value: ' 123 456 ' });
    expect(pickPlatformMfaFactor({ recoveryCode: 'abcde-fghjk' })).toEqual({ kind: 'recovery_code', value: 'abcde-fghjk' });
    // A blank field counts as not sent.
    expect(pickPlatformMfaFactor({ code: '123456', recoveryCode: '   ' })).toEqual({ kind: 'code', value: '123456' });
    expect(pickPlatformMfaFactor({ code: '', recoveryCode: 'ABCDE-FGHJK' })).toEqual({ kind: 'recovery_code', value: 'ABCDE-FGHJK' });
    expect(pickPlatformMfaFactor({ code: null, recoveryCode: 'ABCDE-FGHJK' })).toEqual({ kind: 'recovery_code', value: 'ABCDE-FGHJK' });
  });

  it('refuses none and both', () => {
    expect(pickPlatformMfaFactor({})).toBeNull();
    expect(pickPlatformMfaFactor({ code: '', recoveryCode: ' ' })).toBeNull();
    expect(pickPlatformMfaFactor({ code: null, recoveryCode: null })).toBeNull();
    expect(pickPlatformMfaFactor({ code: '123456', recoveryCode: 'ABCDE-FGHJK' })).toBeNull();
  });
});

describe('challenge attempts', () => {
  it('counts one more wrong factor and consumes the challenge at the fifth — never above five', () => {
    expect(afterWrongPlatformAttempt(0, MAX)).toEqual({ attempts: 1, exhausted: false });
    expect(afterWrongPlatformAttempt(3, MAX)).toEqual({ attempts: 4, exhausted: false });
    expect(afterWrongPlatformAttempt(4, MAX)).toEqual({ attempts: 5, exhausted: true });
    // Whatever it is handed, the written value stays inside the CHECK (0..5).
    expect(afterWrongPlatformAttempt(5, MAX)).toEqual({ attempts: 5, exhausted: true });
    expect(afterWrongPlatformAttempt(9, MAX)).toEqual({ attempts: 5, exhausted: true });
    expect(afterWrongPlatformAttempt(-2, MAX)).toEqual({ attempts: 1, exhausted: false });
  });

  it('treats a challenge at its cap, or with a value that is no count, as exhausted (fail closed)', () => {
    expect(challengeExhausted(0, MAX)).toBe(false);
    expect(challengeExhausted(4, MAX)).toBe(false);
    expect(challengeExhausted(5, MAX)).toBe(true);
    expect(challengeExhausted(6, MAX)).toBe(true);
    expect(challengeExhausted(-1, MAX)).toBe(true);
    expect(challengeExhausted(1.5, MAX)).toBe(true);
    expect(challengeExhausted(Number.NaN, MAX)).toBe(true);
  });
});

describe('challengeOutlivedPassword', () => {
  const issuedAt = new Date('2026-11-16T10:00:00.000Z');
  const expiresAt = new Date(issuedAt.getTime() + TTL);

  it('kills a challenge issued before the last password change, keeps one issued after it or at the same instant', () => {
    expect(challengeOutlivedPassword(expiresAt, null, TTL)).toBe(false);
    expect(challengeOutlivedPassword(expiresAt, new Date(issuedAt.getTime() - 1), TTL)).toBe(false);
    expect(challengeOutlivedPassword(expiresAt, issuedAt, TTL)).toBe(false);
    expect(challengeOutlivedPassword(expiresAt, new Date(issuedAt.getTime() + 1), TTL)).toBe(true);
  });
});

describe('the challenge answer of API-178', () => {
  it('is told apart from a session and serialised without a cookie field', () => {
    const pending = { mfaRequired: true as const, challenge: 'c'.repeat(43), expiresAt: new Date('2026-11-16T10:05:00.000Z') };
    expect(isPendingPlatformMfa(pending)).toBe(true);
    expect(isPendingPlatformMfa({ accessToken: 'a', expiresIn: 900, refreshToken: 'r', refreshExpiresAt: new Date(), user: {} })).toBe(false);
    expect(isPendingPlatformMfa({ mfaRequired: 'true' })).toBe(false);
    expect(toPlatformMfaChallengeResponse(pending)).toEqual({
      mfaRequired: true,
      challenge: 'c'.repeat(43),
      expiresAt: '2026-11-16T10:05:00.000Z',
    });
  });
});
