import { describe, expect, it } from 'vitest'
import { makeGradeScheme, THREE_GRADE_SCHEMES } from '../test/gradeSchemes'
import {
  bandListIssues,
  buildCreateGradeSchemeInput,
  deactivateRefusalOf,
  deleteBlockerOf,
  emptyBand,
  gradeSchemeFormHasChanges,
  gradeSchemeFormValuesOf,
  isValidMinPercent,
  newGradeSchemeForm,
  planGradeSchemePatch,
  promoteSchemeBody,
} from './gradeSchemes.form'
import type { BandFormValues, GradeSchemeFormValues } from './gradeSchemes.form'

const OLD = () => THREE_GRADE_SCHEMES()[2]!

describe('gradeSchemeFormValuesOf / newGradeSchemeForm', () => {
  it('loads the bands in the server order, a blank letter for none, and keeps a Turkish label in a hidden field of its band', () => {
    const values = gradeSchemeFormValuesOf(OLD())
    expect(values.nameAr).toBe('السلّم القديم')
    expect(values.nameEn).toBe('')
    expect(values.bands).toEqual([
      { minPercent: 0, labelAr: 'ضعيف', labelEn: '', labelTr: 'Zayıf', letter: 'E', isPass: false },
      { minPercent: 65.5, labelAr: 'متوسط', labelEn: '', labelTr: 'Orta', letter: 'C', isPass: true },
    ])
    expect(gradeSchemeFormValuesOf(THREE_GRADE_SCHEMES()[1]!).bands[0]).toEqual({ minPercent: 0, labelAr: 'لم ينجح', labelEn: '', letter: '', isPass: false })
  })

  it('starts a new scheme with a failing band at 0 and a passing one, and adds a band without a minimum that fails', () => {
    expect(newGradeSchemeForm().bands.map((band) => [band.minPercent, band.isPass])).toEqual([
      [0, false],
      [60, true],
    ])
    // A fresh object every time: one session's edits never leak into the next (KI-049).
    expect(newGradeSchemeForm()).not.toBe(newGradeSchemeForm())
    expect(emptyBand()).toEqual({ minPercent: null, labelAr: '', labelEn: '', letter: '', isPass: false })
  })
})

describe('isValidMinPercent (IsNumber maxDecimalPlaces 2, Min 0, Max 100)', () => {
  it('accepts 0..100 with at most two decimals, and nothing that is not a finite JSON number', () => {
    for (const value of [0, 100, 59.99, 33.5, 60]) expect(isValidMinPercent(value)).toBe(true)
    for (const value of [-1, 100.01, 60.123, Number.NaN, Number.POSITIVE_INFINITY, '60', null, undefined]) expect(isValidMinPercent(value)).toBe(false)
  })
})

const filled = (over: Partial<GradeSchemeFormValues> = {}): GradeSchemeFormValues => ({
  nameAr: '  سلّم الفصل  ',
  nameEn: ' ',
  bands: [
    { minPercent: 75, labelAr: ' جيد ', labelEn: 'Good', letter: ' B ', isPass: true },
    { minPercent: 0, labelAr: 'راسب', labelEn: '', letter: '  ', isPass: false },
    { minPercent: 50, labelAr: 'مقبول', labelEn: '', letter: '', isPass: true },
  ],
  isDefault: false,
  ...over,
})

describe('buildCreateGradeSchemeInput', () => {
  it('trims the texts, drops a blank English text and a blank letter, and sends the bands ascending', () => {
    expect(buildCreateGradeSchemeInput(filled(), false)).toEqual({
      name: { ar: 'سلّم الفصل' },
      bands: [
        { minPercent: 0, label: { ar: 'راسب' }, isPass: false },
        { minPercent: 50, label: { ar: 'مقبول' }, isPass: true },
        { minPercent: 75, label: { ar: 'جيد', en: 'Good' }, letter: 'B', isPass: true },
      ],
    })
  })

  it('sends isDefault only when it is on and the academy already has a scheme (the first one becomes the default anyway)', () => {
    expect(buildCreateGradeSchemeInput(filled({ isDefault: true }), false).isDefault).toBe(true)
    expect(buildCreateGradeSchemeInput(filled({ isDefault: true }), true)).not.toHaveProperty('isDefault')
    expect(buildCreateGradeSchemeInput(filled({ isDefault: false }), false)).not.toHaveProperty('isDefault')
  })
})

describe('planGradeSchemePatch', () => {
  it('sends nothing for the loaded values, nor for the same bands in another order', () => {
    const scheme = makeGradeScheme()
    const values = gradeSchemeFormValuesOf(scheme)
    expect(planGradeSchemePatch(scheme, values)).toBeNull()
    expect(planGradeSchemePatch(scheme, { ...values, bands: [...values.bands].reverse() })).toBeNull()
    expect(planGradeSchemePatch(OLD(), gradeSchemeFormValuesOf(OLD()))).toBeNull()
  })

  it('sends the name alone when only the name changed — whole, with the Turkish text the form does not show', () => {
    const values = { ...gradeSchemeFormValuesOf(OLD()), nameEn: 'Old scale' }
    expect(planGradeSchemePatch(OLD(), values)).toEqual({ name: { ar: 'السلّم القديم', en: 'Old scale', tr: 'Eski ölçek' } })
  })

  it('sends the bands as a whole ascending list when one band changed, each keeping its Turkish label; a cleared letter is dropped', () => {
    const values = gradeSchemeFormValuesOf(OLD())
    const bands: BandFormValues[] = [{ ...values.bands[1]!, letter: '' }, values.bands[0]!, { minPercent: 90, labelAr: 'ممتاز', labelEn: '', letter: 'A', isPass: true }]
    expect(planGradeSchemePatch(OLD(), { ...values, bands })).toEqual({
      bands: [
        { minPercent: 0, label: { ar: 'ضعيف', tr: 'Zayıf' }, letter: 'E', isPass: false },
        { minPercent: 65.5, label: { ar: 'متوسط', tr: 'Orta' }, isPass: true },
        { minPercent: 90, label: { ar: 'ممتاز' }, letter: 'A', isPass: true },
      ],
    })
  })
})

