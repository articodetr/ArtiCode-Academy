import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { COURSE_ID, makeCourse } from '../test/courses'
import { makeFeePlan } from '../test/payments'
import { describeCoursesFailure } from './courses.errors'
import { arabicTextOf, buildCreateCourseInput, courseFormField, courseFormHasChanges, courseFormValuesOf, englishWithoutArabic, isCoverImageUrl, localizedOf, planCoursePatch, plansFittingCourse } from './courses.form'
import { availableCourseActions, isDangerousCourseAction, nextCourseStatus } from './courses.status'

describe('course form helpers', () => {
  it('builds the create body from what was filled in only: no code, no English, no level, hours or sessions', () => {
    expect(buildCreateCourseInput({ nameAr: ' بايثون ', summaryAr: '', descriptionAr: '  ', subjectId: null, coverImageUrl: '' })).toEqual({ name: { ar: 'بايثون' } })
    const full = buildCreateCourseInput({ nameAr: 'أ', summaryAr: ' م ', descriptionAr: 'و', subjectId: 's-1', coverImageUrl: 'https://cdn.example.org/a.jpg', pricing: 'free' })
    expect(full).toEqual({ name: { ar: 'أ' }, summary: { ar: 'م' }, description: { ar: 'و' }, subjectId: 's-1', coverImageUrl: 'https://cdn.example.org/a.jpg' })
    for (const key of ['code', 'levelId', 'durationHours', 'sessionsCount', 'minAge', 'maxAge', 'enrollmentFeePlanId']) expect(full).not.toHaveProperty(key)
  })

  it('creates a paid course with its plan, and a free one (or a paid one without a plan) with none', () => {
    expect(buildCreateCourseInput({ nameAr: 'أ', pricing: 'paid', enrollmentFeePlanId: 'plan-1' })).toEqual({ name: { ar: 'أ' }, enrollmentFeePlanId: 'plan-1' })
    expect(buildCreateCourseInput({ nameAr: 'أ', pricing: 'free', enrollmentFeePlanId: 'plan-1' })).not.toHaveProperty('enrollmentFeePlanId')
    expect(buildCreateCourseInput({ nameAr: 'أ', pricing: 'paid', enrollmentFeePlanId: null })).not.toHaveProperty('enrollmentFeePlanId')
    // Without fee_plans.manage the type field is not there at all: free.
    expect(buildCreateCourseInput({ nameAr: 'أ' })).not.toHaveProperty('enrollmentFeePlanId')
  })

  it('reads only the fields it shows from a course: no code, English, level, hours, sessions or ages', () => {
    const values = courseFormValuesOf(makeCourse({ summary: { ar: 'ملخص', en: 'Summary' } }))
    expect(values).toMatchObject({ nameAr: 'أساسيات بايثون', summaryAr: 'ملخص', descriptionAr: '' })
    for (const key of ['code', 'nameEn', 'summaryEn', 'descriptionEn', 'levelId', 'durationHours', 'sessionsCount', 'minAge', 'maxAge']) expect(values).not.toHaveProperty(key)
  })

  it('sends no PATCH when nothing changed', () => {
    const course = makeCourse({ summary: { ar: 'ملخص' } })
    expect(planCoursePatch(course, courseFormValuesOf(course))).toBeNull()
  })

  it('keeps the stored English and Turkish texts when the Arabic text changes, and never names the code, level, hours or sessions', () => {
    const course = makeCourse({
      name: { ar: 'بايثون', en: 'Python', tr: 'Python TR' },
      summary: { ar: 'ملخص', en: 'Summary' },
      description: { ar: 'وصف', tr: 'Açıklama' },
    })
    const values = courseFormValuesOf(course)
    expect(planCoursePatch(course, { ...values, nameAr: ' بايثون 3 ' })).toEqual({ name: { ar: 'بايثون 3', en: 'Python', tr: 'Python TR' } })
    const all = planCoursePatch(course, { ...values, nameAr: 'ب', summaryAr: 'م', descriptionAr: 'و' })
    expect(all).toEqual({ name: { ar: 'ب', en: 'Python', tr: 'Python TR' }, summary: { ar: 'م', en: 'Summary' }, description: { ar: 'و', tr: 'Açıklama' } })
    for (const key of ['code', 'levelId', 'durationHours', 'sessionsCount', 'minAge', 'maxAge']) expect(all).not.toHaveProperty(key)
  })

  it('clears a whole summary or description when its Arabic text is emptied (the server requires ar)', () => {
    const course = makeCourse({ summary: { ar: 'ملخص', en: 'Summary' }, description: { ar: 'وصف', en: 'Description' } })
    expect(planCoursePatch(course, { ...courseFormValuesOf(course), summaryAr: ' ', descriptionAr: '' })).toEqual({ summary: null, description: null })
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
    expect(arabicTextOf('  ', { ar: 'أ', en: 'A' })).toBeNull()
    expect(arabicTextOf(' ب ', { ar: 'أ', en: 'A', tr: 'T' })).toEqual({ ar: 'ب', en: 'A', tr: 'T' })
    expect(arabicTextOf('ب', null)).toEqual({ ar: 'ب' })
  })

  it('puts a server error on a field only when the form still has that field', () => {
    expect(courseFormField(['subjectId'])).toEqual(['subjectId'])
    expect(courseFormField(['enrollmentFeePlanId'])).toEqual(['enrollmentFeePlanId'])
    expect(courseFormField(['code'])).toBeUndefined()
    expect(courseFormField(['levelId'])).toBeUndefined()
    expect(courseFormField(undefined)).toBeUndefined()
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
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), nameAr: 'أساسيات بايثون ', summaryAr: ' ملخص' })).toBe(false)
  })

  it('holds a field that differs from the stored course', () => {
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), nameAr: 'بايثون 3' })).toBe(true)
    expect(courseFormHasChanges(course, { ...courseFormValuesOf(course), descriptionAr: 'وصف' })).toBe(true)
  })

  it('holds what the save refuses instead of sending: an emptied name', () => {
    const values = courseFormValuesOf(course)
    expect(planCoursePatch(course, { ...values, nameAr: ' ' })).toBeNull()
    expect(courseFormHasChanges(course, { ...values, nameAr: ' ' })).toBe(true)
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
    expect(buildCreateCourseInput({ nameAr: 'أ', coverImageUrl: '  https://cdn.example.org/a.jpg ' })).toMatchObject({ coverImageUrl: 'https://cdn.example.org/a.jpg' })
    expect(buildCreateCourseInput({ nameAr: 'أ', coverImageUrl: '  ' })).not.toHaveProperty('coverImageUrl')
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
    // The create modal: no course yet, so the general plans only.
    expect(plansFittingCourse(plans, null).map((item) => item.id)).toEqual(['general'])
  })
})
