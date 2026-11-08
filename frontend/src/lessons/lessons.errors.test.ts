import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeLessonsFailure, failureMessage } from './lessons.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, 'failed', { statusCode: status, message: 'failed', ...body })

describe('describeLessonsFailure', () => {
  it('maps the lesson codes to their messages and, where one input is to blame, to its form field', () => {
    expect(describeLessonsFailure(apiError(404, { code: 'lesson_not_found', lessonId: 'l-1' }))).toEqual({ key: 'lessons.errors.lesson_not_found' })
    expect(describeLessonsFailure(apiError(409, { code: 'class_closed', classId: 'c-1', status: 'completed' }))).toEqual({ key: 'lessons.errors.class_closed', field: ['classId'] })
    expect(describeLessonsFailure(apiError(422, { code: 'teacher_not_assigned', userId: 'u-1' }))).toEqual({ key: 'lessons.errors.teacher_not_assigned', field: ['teacherUserId'] })
    expect(describeLessonsFailure(apiError(422, { code: 'syllabus_item_mismatch', syllabusItemId: 's-1', courseId: 'c-1' }))).toEqual({ key: 'lessons.errors.syllabus_item_mismatch', field: ['syllabusItemId'] })
    expect(describeLessonsFailure(apiError(422, { code: 'room_inactive', roomId: 'r-1' }))).toEqual({ key: 'lessons.errors.room_inactive', field: ['roomId'] })
    expect(describeLessonsFailure(apiError(400, { code: 'time_range_invalid', startsAt: 'a', endsAt: 'b', maxHours: 12 }))).toEqual({
      key: 'lessons.errors.time_range_invalid',
      field: ['endTime'],
      params: { maxHours: '12' },
    })
    expect(describeLessonsFailure(apiError(409, { code: 'lesson_not_deletable', status: 'scheduled', attendanceCount: 3 }))).toEqual({ key: 'lessons.errors.lesson_not_deletable', params: { attendanceCount: '3' } })
    expect(describeLessonsFailure(apiError(409, { code: 'lesson_locked', status: 'completed', fields: ['startsAt', 'roomId'] }))).toEqual({ key: 'lessons.errors.lesson_locked', lockedFields: ['startsAt', 'roomId'] })
    expect(describeLessonsFailure(apiError(403, { code: 'permission_denied', missing: ['lessons.manage'] }))).toEqual({ key: 'lessons.errors.permission_denied', params: { list: '(lessons.manage)' } })
  })

  it('names the fields of lesson_locked by their labels, keeping an unknown name as the server sent it', () => {
    const sep = ar.lessons.errors.listSeparator
    const locked = (fields: string[]) => failureMessage(t, describeLessonsFailure(apiError(409, { code: 'lesson_locked', status: 'completed', fields })))
    expect(locked(['startsAt', 'roomId'])).toBe(ar.lessons.errors.lesson_locked.replace('{{list}}', `(${ar.lessons.patchFields.startsAt}${sep}${ar.lessons.patchFields.roomId})`))
    expect(locked(['teacherUserId', 'futureField'])).toBe(ar.lessons.errors.lesson_locked.replace('{{list}}', `(${ar.lessons.patchFields.teacherUserId}${sep}futureField)`))
    expect(locked([])).toBe(ar.lessons.errors.lesson_locked.replace('{{list}}', '').trim())
  })

  it('splits lesson_conflict by the booked resource and points at its field', () => {
    expect(describeLessonsFailure(apiError(409, { code: 'lesson_conflict', resource: 'room', conflictingLessonId: 'l-2', conflictingClassId: 'c-2' }))).toEqual({ key: 'lessons.errors.lesson_conflict_room', field: ['roomId'] })
    expect(describeLessonsFailure(apiError(409, { code: 'lesson_conflict', resource: 'teacher', conflictingLessonId: null, conflictingClassId: null }))).toEqual({ key: 'lessons.errors.lesson_conflict_teacher', field: ['teacherUserId'] })
  })

  it('falls back to validation, server and network messages, and renders the texts of ar.ts', () => {
    const validation = describeLessonsFailure(new ApiError(400, 'startsAt must be an ISO 8601 instant', { statusCode: 400, message: 'startsAt must be an ISO 8601 instant' }))
    expect(validation).toEqual({ key: 'lessons.errors.validation', params: { message: 'startsAt must be an ISO 8601 instant' } })
    expect(failureMessage(t, validation)).toBe('رفض الخادم البيانات: startsAt must be an ISO 8601 instant')
    expect(describeLessonsFailure(new ApiError(500, 'boom'))).toEqual({ key: 'login.errors.server' })
    expect(describeLessonsFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
    expect(failureMessage(t, describeLessonsFailure(apiError(409, { code: 'lesson_not_deletable', status: 'scheduled', attendanceCount: 3 })))).toBe(ar.lessons.errors.lesson_not_deletable.replace('{{attendanceCount}}', '3'))
    expect(failureMessage(t, describeLessonsFailure(apiError(409, { code: 'lesson_not_started', startsAt: 'x' })))).toBe(ar.lessons.errors.lesson_not_started)
  })
})
