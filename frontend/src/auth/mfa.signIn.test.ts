import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import {
  MFA_CHALLENGE_TTL_MS,
  SIGN_IN_NOTICES,
  challengeLifetimeMs,
  describeMfaSignInFailure,
  expiryLine,
  minutesLeftOf,
  normalizeRecoveryCode,
  normalizeTotpCode,
  signInNoticeOf,
} from './mfa.signIn'

function refused(status: number, code?: string, extra: Record<string, unknown> = {}) {
  return new ApiError(status, 'refused', { statusCode: status, ...(code ? { code } : {}), ...extra })
}

describe('normalizeTotpCode', () => {
  it('returns the six ASCII digits, dropping spaces around and inside the code', () => {
    expect(normalizeTotpCode('123456')).toBe('123456')
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456')
    expect(normalizeTotpCode('12 34\t56')).toBe('123456')
    expect(normalizeTotpCode('000000')).toBe('000000')
  })

  it('reads Arabic-Indic and Persian digits as their ASCII twins', () => {
    expect(normalizeTotpCode('١٢٣٤٥٦')).toBe('123456')
    expect(normalizeTotpCode('۱۲۳ ۴۵۶')).toBe('123456')
    expect(normalizeTotpCode('12٣٤56')).toBe('123456')
  })

  it('refuses anything that is not exactly six digits', () => {
    for (const input of ['', '   ', '12345', '1234567', '12345a', '123-456', '12.456', 'abcdef']) {
      expect(normalizeTotpCode(input)).toBeNull()
    }
    expect(normalizeTotpCode(undefined)).toBeNull()
    expect(normalizeTotpCode(null)).toBeNull()
  })
})

describe('normalizeRecoveryCode', () => {
  it('returns XXXXX-XXXXX in upper case whatever the dashes, spaces and case typed', () => {
    expect(normalizeRecoveryCode('ABCDE-FGHJK')).toBe('ABCDE-FGHJK')
    expect(normalizeRecoveryCode('abcdefghjk')).toBe('ABCDE-FGHJK')
    expect(normalizeRecoveryCode('  abcde fghjk ')).toBe('ABCDE-FGHJK')
    expect(normalizeRecoveryCode('ab-cd-ef-gh-jk')).toBe('ABCDE-FGHJK')
    expect(normalizeRecoveryCode('23456-789zz')).toBe('23456-789ZZ')
  })

  it('refuses the look-alikes 0, 1, I and O instead of guessing, like the server', () => {
    for (const input of ['ABCDE-FGHJ0', 'ABCDE-FGHJ1', 'ABCDE-FGHJI', 'ABCDE-FGHJO', 'abcde-fghjo']) {
      expect(normalizeRecoveryCode(input)).toBeNull()
    }
  })

  it('refuses a wrong length, other characters and letters that only upper-case into the alphabet', () => {
    for (const input of ['', '-', 'ABCDE-FGHJ', 'ABCDE-FGHJKL', 'ABCDE_FGHJK', 'ABCDE-FGHJ!', 'ABCDE-FGHJı', 'أبجده-وزحطي']) {
      expect(normalizeRecoveryCode(input)).toBeNull()
    }
    expect(normalizeRecoveryCode(undefined)).toBeNull()
    expect(normalizeRecoveryCode(null)).toBeNull()
  })
})

