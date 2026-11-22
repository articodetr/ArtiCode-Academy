import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeExamsFailure, describeResultsFailure, failureMessage, isExamsFailure, lockedFieldMessageKey } from './exams.errors'

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

/** A translated text with its placeholders filled: the expectations read the texts from the dictionary instead of retyping them. */
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)

describe('describeExamsFailure — the refusals of an online exam (MOD-09 phase 2)', () => {
  const words = ar.examOnline.errors
  const problems = ar.examOnline.readiness.problems
  const notReady = (...list: string[]) => fill(words.exam_not_ready, { list: list.join(words.problemSeparator) })

  it('words exam_not_ready with its problems and the server’s numbers', () => {
    const failure = describeExamsFailure(apiError(409, { code: 'exam_not_ready', problems: ['no_questions', 'window_missing', 'duration_missing'], totalPoints: 0, maxScore: 10, questionIds: [] }))
    expect(failure).toEqual({ key: 'examOnline.errors.exam_not_ready', readiness: { problems: ['no_questions', 'window_missing', 'duration_missing'], totalPoints: 0, maxScore: 10, questionIds: [] } })
    expect(isExamsFailure(failure, 'exam_not_ready')).toBe(true)
    expect(failureMessage(t, failure)).toBe(notReady(problems.no_questions, problems.window_missing, problems.duration_missing))

    const mismatch = describeExamsFailure(apiError(409, { code: 'exam_not_ready', problems: ['questions_not_ready', 'points_mismatch', 'window_closed'], totalPoints: 8.5, maxScore: 10, questionIds: ['q-1'] }))
    expect(mismatch.readiness?.questionIds).toEqual(['q-1'])
    expect(failureMessage(t, mismatch)).toBe(notReady(problems.questions_not_ready, fill(problems.points_mismatch, { total: 8.5, max: 10 }), problems.window_closed))
    expect(failureMessage(t, mismatch)).toContain('(8.5)')
    // A problem of a newer server shows as it came; numbers the server did not send are not invented.
    expect(failureMessage(t, describeExamsFailure(apiError(409, { code: 'exam_not_ready', problems: ['points_mismatch', 'something_new'] })))).toBe(notReady(problems.points_mismatch_plain, 'something_new'))
  })

  it('says how many attempts keep an exam from going back to a draft, and that a started online exam is not deleted', () => {
    const attempts = describeExamsFailure(apiError(409, { code: 'exam_has_attempts', action: 'unschedule', attemptCount: 3 }))
    expect(attempts).toEqual({ key: 'examOnline.errors.exam_has_attempts', params: { attempts: '3' } })
    expect(failureMessage(t, attempts)).toBe(fill(words.exam_has_attempts, { attempts: 3 }))
    expect(failureMessage(t, attempts)).toContain('3')

    const started = describeExamsFailure(apiError(409, { code: 'exam_not_deletable', status: 'scheduled', resultCount: 0, attemptCount: 2 }))
    expect(started).toEqual({ key: 'examOnline.errors.exam_not_deletable', params: { attempts: '2' } })
    expect(isExamsFailure(started, 'exam_not_deletable')).toBe(true)
    expect(failureMessage(t, started)).toBe(fill(words.exam_not_deletable, { attempts: 2 }))
    // Without an attempt count it is the first phase's refusal, worded as before.
    expect(describeExamsFailure(apiError(409, { code: 'exam_not_deletable', status: 'published', resultCount: 4 }))).toEqual({ key: 'exams.errors.exam_not_deletable' })
    expect(describeExamsFailure(apiError(409, { code: 'exam_not_deletable', status: 'published', resultCount: 4, attemptCount: 0 }))).toEqual({ key: 'exams.errors.exam_not_deletable' })
  })

  it('says when the window closes for exam_window_open — formatted by the screen — or that it must close first', () => {
    const open = describeExamsFailure(apiError(409, { code: 'exam_window_open', closesAt: '2026-11-20T09:00:00.000Z' }))
    expect(open).toEqual({ key: 'examOnline.errors.exam_window_open', windowClosesAt: '2026-11-20T09:00:00.000Z' })
    expect(failureMessage(t, open, { instant: (iso) => `<${iso}>` })).toBe(fill(words.exam_window_open, { when: '<2026-11-20T09:00:00.000Z>' }))
    expect(failureMessage(t, open)).toBe(words.exam_window_open_undated)
    const undated = describeExamsFailure(apiError(409, { code: 'exam_window_open', closesAt: null }))
    expect(undated).toEqual({ key: 'examOnline.errors.exam_window_open', windowClosesAt: null })
    expect(failureMessage(t, undated, { instant: (iso) => iso })).toBe(words.exam_window_open_undated)
  })

  it('points window_invalid at the closing, lists the settings refused on a manual exam, and words exam_not_online', () => {
    expect(describeExamsFailure(apiError(400, { code: 'window_invalid', opensAt: 'a', closesAt: 'b' }))).toEqual({ key: 'examOnline.errors.window_invalid', field: ['closesDate'] })
    expect(failureMessage(t, describeExamsFailure(apiError(400, { code: 'window_invalid' })))).toBe(words.window_invalid)
    const refused = describeExamsFailure(apiError(400, { code: 'online_settings_not_allowed', fields: ['closesAt', 'attemptsAllowed'] }))
    expect(refused).toEqual({ key: 'examOnline.errors.online_settings_not_allowed', refusedSettings: ['closesAt', 'attemptsAllowed'] })
    const labels = ar.examOnline.patchFields
    expect(failureMessage(t, refused)).toBe(fill(words.online_settings_not_allowed, { list: `(${[labels.closesAt, labels.attemptsAllowed].join(ar.exams.errors.listSeparator)})` }))
    expect(failureMessage(t, describeExamsFailure(apiError(409, { code: 'exam_not_online', examId: 'e' })))).toBe(words.exam_not_online)
  })

  it('names the online fields of exam_locked by their labels and keeps the counts that tell why', () => {
    const locked = describeExamsFailure(apiError(409, { code: 'exam_locked', status: 'scheduled', fields: ['scheduledAt', 'closesAt', 'durationMinutes', 'maxScore', 'attemptsAllowed'], resultCount: 0, attemptCount: 2 }))
    expect(locked).toEqual({
      key: 'exams.errors.exam_locked',
      lockedFields: ['scheduledAt', 'closesAt', 'durationMinutes', 'maxScore', 'attemptsAllowed'],
      lockedStatus: 'scheduled',
      lockedResultCount: 0,
      lockedAttemptCount: 2,
    })
    const first = ar.exams.patchFields
    const online = ar.examOnline.patchFields
    const lockedList = (...names: string[]) => fill(ar.exams.errors.exam_locked, { list: `(${names.join(ar.exams.errors.listSeparator)})` })
    expect(failureMessage(t, locked)).toBe(lockedList(first.scheduledAt, online.closesAt, first.durationMinutes, first.maxScore, online.attemptsAllowed))
    expect(failureMessage(t, describeExamsFailure(apiError(409, { code: 'exam_locked', status: 'scheduled', fields: ['delivery'], resultCount: 0 })))).toBe(lockedList(online.delivery))
  })
})

