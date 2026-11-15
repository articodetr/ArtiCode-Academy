import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { buildAnnouncementInput, initialAnnouncementValues, textProblem } from './announcements.form'
import { describeNotificationsFailure } from './notifications.errors'
import { notificationLink, planPreferencesSave, switchesOf } from './notifications.view'
import { makePreferences } from '../test/notifications'

describe('notifications rules', () => {
  it('follows only paths of this app', () => {
    expect(notificationLink({ link: '/my-invoices' })).toBe('/my-invoices')
    expect(notificationLink({ link: '//evil.example' })).toBeNull()
    expect(notificationLink({ link: 'https://evil.example' })).toBeNull()
    expect(notificationLink({})).toBeNull()
  })

  it('plans one PUT of the six switches only when one changed', () => {
    const saved = switchesOf(makePreferences())
    expect(planPreferencesSave(saved, { ...saved })).toBeNull()
    expect(planPreferencesSave(saved, { ...saved, exams: false })).toHaveLength(6)
  })

  it('builds the academy audience in the server order and counts code points', () => {
    const input = buildAnnouncementInput({ ...initialAnnouncementValues(), kind: 'academy', roleKeys: ['staff', 'student'], title: ' t ', body: ' b ' })
    expect(input).toEqual({ audience: { kind: 'academy', roleKeys: ['student', 'staff'] }, title: 't', body: 'b', sendEmail: false })
    expect(textProblem('  ', 5)).toBe('required')
    expect(textProblem('❤️❤️❤️', 5)).toBe('max')
  })

  it('names the problems of audience_invalid and points at the field', () => {
    const error = new ApiError(400, 'bad', { code: 'audience_invalid', problems: ['role_keys_required'] })
    const failure = describeNotificationsFailure(error, (key) => (key.endsWith('role_keys_required') ? ar.notifications.errors.audienceProblems.role_keys_required : key))
    expect(failure).toEqual({ key: 'notifications.errors.audience_invalid', params: { list: 'لم يُختر دور' }, field: 'roleKeys' })
  })
})
