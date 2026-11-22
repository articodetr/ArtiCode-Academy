import { describe, expect, it } from 'vitest'
import { COURSE_ID } from '../test/courses'
import { BANK_COURSE, THREE_BANKS, makeBank } from '../test/questionBanks'
import { bankFormHasChanges, bankFormValuesOf, buildCreateBankInput, newBankForm, planBankPatch } from './questionBanks.form'

const OTHER_COURSE = '0193a000-0000-7000-8000-00000000c002'
const bank = makeBank()

describe('bankFormValuesOf() and buildCreateBankInput() — API-261', () => {
  it('reads a bank into the form, nulls as empty', () => {
    expect(bankFormValuesOf(bank)).toEqual({ nameAr: 'بنك بايثون', nameEn: 'Python bank', descriptionAr: 'أسئلة أساسيات اللغة', descriptionEn: '', courseId: COURSE_ID })
    expect(bankFormValuesOf(THREE_BANKS()[1]!)).toEqual({ nameAr: 'أسئلة عامة', nameEn: '', descriptionAr: '', descriptionEn: '', courseId: undefined })
  })

  it('sends the smallest body: the name alone, trimmed', () => {
    expect(buildCreateBankInput({ ...newBankForm(), nameAr: '  بنك الأساسيات ' })).toEqual({ name: { ar: 'بنك الأساسيات' } })
  })

  it('adds the English name, the description and the course only when given', () => {
    expect(buildCreateBankInput({ nameAr: 'بنك الأساسيات', nameEn: ' Basics bank ', descriptionAr: 'وصف', descriptionEn: 'Description', courseId: COURSE_ID })).toEqual({
      name: { ar: 'بنك الأساسيات', en: 'Basics bank' },
      description: { ar: 'وصف', en: 'Description' },
      courseId: COURSE_ID,
    })
    // An English description alone is no description; a cleared course is no course.
    expect(buildCreateBankInput({ nameAr: 'بنك', descriptionEn: 'Only English', courseId: null })).toEqual({ name: { ar: 'بنك' } })
  })
})

describe('planBankPatch() — the smallest PATCH of API-263', () => {
  it('plans nothing for the bank as loaded, or with spaces around its texts', () => {
    expect(planBankPatch(bank, bankFormValuesOf(bank))).toBeNull()
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), nameAr: ' بنك بايثون ', descriptionAr: 'أسئلة أساسيات اللغة  ' })).toBeNull()
  })

  it('sends only what changed, a localized text whole', () => {
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), nameEn: 'Python questions' })).toEqual({ name: { ar: 'بنك بايثون', en: 'Python questions' } })
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), descriptionEn: 'Basics' })).toEqual({ description: { ar: 'أسئلة أساسيات اللغة', en: 'Basics' } })
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), courseId: OTHER_COURSE })).toEqual({ courseId: OTHER_COURSE })
  })

  it('clears the description and the course with null, and never the name', () => {
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), descriptionAr: ' ', courseId: undefined })).toEqual({ description: null, courseId: null })
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), courseId: null })).toEqual({ courseId: null })
    // An emptied Arabic name is refused by the form, never sent.
    expect(planBankPatch(bank, { ...bankFormValuesOf(bank), nameAr: '' })).toBeNull()
  })

  it('keeps the Turkish texts the form does not show', () => {
    const turkish = makeBank({ name: { ar: 'أسئلة عامة', tr: 'Genel sorular' }, description: { ar: 'وصف', tr: 'Açıklama' }, course: null })
    expect(planBankPatch(turkish, { ...bankFormValuesOf(turkish), nameEn: 'General', descriptionAr: 'وصف أطول' })).toEqual({
      name: { ar: 'أسئلة عامة', en: 'General', tr: 'Genel sorular' },
      description: { ar: 'وصف أطول', tr: 'Açıklama' },
    })
  })

  it('files a bank that had no course under one', () => {
    const general = makeBank({ course: null })
    expect(planBankPatch(general, { ...bankFormValuesOf(general), courseId: BANK_COURSE.id })).toEqual({ courseId: COURSE_ID })
  })
})

describe('bankFormHasChanges() — the unsaved guard of the bank form', () => {
  it('follows a new bank from its empty start', () => {
    expect(bankFormHasChanges(null, newBankForm())).toBe(false)
    expect(bankFormHasChanges(null, { ...newBankForm(), nameAr: '   ' })).toBe(false)
    expect(bankFormHasChanges(null, { ...newBankForm(), nameAr: 'بنك' })).toBe(true)
    expect(bankFormHasChanges(null, { ...newBankForm(), nameEn: 'Bank' })).toBe(true)
    expect(bankFormHasChanges(null, { ...newBankForm(), descriptionEn: 'Text' })).toBe(true)
    expect(bankFormHasChanges(null, { ...newBankForm(), courseId: COURSE_ID })).toBe(true)
  })

  it('holds a change of an existing bank, nothing once it is changed back, and what the save would refuse', () => {
    expect(bankFormHasChanges(bank, bankFormValuesOf(bank))).toBe(false)
    expect(bankFormHasChanges(bank, { ...bankFormValuesOf(bank), nameEn: 'Other' })).toBe(true)
    expect(bankFormHasChanges(bank, { ...bankFormValuesOf(bank), nameEn: 'Python bank' })).toBe(false)
    expect(bankFormHasChanges(bank, { ...bankFormValuesOf(bank), courseId: undefined })).toBe(true)
    expect(bankFormHasChanges(bank, { ...bankFormValuesOf(bank), nameAr: '' })).toBe(true)
    const plain = makeBank({ description: null })
    expect(bankFormHasChanges(plain, { ...bankFormValuesOf(plain), descriptionEn: 'Only English' })).toBe(true)
  })
})
