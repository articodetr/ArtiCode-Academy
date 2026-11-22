import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeAttemptsFailure, describeSheetFailure, failureMessage, isAttemptsFailure, isStaleExamFailure } from './examAttempts.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const english = i18n.getFixedT('en')
const tEn = (key: string, options?: Record<string, unknown>) => english(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'x'), body)

describe('describeAttemptsFailure (API-273 regrade, API-274, API-275)', () => {
  it('words grades_certified by the number of issued certificates the server names', () => {
    const one = describeAttemptsFailure(apiError(409, { code: 'grades_certified', classId: 'c', certificateCount: 1 }))
    expect(one).toEqual({ key: 'examAttempts.errors.grades_certified', count: 1 })
    expect(failureMessage(t, one)).toBe(ar.examAttempts.errors.grades_certified_one)
    expect(failureMessage(t, describeAttemptsFailure(apiError(409, { code: 'grades_certified', certificateCount: 2 })))).toBe(ar.examAttempts.errors.grades_certified_two)
    expect(failureMessage(t, describeAttemptsFailure(apiError(409, { code: 'grades_certified', certificateCount: 4 })))).toBe(ar.examAttempts.errors.grades_certified_few.replace('{{count}}', '4'))
    expect(failureMessage(t, describeAttemptsFailure(apiError(409, { code: 'grades_certified', certificateCount: 23 })))).toBe(ar.examAttempts.errors.grades_certified_many.replace('{{count}}', '23'))
    expect(failureMessage(tEn, one)).toContain('This class has 1 issued certificate,')
    expect(failureMessage(tEn, describeAttemptsFailure(apiError(409, { code: 'grades_certified', certificateCount: 4 })))).toContain('This class has 4 issued certificates,')
  })

  it('still says why when the server names no usable count', () => {
    for (const certificateCount of [undefined, '3', 0, 2.5]) {
      const failure = describeAttemptsFailure(apiError(409, { code: 'grades_certified', certificateCount }))
      expect(failure).toEqual({ key: 'examAttempts.errors.grades_certified' })
      expect(failureMessage(t, failure)).toBe(ar.examAttempts.errors.grades_certified)
    }
  })

  it('words what a draft, a manual exam and a cancelled class mean for a regrade, and an attempt that is gone', () => {
    const cases: [number, string, keyof typeof ar.examAttempts.errors][] = [
      [409, 'exam_not_frozen', 'exam_not_frozen'],
      [409, 'exam_not_online', 'exam_not_online'],
      [409, 'class_closed', 'class_closed'],
      [404, 'attempt_not_found', 'attempt_not_found'],
    ]
    for (const [status, code, key] of cases) {
      const failure = describeAttemptsFailure(apiError(status, { code, status: 'draft' }))
      expect(failure).toEqual({ key: `examAttempts.errors.${key}` })
      expect(isAttemptsFailure(failure, code)).toBe(true)
      expect(failureMessage(t, failure)).toBe(ar.examAttempts.errors[key])
    }
  })

  it('leaves the codes the exams screens already word to their mapper: the exam gone, the missing permission, a validation, the rest', () => {
    const gone = describeAttemptsFailure(apiError(404, { code: 'exam_not_found', examId: 'e' }))
    expect(gone).toEqual({ key: 'exams.errors.exam_not_found' })
    expect(isAttemptsFailure(gone, 'exam_not_found')).toBe(true)
    expect(failureMessage(t, gone)).toBe(ar.exams.errors.exam_not_found)
    expect(failureMessage(t, describeAttemptsFailure(apiError(403, { code: 'permission_denied', missing: ['exams.grade'] })))).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (exams.grade)')
    expect(failureMessage(t, describeAttemptsFailure(apiError(400, { message: 'reason must be longer than or equal to 1 characters' })))).toBe(
      'رفض الخادم البيانات: reason must be longer than or equal to 1 characters',
    )
    expect(failureMessage(t, describeAttemptsFailure(apiError(429, { code: 'rate_limited' })))).toBe(ar.exams.errors.rate_limited)
    expect(describeAttemptsFailure(apiError(500, { message: 'boom' }))).toEqual({ key: 'login.errors.server' })
    expect(describeAttemptsFailure(apiError(409, { code: 'something_new' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeAttemptsFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })

  it('knows which refusals mean the exam on screen is stale, so the drawer reads it again', () => {
    const stale = (status: number, code: string) => isStaleExamFailure(describeAttemptsFailure(apiError(status, { code })))
    expect(stale(409, 'exam_not_frozen')).toBe(true)
    expect(stale(409, 'exam_not_online')).toBe(true)
    expect(stale(409, 'class_closed')).toBe(true)
    expect(stale(404, 'exam_not_found')).toBe(true)
    // The exam is what it was: certificates, the permission, a lost attempt, a server failure.
    expect(stale(409, 'grades_certified')).toBe(false)
    expect(stale(403, 'permission_denied')).toBe(false)
    expect(stale(404, 'attempt_not_found')).toBe(false)
    expect(stale(500, 'x')).toBe(false)
  })
})

describe('describeSheetFailure (API-120 for an online exam)', () => {
  it('names the students who started an attempt after the sheet was read, as a refused batch to re-read', () => {
    const failure = describeSheetFailure(apiError(409, { code: 'result_from_attempt', studentIds: ['s-1', 's-2'], message: 'attempts' }))
    expect(failure).toEqual({ key: 'examAttempts.sheet.errors.result_from_attempt', next: 'refused', studentIds: ['s-1', 's-2'], fromAttempt: true })
    expect(failureMessage(t, { ...failure, params: { names: 'سارة الطالبة، يوسف الطالب' } })).toBe(
      ar.examAttempts.sheet.errors.result_from_attempt.replace('{{names}}', 'سارة الطالبة، يوسف الطالب'),
    )
  })

  it('still asks for a re-read when the server names nobody, without an empty list of names', () => {
    for (const studentIds of [undefined, [], 'x', [1, 2]]) {
      const failure = describeSheetFailure(apiError(409, { code: 'result_from_attempt', studentIds }))
      expect(failure).toEqual({ key: 'examAttempts.sheet.errors.result_from_attempt_unnamed', next: 'refused', studentIds: [], fromAttempt: true })
      expect(failureMessage(t, failure)).toBe(ar.examAttempts.sheet.errors.result_from_attempt_unnamed)
    }
  })

  it('leaves every other refusal of the sheet as it was', () => {
    expect(describeSheetFailure(apiError(422, { code: 'not_enrolled', studentIds: ['s-1'] }))).toEqual({ key: 'exams.results.errors.not_enrolled', next: 'refused', studentIds: ['s-1'] })
    expect(describeSheetFailure(apiError(409, { code: 'exam_not_recordable', reason: 'not_scheduled' }))).toEqual({ key: 'exams.results.errors.not_scheduled', next: 'stale' })
    expect(describeSheetFailure(apiError(409, { code: 'class_closed', classId: 'c', status: 'cancelled' }))).toEqual({ key: 'exams.results.errors.class_cancelled', next: 'stale' })
    expect(describeSheetFailure(apiError(404, { code: 'exam_not_found' }))).toEqual({ key: 'exams.errors.exam_not_found', next: 'gone' })
    expect(describeSheetFailure(apiError(413, { message: 'request entity too large' }))).toEqual({ key: 'exams.results.errors.too_large' })
    expect(describeSheetFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
