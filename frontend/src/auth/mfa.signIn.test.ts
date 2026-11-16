import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import {
  LOCK_MINUTES_MAX,
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_CHALLENGE_TTL_MS,
  SIGN_IN_NOTICES,
  challengeExhausted,
  describeMfaSignInFailure,
  expiryLine,
  minutesLeftOf,
  normalizeRecoveryCode,
  normalizeTotpCode,
  signInNotice,
  signInNoticeOf,
  signInNoticeState,
  stepTimeLeftMs,
} from './mfa.signIn'
import type { SignInNotice } from './mfa.signIn'

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
  it('puts a wrong code under its own field, worded per factor, and marks it as one of the challenge’s five', () => {
    expect(describeMfaSignInFailure(refused(401, 'mfa_code_invalid'), 'code')).toEqual({
      kind: 'field',
      key: 'login.mfa.errors.code_invalid',
      spendsAttempt: true,
    })
    expect(describeMfaSignInFailure(refused(401, 'mfa_code_invalid'), 'recoveryCode')).toEqual({
      kind: 'field',
      key: 'login.mfa.errors.recovery_code_invalid',
      spendsAttempt: true,
    })
    // Refused before the server looked at the challenge: it costs no attempt.
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

  it('leaves the step for a locked account, with the minutes to wait rounded up', () => {
    // Not an alert beside a live form: until the lock ends no code can be accepted.
    expect(describeMfaSignInFailure(refused(423, 'account_locked', { retryAfterSeconds: 841 }), 'code')).toEqual({
      kind: 'locked',
      key: 'login.errors.account_locked',
      minutes: 15,
    })
    expect(describeMfaSignInFailure(refused(423, 'account_locked', { retryAfterSeconds: 841 }), 'recoveryCode').kind).toBe('locked')
    expect(describeMfaSignInFailure(refused(423, 'account_locked', { retryAfterSeconds: 20 }), 'code').minutes).toBe(1)
    expect(describeMfaSignInFailure(refused(423, 'account_locked'), 'code')).toEqual({
      kind: 'locked',
      key: 'login.errors.account_locked',
      minutes: undefined,
    })
  })

  it('marks nothing but a wrong code as an attempt of the challenge', () => {
    const others = [
      refused(400, 'mfa_factor_required'),
      refused(401, 'mfa_challenge_invalid'),
      refused(423, 'account_locked', { retryAfterSeconds: 60 }),
      refused(429, 'rate_limited'),
      refused(503, 'mfa_unavailable'),
      refused(403, 'account_suspended'),
      refused(500),
      new TypeError('Failed to fetch'),
    ]
    for (const error of others) expect(describeMfaSignInFailure(error, 'code').spendsAttempt).toBeUndefined()
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
  const START = Date.parse('2026-11-16T09:30:00.000Z')

  it('gives a step that has just appeared the server’s whole five minutes', () => {
    expect(MFA_CHALLENGE_TTL_MS).toBe(5 * 60_000)
    expect(stepTimeLeftMs(START, START)).toBe(MFA_CHALLENGE_TTL_MS)
  })

  it('counts the five minutes down from the moment the step appeared, to 0 and never below', () => {
    expect(stepTimeLeftMs(START, START + 1)).toBe(MFA_CHALLENGE_TTL_MS - 1)
    expect(stepTimeLeftMs(START, START + 20_000)).toBe(4 * 60_000 + 40_000)
    expect(stepTimeLeftMs(START, START + 4 * 60_000 + 59_999)).toBe(1)
    expect(stepTimeLeftMs(START, START + MFA_CHALLENGE_TTL_MS)).toBe(0)
    expect(stepTimeLeftMs(START, START + MFA_CHALLENGE_TTL_MS + 1)).toBe(0)
    expect(stepTimeLeftMs(START, START + 3 * 3_600_000)).toBe(0)
  })

  it('reads the device’s clock as a stopwatch: a clock that is fast or slow changes nothing', () => {
    // 4 min 40 s fast, 3 minutes slow, a day ahead, the epoch: the same 20 seconds passed on each.
    for (const offset of [4 * 60_000 + 40_000, -3 * 60_000, 86_400_000, -START]) {
      const start = START + offset
      expect(stepTimeLeftMs(start, start)).toBe(MFA_CHALLENGE_TTL_MS)
      expect(stepTimeLeftMs(start, start + 20_000)).toBe(4 * 60_000 + 40_000)
      expect(stepTimeLeftMs(start, start + MFA_CHALLENGE_TTL_MS)).toBe(0)
    }
  })

  it('never shows more than the five minutes when the clock is set back while the step is open', () => {
    expect(stepTimeLeftMs(START, START - 1)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(stepTimeLeftMs(START, START - 3_600_000)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(stepTimeLeftMs(START, Number.NaN)).toBe(MFA_CHALLENGE_TTL_MS)
    expect(stepTimeLeftMs(Number.NaN, START)).toBe(MFA_CHALLENGE_TTL_MS)
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

describe('the challenge’s wrong codes', () => {
  it('calls the challenge spent at the server’s fifth wrong code, not before', () => {
    expect(MFA_CHALLENGE_MAX_ATTEMPTS).toBe(5)
    for (const wrongCodes of [0, 1, 4]) expect(challengeExhausted(wrongCodes)).toBe(false)
    for (const wrongCodes of [5, 6]) expect(challengeExhausted(wrongCodes)).toBe(true)
  })
})

describe('the sign-in notices', () => {
  const LOCKED = 'password_changed_account_locked'

  it('reads a known notice from a router location state and nothing else', () => {
    expect(signInNoticeOf({ notice: 'password_changed' })).toEqual({
      id: 'password_changed',
      key: 'login.mfa.notices.passwordChanged',
      type: 'success',
    })
    expect(signInNoticeOf({ notice: 'password_changed_step_ended', from: '/users' })).toEqual({
      id: 'password_changed_step_ended',
      key: 'login.mfa.notices.passwordChangedStepEnded',
      type: 'warning',
    })
    expect(signInNoticeOf({ notice: 'mfa_step_ended' })).toEqual({
      id: 'mfa_step_ended',
      key: 'login.mfa.errors.challenge_invalid',
      type: 'warning',
    })
    for (const state of [null, undefined, 'password_changed', { from: '/users' }, { notice: 'toString' }, { notice: 42 }, { notice: '<b>x</b>' }]) {
      expect(signInNoticeOf(state)).toBeNull()
    }
  })

  it('names the minutes of a lock only for the notice that has such a wording, and only whole minutes up to a day', () => {
    expect(signInNoticeOf({ notice: LOCKED, minutes: 15 })).toEqual({
      id: LOCKED,
      key: 'login.mfa.notices.passwordChangedLockedFor',
      type: 'warning',
      minutes: 15,
    })
    expect(signInNoticeOf({ notice: LOCKED, minutes: 1 })?.minutes).toBe(1)
    expect(signInNoticeOf({ notice: LOCKED, minutes: LOCK_MINUTES_MAX })?.minutes).toBe(1440)

    // Anything else in `minutes` is ignored — the wording without a number, never the value itself.
    const untimed = { id: LOCKED, key: 'login.mfa.notices.passwordChangedLocked', type: 'warning' }
    for (const minutes of [undefined, null, 0, -5, 1.5, 1441, Number.NaN, Infinity, '15', '<b>15</b>', { valueOf: () => 15 }, [15]]) {
      expect(signInNoticeOf({ notice: LOCKED, minutes })).toEqual(untimed)
    }

    // A notice without a timed wording never reads the minutes.
    for (const notice of ['password_changed', 'password_changed_step_ended', 'mfa_step_ended']) {
      expect(signInNoticeOf({ notice, minutes: 15 })).not.toHaveProperty('minutes')
    }
    expect(signInNotice('mfa_step_ended', 15)).toEqual({ id: 'mfa_step_ended', key: 'login.mfa.errors.challenge_invalid', type: 'warning' })
  })

  it('builds the router state a page sends, with the minutes only when they are usable', () => {
    expect(signInNoticeState('password_changed')).toEqual({ notice: 'password_changed' })
    expect(signInNoticeState(LOCKED, 15)).toEqual({ notice: LOCKED, minutes: 15 })
    for (const minutes of [undefined, 0, 2.5, 1441, Number.NaN]) {
      expect(signInNoticeState(LOCKED, minutes)).toEqual({ notice: LOCKED })
    }
    // What one page writes, the sign-in page reads back.
    expect(signInNoticeOf(signInNoticeState(LOCKED, 15))?.minutes).toBe(15)
    expect(signInNoticeOf(signInNoticeState(LOCKED))?.key).toBe('login.mfa.notices.passwordChangedLocked')
  })

  it('has a translated message for every notice, and {{minutes}} exactly in the timed wordings', () => {
    for (const id of Object.keys(SIGN_IN_NOTICES) as SignInNotice[]) {
      const { key, timedKey } = SIGN_IN_NOTICES[id]
      for (const lng of ['ar', 'en']) {
        expect(i18n.exists(key, { lng }), key).toBe(true)
        expect(i18n.t(key, { lng }), key).not.toContain('{{')
        if (timedKey) {
          expect(i18n.exists(timedKey, { lng }), timedKey).toBe(true)
          expect(i18n.t(timedKey, { lng, minutes: 15 }), timedKey).toContain('15')
        }
      }
    }
  })
})
