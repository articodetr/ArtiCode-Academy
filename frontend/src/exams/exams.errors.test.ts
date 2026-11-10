import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeExamsFailure, describeResultsFailure, failureMessage, isExamsFailure } from './exams.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'x'), body)

describe('describeExamsFailure (the exams part of grades.errors.ts)', () => {
  it('maps every code to its message and the field it points at', () => {
    expect(describeExamsFailure(apiError(409, { code: 'class_closed', classId: 'c', status: 'completed' }))).toEqual({ key: 'exams.errors.class_closed', field: ['classId'] })
    expect(describeExamsFailure(apiError(422, { code: 'lesson_mismatch' }))).toEqual({ key: 'exams.errors.lesson_mismatch', field: ['lessonId'] })
    expect(describeExamsFailure(apiError(400, { code: 'pass_score_invalid', passScore: 60, maxScore: 50 }))).toEqual({ key: 'exams.errors.pass_score_invalid', field: ['passScore'], params: { max: '50' } })
    expect(failureMessage(t, describeExamsFailure(apiError(400, { code: 'pass_score_invalid', passScore: 60, maxScore: 50 })))).toBe('درجة النجاح لا تتجاوز الدرجة القصوى (50).')
    for (const code of ['exam_not_found', 'exam_has_results', 'exam_not_deletable', 'invalid_transition', 'cursor_invalid', 'nothing_to_update']) {
      const failure = describeExamsFailure(apiError(409, { code }))
      expect(isExamsFailure(failure, code)).toBe(true)
      expect(failureMessage(t, failure)).toBe(ar.exams.errors[code as keyof typeof ar.exams.errors])
    }
  })

  it('names the refused fields of exam_locked by their labels and lists the missing permissions', () => {
    const locked = describeExamsFailure(apiError(409, { code: 'exam_locked', status: 'scheduled', fields: ['maxScore'], resultCount: 3 }))
    expect(locked).toMatchObject({ lockedFields: ['maxScore'], lockedStatus: 'scheduled' })
    expect(failureMessage(t, locked)).toBe('لم تعد هذه الحقول قابلة للتعديل لهذا الاختبار (الدرجة القصوى)')
    expect(failureMessage(t, describeExamsFailure(apiError(403, { code: 'permission_denied', missing: ['exams.manage'] })))).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (exams.manage)')
  })

  it('falls back to validation, server, generic and network messages', () => {
    expect(describeExamsFailure(apiError(400, { message: 'maxScore must not be greater than 9999.99' }))).toEqual({ key: 'exams.errors.validation', params: { message: 'maxScore must not be greater than 9999.99' } })
    expect(describeExamsFailure(apiError(500, { message: 'boom' }))).toEqual({ key: 'login.errors.server' })
    expect(describeExamsFailure(apiError(418, { message: 'teapot' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeExamsFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})

describe('describeResultsFailure (API-119/API-120)', () => {
  it('tells the sheet to re-read on a draft exam or a cancelled class, and that a vanished exam is gone', () => {
    expect(describeResultsFailure(apiError(409, { code: 'exam_not_recordable', reason: 'not_scheduled' }))).toEqual({ key: 'exams.results.errors.not_scheduled', next: 'stale' })
    expect(describeResultsFailure(apiError(409, { code: 'class_closed', classId: 'c', status: 'cancelled' }))).toEqual({ key: 'exams.results.errors.class_cancelled', next: 'stale' })
    expect(describeResultsFailure(apiError(404, { code: 'exam_not_found' }))).toEqual({ key: 'exams.errors.exam_not_found', next: 'gone' })
  })

  it('names the refused students: not_enrolled, the one of score_out_of_range with the server’s maximum, the repeated ones', () => {
    expect(describeResultsFailure(apiError(422, { code: 'not_enrolled', studentIds: ['s-1', 's-2'] }))).toEqual({ key: 'exams.results.errors.not_enrolled', next: 'refused', studentIds: ['s-1', 's-2'] })
    expect(describeResultsFailure(apiError(400, { code: 'score_out_of_range', score: 55, maxScore: 50, studentId: 's-3' }))).toEqual({
      key: 'exams.results.errors.score_out_of_range',
      next: 'refused',
      studentIds: ['s-3'],
      params: { max: '50' },
    })
    expect(describeResultsFailure(apiError(400, { code: 'results_invalid', duplicates: ['s-4'] }))).toEqual({ key: 'exams.results.errors.results_invalid', next: 'refused', studentIds: ['s-4'] })
  })

  it('says a body above 1 MB is too large and falls back to the exams mapper for the rest', () => {
    expect(describeResultsFailure(apiError(413, { message: 'request entity too large' }))).toEqual({ key: 'exams.results.errors.too_large' })
    expect(describeResultsFailure(apiError(403, { code: 'permission_denied', missing: ['exams.grade'] }))).toEqual({ key: 'exams.errors.permission_denied', params: { list: '(exams.grade)' } })
  })
})