describe('gradeSchemeFormHasChanges', () => {
  it('tells a new scheme off its start, and an edit that would send something or empties the name', () => {
    expect(gradeSchemeFormHasChanges(null, newGradeSchemeForm())).toBe(false)
    expect(gradeSchemeFormHasChanges(null, { ...newGradeSchemeForm(), nameAr: '  ' })).toBe(false)
    expect(gradeSchemeFormHasChanges(null, { ...newGradeSchemeForm(), nameAr: 'س' })).toBe(true)
    expect(gradeSchemeFormHasChanges(null, { ...newGradeSchemeForm(), bands: [...newGradeSchemeForm().bands, emptyBand()] })).toBe(true)
    expect(gradeSchemeFormHasChanges(null, { ...newGradeSchemeForm(), isDefault: true })).toBe(true)

    const scheme = makeGradeScheme()
    const values = gradeSchemeFormValuesOf(scheme)
    expect(gradeSchemeFormHasChanges(scheme, values)).toBe(false)
    expect(gradeSchemeFormHasChanges(scheme, { ...values, nameAr: '' })).toBe(true)
    expect(gradeSchemeFormHasChanges(scheme, { ...values, bands: values.bands.map((band, index) => (index === 0 ? { ...band, minPercent: null } : band)) })).toBe(true)
  })
})

describe('bandListIssues', () => {
  const bands = (...rows: [number | null, boolean][]): BandFormValues[] => rows.map(([minPercent, isPass]) => ({ minPercent, labelAr: 'ش', isPass }))

  it('asks for 2..20 bands first', () => {
    expect(bandListIssues(bands([0, true]))).toEqual([{ key: 'gradeSchemes.validation.bandsMin', params: { min: '2' } }])
    expect(bandListIssues(undefined)).toEqual([{ key: 'gradeSchemes.validation.bandsMin', params: { min: '2' } }])
    const many = Array.from({ length: 21 }, (_, index) => [index, true] as [number, boolean])
    expect(bandListIssues(bands(...many))).toEqual([{ key: 'gradeSchemes.validation.bandsMax', params: { max: '20' } }])
  })

  it('leaves the server rules to a list whose every minimum is valid (a missing or malformed one is its field’s message)', () => {
    expect(bandListIssues(bands([null, false], [60, true]))).toEqual([])
    expect(bandListIssues(bands([0.123, false], [60, true]))).toEqual([])
  })

  it('reports each broken server rule under its key, the repeated minimums listed', () => {
    expect(bandListIssues(bands([0, false], [60, true]))).toEqual([])
    expect(bandListIssues(bands([10, false], [60, true]))).toEqual([{ key: 'gradeSchemes.validation.no_zero_band' }])
    expect(bandListIssues(bands([0, false], [60, true], [60, true], [70.5, true], [70.5, true]))).toEqual([
      { key: 'gradeSchemes.validation.duplicate_min_percent', params: { duplicates: '60, 70.5' } },
    ])
    expect(bandListIssues(bands([0, false], [50, false]))).toEqual([{ key: 'gradeSchemes.validation.no_passing_band' }])
    expect(bandListIssues(bands([80, false], [0, false], [50, true]))).toEqual([{ key: 'gradeSchemes.validation.pass_not_ascending' }])
  })
})

describe('row actions', () => {
  it('promotes an active scheme alone and activates an inactive one in the same request', () => {
    expect(promoteSchemeBody({ isActive: true })).toEqual({ isDefault: true })
    expect(promoteSchemeBody({ isActive: false })).toEqual({ isDefault: true, isActive: true })
  })

  it('refuses deactivating the default (the mirror’s `deactivate`) and nothing else', () => {
    const [main, passFail, old] = THREE_GRADE_SCHEMES()
    expect(deactivateRefusalOf(main!)).toBe('deactivate')
    expect(deactivateRefusalOf(passFail!)).toBeNull()
    expect(deactivateRefusalOf(old!)).toBeNull()
  })

  it('blocks deleting the default first, then a scheme final grades use; an unknown count leaves it to the server', () => {
    const [main, passFail, old] = THREE_GRADE_SCHEMES()
    expect(deleteBlockerOf(main!)).toBe('default')
    expect(deleteBlockerOf({ ...main!, finalGradeCount: 0 })).toBe('default')
    expect(deleteBlockerOf(old!)).toBe('in_use')
    expect(deleteBlockerOf(passFail!)).toBeNull()
    expect(deleteBlockerOf({ ...passFail!, finalGradeCount: null })).toBeNull()
  })
})
