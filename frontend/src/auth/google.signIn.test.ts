import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { GOOGLE_URL_INVALID } from '../api/google'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import {
  GOOGLE_RESULT_CODES,
  describeGoogleStartFailure,
  googleMfaHandoffOf,
  googleResultOf,
  isGoogleMfaFragment,
  withoutGoogleResult,
} from './google.signIn'

const CHALLENGE = 'chl_'.padEnd(43, 'c')
const NOW = Date.parse('2026-11-24T10:00:00.000Z')

describe('google.signIn', () => {
  it.each([
    ['503 google_unavailable', new ApiError(503, 'off', { statusCode: 503, code: 'google_unavailable' }), 'login.google.errors.unavailable'],
    ['429', new ApiError(429, 'slow', { statusCode: 429 }), 'login.errors.rate_limited'],
    ['origin_forbidden', new ApiError(403, 'origin', { statusCode: 403, code: 'origin_forbidden' }), 'users.errors.origin_forbidden'],
    ['a 500', new ApiError(500, 'boom', { statusCode: 500 }), 'login.errors.server'],
    ['a 400', new ApiError(400, 'bad', { statusCode: 400 }), 'login.google.errors.failed'],
    ['an address that is not Google’s', new Error(GOOGLE_URL_INVALID), 'login.google.errors.failed'],
    ['no network', new TypeError('Failed to fetch'), 'login.errors.network'],
  ])('words a refused start on %s', (_label, error, key) => {
    expect(describeGoogleStartFailure(error)).toBe(key)
  })

  it('words every verdict of the callback by its own key and type', () => {
    for (const code of GOOGLE_RESULT_CODES) {
      expect(googleResultOf(`?google=${code}&returnTo=%2F`)).toMatchObject({ code, key: `login.google.results.${code}` })
    }
    expect(googleResultOf('?google=cancelled')?.type).toBe('info')
    expect(googleResultOf('?google=link_required')?.type).toBe('warning')
    expect(googleResultOf('?google=account_unavailable')?.type).toBe('error')
    // The codes the review added (the shared contract).
    expect(googleResultOf('?google=link_conflict')).toEqual({ code: 'link_conflict', key: 'login.google.results.link_conflict', type: 'warning' })
    expect(googleResultOf('?google=email_not_authoritative')).toEqual({
      code: 'email_not_authoritative',
      key: 'login.google.results.email_not_authoritative',
      type: 'warning',
    })
    expect(googleResultOf('?google=mfa_unavailable')).toEqual({ code: 'mfa_unavailable', key: 'login.google.results.mfa_unavailable', type: 'error' })
  })

  it('has a message for every verdict in both languages', () => {
    for (const code of GOOGLE_RESULT_CODES) {
      expect(ar.login.google.results[code]).toMatch(/\S/)
      expect(en.login.google.results[code]).toMatch(/\S/)
    }
  })

  it('reads an unknown verdict as failed, never as its raw value, and nothing without the parameter', () => {
    expect(googleResultOf('?google=<b>x</b>')).toEqual({ code: 'failed', key: 'login.google.results.failed', type: 'error' })
    expect(googleResultOf('?google=')?.code).toBe('failed')
    expect(googleResultOf('?returnTo=%2Fusers')).toBeNull()
    expect(googleResultOf('')).toBeNull()
  })

  it('drops the verdict from the address and keeps the return path', () => {
    expect(withoutGoogleResult('?google=failed&returnTo=%2Fcatalog%2Fc-1')).toBe('?returnTo=%2Fcatalog%2Fc-1')
    expect(withoutGoogleResult('?google=failed')).toBe('')
  })

  it('reads the hand-over of a second step from the fragment, with its return path checked', () => {
    const hash = `#google-mfa=${CHALLENGE}&expiresAt=2026-11-24T10%3A05%3A00.000Z&returnTo=${encodeURIComponent('/catalog/c-1?intent=enroll')}`
    expect(isGoogleMfaFragment(hash)).toBe(true)
    expect(googleMfaHandoffOf(hash, NOW)).toEqual({
      challenge: { mfaRequired: true, challenge: CHALLENGE, expiresAt: '2026-11-24T10:05:00.000Z' },
      returnTo: '/catalog/c-1?intent=enroll',
    })
  })

  it('drops a return path that leaves the site, and dates a missing expiry five minutes ahead', () => {
    const handoff = googleMfaHandoffOf(`#google-mfa=${CHALLENGE}&returnTo=${encodeURIComponent('https://evil.example')}`, NOW)
    expect(handoff?.returnTo).toBeNull()
    expect(handoff?.challenge.expiresAt).toBe('2026-11-24T10:05:00.000Z')
  })

  it.each([
    ['no fragment', ''],
    ['another fragment', '#top'],
    ['an empty challenge', '#google-mfa='],
    ['markup', '#google-mfa=%3Cscript%3E'],
    ['a short value', '#google-mfa=abc'],
    ['a long value', `#google-mfa=${'a'.repeat(300)}`],
  ])('takes no second step from %s', (_label, hash) => {
    expect(googleMfaHandoffOf(hash, NOW)).toBeNull()
  })
})
