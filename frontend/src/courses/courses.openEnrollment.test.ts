import { describe, expect, it } from 'vitest'
import type { CourseFeePlan } from '../api/courses'
import { todayIn } from '../lessons/lessons.format'
import { makeClass } from '../test/classes'
import { makeCourse } from '../test/courses'
import { deviceTimeZone } from '../timetable/timetable.settings'
import {
  GENERAL_CLASS_MARKER,
  GENERAL_CLASS_NAME,
  GENERAL_CLASS_NOTE,
  coursePriceUnusable,
  defaultStartsOn,
  generalClassCodes,
  isGeneralClass,
  isValidCapacity,
  planEnrollmentPanel,
  planStop,
  selfServiceClasses,
} from './courses.openEnrollment'

const makeFeePlanSummary = (overrides: Partial<CourseFeePlan> = {}): CourseFeePlan => ({
  id: 'plan-1',
  name: { ar: 'رسوم الدورة' },
  isActive: true,
  total: 1200,
  currency: 'USD',
  installments: 1,
  ...overrides,
})

const general = (overrides: Parameters<typeof makeClass>[0] = {}) =>
  makeClass({ id: 'general', code: 'PY-101-GEN', name: { ...GENERAL_CLASS_NAME }, notes: GENERAL_CLASS_NOTE, ...overrides })
const privateClass = (overrides: Parameters<typeof makeClass>[0] = {}) => makeClass({ id: 'private', code: 'PY-101-A', ...overrides })
/** The admin's own class that merely looks like ours: our code shape, our name, no marker. */
const lookalike = (overrides: Parameters<typeof makeClass>[0] = {}) => privateClass({ id: 'lookalike', code: 'X-GEN', name: { ...GENERAL_CLASS_NAME }, ...overrides })

describe('generalClassCodes', () => {
  it('tries -GEN then -GEN2 .. -GEN9', () => {
    const codes = generalClassCodes('PY-101')
    expect(codes).toHaveLength(9)
    expect(codes[0]).toBe('PY-101-GEN')
    expect(codes[1]).toBe('PY-101-GEN2')
    expect(codes[8]).toBe('PY-101-GEN9')
  })

  it('trims a long course code so every candidate fits the server pattern', () => {
    const codes = generalClassCodes('A'.repeat(32))
    for (const code of codes) {
      expect(code.length).toBeLessThanOrEqual(32)
      expect(code).toMatch(/^[A-Z0-9][A-Z0-9._-]{0,31}$/)
    }
    expect(codes[0]).toBe(`${'A'.repeat(28)}-GEN`)
    expect(codes[1]).toBe(`${'A'.repeat(27)}-GEN2`)
  })

  it('drops a separator left at the end of the trimmed prefix', () => {
    expect(generalClassCodes(`${'A'.repeat(27)}-BBBB`)[0]).toBe(`${'A'.repeat(27)}-GEN`)
  })
})

describe('isGeneralClass', () => {
  it('is the marker in the notes and nothing else', () => {
    expect(GENERAL_CLASS_NOTE).toContain(GENERAL_CLASS_MARKER)
    expect(isGeneralClass(general())).toBe(true)
    expect(isGeneralClass(general({ code: 'RENAMED-1', name: { ar: 'اسم جديد' } }))).toBe(true)
    expect(isGeneralClass(general({ notes: `ملاحظة المدير ${GENERAL_CLASS_MARKER}` }))).toBe(true)
    expect(isGeneralClass(lookalike())).toBe(false)
    expect(isGeneralClass(lookalike({ notes: 'فوج الصباح' }))).toBe(false)
  })
})

