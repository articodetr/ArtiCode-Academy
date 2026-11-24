import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { REGISTRATION_PROBLEMS } from '../api/registration'
import i18n from '../i18n'
import {
  describeCompleteFailure,
  describeLinkFailure,
  describeRegisterFailure,
  fieldErrorsOf,
  rateLimitMessage,
} from './registration.errors'

function refused(status: number, code?: string, extra: Record<string, unknown> = {}, retryAfter: number | null = null) {
  return new ApiError(status, 'refused', { statusCode: status, ...(code ? { code } : {}), ...extra }, retryAfter)
}

describe('fieldErrorsOf', () => {
  it('puts each problem under its own field, for the fields the screen shows', () => {
    const body = { fields: { email: ['invalid_format'], fullName: ['too_short', 'blank'], locale: ['invalid_format'] }, unknown: [] }
    expect(fieldErrorsOf(body, ['fullName', 'email'])).toEqual([
      {
        name: 'fullName',
        messages: [{ key: 'studentRegistration.validation.fullName.too_short' }, { key: 'studentRegistration.validation.fullName.blank' }],
      },
      { name: 'email', messages: [{ key: 'studentRegistration.validation.email.invalid_format' }] },
    ])
  })

  it('reads an unknown problem as a wrong format and never shows the raw code', () => {
    expect(fieldErrorsOf({ fields: { email: ['<b>new</b>'] } }, ['email'])).toEqual([
      { name: 'email', messages: [{ key: 'studentRegistration.validation.email.invalid_format' }] },
    ])
  })

  it('words every password problem as the password policy, once', () => {
    const [error] = fieldErrorsOf({ fields: { password: ['required', 'too_short'] } }, ['password'])
    expect(error?.messages).toEqual([{ key: 'account.validation.passwordPolicy', params: { min: 10, max: 128 } }])
  })

  it('ignores a body without usable fields', () => {
    for (const body of [undefined, null, 'x', {}, { fields: null }, { fields: { email: 'invalid_format' } }, { fields: { email: [42] } }]) {
      expect(fieldErrorsOf(body, ['email'])).toEqual([])
    }
    // An inherited property is not a field of the answer.
    expect(fieldErrorsOf({ fields: Object.create({ email: ['required'] }) }, ['email'])).toEqual([])
  })

  it('has a worded message for every problem of both fields in both languages', () => {
    for (const field of ['fullName', 'email']) {
      for (const problem of REGISTRATION_PROBLEMS) {
        const key = `studentRegistration.validation.${field}.${problem}`
        for (const lng of ['ar', 'en']) expect(i18n.exists(key, { lng }), key).toBe(true)
      }
    }
  })
})

describe('rateLimitMessage', () => {
  it('says how long to wait when the server named it, in whole minutes rounded up', () => {
    expect(rateLimitMessage(30)).toEqual({ key: 'studentRegistration.errors.rateLimitedSoon' })
    expect(rateLimitMessage(60)).toEqual({ key: 'studentRegistration.errors.rateLimitedMinutes', params: { count: 1 } })
    expect(rateLimitMessage(61)).toEqual({ key: 'studentRegistration.errors.rateLimitedMinutes', params: { count: 2 } })
    expect(rateLimitMessage(900)).toEqual({ key: 'studentRegistration.errors.rateLimitedMinutes', params: { count: 15 } })
  })

  it('stays general without a usable number', () => {
    for (const seconds of [null, 0, -1, Number.NaN, Infinity]) {
      expect(rateLimitMessage(seconds)).toEqual({ key: 'studentRegistration.errors.rateLimited' })
    }
  })

  it('words the minutes in both languages', () => {
    const key = 'studentRegistration.errors.rateLimitedMinutes'
    expect(i18n.t(key, { lng: 'ar', count: 1 })).toContain('دقيقة واحدة')
    expect(i18n.t(key, { lng: 'ar', count: 2 })).toContain('دقيقتين')
    expect(i18n.t(key, { lng: 'ar', count: 5 })).toContain('5 دقائق')
    expect(i18n.t(key, { lng: 'ar', count: 15 })).toContain('15 دقيقة')
    expect(i18n.t(key, { lng: 'en', count: 1 })).toContain('1 minute.')
    expect(i18n.t(key, { lng: 'en', count: 15 })).toContain('15 minutes')
  })
})

