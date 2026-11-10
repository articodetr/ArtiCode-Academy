// The mirror of backend/src/grades/grade-schemes.changes.ts must answer as the server does:
// the cases of its spec (TEST-128) run here too.
import { describe, expect, it } from 'vitest'
import { defaultBands } from '../test/gradeSchemes'
import { checkBands, GRADE_SCHEME_PROBLEMS, percentText, planGradeSchemeUpdate, sameBands, sortBands } from './gradeSchemes.changes'
import type { CurrentScheme, SchemeBand } from './gradeSchemes.changes'

const band = (min: number, isPass: boolean, ar = `≥${min}`, letter: string | null = null): SchemeBand => ({ minPercent: percentText(min), label: { ar }, letter, isPass })
const DEFAULT: SchemeBand[] = defaultBands().map((b) => ({ minPercent: percentText(b.minPercent), label: b.label, letter: b.letter, isPass: b.isPass }))

describe('checkBands (mirror of grade-schemes.changes.ts)', () => {
  it('accepts the default scheme and any order of valid bands', () => {
    expect(checkBands(DEFAULT)).toEqual({ problems: [], duplicates: [] })
    expect(checkBands([band(60, true), band(0, false)])).toEqual({ problems: [], duplicates: [] })
    expect(checkBands([band(0, true), band(50, true)])).toEqual({ problems: [], duplicates: [] }) // everyone passes
  })

  it('needs a band at 0, distinct minimums, a passing band and passing bands only above the first one — in the server order', () => {
    expect(checkBands([band(10, false), band(60, true)]).problems).toEqual(['no_zero_band'])
    expect(checkBands([band(0, false), band(60, true), band(60, true)])).toEqual({ problems: ['duplicate_min_percent'], duplicates: [60] })
    expect(checkBands([band(0, false), band(50, false)]).problems).toEqual(['no_passing_band'])
    expect(checkBands([band(0, false), band(50, true), band(80, false)]).problems).toEqual(['pass_not_ascending'])
    expect(checkBands([band(5, false), band(5, false)]).problems).toEqual(['no_zero_band', 'duplicate_min_percent', 'no_passing_band'])
    // Minimums are compared as numeric(5,2) text: 60 and 60.00 are the same minimum.
    expect(checkBands([band(0, false), { ...band(60, true), minPercent: percentText('60.00') }, band(60, true)]).duplicates).toEqual([60])
    expect(GRADE_SCHEME_PROBLEMS).toEqual(['no_zero_band', 'duplicate_min_percent', 'no_passing_band', 'pass_not_ascending'])
  })
})

describe('sameBands / sortBands', () => {
  it('sorts by minimum and compares every field of a band in canonical order', () => {
    expect(sortBands([band(70, true), band(0, false), band(33.5, false)]).map((b) => b.minPercent)).toEqual(['0.00', '33.50', '70.00'])
    expect(sameBands([band(60, true), band(0, false)], [band(0, false), band(60, true)])).toBe(true)
    expect(sameBands([band(0, false), band(60, true, 'ناجح', 'P')], [band(0, false), band(60, true, 'ناجح', null)])).toBe(false)
    expect(sameBands([band(0, false), band(60, true)], [band(0, false), band(60, false)])).toBe(false)
    expect(sameBands([band(0, false)], [band(0, false), band(60, true)])).toBe(false)
    // An absent locale equals a missing one; a Turkish text is part of the label.
    expect(sameBands([{ ...band(0, true), label: { ar: 'أ', en: 'A' } }], [{ ...band(0, true), label: { ar: 'أ', en: 'A' } }])).toBe(true)
    expect(sameBands([{ ...band(0, true), label: { ar: 'أ', tr: 'A' } }], [{ ...band(0, true), label: { ar: 'أ' } }])).toBe(false)
  })
})

describe('planGradeSchemeUpdate (mirror)', () => {
  const scheme = (over: Partial<CurrentScheme> = {}): CurrentScheme => ({ name: { ar: 'سلّم' }, isDefault: false, isActive: true, bands: [band(0, false), band(60, true)], ...over })

  it('writes nothing for the same values, bands compared in canonical order', () => {
    expect(planGradeSchemeUpdate(scheme(), { name: { ar: 'سلّم' }, bands: [band(60, true), band(0, false)], isActive: true })).toEqual({ fields: [], promotes: false })
  })

  it('plans the changed fields, the bands sorted, and a promotion', () => {
    const plan = planGradeSchemeUpdate(scheme(), { name: { ar: 'جديد', en: 'New' }, bands: [band(70, true), band(0, false)], isDefault: true })
    expect(plan.fields).toEqual(['name', 'bands', 'isDefault'])
    expect(plan.promotes).toBe(true)
    expect(plan.bands!.map((b) => b.minPercent)).toEqual(['0.00', '70.00'])
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isDefault: true })).toEqual({ fields: [], promotes: false }) // already the default
    expect(planGradeSchemeUpdate(scheme(), { isDefault: false })).toEqual({ fields: [], promotes: false }) // not the default: nothing to do
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isActive: true })).toMatchObject({ fields: ['isActive'], isActive: true })
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isDefault: true, isActive: true })).toMatchObject({ fields: ['isDefault', 'isActive'], promotes: true })
  })

  it('keeps one active default: refuses unsetting, deactivating it and promoting an inactive scheme', () => {
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isDefault: false }).refusal).toBe('unset_default')
    expect(planGradeSchemeUpdate(scheme({ isDefault: true }), { isActive: false }).refusal).toBe('deactivate')
    expect(planGradeSchemeUpdate(scheme({ isActive: false }), { isDefault: true }).refusal).toBe('promote_inactive')
    expect(planGradeSchemeUpdate(scheme(), { isDefault: true, isActive: false }).refusal).toBe('promote_inactive')
  })
})
