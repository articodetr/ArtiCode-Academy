// CH-0297: the Arabic counts of the courses screens in their plural forms, through the real i18next instance
// (Intl.PluralRules('ar'): 0 zero, 1 one, 2 two, 3..10 few, 11..99 many, 100..102 other — the hundreds repeat it).
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { describeCoursesFailure, failureMessage } from './courses.errors'

const arabic = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('ar')(key, options)
const english = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en')(key, options)

describe('courses counts in their plural forms (CH-0297)', () => {
  it('words the syllabus items: «بند واحد», «بندان», «3 بنود», «11 بنداً», «100 بند»', () => {
    const items = (count: number) => arabic('courses.syllabus.items', { count })
    expect([1, 2, 3, 10, 11, 99, 100, 103, 135].map(items)).toEqual([
      'بند واحد',
      'بندان',
      '3 بنود',
      '10 بنود',
      '11 بنداً',
      '99 بنداً',
      '100 بند',
      '103 بنود',
      '135 بنداً',
    ])
    expect(english('courses.syllabus.items', { count: 1 })).toBe('1 item')
    expect(english('courses.syllabus.items', { count: 3 })).toBe('3 items')
  })

  it('words the minutes: «دقيقة واحدة», «دقيقتان», «5 دقائق», «45 دقيقة», «135 دقيقة»', () => {
    const minutes = (count: number) => arabic('courses.syllabus.minutes', { count })
    expect([0, 1, 2, 5, 45, 105, 135].map(minutes)).toEqual(['0 دقيقة', 'دقيقة واحدة', 'دقيقتان', '5 دقائق', '45 دقيقة', '105 دقائق', '135 دقيقة'])
  })

  it('composes the syllabus summary from the two counts — the reported «3 بند · 135 دقيقة» reads «3 بنود · 135 دقيقة»', () => {
    const summary = (language: 'ar' | 'en', items: number, minutes: number) => {
      const t = language === 'ar' ? arabic : english
      return t('courses.syllabus.summary', { items: t('courses.syllabus.items', { count: items }), minutes: t('courses.syllabus.minutes', { count: minutes }) })
    }
    expect(summary('ar', 3, 135)).toBe('3 بنود · 135 دقيقة تقديرياً')
    expect(summary('ar', 1, 2)).toBe('بند واحد · دقيقتان تقديرياً')
    expect(summary('en', 1, 45)).toBe('1 item · 45 min estimated')
  })

  it('words the course count of level_in_use from the server refusal and the tooltip: «تستخدمه دورة واحدة», «دورتان», «3 دورات»', () => {
    const refusal = (courseCount: number) => describeCoursesFailure(new ApiError(409, 'in use', { statusCode: 409, code: 'level_in_use', courseCount }))
    expect(refusal(1)).toEqual({ key: 'courses.errors.level_in_use', params: { courseCount: '1' } })
    expect(failureMessage(arabic, refusal(1))).toBe('لا يُحذف هذا المستوى: تستخدمه دورة واحدة. عطّله بدلاً من ذلك.')
    expect(failureMessage(arabic, refusal(2))).toBe('لا يُحذف هذا المستوى: تستخدمه دورتان. عطّله بدلاً من ذلك.')
    expect(failureMessage(arabic, refusal(3))).toBe('لا يُحذف هذا المستوى: تستخدمه 3 دورات. عطّله بدلاً من ذلك.')
    expect(failureMessage(arabic, refusal(11))).toBe('لا يُحذف هذا المستوى: تستخدمه 11 دورة. عطّله بدلاً من ذلك.')
    expect(failureMessage(english, refusal(1))).toBe('This level cannot be deleted: 1 course uses it. Deactivate it instead.')
    expect(failureMessage(english, refusal(4))).toBe('This level cannot be deleted: 4 courses use it. Deactivate it instead.')
    // The tooltip of LevelsManager hands the row's count as a number too.
    expect(arabic('courses.errors.level_in_use', { count: 1 })).toBe('لا يُحذف هذا المستوى: تستخدمه دورة واحدة. عطّله بدلاً من ذلك.')
  })

  it('leaves every other courses failure as users.errors words it', () => {
    const denied = describeCoursesFailure(new ApiError(403, 'denied', { statusCode: 403, code: 'permission_denied', missing: ['courses.manage'] }))
    expect(failureMessage(arabic, denied)).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (courses.manage)')
    expect(failureMessage(arabic, describeCoursesFailure(new TypeError('fetch failed')))).toBe(arabic('login.errors.network'))
  })
})