describe('lockedFieldMessageKey (why exam_locked refused each field)', () => {
  it('keeps the first phase’s reason for a manual exam: the maximum score after a first result', () => {
    expect(lockedFieldMessageKey('maxScore', { lockedResultCount: 1 })).toBe('exams.validation.lockedAfterResult')
    expect(lockedFieldMessageKey('maxScore', {})).toBe('exams.validation.lockedAfterResult')
    expect(lockedFieldMessageKey('title', {})).toBe('exams.validation.lockedAfterResult')
  })

  it('tells an online exam’s cases apart by the counts of the refusal', () => {
    const visible = { lockedResultCount: 0, lockedAttemptCount: 0 }
    const started = { lockedResultCount: 0, lockedAttemptCount: 3 }
    expect(lockedFieldMessageKey('delivery', visible)).toBe('examOnline.locked.delivery')
    expect(lockedFieldMessageKey('maxScore', visible)).toBe('examOnline.locked.maxScore')
    expect(['scheduledAt', 'closesAt', 'durationMinutes'].map((field) => lockedFieldMessageKey(field, visible))).toEqual(Array(3).fill('examOnline.locked.clearedOnceVisible'))
    expect(lockedFieldMessageKey('scheduledAt', started)).toBe('examOnline.locked.fixedOnceStarted')
    expect(lockedFieldMessageKey('durationMinutes', started)).toBe('examOnline.locked.fixedOnceStarted')
    expect(lockedFieldMessageKey('closesAt', started)).toBe('examOnline.locked.closesOnlyLater')
    expect(lockedFieldMessageKey('attemptsAllowed', started)).toBe('examOnline.locked.attemptsOnlyRise')
    // Every key is a real text.
    for (const key of Object.keys(ar.examOnline.locked)) expect(t(`examOnline.locked.${key}`)).toBe(ar.examOnline.locked[key as keyof typeof ar.examOnline.locked])
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
