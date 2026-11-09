import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makeCourse } from '../test/courses'
import { describeCoursesFailure } from './courses.errors'
import { buildCreateCourseInput, courseFormHasChanges, courseFormValuesOf, englishWithoutArabic, invalidAgeRange, localizedOf, planCoursePatch } from './courses.form'
import { availableCourseActions, isDangerousCourseAction, nextCourseStatus } from './courses.status'

describe('course form helpers', () => {
  it('builds the create body from what was filled in only, with a normalised code', () => {
    expect(buildCreateCourseInput({ code: ' py-101 ', nameAr: ' بايثون ', nameEn: '', summaryAr: '', levelId: null, durationHours: null })).toEqual({
      code: 'PY-101',
      name: { ar: 'بايثون' },
    })
    expect(
      buildCreateCourseInput({ code: 'A', nameAr: 'أ', nameEn: 'A', summaryAr: 'م', summaryEn: 'S', levelId: 'l-1', durationHours: 12.5, sessionsCount: 4, minAge: 8, maxAge: 9 }),
    ).toEqual({ code: 'A', name: { ar: 'أ', en: 'A' }, summary: { ar: 'م', en: 'S' }, levelId: 'l-1', durationHours: 12.5, sessionsCount: 4, minAge: 8, maxAge: 9 })
  })

  it('sends no PATCH when nothing changed', () => {
    const course = makeCourse({ summary: { ar: 'ملخص' } })
    expect(planCoursePatch(course, courseFormValuesOf(course))).toBeNull()
  })

  it('sends only the changed fields: null clears, a localized text travels whole and keeps its Turkish text', () => {
    const course = makeCourse({ name: { ar: 'بايثون', en: 'Python', tr: 'Python TR' }, summary: { ar: 'ملخص' } })
    const values = { ...courseFormValuesOf(course), nameEn: 'Python 3', summaryAr: '', levelId: null, maxAge: null, code: 'py-102' }
    expect(planCoursePatch(course, values)).toEqual({
      code: 'PY-102',
      name: { ar: 'بايثون', en: 'Python 3', tr: 'Python TR' },
      summary: null,
      levelId: null,
      maxAge: null,
    })
  })

  it('reads localized text and the age rule like the server', () => {
    expect(localizedOf('  ', 'only english')).toBeNull()
    expect(localizedOf('أ', '  ')).toEqual({ ar: 'أ' })
    expect(invalidAgeRange(12, 10)).toBe(true)
    expect(invalidAgeRange(12, null)).toBe(false)
    expect(invalidAgeRange(10, 10)).toBe(false)
  })
})

describe('course actions mirror (backend courses.status.ts)', () => {
  it('offers the allowed transitions plus delete for a draft, nothing without courses.manage', () => {
    expect(availableCourseActions('draft', true)).toEqual(['publish', 'archive', 'delete'])
    expect(availableCourseActions('published', true)).toEqual(['unpublish', 'archive'])
    expect(availableCourseActions('archived', true)).toEqual(['restore'])
    expect(availableCourseActions('draft', false)).toEqual([])
    expect(nextCourseStatus('restore', 'archived')).toBe('draft')
    expect(nextCourseStatus('publish', 'archived')).toBeNull()
    expect(isDangerousCourseAction('archive')).toBe(true)
    expect(isDangerousCourseAction('publish')).toBe(false)
  })
})

describe('course errors', () => {
  it('maps the codes to messages and fields', () => {
    expect(describeCoursesFailure(new ApiError(409, 'taken', { code: 'course_code_taken', courseCode: 'PY-101' }))).toEqual({ key: 'courses.errors.course_code_taken', field: ['code'] })
    expect(describeCoursesFailure(new ApiError(403, 'denied', { code: 'permission_denied', missing: ['courses.manage'] }))).toEqual({
      key: 'courses.errors.permission_denied',
      params: { list: '(courses.manage)' },
    })
    expect(describeCoursesFailure(new ApiError(400, 'name.ar must be longer'))).toEqual({ key: 'courses.errors.validation', params: { message: 'name.ar must be longer' } })
    expect(describeCoursesFailure(new ApiError(500, 'boom'))).toEqual({ key: 'login.errors.server' })
    expect(describeCoursesFailure(new TypeError('offline'))).toEqual({ key: 'login.errors.network' })
  })
})

describe('courseFormHasChanges (KI-054 — J-F23)', () => {
  const course = makeCourse({ summary: { ar: 'ملخص' } })

  it('holds nothing for the stored values or a change typed back', () => {
    expect(courseFormHasChanges(course, courseFormValuesOf(course))).toBe(false)
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), code: 'py-101', nameEn: 'Python Basics ' })).toBe(false)
  })

  it('holds a field that differs from the stored course, text or number', () => {
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), nameEn: 'Python 3' })).toBe(true)
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), sessionsCount: null })).toBe(true)
  })

  it('holds what the save refuses instead of sending: an emptied code or Arabic name, English without its Arabic text', () => {
    const values = courseFormValuesOf(course)
    expect(planCoursePatch(course, { ...values, nameAr: ' ' })).toBeNull()
    expect(courseFormHasChanges(course, { ...values, nameAr: ' ' })).toBe(true)
    expect(courseFormHasChanges(course, { ...values, code: '' })).toBe(true)
    expect(planCoursePatch(course, { ...values, descriptionEn: 'English only' })).toBeNull()
    expect(courseFormHasChanges(course, { ...values, descriptionEn: 'English only' })).toBe(true)
    expect(englishWithoutArabic('', ' ')).toBe(false)
    expect(englishWithoutArabic('عربي', 'English')).toBe(false)
  })
})
