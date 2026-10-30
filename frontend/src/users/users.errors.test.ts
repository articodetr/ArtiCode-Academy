import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeUsersFailure, failureMessage } from './users.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

describe('describeUsersFailure', () => {
  it('maps a known code to its message and, where it names an input, to the form field', () => {
    expect(describeUsersFailure(apiError(409, { code: 'email_in_use' }))).toEqual({ key: 'users.errors.email_in_use', field: ['email'] })
    expect(describeUsersFailure(apiError(409, { code: 'student_number_in_use' }))).toEqual({
      key: 'users.errors.student_number_in_use',
      field: ['studentProfile', 'studentNumber'],
    })
    expect(describeUsersFailure(apiError(422, { code: 'profile_mismatch' }))).toEqual({ key: 'users.errors.profile_mismatch' })
  })

  it('carries the missing permissions and the unknown role keys as a parenthesised list', () => {
    expect(describeUsersFailure(apiError(403, { code: 'permission_denied', missing: ['users.create', 'users.roles.assign'] }))).toEqual({
      key: 'users.errors.permission_denied',
      params: { list: '(users.create, users.roles.assign)' },
    })
    expect(describeUsersFailure(apiError(400, { code: 'role_unknown', roleKeys: ['exam_boss'] }))).toEqual({
      key: 'users.errors.role_unknown',
      field: ['roleKeys'],
      params: { list: '(exam_boss)' },
    })
  })

  it('maps the T14 codes, telling the two meanings of self_forbidden and user_not_found apart by their details', () => {
    expect(describeUsersFailure(apiError(409, { code: 'last_admin' }))).toEqual({ key: 'users.errors.last_admin' })
    expect(describeUsersFailure(apiError(409, { code: 'invalid_transition', from: 'deleted', action: 'restore', allowed: [] }))).toEqual({
      key: 'users.errors.invalid_transition',
    })
    expect(describeUsersFailure(apiError(403, { code: 'self_forbidden', action: 'suspend' }))).toEqual({ key: 'users.errors.self_forbidden' })
    expect(describeUsersFailure(apiError(403, { code: 'self_forbidden', action: 'remove_academy_admin' }))).toEqual({ key: 'users.errors.self_forbidden_roles' })
    expect(describeUsersFailure(apiError(422, { code: 'not_a_guardian', userId: 'g' }))).toEqual({ key: 'users.errors.not_a_guardian' })
    expect(describeUsersFailure(apiError(422, { code: 'not_a_student', userId: 's' }))).toEqual({ key: 'users.errors.not_a_student' })
    expect(describeUsersFailure(apiError(409, { code: 'already_linked', studentId: 's', guardianId: 'g' }))).toEqual({ key: 'users.errors.already_linked' })
    expect(describeUsersFailure(apiError(404, { code: 'user_not_found', studentId: 's', guardianId: 'g', reason: 'not_linked' }))).toEqual({ key: 'users.errors.not_linked' })
    expect(describeUsersFailure(apiError(404, { code: 'user_not_found', userId: 'g', party: 'guardian' }))).toEqual({ key: 'users.errors.guardian_not_found' })
    expect(describeUsersFailure(apiError(404, { code: 'user_not_found', userId: 's', party: 'student' }))).toEqual({ key: 'users.errors.student_not_found' })
    expect(describeUsersFailure(apiError(404, { code: 'user_not_found' }))).toEqual({ key: 'users.errors.user_not_found' })
    for (const key of ['last_admin', 'self_forbidden_roles', 'not_linked', 'guardian_not_found'] as const) {
      expect(failureMessage(t, { key: `users.errors.${key}` })).toBe(ar.users.errors[key])
    }
  })

  it('turns a validation 400 without a code into the server message, and classifies the rest', () => {
    expect(describeUsersFailure(apiError(400, { message: 'fullName must be longer than or equal to 2 characters' }))).toEqual({
      key: 'users.errors.validation',
      params: { message: 'fullName must be longer than or equal to 2 characters' },
    })
    expect(describeUsersFailure(apiError(503, { message: 'down' }))).toEqual({ key: 'login.errors.server' })
    expect(describeUsersFailure(apiError(404, { code: 'something_new' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeUsersFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})

describe('failureMessage', () => {
  it('renders the list when present and a clean sentence when it is absent', () => {
    expect(failureMessage(t, { key: 'users.errors.permission_denied', params: { list: '(users.create)' } })).toBe(
      'ليست لديك الصلاحية اللازمة لهذا الإجراء (users.create)',
    )
    expect(failureMessage(t, { key: 'users.errors.permission_denied' })).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء')
    expect(failureMessage(t, { key: 'users.errors.email_in_use', field: ['email'] })).toBe(ar.users.errors.email_in_use)
  })
})