describe('describeRegisterFailure', () => {
  it('reads the closed academy and the field problems', () => {
    expect(describeRegisterFailure(refused(403, 'registration_disabled'))).toEqual({ kind: 'closed' })
    const failure = describeRegisterFailure(refused(400, 'registration_invalid', { fields: { email: ['too_long'] }, unknown: [] }))
    expect(failure).toEqual({
      kind: 'fields',
      fields: [{ name: 'email', messages: [{ key: 'studentRegistration.validation.email.too_long' }] }],
    })
  })

  it('answers a refusal that names no shown field with a general message', () => {
    expect(describeRegisterFailure(refused(400, 'registration_invalid', { fields: {}, unknown: ['role'] }))).toEqual({
      kind: 'message',
      key: 'studentRegistration.errors.invalid',
    })
  })

  it('words the failures that keep the form', () => {
    expect(describeRegisterFailure(new TypeError('offline'))).toEqual({ kind: 'message', key: 'login.errors.network' })
    expect(describeRegisterFailure(refused(403, 'origin_forbidden'))).toEqual({ kind: 'message', key: 'users.errors.origin_forbidden' })
    expect(describeRegisterFailure(refused(503))).toEqual({ kind: 'message', key: 'login.errors.server' })
    expect(describeRegisterFailure(refused(418))).toEqual({ kind: 'message', key: 'login.errors.generic' })
    expect(describeRegisterFailure(refused(429, undefined, {}, 120))).toEqual({
      kind: 'message',
      key: 'studentRegistration.errors.rateLimitedMinutes',
      params: { count: 2 },
    })
  })
})

describe('describeLinkFailure', () => {
  it('reads a dead link, with or without a code', () => {
    expect(describeLinkFailure(refused(404, 'registration_link_invalid'))).toEqual({ kind: 'link_invalid' })
    expect(describeLinkFailure(refused(404))).toEqual({ kind: 'link_invalid' })
    expect(describeLinkFailure(refused(410, 'registration_link_expired'))).toEqual({ kind: 'link_expired' })
    expect(describeLinkFailure(refused(410))).toEqual({ kind: 'link_expired' })
    expect(describeLinkFailure(refused(403, 'registration_disabled'))).toEqual({ kind: 'closed' })
  })

  it('leaves a failure that is not about the link to a retry', () => {
    expect(describeLinkFailure(new TypeError('offline'))).toEqual({ kind: 'message', key: 'login.errors.network' })
    expect(describeLinkFailure(refused(500))).toEqual({ kind: 'message', key: 'login.errors.server' })
    expect(describeLinkFailure(refused(429)).kind).toBe('message')
  })
})

describe('describeCompleteFailure', () => {
  it('puts password_weak under the password', () => {
    expect(describeCompleteFailure(refused(400, 'password_weak', { problems: ['at least 10 characters'] }))).toEqual({
      kind: 'fields',
      fields: [{ name: 'password', messages: [{ key: 'account.errors.password_weak', params: { min: 10 } }] }],
    })
  })

  it('puts registration_invalid under the name or the password', () => {
    expect(describeCompleteFailure(refused(400, 'registration_invalid', { fields: { fullName: ['too_long'] } }))).toEqual({
      kind: 'fields',
      fields: [{ name: 'fullName', messages: [{ key: 'studentRegistration.validation.fullName.too_long' }] }],
    })
    expect(describeCompleteFailure(refused(400, 'registration_invalid', { fields: { email: ['required'] } }))).toEqual({
      kind: 'message',
      key: 'studentRegistration.errors.invalid',
    })
  })

  it('reads the link verdicts and keeps the form for the rest', () => {
    expect(describeCompleteFailure(refused(404))).toEqual({ kind: 'link_invalid' })
    expect(describeCompleteFailure(refused(410, 'registration_link_expired'))).toEqual({ kind: 'link_expired' })
    expect(describeCompleteFailure(refused(403, 'registration_disabled'))).toEqual({ kind: 'closed' })
    expect(describeCompleteFailure(refused(500))).toEqual({ kind: 'message', key: 'login.errors.server' })
    expect(describeCompleteFailure(new TypeError('offline'))).toEqual({ kind: 'message', key: 'login.errors.network' })
  })
})
