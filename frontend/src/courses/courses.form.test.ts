import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { COURSE_ID, makeCourse } from '../test/courses'
import { makeFeePlan } from '../test/payments'
import { describeCoursesFailure } from './courses.errors'
import { buildCreateCourseInput, courseFormHasChanges, courseFormValuesOf, englishWithoutArabic, isCoverImageUrl, localizedOf, planCoursePatch, plansFittingCourse } from './courses.form'
import { availableCourseActions, isDangerousCourseAction, nextCourseStatus } from './courses.status'

describe('course form helpers', () => {
  it('builds the create body from what was filled in only, with a normalised code', () => {
    expect(buildCreateCourseInput({ code: ' py-101 ', nameAr: ' بايثون ', nameEn: '', summaryAr: '', levelId: null, subjectId: null, durationHours: null })).toEqual({
      code: 'PY-101',
      name: { ar: 'بايثون' },
    })
    expect(
      buildCreateCourseInput({ code: 'A', nameAr: 'أ', nameEn: 'A', summaryAr: 'م', summaryEn: 'S', levelId: 'l-1', subjectId: 's-1', durationHours: 12.5, sessionsCount: 4 }),
    ).toEqual({ code: 'A', name: { ar: 'أ', en: 'A' }, summary: { ar: 'م', en: 'S' }, levelId: 'l-1', subjectId: 's-1', durationHours: 12.5, sessionsCount: 4 })
  })

  it('never sends an age range (PORTAL-04): neither on create nor in a PATCH, so the stored ages stay', () => {
    const created = buildCreateCourseInput({ code: 'A', nameAr: 'أ', durationHours: 2, sessionsCount: 3 })
    expect(created).not.toHaveProperty('minAge')
    expect(created).not.toHaveProperty('maxAge')
    const course = makeCourse({ minAge: 10, maxAge: 14 })
    const values = courseFormValuesOf(course)
    expect(values).not.toHaveProperty('minAge')
    expect(values).not.toHaveProperty('maxAge')
    expect(planCoursePatch(course, { ...values, sessionsCount: 20 })).toEqual({ sessionsCount: 20 })
  })

  it('sends no PATCH when nothing changed', () => {
    const course = makeCourse({ summary: { ar: 'ملخص' } })
    expect(planCoursePatch(course, courseFormValuesOf(course))).toBeNull()
  })

  it('sends only the changed fields: null clears, a localized text travels whole and keeps its Turkish text', () => {
    const course = makeCourse({ name: { ar: 'بايثون', en: 'Python', tr: 'Python TR' }, summary: { ar: 'ملخص' } })
    const values = { ...courseFormValuesOf(course), nameEn: 'Python 3', summaryAr: '', levelId: null, sessionsCount: null, code: 'py-102' }
    expect(planCoursePatch(course, values)).toEqual({
      code: 'PY-102',
      name: { ar: 'بايثون', en: 'Python 3', tr: 'Python TR' },
      summary: null,
      levelId: null,
      sessionsCount: null,
    })
  })

  it('reads the subject from the course and sends it only when it changes; an emptied picker clears it (PORTAL-04)', () => {
    const course = makeCourse()
    const values = courseFormValuesOf(course)
    expect(values.subjectId).toBe(course.subject!.id)
    expect(planCoursePatch(course, values)).toBeNull()
    expect(planCoursePatch(course, { ...values, subjectId: 'other-subject' })).toEqual({ subjectId: 'other-subject' })
    // antd answers undefined when a Select is cleared.
    expect(planCoursePatch(course, { ...values, subjectId: undefined })).toEqual({ subjectId: null })
    expect(planCoursePatch(course, { ...values, subjectId: null })).toEqual({ subjectId: null })
    const none = makeCourse({ subject: null })
    expect(courseFormValuesOf(none).subjectId).toBeNull()
    expect(planCoursePatch(none, { ...courseFormValuesOf(none), subjectId: 's-1' })).toEqual({ subjectId: 's-1' })
    expect(courseFormHasChanges(none, { ...courseFormValuesOf(none), subjectId: 's-1' })).toBe(true)
  })

  it('reads localized text like the server', () => {
    expect(localizedOf('  ', 'only english')).toBeNull()
    expect(localizedOf('أ', '  ')).toEqual({ ar: 'أ' })
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

  it('maps the subject codes (PORTAL-04): the course form\'s picker, the subjects tab\'s code field and the course count', () => {
    expect(describeCoursesFailure(new ApiError(404, 'gone', { code: 'subject_not_found', subjectId: 's-1' }))).toEqual({ key: 'courses.errors.subject_not_found', field: ['subjectId'] })
    expect(describeCoursesFailure(new ApiError(422, 'off', { code: 'subject_inactive', subjectId: 's-1' }))).toEqual({ key: 'courses.errors.subject_inactive', field: ['subjectId'] })
    expect(describeCoursesFailure(new ApiError(409, 'taken', { code: 'subject_code_taken', subjectCode: 'MATH' }))).toEqual({ key: 'courses.errors.subject_code_taken', field: ['code'] })
    expect(describeCoursesFailure(new ApiError(409, 'used', { code: 'subject_in_use', courseCount: 3 }))).toEqual({ key: 'courses.errors.subject_in_use', params: { courseCount: '3' } })
    expect(describeCoursesFailure(new ApiError(400, 'order', { code: 'subject_order_invalid' }))).toEqual({ key: 'courses.errors.subject_order_invalid' })
    // No age field is left on the form: a stale age refusal shows above it.
    expect(describeCoursesFailure(new ApiError(400, 'age', { code: 'age_range_invalid' }))).toEqual({ key: 'courses.errors.age_range_invalid' })
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

describe('course cover and pricing (MOD-19, D-R122/D-R129)', () => {
  const plan = { id: 'plan-1', name: { ar: 'رسوم' }, isActive: true, total: 1000, currency: 'SAR', installments: 1 }

  it('mirrors the cover rule: an absolute http(s) URL without spaces, at most 2048 characters; blank is no cover', () => {
    expect(isCoverImageUrl('https://cdn.example.org/a.jpg')).toBe(true)
    expect(isCoverImageUrl('http://localhost:5173/a.png')).toBe(true)
    expect(isCoverImageUrl('')).toBe(true)
    expect(isCoverImageUrl(undefined)).toBe(true)
    for (const bad of ['javascript:alert(1)', 'cdn.example.org/a.jpg', 'https://cdn.example.org/a b.jpg', `https://x.org/${'a'.repeat(2048)}`, 'ftp://x.org/a']) {
      expect(isCoverImageUrl(bad), bad.slice(0, 20)).toBe(false)
    }
  })

  it('creates with a trimmed cover only when one was typed', () => {
    expect(buildCreateCourseInput({ code: 'a', nameAr: 'أ', coverImageUrl: '  https://cdn.example.org/a.jpg ' })).toMatchObject({ coverImageUrl: 'https://cdn.example.org/a.jpg' })
    expect(buildCreateCourseInput({ code: 'a', nameAr: 'أ', coverImageUrl: '  ' })).not.toHaveProperty('coverImageUrl')
  })

  it('sends the cover and the plan only when they change; free sends null, paid without a plan sends nothing', () => {
    const free = makeCourse()
    const values = courseFormValuesOf(free)
    expect(values).toMatchObject({ coverImageUrl: '', pricing: 'free', enrollmentFeePlanId: null })
    expect(planCoursePatch(free, values)).toBeNull()
    expect(planCoursePatch(free, { ...values, coverImageUrl: 'https://cdn.example.org/a.jpg' })).toEqual({ coverImageUrl: 'https://cdn.example.org/a.jpg' })
    expect(planCoursePatch(free, { ...values, pricing: 'paid', enrollmentFeePlanId: 'plan-1' })).toEqual({ enrollmentFeePlanId: 'plan-1' })
    expect(planCoursePatch(free, { ...values, pricing: 'paid', enrollmentFeePlanId: null })).toBeNull()
    // …but that choice is typed work the drawer keeps.
    expect(courseFormHasChanges(free, { ...values, pricing: 'paid', enrollmentFeePlanId: null })).toBe(true)

    const paid = makeCourse({ pricing: 'paid', enrollmentFeePlan: plan, coverImageUrl: 'https://cdn.example.org/a.jpg' })
    const paidValues = courseFormValuesOf(paid)
    expect(paidValues).toMatchObject({ pricing: 'paid', enrollmentFeePlanId: 'plan-1', coverImageUrl: 'https://cdn.example.org/a.jpg' })
    expect(planCoursePatch(paid, paidValues)).toBeNull()
    expect(planCoursePatch(paid, { ...paidValues, pricing: 'free' })).toEqual({ enrollmentFeePlanId: null })
    expect(planCoursePatch(paid, { ...paidValues, enrollmentFeePlanId: 'plan-2' })).toEqual({ enrollmentFeePlanId: 'plan-2' })
    expect(planCoursePatch(paid, { ...paidValues, coverImageUrl: '' })).toEqual({ coverImageUrl: null })
    // A form without the pricing fields (no fee_plans.manage) leaves the price alone.
    expect(planCoursePatch(paid, { ...paidValues, pricing: undefined, enrollmentFeePlanId: undefined })).toBeNull()
    expect(courseFormHasChanges(paid, { ...paidValues, coverImageUrl: 'not a url' })).toBe(true)
  })

  it('offers the active plans of the course and the general ones, never a class plan or another course’s', () => {
    const plans = [
      makeFeePlan({ id: 'general' }),
      makeFeePlan({ id: 'mine', course: { id: COURSE_ID, code: 'PY-101', name: { ar: 'بايثون' } } }),
      makeFeePlan({ id: 'other', course: { id: 'other-course', code: 'X', name: { ar: 'أخرى' } } }),
      makeFeePlan({ id: 'class', class: { id: 'cls', code: 'PY-101-A', name: { ar: 'فصل' } } }),
      makeFeePlan({ id: 'off', isActive: false }),
    ]
    expect(plansFittingCourse(plans, COURSE_ID).map((item) => item.id)).toEqual(['general', 'mine'])
  })
})
