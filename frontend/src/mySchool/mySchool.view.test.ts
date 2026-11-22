// MOD-20 — the pure rules of «My School» (TEST-250): sections and the URL, the course lists and their order, the
// summary counts, the local search, the card's action and badge, and the context action of a request.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { makeMyRequest } from '../test/catalog'
import { makeMyCertificate } from '../test/myCertificates'
import { LEARNING_ENROLLMENT_IDS, makeChildCourse, makeCompletedCourse, makeLearningCourse, makeProgress } from './mySchool.fixtures'
import {
  byRecentActivity,
  cardActionOf,
  catalogCoursePath,
  completedItems,
  continueItems,
  courseStateOf,
  featuredItemOf,
  requestStepOf,
  sectionHintKey,
  defaultSection,
  isCourseDone,
  isCourseSection,
  itemsOfSection,
  learnPath,
  matchesSearch,
  mySchoolFailureKey,
  requestActionOf,
  searchItems,
  sectionOf,
  sectionsFor,
  summaryOf,
} from './mySchool.view'

const student = { student: true }
const guardian = { student: false }

describe('sections', () => {
  it('gives a student every section and a guardian neither «continue learning» nor «requests»', () => {
    expect(sectionsFor(student)).toEqual(['continue', 'courses', 'completed', 'requests', 'assessments', 'certificates'])
    expect(sectionsFor(guardian)).toEqual(['courses', 'completed', 'assessments', 'certificates'])
    expect(defaultSection(student)).toBe('continue')
    expect(defaultSection(guardian)).toBe('courses')
  })

  it('reads the section from the URL only when the viewer has it', () => {
    expect(sectionOf('certificates', student)).toBe('certificates')
    expect(sectionOf('requests', guardian)).toBe('courses')
    expect(sectionOf('continue', guardian)).toBe('courses')
    expect(sectionOf('nonsense', student)).toBe('continue')
    expect(sectionOf(null, student)).toBe('continue')
    expect(isCourseSection('completed')).toBe(true)
    expect(isCourseSection('requests')).toBe(false)
  })
})

describe('course lists', () => {
  const older = makeLearningCourse({ enrollmentId: 'older', lastActivityAt: '2026-11-10T10:00:00.000Z' })
  const newer = makeLearningCourse({ enrollmentId: 'newer', lastActivityAt: '2026-11-18T10:00:00.000Z' })
  const untouchedOld = makeLearningCourse({ enrollmentId: 'untouched-old', lastActivityAt: null, action: 'start', enrollment: { ...older.enrollment, enrolledAt: '2026-10-01T09:00:00.000Z' } })
  const untouchedNew = makeLearningCourse({ enrollmentId: 'untouched-new', lastActivityAt: null, action: 'start', enrollment: { ...older.enrollment, enrolledAt: '2026-11-15T09:00:00.000Z' } })
  const done = makeCompletedCourse()
  const child = makeChildCourse()

  it('continues the own unfinished courses, most recent activity first, untouched ones last by the newest enrollment', () => {
    expect(continueItems([untouchedOld, older, done, child, untouchedNew, newer]).map((item) => item.enrollmentId)).toEqual(['newer', 'older', 'untouched-new', 'untouched-old'])
    expect(byRecentActivity(newer, older)).toBeLessThan(0)
  })

  it('never continues a course the server does not open, even an own one', () => {
    expect(continueItems([makeLearningCourse({ canLearn: false })])).toEqual([])
  })

  it('counts a course done when every required lesson is done or the enrollment is completed', () => {
    expect(isCourseDone(done)).toBe(true)
    expect(isCourseDone(makeLearningCourse({ enrollment: { ...older.enrollment, status: 'completed' } }))).toBe(true)
    expect(isCourseDone(makeLearningCourse({ progress: makeProgress({ isComplete: true, percent: 100 }) }))).toBe(true)
    expect(isCourseDone(older)).toBe(false)
    expect(completedItems([older, done, child]).map((item) => item.enrollmentId)).toEqual([LEARNING_ENROLLMENT_IDS[1]])
  })

  it('lists every course in «my courses» and nothing in the other sections', () => {
    expect(itemsOfSection('courses', [older, done, child])).toHaveLength(3)
    expect(itemsOfSection('requests', [older])).toEqual([])
  })
})

describe('search', () => {
  const python = makeLearningCourse()
  it('matches the course name in any language or its code, ignoring case and surrounding spaces', () => {
    expect(matchesSearch(python, '  بايثون ')).toBe(true)
    expect(matchesSearch(python, 'PYTHON')).toBe(true)
    expect(matchesSearch(python, 'py-101')).toBe(true)
    expect(matchesSearch(python, 'الويب')).toBe(false)
    expect(matchesSearch(python, '   ')).toBe(true)
    expect(searchItems([python, makeCompletedCourse()], 'web').map((item) => item.course.code)).toEqual(['WEB-201'])
  })
})

