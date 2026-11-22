// Every refusal of API-260..API-269 in words (backend/src/questions/questions.errors.ts plus the guards), through the
// real i18next instance: the counted ones in their Arabic plural forms (Intl.PluralRules('ar'): 1 one, 2 two, 3..10
// few, 11..99 many, 100 other), `question_invalid` problem by problem.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { QUESTION_PROBLEMS } from '../api/questionBanks'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeQuestionsFailure, failureMessage, isGoneFailure, isQuestionsFailure } from './questions.errors'

const arabic = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('ar')(key, options)
const english = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en')(key, options)
const refusal = (status: number, code: string, details: Record<string, unknown> = {}) => new ApiError(status, code, { statusCode: status, code, message: code, ...details })
const words = (error: unknown) => failureMessage(arabic, describeQuestionsFailure(error))

describe('describeQuestionsFailure()', () => {
  it('maps every code of the questions dictionary to its own message', () => {
    const codes = ['question_bank_not_found', 'question_bank_in_use', 'course_not_found', 'question_not_found', 'question_in_use', 'nothing_to_update', 'cursor_invalid'] as const
    for (const code of codes) {
      const failure = describeQuestionsFailure(refusal(409, code))
      expect(failure.key).toBe(`questionBanks.errors.${code}`)
      expect(failure.code).toBe(code)
      // A worded Arabic message, never the key itself.
      expect(failureMessage(arabic, failure)).toBe(ar.questionBanks.errors[code])
    }
  })

  it('puts course_not_found on the course field of the bank form', () => {
    expect(describeQuestionsFailure(refusal(404, 'course_not_found', { courseId: 'c-1' }))).toEqual({ key: 'questionBanks.errors.course_not_found', code: 'course_not_found', field: ['courseId'] })
    expect(describeQuestionsFailure(refusal(404, 'question_bank_not_found')).field).toBeUndefined()
  })

  it('keeps the count of a counted refusal as a number, and only a positive whole one', () => {
    expect(describeQuestionsFailure(refusal(409, 'question_bank_in_use', { linkedQuestionCount: 3 })).count).toBe(3)
    expect(describeQuestionsFailure(refusal(409, 'question_in_use', { examCount: 1 })).count).toBe(1)
    expect(describeQuestionsFailure(refusal(409, 'question_in_use', { examCount: '2' })).count).toBeUndefined()
    expect(describeQuestionsFailure(refusal(409, 'question_in_use', { examCount: 0 })).count).toBeUndefined()
    expect(describeQuestionsFailure(refusal(409, 'question_in_use', { examCount: 1.5 })).count).toBeUndefined()
    // The count of another refusal is not this one's.
    expect(describeQuestionsFailure(refusal(409, 'question_in_use', { linkedQuestionCount: 4 })).count).toBeUndefined()
    expect(describeQuestionsFailure(refusal(409, 'question_bank_in_use', { examCount: 4 })).count).toBeUndefined()
  })

  it('keeps the problems of question_invalid in catalogue order and drops what the catalogue does not know', () => {
    const failure = describeQuestionsFailure(refusal(400, 'question_invalid', { problems: ['correct_option_required', 'something_new', 'options_too_few', 7] }))
    expect(failure).toEqual({ key: 'questionBanks.errors.question_invalid', code: 'question_invalid', problems: ['options_too_few', 'correct_option_required'] })
    expect(isQuestionsFailure(failure, 'question_invalid')).toBe(true)
    // Nothing the catalogue knows: the plain message, still the same code.
    const plain = describeQuestionsFailure(refusal(400, 'question_invalid', { problems: ['something_new'] }))
    expect(plain).toEqual({ key: 'questionBanks.errors.question_invalid_plain', code: 'question_invalid' })
    expect(describeQuestionsFailure(refusal(400, 'question_invalid'))).toEqual(plain)
  })

  it('names the missing permission, and words the origin and rate-limit guards', () => {
    expect(describeQuestionsFailure(refusal(403, 'permission_denied', { missing: ['questions.manage'] }))).toEqual({
      key: 'questionBanks.errors.permission_denied',
      code: 'permission_denied',
      params: { list: '(questions.manage)' },
    })
    expect(words(refusal(403, 'permission_denied', { missing: ['questions.manage'] }))).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (questions.manage)')
    expect(words(refusal(403, 'permission_denied'))).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء')
    expect(words(refusal(403, 'origin_forbidden'))).toBe(ar.questionBanks.errors.origin_forbidden)
    expect(words(refusal(429, 'rate_limited'))).toBe(ar.questionBanks.errors.rate_limited)
  })

  it('shows a validation 400 with the constraints the server listed, a 5xx and a network failure in the shared words, anything else generically', () => {
    const validation = new ApiError(400, 'points must not be greater than 9999.99', { statusCode: 400, message: ['points must not be greater than 9999.99'] })
    expect(describeQuestionsFailure(validation)).toEqual({ key: 'questionBanks.errors.validation', params: { message: 'points must not be greater than 9999.99' } })
    expect(words(validation)).toBe('رفض الخادم البيانات: points must not be greater than 9999.99')
    expect(describeQuestionsFailure(new ApiError(503, 'down', { statusCode: 503 }))).toEqual({ key: 'login.errors.server' })
    expect(describeQuestionsFailure(new TypeError('fetch failed'))).toEqual({ key: 'login.errors.network' })
    expect(describeQuestionsFailure(refusal(409, 'something_else'))).toEqual({ key: 'login.errors.generic' })
    expect(describeQuestionsFailure(new ApiError(401, 'unauthenticated', { statusCode: 401, code: 'unauthenticated' }))).toEqual({ key: 'login.errors.generic' })
    expect(words(new TypeError('fetch failed'))).toBe(ar.login.errors.network)
  })

  it('tells a bank or a question that is gone from every other refusal', () => {
    expect(isGoneFailure(describeQuestionsFailure(refusal(404, 'question_bank_not_found')))).toBe(true)
    expect(isGoneFailure(describeQuestionsFailure(refusal(404, 'question_not_found')))).toBe(true)
    expect(isGoneFailure(describeQuestionsFailure(refusal(404, 'course_not_found')))).toBe(false)
    expect(isGoneFailure(describeQuestionsFailure(new ApiError(404, 'Not Found', { statusCode: 404 })))).toBe(false)
    expect(isGoneFailure(describeQuestionsFailure(new TypeError('fetch failed')))).toBe(false)
  })
})

