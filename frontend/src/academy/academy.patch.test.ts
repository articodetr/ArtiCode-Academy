import { describe, expect, it } from 'vitest'
import { makeAcademy } from '../test/academy'
import { nameOf, planAcademyPatch, sameName, settingsFormValuesOf } from './academy.patch'

describe('settingsFormValuesOf', () => {
  it('turns nulls and missing locales into empty strings', () => {
    expect(settingsFormValuesOf(makeAcademy())).toEqual({
      nameAr: 'أكاديمية آرتي كود',
      nameEn: 'ArtiCode Academy',
      nameTr: '',
      logoUrl: '',
      defaultLocale: 'ar',
      timezone: 'Asia/Riyadh',
      currency: 'SAR',
      contactEmail: 'info@articode.test',
      contactPhone: '',
    })
  })
})

describe('nameOf / sameName', () => {
  it('builds the localized name the server stores: ar trimmed, blank optional locales dropped', () => {
    expect(nameOf({ nameAr: ' أ ', nameEn: '  ', nameTr: 'T', defaultLocale: 'ar', timezone: 'UTC', currency: 'SAR' })).toEqual({ ar: 'أ', tr: 'T' })
    expect(sameName({ ar: 'أ' }, { ar: 'أ', en: undefined })).toBe(true)
    expect(sameName({ ar: 'أ', en: 'A' }, { ar: 'أ' })).toBe(false)
  })
})

describe('planAcademyPatch', () => {
  it('returns null when the form still holds the loaded values (also after trimming and case-only changes)', () => {
    const academy = makeAcademy()
    const values = settingsFormValuesOf(academy)
    expect(planAcademyPatch(academy, values)).toBeNull()
    expect(planAcademyPatch(academy, { ...values, currency: ' sar ', contactEmail: ' Info@ArtiCode.test ', nameEn: ' ArtiCode Academy ' })).toBeNull()
  })

  it('sends only the changed fields, the name as a whole object, null for a cleared nullable field, the currency upper-cased', () => {
    const academy = makeAcademy({ logoUrl: 'https://cdn.example.test/old.png' })
    const values = {
      ...settingsFormValuesOf(academy),
      nameEn: 'ArtiCode',
      logoUrl: '',
      currency: 'try',
      contactPhone: ' +966500000000 ',
      timezone: 'Europe/Istanbul',
    }
    expect(planAcademyPatch(academy, values)).toEqual({
      name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode' },
      logoUrl: null,
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      contactPhone: '+966500000000',
    })
  })

  it('drops a cleared optional locale through the whole-name replacement and lower-cases the contact e-mail', () => {
    const academy = makeAcademy()
    const values = { ...settingsFormValuesOf(academy), nameEn: '', contactEmail: 'Hello@ArtiCode.test', defaultLocale: 'en' as const }
    expect(planAcademyPatch(academy, values)).toEqual({ name: { ar: 'أكاديمية آرتي كود' }, defaultLocale: 'en', contactEmail: 'hello@articode.test' })
  })

  it('never sends a blank required field (the form rules refuse it first) and nothing for an unchanged one', () => {
    const academy = makeAcademy()
    const values = { ...settingsFormValuesOf(academy), nameAr: '  ', timezone: '', currency: '' }
    expect(planAcademyPatch(academy, values)).toBeNull()
  })
})
