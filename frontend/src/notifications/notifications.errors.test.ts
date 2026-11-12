import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { AUDIENCE_PROBLEMS, describeNotificationsFailure, failureMessage } from './notifications.errors'

const t = i18n.t.bind(i18n)

function refusal(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : `${status}`, { statusCode: status, ...body })
}

describe('describeNotificationsFailure', () => {
  it('words every code of the MOD-12 dictionary', () => {
    for (const code of ['notification_not_found', 'nothing_to_update', 'audience_empty', 'announcement_not_found']) {
      const failure = describeNotificationsFailure(refusal(400, { code }))
      expect(failure.key).toBe(`notifications.errors.${code}`)
      expect(failureMessage(t, failure)).toBe(ar.notifications.errors[code as keyof typeof ar.notifications.errors])
    }
  })

  it('points class_not_found at the class field of the composer', () => {
    expect(describeNotificationsFailure(refusal(404, { code: 'class_not_found', classId: 'c-1' }))).toEqual({ key: 'notifications.errors.class_not_found', field: ['classId'] })
  })

  it('lists the audience problems in words, and an unknown one as the server spelled it', () => {
    const failure = describeNotificationsFailure(refusal(400, { code: 'audience_invalid', problems: ['class_id_required', 'recipient_group_required', 'brand_new'] }))
    expect(failure.problems).toEqual(['class_id_required', 'recipient_group_required', 'brand_new'])
    expect(failureMessage(t, failure)).toBe(
      i18n.t('notifications.errors.audience_invalid', {
        list: [ar.notifications.errors.problems.class_id_required, ar.notifications.errors.problems.recipient_group_required, 'brand_new'].join('، '),
      }),
    )
    for (const problem of AUDIENCE_PROBLEMS) expect(typeof ar.notifications.errors.problems[problem]).toBe('string')
  })

  it('names the recipients and the limit of audience_too_large, and the missing keys of permission_denied', () => {
    const tooLarge = describeNotificationsFailure(refusal(422, { code: 'audience_too_large', recipients: 6200, max: 5000 }))
    expect(failureMessage(t, tooLarge)).toBe(i18n.t('notifications.errors.audience_too_large', { recipients: '6200', max: '5000' }))
    const denied = describeNotificationsFailure(refusal(403, { code: 'permission_denied', missing: ['classes.manage'] }))
    expect(failureMessage(t, denied)).toBe(i18n.t('notifications.errors.permission_denied', { list: '(classes.manage)' }))
  })

  it('falls back to the guards, a validation refusal, the server and the network', () => {
    expect(describeNotificationsFailure(refusal(403, { code: 'origin_forbidden' })).key).toBe('users.errors.origin_forbidden')
    expect(describeNotificationsFailure(refusal(429, { code: 'rate_limited' })).key).toBe('login.errors.rate_limited')
    expect(describeNotificationsFailure(refusal(400, { message: 'title must be 1 to 200 characters long' }))).toEqual({
      key: 'notifications.errors.validation',
      params: { message: 'title must be 1 to 200 characters long' },
    })
    expect(describeNotificationsFailure(refusal(500, {})).key).toBe('login.errors.server')
    expect(describeNotificationsFailure(refusal(409, {})).key).toBe('login.errors.generic')
    expect(describeNotificationsFailure(new TypeError('Failed to fetch')).key).toBe('login.errors.network')
  })
})