describe('failureMessage() — the counted refusals in their plural forms', () => {
  it('explains question_bank_in_use with the advice to archive: «سؤال واحد», «سؤالان», «3 أسئلة», «11 سؤالاً», «100 سؤال»', () => {
    const inUse = (linkedQuestionCount: number) => words(refusal(409, 'question_bank_in_use', { linkedQuestionCount }))
    expect([1, 2, 3, 10, 11, 99, 100].map(inUse)).toEqual([
      'لا يُحذف هذا البنك: فيه سؤال واحد مربوط باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه سؤالان مربوطان باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه 3 أسئلة مربوطة باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه 10 أسئلة مربوطة باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه 11 سؤالاً مربوطاً باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه 99 سؤالاً مربوطاً باختبارات. أرشف أسئلته بدل حذفه.',
      'لا يُحذف هذا البنك: فيه 100 سؤال مربوط باختبارات. أرشف أسئلته بدل حذفه.',
    ])
    // Without a number the message still says why, and what to do instead.
    expect(words(refusal(409, 'question_bank_in_use'))).toBe('لا يُحذف هذا البنك: فيه أسئلة مربوطة باختبارات. أرشف أسئلته بدل حذفه.')
  })

  it('explains question_in_use with the advice to archive: «اختبار واحد», «اختباران», «3 اختبارات», «11 اختباراً», «100 اختبار»', () => {
    const inUse = (examCount: number) => words(refusal(409, 'question_in_use', { examCount }))
    expect([1, 2, 3, 11, 100].map(inUse)).toEqual([
      'لا يُحذف هذا السؤال: يستعمله اختبار واحد. أرشفه بدل حذفه.',
      'لا يُحذف هذا السؤال: يستعمله اختباران. أرشفه بدل حذفه.',
      'لا يُحذف هذا السؤال: تستعمله 3 اختبارات. أرشفه بدل حذفه.',
      'لا يُحذف هذا السؤال: يستعمله 11 اختباراً. أرشفه بدل حذفه.',
      'لا يُحذف هذا السؤال: يستعمله 100 اختبار. أرشفه بدل حذفه.',
    ])
    expect(words(refusal(409, 'question_in_use'))).toBe('لا يُحذف هذا السؤال: تستعمله اختبارات. أرشفه بدل حذفه.')
  })

  it('words the counted refusals in English too', () => {
    const en = (error: unknown) => failureMessage(english, describeQuestionsFailure(error))
    expect(en(refusal(409, 'question_in_use', { examCount: 1 }))).toBe('This question cannot be deleted: 1 exam uses it. Archive it instead.')
    expect(en(refusal(409, 'question_in_use', { examCount: 4 }))).toBe('This question cannot be deleted: 4 exams use it. Archive it instead.')
    expect(en(refusal(409, 'question_bank_in_use', { linkedQuestionCount: 1 }))).toBe('This bank cannot be deleted: 1 of its questions is linked to exams. Archive its questions instead.')
    expect(en(refusal(409, 'question_bank_in_use', { linkedQuestionCount: 5 }))).toBe('This bank cannot be deleted: 5 of its questions are linked to exams. Archive its questions instead.')
    expect(en(refusal(409, 'question_bank_in_use'))).toBe('This bank cannot be deleted: some of its questions are linked to exams. Archive its questions instead.')
  })
})

describe('failureMessage() — question_invalid, problem by problem', () => {
  it('has a sentence for every problem of the catalogue, in both languages', () => {
    for (const problem of QUESTION_PROBLEMS) {
      const failure = describeQuestionsFailure(refusal(400, 'question_invalid', { problems: [problem] }))
      expect(failureMessage(arabic, failure)).toBe(`رفض الخادم السؤال: ${ar.questionBanks.problems[problem]}`)
      expect(failureMessage(english, failure)).toContain('The server refused the question: ')
      expect(failureMessage(english, failure)).not.toContain('questionBanks.')
    }
  })

  it('lists several problems as sentences in the server’s order', () => {
    expect(words(refusal(400, 'question_invalid', { problems: ['correct_option_required', 'options_too_few'] }))).toBe('رفض الخادم السؤال: اكتب خيارين على الأقل. حدّد الخيار الصحيح.')
    expect(words(refusal(400, 'question_invalid', { problems: [] }))).toBe(ar.questionBanks.errors.question_invalid_plain)
  })
})
