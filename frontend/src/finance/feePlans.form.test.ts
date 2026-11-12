import { describe, expect, it } from 'vitest'
import { CLASS_COURSE_ID } from '../test/classes'
import { makeCoursePlan, makeFeePlan } from '../test/feePlans'
import {
  buildCreateFeePlanInput,
  evenShares,
  feePlanFormHasChanges,
  feePlanFormProblems,
  feePlanFormValuesOf,
  localizedOf,
  newFeePlanForm,
  planFeePlanPatch,
  planLinesTotalCents,
} from './feePlans.form'
import { changedPlanFields, checkPlan, percentSum } from './feePlans.rules'

describe('fee plan rules — the mirror of checkPlan()/planFeePlanUpdate() (backend/src/finance/fee-plans.rules.ts)', () => {
  it('reports the problems in the server’s order: course and class, the sum of the shares, the offsets', () => {
    expect(checkPlan({ courseId: null, classId: null, installments: [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 30 }] })).toEqual([])
    expect(checkPlan({ courseId: 'c', classId: 'k', installments: [{ percent: 60, dueOffsetDays: 30 }, { percent: 30, dueOffsetDays: 0 }] })).toEqual(['course_and_class', 'percent_sum', 'offsets_not_ascending'])
    // Two shares on the same day are fine (non-decreasing — the plan's own deviation, §4i.5 T02).
    expect(checkPlan({ courseId: null, classId: null, installments: [{ percent: 33.33, dueOffsetDays: 0 }, { percent: 33.33, dueOffsetDays: 0 }, { percent: 33.34, dueOffsetDays: 10 }] })).toEqual([])
  })

  it('sums the shares in cents (33.33 + 33.33 + 33.34 = 100 exactly)', () => {
    expect(percentSum([33.33, 33.33, 33.34])).toBe(100)
    expect(percentSum([50, null])).toBeNull()
  })

  it('compares the localized texts and amounts the way the server does (blank locales are absent)', () => {
    const plan = makeFeePlan()
    const current = { name: plan.name, courseId: null, classId: plan.class!.id, lines: plan.lines, installments: plan.installments }
    expect(changedPlanFields(current, { ...current })).toEqual([])
    expect(changedPlanFields(current, { ...current, name: { ar: plan.name.ar, en: plan.name.en } })).toEqual([])
    expect(changedPlanFields(current, { ...current, lines: [{ ...plan.lines[0]!, amount: 1000.0 }, plan.lines[1]!] })).toEqual([])
    expect(changedPlanFields(current, { ...current, classId: null, courseId: CLASS_COURSE_ID })).toEqual(['courseId', 'classId'])
  })
})

describe('the fee plan form', () => {
  it('drops the blank optional locales and trims the texts', () => {
    expect(localizedOf('  رسوم  ', ' ', undefined)).toEqual({ ar: 'رسوم' })
    expect(localizedOf('رسوم', 'Fee ', 'Ücret')).toEqual({ ar: 'رسوم', en: 'Fee', tr: 'Ücret' })
  })

  it('creates a plan with the course or the class of its scope only', () => {
    const values = { ...newFeePlanForm(), nameAr: 'خطة', scope: 'course' as const, courseId: CLASS_COURSE_ID, classId: 'left-from-another-scope', lines: [{ descriptionAr: 'رسوم', amount: 500 }] }
    expect(buildCreateFeePlanInput(values)).toEqual({ name: { ar: 'خطة' }, courseId: CLASS_COURSE_ID, lines: [{ description: { ar: 'رسوم' }, amount: 500 }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
    expect(buildCreateFeePlanInput({ ...values, scope: 'general' })).not.toHaveProperty('courseId')
  })

  it('sends the smallest PATCH — whole lines or shares when they differ — and nothing when nothing changed', () => {
    const plan = makeFeePlan()
    const values = feePlanFormValuesOf(plan)
    expect(planFeePlanPatch(plan, values)).toBeNull()
    expect(planFeePlanPatch(plan, { ...values, nameEn: '  Python fees — class A ' })).toBeNull()
    expect(planFeePlanPatch(plan, { ...values, installments: [{ percent: 40, dueOffsetDays: 0 }, { percent: 60, dueOffsetDays: 30 }] })).toEqual({
      installments: [
        { percent: 40, dueOffsetDays: 0 },
        { percent: 60, dueOffsetDays: 30 },
      ],
    })
    // Another scope clears the old target and sets the new one.
    expect(planFeePlanPatch(plan, { ...values, scope: 'course', courseId: CLASS_COURSE_ID })).toEqual({ courseId: CLASS_COURSE_ID, classId: null })
    expect(planFeePlanPatch(makeCoursePlan(), { ...feePlanFormValuesOf(makeCoursePlan()), scope: 'general' })).toEqual({ courseId: null })
  })

  it('counts unsaved work the way the planner reads the form: a change changed back holds nothing, an emptied field holds something', () => {
    const initial = feePlanFormValuesOf(makeFeePlan())
    expect(feePlanFormHasChanges(initial, { ...initial })).toBe(false)
    expect(feePlanFormHasChanges(initial, { ...initial, nameAr: `${initial.nameAr} ` })).toBe(false)
    expect(feePlanFormHasChanges(initial, { ...initial, lines: [{ ...initial.lines![0]!, amount: null }, initial.lines![1]!] })).toBe(true)
    expect(feePlanFormHasChanges(newFeePlanForm(), { ...newFeePlanForm(), scope: 'class' })).toBe(true)
  })

  it('checks the share rules once every share is valid, totals the lines and splits the shares evenly', () => {
    expect(feePlanFormProblems({ installments: [{ percent: 60, dueOffsetDays: 30 }, { percent: 30, dueOffsetDays: 0 }] })).toEqual(['percent_sum', 'offsets_not_ascending'])
    expect(feePlanFormProblems({ installments: [{ percent: null, dueOffsetDays: 0 }] })).toEqual([])
    expect(planLinesTotalCents(feePlanFormValuesOf(makeFeePlan()))).toBe(120000)
    expect(planLinesTotalCents({ lines: [{ amount: 10 }, { amount: null }] })).toBeNull()
    expect(evenShares([{ percent: 10, dueOffsetDays: 0 }, { percent: null, dueOffsetDays: 30 }, { dueOffsetDays: 60 }])).toEqual([
      { percent: 33.33, dueOffsetDays: 0 },
      { percent: 33.33, dueOffsetDays: 30 },
      { percent: 33.34, dueOffsetDays: 60 },
    ])
  })
})
