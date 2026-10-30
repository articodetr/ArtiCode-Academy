import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { describeRolesFailure, failureMessage } from './roles.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

describe('describeRolesFailure', () => {
  it('tells the two meanings of role_in_use apart by the userCount detail', () => {
    expect(describeRolesFailure(apiError(409, { code: 'role_in_use', key: 'teacher' }))).toEqual({
      key: 'rolesAdmin.errors.role_in_use_key',
      field: ['key'],
    })
    expect(describeRolesFailure(apiError(409, { code: 'role_in_use', key: 'registrar', userCount: 2 }))).toEqual({
      key: 'rolesAdmin.errors.role_in_use_users',
      params: { count: '2' },
    })
  })

  it('carries the detail lists of permission_unknown (on the permissions field), permission_denied and role_immutable', () => {
    expect(describeRolesFailure(apiError(400, { code: 'permission_unknown', permissions: ['exams.fly'] }))).toEqual({
      key: 'rolesAdmin.errors.permission_unknown',
      field: ['permissions'],
      params: { list: '(exams.fly)' },
    })
    expect(describeRolesFailure(apiError(403, { code: 'permission_denied', missing: ['courses.manage', 'users.read_contact'] }))).toEqual({
      key: 'rolesAdmin.errors.permission_denied',
      params: { list: '(courses.manage, users.read_contact)' },
    })
    expect(describeRolesFailure(apiError(403, { code: 'role_immutable', key: 'teacher', fields: ['label'] }))).toEqual({
      key: 'rolesAdmin.errors.role_immutable',
      params: { list: '(label)' },
    })
    expect(describeRolesFailure(apiError(403, { code: 'role_immutable', key: 'academy_admin' }))).toEqual({ key: 'rolesAdmin.errors.role_immutable' })
  })

  it('turns a validation 400 into the server message and classifies the rest', () => {
    expect(describeRolesFailure(apiError(400, { message: 'key must be 3–64 lower-case letters' }))).toEqual({
      key: 'rolesAdmin.errors.validation',
      params: { message: 'key must be 3–64 lower-case letters' },
    })
    expect(describeRolesFailure(apiError(404, { code: 'role_unknown', id: 'x' }))).toEqual({ key: 'rolesAdmin.errors.role_unknown' })
    expect(describeRolesFailure(apiError(503, { message: 'down' }))).toEqual({ key: 'login.errors.server' })
    expect(describeRolesFailure(apiError(418, { code: 'teapot' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeRolesFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })

  it('renders the messages with and without their lists', () => {
    expect(failureMessage(t, { key: 'rolesAdmin.errors.role_in_use_users', params: { count: '2' } })).toBe('لا يمكن حذف الدور لأنه ممنوح لمستخدمين (2).')
    expect(failureMessage(t, { key: 'rolesAdmin.errors.role_immutable' })).toBe('هذا الدور النظامي لا يقبل هذا التعديل')
  })
})