describe('describeMfaSignInFailure', () => {
  it('puts a wrong code under its own field, worded per factor', () => {
    expect(describeMfaSignInFailure(refused(401, 'mfa_code_invalid'), 'code')).toEqual({
      kind: 'field',
      key: 'login.mfa.errors.code_invalid',
    })
    expect(describeMfaSignInFailure(refused(401, 'mfa_code_invalid'), 'recoveryCode')).toEqual({
      kind: 'field',
      key: 'login.mfa.errors.recovery_code_invalid',
    })
    expect(describeMfaSignInFailure(refused(400, 'mfa_factor_required'), 'code')).toEqual({
      kind: 'field',
      key: 'login.mfa.codeRequired',
    })
    expect(describeMfaSignInFailure(refused(400, 'mfa_factor_required'), 'recoveryCode')).toEqual({
      kind: 'field',
      key: 'login.mfa.recoveryCodeRequired',
    })
  })

  it('ends the step when the challenge is expired, used or unknown', () => {
    expect(describeMfaSignInFailure(refused(401, 'mfa_challenge_invalid'), 'code')).toEqual({
      kind: 'restart',
      key: 'login.mfa.errors.challenge_invalid',
    })
  })

  it('tells a locked account how many minutes to wait, rounded up', () => {
    expect(describeMfaSignInFailure(refused(423, 'account_locked', { retryAfterSeconds: 841 }), 'code')).toEqual({
      kind: 'alert',
      key: 'login.errors.account_locked',
      minutes: 15,
    })
    expect(describeMfaSignInFailure(refused(423, 'account_locked', { retryAfterSeconds: 20 }), 'code').minutes).toBe(1)
    expect(describeMfaSignInFailure(refused(423, 'account_locked'), 'code').minutes).toBeUndefined()
  })

  it.each([
    [429, 'rate_limited', 'login.errors.rate_limited'],
    [429, undefined, 'login.errors.rate_limited'],
    [503, 'mfa_unavailable', 'login.errors.mfa_unavailable'],
    [403, 'account_suspended', 'login.errors.account_suspended'],
    [403, 'account_pending', 'login.errors.account_pending'],
    [403, 'account_not_activated', 'login.errors.account_not_activated'],
    [403, 'origin_forbidden', 'users.errors.origin_forbidden'],
    [500, undefined, 'login.errors.server'],
    [502, 'something_new', 'login.errors.server'],
    [400, undefined, 'login.errors.generic'],
    [418, 'something_new', 'login.errors.generic'],
  ])('words %i %s as an alert above the field (%s)', (status, code, key) => {
    expect(describeMfaSignInFailure(refused(status, code), 'code')).toEqual({ kind: 'alert', key })
  })

  it('keeps the typed code only when the server was not reached', () => {
    expect(describeMfaSignInFailure(new TypeError('Failed to fetch'), 'code')).toEqual({
      kind: 'alert',
      key: 'login.errors.network',
      keepsInput: true,
    })
  })

  it('never hands the screen a key without a translation in either language', () => {
    const errors = [
      refused(401, 'mfa_code_invalid'),
      refused(400, 'mfa_factor_required'),
      refused(401, 'mfa_challenge_invalid'),
      refused(423, 'account_locked', { retryAfterSeconds: 60 }),
      refused(429, 'rate_limited'),
      refused(503, 'mfa_unavailable'),
      refused(403, 'account_suspended'),
      refused(403, 'account_pending'),
      refused(403, 'account_not_activated'),
      refused(403, 'origin_forbidden'),
      refused(500),
      refused(400),
      new TypeError('Failed to fetch'),
    ]
    for (const error of errors) {
      for (const factor of ['code', 'recoveryCode'] as const) {
        const { key } = describeMfaSignInFailure(error, factor)
        expect(i18n.exists(key, { lng: 'ar' }), key).toBe(true)
        expect(i18n.exists(key, { lng: 'en' }), key).toBe(true)
      }
    }
  })
})

describe('the step’s clock', () => {
  const NOW = Date.parse('2026-11-16T09:30:00.000Z')
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

  it('shows the time to expiresAt for a challenge that has just arrived', () => {
    expect(challengeLifetimeMs(at(MFA_CHALLENGE_TTL_MS), NOW)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(challengeLifetimeMs(at(4 * 60_000 + 30_000), NOW)).toBe(4 * 60_000 + 30_000)
    expect(challengeLifetimeMs(at(1), NOW)).toBe(1)
  })

  it('falls back to the server’s five minutes when this device’s clock cannot be right', () => {
    // Already past, or further away than a challenge ever lives: the clock is off, not the challenge.
    expect(challengeLifetimeMs(at(0), NOW)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(challengeLifetimeMs(at(-10 * 60_000), NOW)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(challengeLifetimeMs(at(MFA_CHALLENGE_TTL_MS + 1), NOW)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(challengeLifetimeMs(at(3 * 3_600_000), NOW)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(challengeLifetimeMs('not a date', NOW)).toBe(MFA_CHALLENGE_TTL_MS)
  })

  it('counts whole minutes left, rounded up, and 0 once the time is up', () => {
    expect(minutesLeftOf(MFA_CHALLENGE_TTL_MS)).toBe(5)
    expect(minutesLeftOf(4 * 60_000 + 1)).toBe(5)
    expect(minutesLeftOf(4 * 60_000)).toBe(4)
    expect(minutesLeftOf(60_001)).toBe(2)
    expect(minutesLeftOf(60_000)).toBe(1)
    expect(minutesLeftOf(1)).toBe(1)
    expect(minutesLeftOf(0)).toBe(0)
    expect(minutesLeftOf(-5_000)).toBe(0)
  })

  it('words the line for the minutes left and has none once the step is over', () => {
    expect(expiryLine(5)).toEqual({ key: 'login.mfa.expiresInMinutes', minutes: 5 })
    expect(expiryLine(3)).toEqual({ key: 'login.mfa.expiresInMinutes', minutes: 3 })
    expect(expiryLine(2)).toEqual({ key: 'login.mfa.expiresInTwoMinutes' })
    expect(expiryLine(1)).toEqual({ key: 'login.mfa.expiresSoon' })
    expect(expiryLine(0)).toBeNull()
  })
})

describe('signInNoticeOf', () => {
  it('reads a known notice from a router location state and nothing else', () => {
    expect(signInNoticeOf({ notice: 'password_changed' })).toBe('password_changed')
    expect(signInNoticeOf({ notice: 'password_changed_step_ended', from: '/users' })).toBe('password_changed_step_ended')
    expect(signInNoticeOf({ notice: 'mfa_step_ended' })).toBe('mfa_step_ended')
    for (const state of [null, undefined, 'password_changed', { from: '/users' }, { notice: 'toString' }, { notice: 42 }, { notice: '<b>x</b>' }]) {
      expect(signInNoticeOf(state)).toBeNull()
    }
  })

  it('has a translated message for every notice', () => {
    for (const { key } of Object.values(SIGN_IN_NOTICES)) {
      expect(i18n.exists(key, { lng: 'ar' }), key).toBe(true)
      expect(i18n.exists(key, { lng: 'en' }), key).toBe(true)
    }
  })
})
