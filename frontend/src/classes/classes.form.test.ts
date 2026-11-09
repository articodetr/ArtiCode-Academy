import { describe, expect, it } from 'vitest'
import { makeClass } from '../test/classes'
import { CLASS_CODE_PATTERN, buildCreateClassInput, classFormHasChanges, classFormValuesOf, invalidDateRange, normaliseClassCode, planClassPatch } from './classes.form'

describe('classes.form', () => {
  it('normalises codes like the server and mirrors its pattern', () => {
    expect(normaliseClassCode('  py-101-a ')).toBe('PY-101-A')
    expect(CLASS_CODE_PATTERN.test('PY-101-A')).toBe(true)
    expect(CLASS_CODE_PATTERN.test('PY 101')).toBe(false)
    expect(CLASS_CODE_PATTERN.test('-PY')).toBe(false)
    expect(CLASS_CODE_PATTERN.test('A'.repeat(33))).toBe(false)
  })

  it('refuses an end date before the start date only when both are set', () => {
    expect(invalidDateRange('2026-11-10', '2026-11-09')).toBe(true)
    expect(invalidDateRange('2026-11-10', '2026-11-10')).toBe(false)
    expect(invalidDateRange('', '2026-11-09')).toBe(false)
    expect(invalidDateRange('2026-11-10', undefined)).toBe(false)
  })

  it('builds the create body with what was filled in only (blank dates and notes left out)', () => {
    expect(buildCreateClassInput({ courseId: 'c-1', code: ' py-a ', nameAr: ' الفصل أ ', nameEn: '', capacity: 12, startsOn: '', endsOn: '', notes: '   ' })).toEqual({
      courseId: 'c-1',
      code: 'PY-A',
      name: { ar: 'الفصل أ' },
      capacity: 12,
    })
    expect(buildCreateClassInput({ courseId: 'c-1', code: 'PY-A', nameAr: 'أ', nameEn: 'A', capacity: 5, startsOn: '2026-11-10', endsOn: '2026-12-20', notes: ' مسائي ' })).toEqual({
      courseId: 'c-1',
      code: 'PY-A',
      name: { ar: 'أ', en: 'A' },
      capacity: 5,
      startsOn: '2026-11-10',
      endsOn: '2026-12-20',
      notes: 'مسائي',
    })
  })

  it('plans nothing when the form holds what the server holds', () => {
    const cls = makeClass({ notes: 'ملاحظة' })
    expect(planClassPatch(cls, classFormValuesOf(cls))).toBeNull()
  })

  it('plans the smallest PATCH: changed fields only, cleared dates and notes as null, the Turkish name kept', () => {
    const cls = makeClass({ name: { ar: 'أ', en: 'A', tr: 'A-tr' }, notes: 'ملاحظة' })
    const values = { ...classFormValuesOf(cls), code: 'py-101-b', nameEn: 'A2', capacity: 30, startsOn: '', notes: '  ' }
    expect(planClassPatch(cls, values)).toEqual({
      code: 'PY-101-B',
      name: { ar: 'أ', en: 'A2', tr: 'A-tr' },
      capacity: 30,
      startsOn: null,
      notes: null,
    })
  })

  it('sets a date that was empty and never sends the course', () => {
    const cls = makeClass({ startsOn: null, endsOn: null })
    const body = planClassPatch(cls, { ...classFormValuesOf(cls), courseId: 'other', endsOn: '2027-01-31' })
    expect(body).toEqual({ endsOn: '2027-01-31' })
  })
  it('counts a field holding anything else than the class value as a change, a field changed back as none (J-F21, KI-052)', () => {
    const cls = makeClass({ notes: 'مسائي' })
    const initial = classFormValuesOf(cls)
    expect(classFormHasChanges(cls, initial)).toBe(false)
    expect(classFormHasChanges(cls, { ...initial, capacity: 25 })).toBe(true)
    expect(classFormHasChanges(cls, { ...initial, notes: 'صباحي' })).toBe(true)
    // Changed back to the class value: nothing to lose.
    expect(classFormHasChanges(cls, { ...initial, capacity: cls.capacity })).toBe(false)
    // Unsaved even while invalid or blank: the user is typing.
    expect(classFormHasChanges(cls, { ...initial, nameAr: '' })).toBe(true)
    expect(classFormHasChanges(cls, { ...initial, capacity: null })).toBe(true)
    // An empty optional input may come back undefined: still the class's own (empty) value.
    const bare = makeClass({ name: { ar: 'فصل' }, notes: null, startsOn: null, endsOn: null })
    expect(classFormHasChanges(bare, { ...classFormValuesOf(bare), nameEn: undefined, notes: undefined, startsOn: undefined })).toBe(false)
  })

  it('compares the capacity as a number: the same number is clean, another number or an emptied input is unsaved (PR #74 review)', () => {
    // The InputNumber hands the form a number (null once emptied); the class holds a number (AcademyClass.capacity).
    const cls = makeClass({ capacity: 20 })
    const initial = classFormValuesOf(cls)
    expect(initial.capacity).toBe(20)
    expect(classFormHasChanges(cls, { ...initial, capacity: 20 })).toBe(false)
    expect(classFormHasChanges(cls, { ...initial, capacity: 21 })).toBe(true)
    // 0 is a number like any other, not an empty input.
    expect(classFormHasChanges(cls, { ...initial, capacity: 0 })).toBe(true)
    expect(classFormHasChanges(cls, { ...initial, capacity: null })).toBe(true)
    expect(classFormHasChanges(cls, { ...initial, capacity: undefined })).toBe(true)
  })
})
