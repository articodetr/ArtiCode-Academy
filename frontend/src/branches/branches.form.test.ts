import { describe, expect, it } from 'vitest'
import { makeBranch } from '../test/branches'
import {
  BRANCH_CODE_PATTERN,
  branchFormValuesOf,
  buildCreateBranchInput,
  EMPTY_BRANCH_FORM,
  mainInactiveReason,
  normaliseBranchCode,
  planBranchPatch,
  promoteBranchBody,
} from './branches.form'

describe('branches.form (MOD-02-T06 screen)', () => {
  it('mirrors the server code rule: trimmed, upper-cased, 1–16 of the level alphabet', () => {
    expect(normaliseBranchCode('  north-1 ')).toBe('NORTH-1')
    expect(BRANCH_CODE_PATTERN.test('NORTH-1')).toBe(true)
    expect(BRANCH_CODE_PATTERN.test('A'.repeat(16))).toBe(true)
    expect(BRANCH_CODE_PATTERN.test('A'.repeat(17))).toBe(false)
    expect(BRANCH_CODE_PATTERN.test('-NORTH')).toBe(false)
    expect(BRANCH_CODE_PATTERN.test('NO RTH')).toBe(false)
  })

  it('builds the smallest create body: only the filled fields, flags only when they differ from the server defaults', () => {
    expect(buildCreateBranchInput({ ...EMPTY_BRANCH_FORM, code: ' west ', nameAr: ' الفرع الغربي ' })).toEqual({ code: 'WEST', name: { ar: 'الفرع الغربي' } })
    expect(
      buildCreateBranchInput({
        code: 'WEST',
        nameAr: 'الفرع الغربي',
        nameEn: 'West branch',
        addressAr: 'جدة',
        addressEn: 'Jeddah',
        phone: ' +966500000001 ',
        timezone: 'Asia/Riyadh',
        isMain: true,
        isActive: false,
      }),
    ).toEqual({
      code: 'WEST',
      name: { ar: 'الفرع الغربي', en: 'West branch' },
      address: { ar: 'جدة', en: 'Jeddah' },
      phone: '+966500000001',
      timezone: 'Asia/Riyadh',
      isMain: true,
      isActive: false,
    })
    // English without Arabic is not an address (the form refuses it anyway).
    expect(buildCreateBranchInput({ ...EMPTY_BRANCH_FORM, code: 'W', nameAr: 'غ', addressEn: 'Jeddah' })).toEqual({ code: 'W', name: { ar: 'غ' } })
  })

  it('round-trips a loaded branch into form values and plans nothing when they come back unchanged', () => {
    const branch = makeBranch({ timezone: 'Europe/Istanbul' })
    const values = branchFormValuesOf(branch)
    expect(values).toEqual({
      code: 'MAIN',
      nameAr: 'الفرع الرئيسي',
      nameEn: 'Main branch',
      addressAr: 'شارع الملك فهد، الرياض',
      addressEn: 'King Fahd Road, Riyadh',
      phone: '+966500000000',
      timezone: 'Europe/Istanbul',
      isMain: true,
      isActive: true,
    })
    expect(planBranchPatch(branch, values)).toBeNull()
    expect(planBranchPatch(branch, { ...values, code: ' main ', nameEn: ' Main branch ', phone: ' +966500000000 ' })).toBeNull()
  })

  it('plans the smallest PATCH: changed fields only, null clears the address, phone and time zone, Turkish texts are kept', () => {
    const branch = makeBranch({ name: { ar: 'الفرع الرئيسي', en: 'Main branch', tr: 'Ana şube' }, timezone: 'Europe/Istanbul' })
    const values = branchFormValuesOf(branch)
    expect(planBranchPatch(branch, { ...values, nameEn: 'HQ' })).toEqual({ name: { ar: 'الفرع الرئيسي', en: 'HQ', tr: 'Ana şube' } })
    expect(planBranchPatch(branch, { ...values, addressAr: '', addressEn: '', phone: '', timezone: '' })).toEqual({ address: null, phone: null, timezone: null })
    expect(planBranchPatch(branch, { ...values, code: 'hq', isMain: false, isActive: false })).toEqual({ code: 'HQ', isMain: false, isActive: false })
    expect(planBranchPatch(makeBranch({ address: null }), { ...branchFormValuesOf(makeBranch({ address: null })), addressAr: 'جدة' })).toEqual({ address: { ar: 'جدة' } })
  })

  it('mirrors the main/active rule: a new or non-main branch cannot be main and inactive, the main branch cannot be deactivated', () => {
    expect(mainInactiveReason(null, { isMain: true, isActive: false })).toBe('promote_inactive')
    expect(mainInactiveReason({ isMain: false }, { isMain: true, isActive: false })).toBe('promote_inactive')
    expect(mainInactiveReason({ isMain: true }, { isMain: true, isActive: false })).toBe('deactivate')
    expect(mainInactiveReason({ isMain: true }, { isMain: false, isActive: false })).toBeNull()
    expect(mainInactiveReason(null, { isMain: true, isActive: true })).toBeNull()
    expect(mainInactiveReason(null, { isMain: false, isActive: false })).toBeNull()
  })

  it('promotes an inactive branch by activating it in the same request', () => {
    expect(promoteBranchBody({ isActive: true })).toEqual({ isMain: true })
    expect(promoteBranchBody({ isActive: false })).toEqual({ isMain: true, isActive: true })
  })
})
