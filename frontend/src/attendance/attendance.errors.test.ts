import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeAttendanceFailure, failureMessage } from './attendance.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, 'failed', { statusCode: status, message: 'failed', ...body })

describe('describeAttendanceFailure', () => {
  it('maps the attendance codes to their messages and to what the sheet does next', () => {
    expect(describeAttendanceFailure(apiError(409, { code: 'attendance_closed', reason: 'not_started', startsAt: 'x' }))).toEqual({ key: 'attendance.errors.not_started', next: 'stale' })
    expect(describeAttendanceFailure(apiError(409, { code: 'attendance_closed', reason: 'cancelled', startsAt: 'x' }))).toEqual({ key: 'attendance.errors.lesson_cancelled', next: 'stale' })
    expect(describeAttendanceFailure(apiError(409, { code: 'class_closed', classId: 'c-1', status: 'cancelled' }))).toEqual({ key: 'attendance.errors.class_cancelled', next: 'stale' })
    expect(describeAttendanceFailure(apiError(422, { code: 'not_enrolled', studentIds: ['s-1', 's-2'] }))).toEqual({ key: 'attendance.errors.not_enrolled', next: 'refused', studentIds: ['s-1', 's-2'] })
    expect(describeAttendanceFailure(apiError(404, { code: 'lesson_not_found', lessonId: 'l-1' }))).toEqual({ key: 'lessons.errors.lesson_not_found', next: 'gone' })
    expect(describeAttendanceFailure(new ApiError(413, 'request entity too large', { statusCode: 413, message: 'request entity too large' }))).toEqual({ key: 'attendance.errors.too_large' })
  })

  it('falls back to the lessons mapper (validation, permission, server, network) and renders the texts of ar.ts', () => {
    const validation = describeAttendanceFailure(new ApiError(400, 'records must not repeat a studentId', { statusCode: 400, message: 'records must not repeat a studentId' }))
    expect(failureMessage(t, validation)).toBe('رفض الخادم البيانات: records must not repeat a studentId')
    expect(describeAttendanceFailure(apiError(403, { code: 'permission_denied', missing: ['attendance.record'] }))).toEqual({ key: 'lessons.errors.permission_denied', params: { list: '(attendance.record)' } })
    expect(describeAttendanceFailure(new ApiError(500, 'boom'))).toEqual({ key: 'login.errors.server' })
    expect(describeAttendanceFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
    expect(failureMessage(t, { key: 'attendance.errors.not_enrolled', params: { names: 'ليلى' } })).toBe(ar.attendance.errors.not_enrolled.replace('{{names}}', 'ليلى'))
  })
})
