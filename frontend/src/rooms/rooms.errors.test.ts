import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { describeRoomsFailure, failureMessage } from './rooms.errors'

const t = (key: string, options?: Record<string, unknown>) => {
  const text = key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), ar)
  return typeof text === 'string' ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')) : key
}

describe('describeRoomsFailure (J-F06)', () => {
  it('maps the schedule codes of the rooms to their messages, fields and details', () => {
    const taken = describeRoomsFailure(new ApiError(409, 'taken', { statusCode: 409, code: 'room_code_taken', roomCode: 'LAB-1', branchId: null }))
    expect(taken).toEqual({ key: 'rooms.errors.room_code_taken', field: ['code'], params: { roomCode: 'LAB-1' } })
    expect(failureMessage(t, taken)).toBe('الرمز LAB-1 مستخدم لقاعة أخرى في الفرع نفسه.')

    const inUse = describeRoomsFailure(new ApiError(409, 'in use', { statusCode: 409, code: 'room_in_use', slotCount: 3 }))
    expect(inUse).toEqual({ key: 'rooms.errors.room_in_use', params: { slotCount: '3' } })
    expect(failureMessage(t, inUse)).toBe('لا تُحذف هذه القاعة: تستخدمها 3 حصة. أوقفها بدلاً من ذلك.')

    expect(describeRoomsFailure(new ApiError(422, 'inactive', { statusCode: 422, code: 'branch_inactive', branchId: 'b' }))).toEqual({ key: 'rooms.errors.branch_inactive', field: ['branchId'] })
    expect(describeRoomsFailure(new ApiError(404, 'no branch', { statusCode: 404, code: 'branch_not_found', branchId: 'b' }))).toEqual({ key: 'rooms.errors.branch_not_found', field: ['branchId'] })
    expect(describeRoomsFailure(new ApiError(404, 'no room', { statusCode: 404, code: 'room_not_found', roomId: 'r' }))).toEqual({ key: 'rooms.errors.room_not_found' })
    expect(describeRoomsFailure(new ApiError(400, 'empty', { statusCode: 400, code: 'nothing_to_update' }))).toEqual({ key: 'rooms.errors.nothing_to_update' })
  })

  it('lists the missing permission keys of a 403 and keeps the server message of a plain 400', () => {
    const denied = describeRoomsFailure(new ApiError(403, 'denied', { statusCode: 403, code: 'permission_denied', missing: ['schedule.manage'] }))
    expect(denied).toEqual({ key: 'rooms.errors.permission_denied', params: { list: '(schedule.manage)' } })
    expect(failureMessage(t, denied)).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (schedule.manage)')
    expect(describeRoomsFailure(new ApiError(400, 'capacity must be an integer', { statusCode: 400, message: 'capacity must be an integer' }))).toEqual({
      key: 'rooms.errors.validation',
      params: { message: 'capacity must be an integer' },
    })
  })

  it('tells a network failure, a server failure and an unknown refusal apart', () => {
    expect(describeRoomsFailure(new TypeError('fetch failed'))).toEqual({ key: 'login.errors.network' })
    expect(describeRoomsFailure(new ApiError(503, 'down'))).toEqual({ key: 'login.errors.server' })
    expect(describeRoomsFailure(new ApiError(418, 'teapot', { code: 'unknown_code' }))).toEqual({ key: 'login.errors.generic' })
  })
})
