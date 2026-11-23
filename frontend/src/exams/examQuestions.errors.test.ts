import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { KEY_PROBLEMS } from '../api/examQuestions'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeKeyCorrectionFailure, describeQuestionSetFailure } from './examQuestions.errors'
import { failureMessage } from './exams.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? 'x'), body)
const setWords = ar.examOnline.editor.errors
const keyWords = ar.examOnline.key.errors

describe('describeQuestionSetFailure (API-270 / API-271)', () => {
  it('marks the rows the server named and says nothing was written: gone, not ready, repeated', () => {
    const gone = describeQuestionSetFailure(apiError(404, { code: 'question_not_found', questionIds: ['q-1', 'q-2'] }))
    expect(gone).toEqual({ key: 'examOnline.editor.errors.question_not_found', next: 'refused', questionIds: ['q-1', 'q-2'], rowReason: 'not_found', params: { value: '2' } })
    expect(failureMessage(t, gone)).toBe(setWords.question_not_found.replace('{{value}}', '2'))

    const notReady = describeQuestionSetFailure(apiError(422, { code: 'question_not_ready', questionIds: ['q-3'] }))
    expect(notReady).toEqual({ key: 'examOnline.editor.errors.question_not_ready', next: 'refused', questionIds: ['q-3'], rowReason: 'not_ready', params: { value: '1' } })
    expect(failureMessage(t, notReady)).toBe(setWords.question_not_ready.replace('{{value}}', '1'))

    const repeated = describeQuestionSetFailure(apiError(400, { code: 'exam_questions_invalid', duplicates: ['q-4'] }))
    expect(repeated).toEqual({ key: 'examOnline.editor.errors.exam_questions_invalid', next: 'refused', questionIds: ['q-4'], rowReason: 'duplicate', params: { value: '1' } })
    expect(failureMessage(t, repeated)).toBe(setWords.exam_questions_invalid.replace('{{value}}', '1'))
  })

  it('tells the tab to re-read when the exam changed elsewhere: no longer a draft, its class cancelled, no longer online', () => {
    expect(describeQuestionSetFailure(apiError(409, { code: 'exam_questions_locked', status: 'scheduled' }))).toEqual({ key: 'examOnline.editor.errors.exam_questions_locked', next: 'stale' })
    expect(describeQuestionSetFailure(apiError(409, { code: 'class_closed', classId: 'c', status: 'cancelled' }))).toEqual({ key: 'examOnline.editor.errors.class_closed', next: 'stale' })
    expect(describeQuestionSetFailure(apiError(409, { code: 'exam_not_online', examId: 'e' }))).toEqual({ key: 'examOnline.editor.errors.exam_not_online', next: 'stale' })
    for (const code of ['exam_questions_locked', 'class_closed', 'exam_not_online'] as const) {
      expect(failureMessage(t, describeQuestionSetFailure(apiError(409, { code })))).toBe(setWords[code])
    }
  })

  it('says a vanished exam is gone, and words a body above the limit', () => {
    expect(describeQuestionSetFailure(apiError(404, { code: 'exam_not_found' }))).toEqual({ key: 'exams.errors.exam_not_found', next: 'gone' })
    expect(describeQuestionSetFailure(apiError(413, { message: 'request entity too large' }))).toEqual({ key: 'examOnline.editor.errors.too_large' })
  })

  it('falls back to the exams mapper: the missing permissions by name, validation, the server, the network', () => {
    const denied = describeQuestionSetFailure(apiError(403, { code: 'permission_denied', missing: ['exams.manage', 'questions.manage'] }))
    expect(denied).toEqual({ key: 'exams.errors.permission_denied', params: { list: '(exams.manage, questions.manage)' } })
    expect(failureMessage(t, denied)).toBe(ar.exams.errors.permission_denied.replace('{{list}}', '(exams.manage, questions.manage)'))
    expect(describeQuestionSetFailure(apiError(400, { message: 'points must not be less than 0.01' }))).toEqual({ key: 'exams.errors.validation', params: { message: 'points must not be less than 0.01' } })
    expect(describeQuestionSetFailure(apiError(500, { message: 'boom' }))).toEqual({ key: 'login.errors.server' })
    expect(describeQuestionSetFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})

describe('describeKeyCorrectionFailure (API-272)', () => {
  it('words the four problems of key_invalid; the two that mean the question changed elsewhere make the tab re-read', () => {
    expect(KEY_PROBLEMS).toEqual(['option_required', 'option_unknown', 'answer_required', 'not_allowed_for_type'])
    const described = KEY_PROBLEMS.map((problem) => describeKeyCorrectionFailure(apiError(400, { code: 'key_invalid', problem })))
    expect(described).toEqual([
      { key: 'examOnline.key.errors.key_invalid.option_required' },
      { key: 'examOnline.key.errors.key_invalid.option_unknown', next: 'stale' },
      { key: 'examOnline.key.errors.key_invalid.answer_required' },
      { key: 'examOnline.key.errors.key_invalid.not_allowed_for_type', next: 'stale' },
    ])
    expect(described.map((failure) => failureMessage(t, failure))).toEqual(KEY_PROBLEMS.map((problem) => keyWords.key_invalid[problem]))
    // A problem of a newer server still gets words.
    const unknown = describeKeyCorrectionFailure(apiError(400, { code: 'key_invalid', problem: 'something_new' }))
    expect(unknown).toEqual({ key: 'examOnline.key.errors.key_invalid.unknown' })
    expect(failureMessage(t, unknown)).toBe(keyWords.key_invalid.unknown)
  })

  it('says the class holds issued certificates (grades_certified), with their number', () => {
    const certified = describeKeyCorrectionFailure(apiError(409, { code: 'grades_certified', classId: 'c', certificateCount: 3 }))
    expect(certified).toEqual({ key: 'examOnline.key.errors.grades_certified', params: { value: '3' } })
    expect(failureMessage(t, certified)).toBe(keyWords.grades_certified.replace('{{value}}', '3'))
    expect(certified.next).toBeUndefined()
  })

  it('tells the tab to re-read when the exam or the question changed elsewhere', () => {
    for (const code of ['exam_not_frozen', 'exam_not_online', 'class_closed', 'question_not_found'] as const) {
      const failure = describeKeyCorrectionFailure(apiError(code === 'question_not_found' ? 404 : 409, { code }))
      expect(failure).toEqual({ key: `examOnline.key.errors.${code}`, next: 'stale' })
      expect(failureMessage(t, failure)).toBe(keyWords[code])
    }
    expect(describeKeyCorrectionFailure(apiError(404, { code: 'exam_not_found' }))).toEqual({ key: 'exams.errors.exam_not_found', next: 'gone' })
  })

  it('falls back to the exams mapper for a missing permission and anything else', () => {
    expect(describeKeyCorrectionFailure(apiError(403, { code: 'permission_denied', missing: ['exams.grade'] }))).toEqual({ key: 'exams.errors.permission_denied', params: { list: '(exams.grade)' } })
    expect(describeKeyCorrectionFailure(apiError(400, { message: 'reason must be longer than or equal to 1 characters' }))).toEqual({ key: 'exams.errors.validation', params: { message: 'reason must be longer than or equal to 1 characters' } })
    expect(describeKeyCorrectionFailure(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })
})
