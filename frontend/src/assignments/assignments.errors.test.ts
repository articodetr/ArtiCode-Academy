import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { describeAssignmentsFailure, failureMessage, isAssignmentsFailure } from './assignments.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'error'), { statusCode: status, ...body })

describe('describeAssignmentsFailure', () => {
  it('points the lesson and late-policy codes at their form fields, and the class codes at the class picker', () => {
    expect(describeAssignmentsFailure(apiError(422, { code: 'lesson_mismatch', lessonId: 'l-1', classId: 'c-1' }))).toEqual({ key: 'assignments.errors.lesson_mismatch', field: ['lessonId'] })
    expect(describeAssignmentsFailure(apiError(404, { code: 'lesson_not_found', lessonId: 'l-1' })).field).toEqual(['lessonId'])
    expect(describeAssignmentsFailure(apiError(400, { code: 'late_penalty_invalid', allowLate: false, latePenaltyPercent: 10 })).field).toEqual(['latePenaltyPercent'])
    expect(describeAssignmentsFailure(apiError(409, { code: 'class_closed', classId: 'c-1', status: 'completed' })).field).toEqual(['classId'])
    expect(describeAssignmentsFailure(apiError(404, { code: 'class_not_found', classId: 'c-1' })).field).toEqual(['classId'])
  })

  it('keeps the refused fields and the status of assignment_locked, and lists the fields by their Arabic labels', () => {
    const failure = describeAssignmentsFailure(apiError(409, { code: 'assignment_locked', status: 'open', fields: ['maxScore', 'maxAttempts'], submissionCount: 3 }))
    expect(failure).toEqual({ key: 'assignments.errors.assignment_locked', lockedFields: ['maxScore', 'maxAttempts'], lockedStatus: 'open' })
    expect(failureMessage(t, failure)).toBe('لم تعد هذه الحقول قابلة للتعديل لهذا الواجب (الدرجة القصوى، عدد المحاولات)')
    expect(isAssignmentsFailure(failure, 'assignment_locked')).toBe(true)
  })

  it('words the state codes and the permission guard', () => {
    expect(failureMessage(t, describeAssignmentsFailure(apiError(409, { code: 'assignment_not_deletable', status: 'open', submissionCount: 0 })))).toBe(
      'لا تُحذف إلا مسودة بلا تسليمات؛ أغلق الواجب بدلاً من ذلك.',
    )
    expect(failureMessage(t, describeAssignmentsFailure(apiError(409, { code: 'invalid_transition', from: 'open', action: 'publish', allowed: ['close'] })))).toBe(
      'تغيّرت حالة الواجب في مكان آخر؛ أُعيد تحميله.',
    )
    expect(failureMessage(t, describeAssignmentsFailure(apiError(403, { code: 'permission_denied', missing: ['assignments.manage'] })))).toBe(
      'ليست لديك الصلاحية اللازمة لهذا الإجراء (assignments.manage)',
    )
    expect(describeAssignmentsFailure(apiError(400, { code: 'cursor_invalid' })).key).toBe('assignments.errors.cursor_invalid')
  })

  it('falls back to the validation message on another 400, the server message on 5xx and the network message otherwise', () => {
    expect(describeAssignmentsFailure(apiError(400, { message: 'maxScore must not be greater than 9999.99' }))).toEqual({
      key: 'assignments.errors.validation',
      params: { message: 'maxScore must not be greater than 9999.99' },
    })
    expect(describeAssignmentsFailure(apiError(500, { message: 'boom' })).key).toBe('login.errors.server')
    expect(describeAssignmentsFailure(new TypeError('fetch failed')).key).toBe('login.errors.network')
  })
})

describe('describeAssignmentsFailure — the T03 codes (J-F41)', () => {
  it('points the review codes at the grading form fields, with the max score the server names', () => {
    const range = describeAssignmentsFailure(apiError(400, { code: 'score_out_of_range', score: 25, maxScore: 20 }))
    expect(range).toEqual({ key: 'assignments.errors.score_out_of_range', field: ['score'], params: { max: '20' } })
    expect(failureMessage(t, range)).toBe('الدرجة من 0 إلى 20.')
    const feedback = describeAssignmentsFailure(apiError(400, { code: 'feedback_required' }))
    expect(feedback).toEqual({ key: 'assignments.errors.feedback_required', field: ['feedback'] })
    expect(failureMessage(t, feedback)).toBe('الإعادة للتعديل تحتاج تغذية راجعة.')
  })

  it('words the read and submission codes, attempts_exhausted with the effective allowance', () => {
    const gone = describeAssignmentsFailure(apiError(404, { code: 'submission_not_found', submissionId: 's-1' }))
    expect(isAssignmentsFailure(gone, 'submission_not_found')).toBe(true)
    expect(failureMessage(t, gone)).toBe('التسليم غير موجود أو ليس في فصل مُسند إليك.')
    expect(failureMessage(t, describeAssignmentsFailure(apiError(409, { code: 'attempts_exhausted', maxAttempts: 3, attempts: 3 })))).toBe('لم تبقَ محاولات لهذا الواجب (3 من 3).')
    for (const code of ['assignment_closed', 'not_enrolled', 'submission_invalid']) {
      const failure = describeAssignmentsFailure(apiError(code === 'not_enrolled' ? 403 : code === 'assignment_closed' ? 409 : 400, { code, reason: 'past_due', dueAt: null, classId: 'c-1' }))
      expect(failure.key).toBe(`assignments.errors.${code}`)
      expect(failure.field).toBeUndefined()
    }
  })
})