describe('the card', () => {
  it('offers the server’s action on an own course it opens, and nothing to a guardian', () => {
    expect(cardActionOf(makeLearningCourse({ action: 'start' }))).toBe('start')
    expect(cardActionOf(makeCompletedCourse())).toBe('review')
    expect(cardActionOf(makeChildCourse({ action: 'continue' }))).toBeNull()
    expect(cardActionOf(makeLearningCourse({ canLearn: false }))).toBeNull()
    // PORTAL-04 stage 5: an enrollment the office completed before the lessons were done is reviewed, never «started».
    const officeDone = makeLearningCourse({ action: 'start', lastActivityAt: null, enrollment: { ...makeLearningCourse().enrollment, status: 'completed', completedAt: '2026-11-22T10:00:00.000Z' }, progress: makeProgress({ completed: 0, completedRequired: 0, percent: 0 }) })
    expect(cardActionOf(officeDone)).toBe('review')
    expect(courseStateOf(officeDone)).toBe('complete')
    expect(learnPath('a b')).toBe('/learn/a%20b')
    expect(catalogCoursePath('c1')).toBe('/catalog/c1')
  })

  it('badges a card complete, new or in progress from the server’s counts', () => {
    expect(courseStateOf(makeCompletedCourse())).toBe('complete')
    expect(courseStateOf(makeLearningCourse({ action: 'start', lastActivityAt: null, progress: makeProgress({ completed: 0, completedRequired: 0, percent: 0 }) }))).toBe('notStarted')
    expect(courseStateOf(makeLearningCourse())).toBe('inProgress')
  })
})

describe('requests', () => {
  it('pays, waits or asks again by the request state', () => {
    expect(requestActionOf(makeMyRequest({ state: 'pending_payment' }))).toBe('pay')
    expect(requestActionOf(makeMyRequest({ state: 'pending_approval' }))).toBe('awaitingApproval')
    expect(requestActionOf(makeMyRequest({ state: 'rejected', status: 'cancelled' }))).toBe('requestAgain')
    // PORTAL-04: once active (or done) per the server, the way into the course; never before.
    expect(requestActionOf(makeMyRequest({ state: 'enrolled', status: 'active' }))).toBe('learn')
    expect(requestActionOf(makeMyRequest({ state: 'completed', status: 'completed' }))).toBe('learn')
    expect(requestActionOf(makeMyRequest({ state: 'cancelled', status: 'cancelled' }))).toBeNull()
  })
})

describe('summary', () => {
  it('counts only what the server answered', () => {
    const summary = summaryOf({
      courses: [makeLearningCourse(), makeCompletedCourse(), makeChildCourse()],
      requests: [makeMyRequest(), makeMyRequest({ state: 'pending_approval' }), makeMyRequest({ status: 'cancelled', state: 'rejected' })],
      certificates: [makeMyCertificate(), makeMyCertificate({ status: 'revoked' })],
    })
    expect(summary).toEqual({ activeCourses: 2, completedCourses: 1, pendingRequests: 2, certificates: 1 })
  })

  it('leaves an unknown source unknown instead of counting zero', () => {
    expect(summaryOf({ courses: null, requests: null, certificates: null })).toEqual({ activeCourses: null, completedCourses: null, pendingRequests: null, certificates: null })
  })
})

describe('failures', () => {
  it('words a network failure, a refusal, a rate limit and a server error', () => {
    expect(mySchoolFailureKey(new TypeError('fetch failed'))).toBe('mySchool.errors.network')
    expect(mySchoolFailureKey(new ApiError(403, 'no'))).toBe('mySchool.errors.permission')
    expect(mySchoolFailureKey(new ApiError(429, 'slow down'))).toBe('mySchool.errors.rateLimited')
    expect(mySchoolFailureKey(new ApiError(500, 'boom'))).toBe('mySchool.errors.server')
  })
})

describe('featuredItemOf (PORTAL-04)', () => {
  it('puts forward the first course when the student has been in it, never one not started, a child’s, or during a search', () => {
    const started = makeLearningCourse()
    const fresh = makeLearningCourse({ enrollmentId: 'fresh', action: 'start', lastActivityAt: null, lastLesson: null })
    const openedOnly = makeLearningCourse({ enrollmentId: 'opened', lastActivityAt: null })
    expect(featuredItemOf([started, fresh], '')).toBe(started)
    expect(featuredItemOf([openedOnly], '  ')).toBe(openedOnly)
    expect(featuredItemOf([fresh, started], '')).toBeNull()
    expect(featuredItemOf([started], 'بايثون')).toBeNull()
    expect(featuredItemOf([makeChildCourse()], '')).toBeNull()
    expect(featuredItemOf([makeLearningCourse({ canLearn: false })], '')).toBeNull()
    expect(featuredItemOf([], '')).toBeNull()
  })
})

describe('requestStepOf and sectionHintKey (PORTAL-04)', () => {
  it('places a request on its steps from the server state only, and a closed one nowhere', () => {
    expect(requestStepOf(makeMyRequest({ state: 'pending_payment' }))).toEqual({ current: 1, finished: false })
    expect(requestStepOf(makeMyRequest({ state: 'pending_approval' }))).toEqual({ current: 2, finished: false })
    expect(requestStepOf(makeMyRequest({ state: 'enrolled', status: 'active' }))).toEqual({ current: 3, finished: true })
    expect(requestStepOf(makeMyRequest({ state: 'completed', status: 'completed' }))).toEqual({ current: 3, finished: true })
    for (const state of ['rejected', 'cancelled', 'withdrawn'] as const) expect(requestStepOf(makeMyRequest({ state, status: 'cancelled' }))).toBeNull()
  })

  it('gives each section its line, a guardian’s courses their own, and none to the assessments or certificates', () => {
    const student = { student: true }
    expect(sectionHintKey('continue', student)).toBe('mySchool.courses.continueHint')
    expect(sectionHintKey('courses', student)).toBe('mySchool.courses.allHint')
    expect(sectionHintKey('courses', { student: false })).toBe('mySchool.courses.allHintGuardian')
    expect(sectionHintKey('completed', student)).toBe('mySchool.courses.completedHint')
    expect(sectionHintKey('requests', student)).toBe('mySchool.requests.hint')
    expect(sectionHintKey('assessments', student)).toBeNull()
    expect(sectionHintKey('certificates', student)).toBeNull()
  })
})
