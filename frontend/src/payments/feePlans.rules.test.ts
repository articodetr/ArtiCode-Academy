import { describe, expect, it } from 'vitest'
import { makeFeePlan } from '../test/payments'
import { buildCreateFeePlanInput, checkPlan, checkPlanValues, evenShares, feePlanFormValues, firstDescendingOffset, planFeePlanPatch, planFits, sharesTotal } from './feePlans.rules'

describe('fee plan rules (mirror of fee-plans.rules.ts)', () => {
  it('accepts shares summing to exactly 100 in cents and non-decreasing offsets', () => {
    expect(checkPlan({ courseId: null, classId: null, installments: [{ percent: 33.33, dueOffsetDays: 0 }, { percent: 33.33, dueOffsetDays: 30 }, { percent: 33.34, dueOffsetDays: 30 }] })).toEqual([])
  })

  it('reports every broken rule in the server order', () => {
    expect(checkPlan({ courseId: 'c', classId: 'k', installments: [{ percent: 60, dueOffsetDays: 30 }, { percent: 30, dueOffsetDays: 10 }] })).toEqual([
      'course_and_class',
      'percent_sum',
      'offsets_not_ascending',
    ])
    expect(firstDescendingOffset([{ dueOffsetDays: 0 }, { dueOffsetDays: 30 }, { dueOffsetDays: 10 }])).toBe(2)
    expect(sharesTotal([{ percent: 60 }, { percent: 30.5 }])).toBe(90.5)
  })

  it('splits equal shares with the remainder on the last', () => {
    expect(evenShares(3)).toEqual([33.33, 33.33, 33.34])
    expect(evenShares(0)).toEqual([])
  })

  it('builds the API-141 body with the chosen scope only', () => {
    const values = {
      nameAr: ' رسوم ',
      nameEn: '',
      scope: 'course' as const,
      courseId: 'course-1',
      classId: 'class-stale',
      lines: [{ descriptionAr: 'الدورة', descriptionEn: ' Course ', amount: 900 }],
      installments: [{ percent: 100, dueOffsetDays: 0 }],
    }
    expect(checkPlanValues(values)).toEqual([])
    expect(buildCreateFeePlanInput(values)).toEqual({
      name: { ar: 'رسوم' },
      courseId: 'course-1',
      lines: [{ description: { ar: 'الدورة', en: 'Course' }, amount: 900 }],
      installments: [{ percent: 100, dueOffsetDays: 0 }],
    })
  })

  it('sends the smallest PATCH and nothing for unchanged values', () => {
    const plan = makeFeePlan({ name: { ar: 'رسوم', tr: 'Ücret' } })
    const same = feePlanFormValues(plan)
    expect(planFeePlanPatch(plan, same)).toEqual({})
    expect(planFeePlanPatch(plan, { ...same, nameEn: 'Fees', scope: 'class', classId: 'k-1' })).toEqual({ name: { ar: 'رسوم', en: 'Fees', tr: 'Ücret' }, classId: 'k-1' })
    const shares = [{ percent: 40, dueOffsetDays: 0 }, { percent: 60, dueOffsetDays: 30 }]
    expect(planFeePlanPatch(plan, { ...same, installments: shares })).toEqual({ installments: shares })
  })

  it('fits a plan to a class like planFits()', () => {
    const target = { classId: 'k', courseId: 'c' }
    expect(planFits(makeFeePlan(), target)).toBe(true)
    expect(planFits(makeFeePlan({ course: { id: 'c', code: 'C', name: { ar: 'د' } } }), target)).toBe(true)
    expect(planFits(makeFeePlan({ class: { id: 'other', code: 'O', name: { ar: 'ف' } } }), target)).toBe(false)
  })
})
