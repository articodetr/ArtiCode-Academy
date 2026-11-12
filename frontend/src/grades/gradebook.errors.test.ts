import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeGradebookFailure, gradebookFailureMessage, isGradebookFailure } from './gradebook.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'x'), body)
const messageOf = (status: number, body: Record<string, unknown>) => gradebookFailureMessage(t, describeGradebookFailure(apiError(status, body)))

describe('describeGradebookFailure (the gradebook part of grades.errors.ts, API-126..API-128)', () => {
  it('re-reads the gradebook on the refusals that mean it changed, and marks a vanished class gone and a vanished scheme', () => {
    expect(describeGradebookFailure(apiError(409, { code: 'class_not_gradable', classId: 'c', status: 'open' }))).toEqual({ key: 'gradebook.errors.class_not_gradable', next: 'stale', classStatus: 'open' })
    expect(describeGradebookFailure(apiError(409, { code: 'grade_scheme_missing' }))).toEqual({ key: 'gradebook.errors.grade_scheme_missing', next: 'stale' })
    expect(describeGradebookFailure(apiError(409, { code: 'grades_certified', classId: 'c', certificateCount: 2 }))).toEqual({
      key: 'gradebook.errors.grades_certified',
      next: 'stale',
      params: { certificateCount: '2' },
    })
    expect(describeGradebookFailure(apiError(404, { code: 'class_not_found', classId: 'c' }))).toEqual({ key: 'gradebook.errors.class_not_found', next: 'gone' })
    expect(describeGradebookFailure(apiError(404, { code: 'grade_scheme_not_found', schemeId: 's' }))).toEqual({ key: 'gradebook.errors.grade_scheme_not_found', next: 'scheme' })
  })

  it('keeps the server’s counts of grades_not_ready, or its reason no_weighted_components', () => {
    const notReady = describeGradebookFailure(apiError(409, { code: 'grades_not_ready', openAssignments: 1, awaitingReview: 2, unpublishedExams: 0, weightedComponents: 3 }))
    expect(notReady).toEqual({ key: 'gradebook.errors.grades_not_ready', next: 'stale', blockers: { openAssignments: 1, awaitingReview: 2, unpublishedExams: 0 } })
    expect(describeGradebookFailure(apiError(409, { code: 'grades_not_ready', openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 0, reason: 'no_weighted_components' }))).toEqual({
      key: 'gradebook.errors.grades_not_ready_no_weighted_components',
      next: 'stale',
    })
  })

  it('words each refusal: the counts above 0 of grades_not_ready, the class status by its label, the certificate count', () => {
    expect(messageOf(409, { code: 'grades_not_ready', openAssignments: 1, awaitingReview: 2, unpublishedExams: 0, weightedComponents: 3 })).toBe(
      'لا يُقبل التثبيت بعد: 1 واجب موزون مفتوح، 2 محاولة بانتظار المراجعة.',
    )
    expect(messageOf(409, { code: 'grades_not_ready', openAssignments: 0, awaitingReview: 0, unpublishedExams: 4, weightedComponents: 4 })).toBe('لا يُقبل التثبيت بعد: 4 اختبار موزون غير منشور.')
    expect(messageOf(409, { code: 'grades_not_ready', reason: 'no_weighted_components', openAssignments: 0, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 0 })).toBe(
      ar.gradebook.errors.grades_not_ready_no_weighted_components,
    )
    // A refusal without a positive count (the server never sends one) still reads as a sentence.
    expect(messageOf(409, { code: 'grades_not_ready', openAssignments: 0, awaitingReview: 0, unpublishedExams: 0 })).toBe(ar.gradebook.errors.grades_not_ready_generic)
    expect(messageOf(409, { code: 'class_not_gradable', status: 'planned' })).toBe('لا تُثبَّت الدرجات النهائية إلا لفصل جارٍ أو مكتمل، والفصل الآن «مخطَّط».')
    expect(messageOf(409, { code: 'grades_certified', certificateCount: 3 })).toBe('للفصل 3 شهادة سارية: لا تُثبَّت درجاته النهائية ولا تُسحب حتى تُبطَل شهاداته.')
    expect(messageOf(409, { code: 'grade_scheme_missing' })).toBe(ar.gradebook.errors.grade_scheme_missing)
    expect(messageOf(404, { code: 'grade_scheme_not_found' })).toBe(ar.gradebook.errors.grade_scheme_not_found)
    expect(messageOf(404, { code: 'class_not_found' })).toBe(ar.gradebook.errors.class_not_found)
  })

  it('lists the missing permission and maps the guards; nothing else retries differently', () => {
    const denied = describeGradebookFailure(apiError(403, { code: 'permission_denied', missing: ['grades.manage'] }))
    expect(denied).toEqual({ key: 'gradebook.errors.permission_denied', params: { list: '(grades.manage)' } })
    expect(gradebookFailureMessage(t, denied)).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (grades.manage)')
    for (const code of ['origin_forbidden', 'rate_limited']) {
      const failure = describeGradebookFailure(apiError(code === 'rate_limited' ? 429 : 403, { code }))
      expect(isGradebookFailure(failure, code)).toBe(true)
      expect(failure.next).toBeUndefined()
      expect(gradebookFailureMessage(t, failure)).toBe(ar.gradebook.errors[code as 'origin_forbidden' | 'rate_limited'])
    }
  })

  it('falls back to validation, server, generic and network messages', () => {
    expect(describeGradebookFailure(apiError(400, { message: 'schemeId must be a UUID' }))).toEqual({ key: 'gradebook.errors.validation', params: { message: 'schemeId must be a UUID' } })
    expect(messageOf(400, { message: 'schemeId must be a UUID' })).toBe('رفض الخادم الطلب: schemeId must be a UUID')
    expect(describeGradebookFailure(apiError(500, { message: 'boom' }))).toEqual({ key: 'login.errors.server' })
    expect(describeGradebookFailure(apiError(418, { message: 'teapot' }))).toEqual({ key: 'login.errors.generic' })
    expect(describeGradebookFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
