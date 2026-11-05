import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import i18n from '../i18n'
import { describeClassesFailure, failureMessage } from './classes.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'x'), body)

describe('describeClassesFailure', () => {
  it('maps a code to its message and, where it names an input, to that field', () => {
    expect(describeClassesFailure(apiError(409, { code: 'class_code_taken', classCode: 'PY-A' }))).toEqual({ key: 'classes.errors.class_code_taken', field: ['code'] })
    expect(describeClassesFailure(apiError(422, { code: 'course_not_published', courseId: 'c', status: 'draft' }))).toMatchObject({ field: ['courseId'] })
    expect(describeClassesFailure(apiError(400, { code: 'date_range_invalid' }))).toMatchObject({ field: ['endsOn'] })
  })

  it('carries the counts of capacity_below_enrolled and class_not_deletable into the message', () => {
    const capacity = describeClassesFailure(apiError(409, { code: 'capacity_below_enrolled', capacity: 5, enrolledCount: 7 }))
    expect(capacity).toMatchObject({ field: ['capacity'] })
    expect(failureMessage(t, capacity)).toBe('السعة أقل من عدد المسجّلين حالياً (7).')
    expect(failureMessage(t, describeClassesFailure(apiError(409, { code: 'class_not_deletable', status: 'planned', enrollmentCount: 3 })))).toContain('(3 تسجيل)')
  })

  it('names the teacher of a teacher error through the given lookup, else by id', () => {
    const error = apiError(422, { code: 'not_a_teacher', userId: 'u-1' })
    expect(failureMessage(t, describeClassesFailure(error, (id) => (id === 'u-1' ? 'خالد' : undefined)))).toBe('«خالد» لا يحمل دور معلم.')
    expect(failureMessage(t, describeClassesFailure(error))).toBe('«u-1» لا يحمل دور معلم.')
  })

  it('maps the enrollment codes of T04 (J-F04): the seat numbers, the student name and the translated status of the existing enrollment', () => {
    expect(failureMessage(t, describeClassesFailure(apiError(409, { code: 'class_full', capacity: 20, enrolledCount: 20 })))).toBe('الفصل ممتلئ (20 / 20)؛ لا مقعد متاحاً.')
    expect(failureMessage(t, describeClassesFailure(apiError(409, { code: 'class_not_enrollable', status: 'planned' })))).toBe(ar.classes.errors.class_not_enrollable)
    expect(failureMessage(t, describeClassesFailure(apiError(422, { code: 'not_a_student', userId: 's-1' }), (id) => (id === 's-1' ? 'ليلى' : undefined)))).toBe('«ليلى» لا يحمل دور طالب.')
    expect(failureMessage(t, describeClassesFailure(apiError(409, { code: 'already_enrolled', enrollmentId: 'e-1', status: 'cancelled' })))).toBe(
      'للطالب تسجيل سابق في هذا الفصل (ملغى)؛ أعد تفعيله من القائمة بدلاً من تسجيله مجدداً.',
    )
    expect(describeClassesFailure(apiError(404, { code: 'enrollment_not_found', enrollmentId: 'e-1' }))).toEqual({ key: 'classes.errors.enrollment_not_found' })
  })

  it('falls back to validation, server, network and generic messages', () => {
    expect(describeClassesFailure(apiError(400, { message: 'capacity must be an integer' }))).toEqual({ key: 'classes.errors.validation', params: { message: 'capacity must be an integer' } })
    expect(describeClassesFailure(apiError(503, {}))).toEqual({ key: 'login.errors.server' })
    expect(describeClassesFailure(new TypeError('fetch failed'))).toEqual({ key: 'login.errors.network' })
    expect(describeClassesFailure(apiError(418, {}))).toEqual({ key: 'login.errors.generic' })
    expect(ar.classes.errors.permission_denied).toContain('{{list}}')
  })
})
