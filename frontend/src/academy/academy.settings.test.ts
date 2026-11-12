import { describe, expect, it } from 'vitest'
import {
  exampleSerial,
  isSerialPrefixInput,
  isWeekday,
  normaliseSerialPrefix,
  normaliseWorkingDays,
  orderedWeekdays,
  planCertificatesPatch,
  planSchedulingPatch,
  sameDays,
  schedulingFormValuesOf,
  serialPrefixOf,
} from './academy.settings'

const UNSET = { weekStartsOn: null, workingDays: null }

describe('weekday helpers', () => {
  it('accepts the integers 0–6 only, as the server schema does', () => {
    expect([0, 3, 6].every(isWeekday)).toBe(true)
    expect([-1, 7, 1.5, '6', null, undefined].some(isWeekday)).toBe(false)
  })

  it('normalises the working days like the server: distinct, ascending, nothing left → null', () => {
    expect(normaliseWorkingDays([4, 0, 2, 0])).toEqual([0, 2, 4])
    expect(normaliseWorkingDays([7, -1, 1.5, 3])).toEqual([3])
    expect(normaliseWorkingDays([])).toBeNull()
    expect(normaliseWorkingDays(undefined)).toBeNull()
    expect(sameDays([0, 1], [0, 1])).toBe(true)
    expect(sameDays([0, 1], [0, 2])).toBe(false)
    expect(sameDays(null, [0])).toBe(false)
    expect(sameDays(null, null)).toBe(true)
  })

  it('orders the seven days from the first day of the week, Sunday while it is not set', () => {
    expect(orderedWeekdays(undefined)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(orderedWeekdays(6)).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('shows a key that is not set as an empty choice in the form', () => {
    expect(schedulingFormValuesOf(UNSET)).toEqual({ weekStartsOn: undefined, workingDays: [] })
    expect(schedulingFormValuesOf({ weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] })).toEqual({ weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] })
  })
})

describe('planSchedulingPatch', () => {
  it('returns null when nothing differs, also for the same days checked in another order', () => {
    expect(planSchedulingPatch(UNSET, { weekStartsOn: undefined, workingDays: [] })).toBeNull()
    expect(planSchedulingPatch({ weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] }, { weekStartsOn: 6, workingDays: [4, 3, 2, 1, 0] })).toBeNull()
  })

  it('sends only the key that changed', () => {
    expect(planSchedulingPatch(UNSET, { weekStartsOn: 6, workingDays: [] })).toEqual({ weekStartsOn: 6 })
    expect(planSchedulingPatch({ weekStartsOn: 6, workingDays: null }, { weekStartsOn: 6, workingDays: [4, 0, 1] })).toEqual({ workingDays: [0, 1, 4] })
  })

  it('clears a key with null: a cleared select or no day checked', () => {
    expect(planSchedulingPatch({ weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] }, { weekStartsOn: undefined, workingDays: [] })).toEqual({
      weekStartsOn: null,
      workingDays: null,
    })
  })
})

describe('certificate prefix (J-F51 — mirror of serialPrefixSchema, D-R51)', () => {
  it('accepts a blank field (the default CERT) or 2–10 upper-case letters or digits once trimmed and upper-cased', () => {
    expect(normaliseSerialPrefix(' aca ')).toBe('ACA')
    expect(normaliseSerialPrefix(undefined)).toBe('')
    for (const value of ['', '  ', 'AC', 'aca', 'ACA2026', 'ABCDEFGHIJ']) expect(isSerialPrefixInput(value)).toBe(true)
    for (const value of ['A', 'ABCDEFGHIJK', 'AC-1', 'A C', 'ÄCA', 'ACA_']) expect(isSerialPrefixInput(value)).toBe(false)
  })

  it('reads the stored prefix defensively: a missing domain or a value the schema refuses reads as not set', () => {
    expect(serialPrefixOf({ scheduling: UNSET, certificates: { serialPrefix: 'ACA' } })).toBe('ACA')
    expect(serialPrefixOf({ scheduling: UNSET, certificates: { serialPrefix: null } })).toBeNull()
    expect(serialPrefixOf({ scheduling: UNSET })).toBeNull()
    expect(serialPrefixOf({ certificates: { serialPrefix: 'aca' } })).toBeNull()
    expect(serialPrefixOf({ certificates: 'ACA' })).toBeNull()
    expect(serialPrefixOf(null)).toBeNull()
  })

  it('plans the smallest settings.certificates patch: unchanged → null, a new prefix upper-cased, a blank one clears it', () => {
    expect(planCertificatesPatch(null, '')).toBeNull()
    expect(planCertificatesPatch('ACA', ' aca')).toBeNull()
    expect(planCertificatesPatch(null, 'aca')).toEqual({ serialPrefix: 'ACA' })
    expect(planCertificatesPatch('ACA', 'ART')).toEqual({ serialPrefix: 'ART' })
    expect(planCertificatesPatch('ACA', '  ')).toEqual({ serialPrefix: null })
    expect(planCertificatesPatch('ACA', undefined)).toBeNull()
  })

  it('shows the first serial of a year with the typed prefix, the default one until it is valid', () => {
    expect(exampleSerial('aca', 2026)).toBe('ACA-2026-00001')
    expect(exampleSerial('', 2026)).toBe('CERT-2026-00001')
    expect(exampleSerial('A', 2027)).toBe('CERT-2027-00001')
  })
})