describe('planEnrollmentPanel', () => {
  it('is disabled for a course that is not published, whatever its classes', () => {
    expect(planEnrollmentPanel('draft', [])).toEqual({ kind: 'unpublished' })
    expect(planEnrollmentPanel('archived', [general({ status: 'open', selfEnrollment: true })])).toEqual({ kind: 'unpublished' })
  })

  it('is open while any open or running class takes self-service, ours or not', () => {
    const ours = general({ status: 'running', selfEnrollment: true })
    const theirs = privateClass({ status: 'open', selfEnrollment: true })
    const plan = planEnrollmentPanel('published', [ours, theirs, privateClass({ id: 'closed', status: 'open' })])
    expect(plan).toEqual({ kind: 'open', classes: [ours, theirs] })
  })

  it('does not count a self-service class that is planned, completed or cancelled as open', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      expect(planEnrollmentPanel('published', [privateClass({ status, selfEnrollment: true })])).toEqual({ kind: 'closed', step: { kind: 'create' } })
    }
    expect(planEnrollmentPanel('published', [general({ status: 'planned', selfEnrollment: true })]).kind).toBe('closed')
  })

  it('turns our open general class back on', () => {
    expect(planEnrollmentPanel('published', [general({ status: 'open' })])).toEqual({ kind: 'closed', step: { kind: 'reenable', classId: 'general' } })
  })

  it('still recognises a general class whose code and name were edited: no second class', () => {
    expect(planEnrollmentPanel('published', [general({ code: 'RENAMED-1', name: { ar: 'اسم جديد' }, status: 'open' })])).toEqual({
      kind: 'closed',
      step: { kind: 'reenable', classId: 'general' },
    })
  })

  it('resumes our planned general class, enabling self-service only when needed', () => {
    expect(planEnrollmentPanel('published', [general({ status: 'planned', selfEnrollment: true })])).toEqual({
      kind: 'closed',
      step: { kind: 'resume', classId: 'general', enableSelfService: false },
    })
    expect(planEnrollmentPanel('published', [general({ status: 'planned' })])).toEqual({
      kind: 'closed',
      step: { kind: 'resume', classId: 'general', enableSelfService: true },
    })
  })

  it('prefers a live general class over a planned one', () => {
    const planned = general({ id: 'planned', code: 'PY-101-GEN', status: 'planned' })
    const live = general({ id: 'live', code: 'PY-101-GEN2', status: 'running' })
    expect(planEnrollmentPanel('published', [planned, live])).toEqual({ kind: 'closed', step: { kind: 'reenable', classId: 'live' } })
  })

  it('never touches a private class: an open or planned cohort leads to a new class', () => {
    for (const status of ['planned', 'open', 'running'] as const) {
      expect(planEnrollmentPanel('published', [privateClass({ status })])).toEqual({ kind: 'closed', step: { kind: 'create' } })
      // Even with our code shape and our name, without the marker.
      expect(planEnrollmentPanel('published', [lookalike({ status })])).toEqual({ kind: 'closed', step: { kind: 'create' } })
    }
  })

  it('creates a new class when our general class is over', () => {
    expect(planEnrollmentPanel('published', [general({ status: 'completed' }), general({ id: 'c', code: 'PY-101-GEN2', status: 'cancelled' })])).toEqual({
      kind: 'closed',
      step: { kind: 'create' },
    })
  })
})

describe('selfServiceClasses', () => {
  it('keeps only open or running classes with self-enrollment on', () => {
    const on = privateClass({ id: 'on', status: 'open', selfEnrollment: true })
    expect(selfServiceClasses([on, privateClass({ id: 'off', status: 'open' }), privateClass({ id: 'planned', selfEnrollment: true })])).toEqual([on])
  })
})

describe('planStop', () => {
  it('targets general classes with self-enrollment on, a planned one included', () => {
    const open = general({ id: 'g-open', status: 'open', selfEnrollment: true })
    const running = general({ id: 'g-running', status: 'running', selfEnrollment: true })
    const planned = general({ id: 'g-planned', status: 'planned', selfEnrollment: true })
    expect(planStop([open, running, planned])).toEqual({ targets: [open, running, planned], staysOpenThrough: [] })
  })

  it('skips a general class already off or already over', () => {
    const classes = [general({ id: 'off', status: 'open' }), general({ id: 'done', status: 'completed', selfEnrollment: true }), general({ id: 'gone', status: 'cancelled', selfEnrollment: true })]
    expect(planStop(classes).targets).toEqual([])
  })

  it('never targets an admin’s class and reports the ones that keep subscription open', () => {
    const ours = general({ status: 'open', selfEnrollment: true })
    const theirs = lookalike({ status: 'running', selfEnrollment: true })
    const plannedTheirs = privateClass({ id: 'planned-private', status: 'planned', selfEnrollment: true })
    expect(planStop([ours, theirs, plannedTheirs])).toEqual({ targets: [ours], staysOpenThrough: [theirs] })
  })
})

describe('defaultStartsOn', () => {
  const now = new Date('2026-11-23T22:30:00.000Z')

  it('is today in the academy’s zone', () => {
    expect(defaultStartsOn({ timezone: 'Asia/Riyadh' }, now)).toBe('2026-11-24')
    expect(defaultStartsOn({ timezone: 'UTC' }, now)).toBe('2026-11-23')
  })

  it('falls back to this device’s zone when the academy cannot be read', () => {
    expect(defaultStartsOn(null, now)).toBe(todayIn(deviceTimeZone(), now))
  })
})

describe('coursePriceUnusable', () => {
  it('warns for a paid course whose plan is deactivated, not for a free or properly priced one', () => {
    expect(coursePriceUnusable(makeCourse())).toBe(false)
    expect(coursePriceUnusable(makeCourse({ pricing: 'paid', enrollmentFeePlan: makeFeePlanSummary() }))).toBe(false)
    expect(coursePriceUnusable(makeCourse({ pricing: 'paid', enrollmentFeePlan: makeFeePlanSummary({ isActive: false }) }))).toBe(true)
  })
})

describe('isValidCapacity', () => {
  it('accepts whole numbers from 1 to 32767 only', () => {
    expect(isValidCapacity(1)).toBe(true)
    expect(isValidCapacity(32767)).toBe(true)
    for (const value of [0, 32768, 1.5, null, undefined, '10']) expect(isValidCapacity(value)).toBe(false)
  })
})
