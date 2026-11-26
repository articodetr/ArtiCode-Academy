import { describe, expect, it } from 'vitest'
import { makeAcademy } from '../test/academy'
import { nameOf, planAcademyPatch, sameName, settingsFormValuesOf } from './academy.patch'

/** The MOD-20 keys as a freshly seeded academy holds them. */
const UNSET_MOD20 = { learning: { videoCompletionPercent: null }, catalog: { publicBrowsing: null } }

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
      weekStartsOn: undefined,
      workingDays: [],
      serialPrefix: '',
      selfIssue: false,
      videoCompletionPercent: null,
      publicBrowsing: false,
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

  it('adds the changed weekly-schedule keys under settings.scheduling, in the same body as the row fields (J-F02)', () => {
    const academy = makeAcademy({ settings: { scheduling: { weekStartsOn: 0, workingDays: [0, 1, 2, 3, 4] }, certificates: { serialPrefix: null }, ...UNSET_MOD20 } })
    const values = settingsFormValuesOf(academy)
    expect(planAcademyPatch(academy, { ...values, workingDays: [4, 3, 2, 1, 0] })).toBeNull()
    expect(planAcademyPatch(academy, { ...values, currency: 'TRY', weekStartsOn: 6, workingDays: [] })).toEqual({
      currency: 'TRY',
      settings: { scheduling: { weekStartsOn: 6, workingDays: null } },
    })
  })

  it('never sends a blank required field (the form rules refuse it first) and nothing for an unchanged one', () => {
    const academy = makeAcademy()
    const values = { ...settingsFormValuesOf(academy), nameAr: '  ', timezone: '', currency: '' }
    expect(planAcademyPatch(academy, values)).toBeNull()
  })

  it('adds the certificate prefix under settings.certificates in the same body, upper-cased; blank clears it to null (J-F51)', () => {
    const academy = makeAcademy({ settings: { scheduling: { weekStartsOn: 0, workingDays: null }, certificates: { serialPrefix: 'ACA' }, ...UNSET_MOD20 } })
    const values = settingsFormValuesOf(academy)
    expect(values.serialPrefix).toBe('ACA')
    expect(planAcademyPatch(academy, { ...values, serialPrefix: ' aca ' })).toBeNull()
    expect(planAcademyPatch(academy, { ...values, serialPrefix: 'acad26', weekStartsOn: 6 })).toEqual({
      settings: { scheduling: { weekStartsOn: 6 }, certificates: { serialPrefix: 'ACAD26' } },
    })
    expect(planAcademyPatch(academy, { ...values, serialPrefix: '' })).toEqual({ settings: { certificates: { serialPrefix: null } } })
    // A form without the field changes nothing.
    expect(planAcademyPatch(academy, { ...values, serialPrefix: undefined })).toBeNull()
  })

  it('reads a server before MOD-10-T02 (no settings.certificates) as an unset prefix', () => {
    const academy = { ...makeAcademy(), settings: { scheduling: { weekStartsOn: null, workingDays: null } } } as unknown as ReturnType<typeof makeAcademy>
    expect(settingsFormValuesOf(academy).serialPrefix).toBe('')
    expect(planAcademyPatch(academy, settingsFormValuesOf(academy))).toBeNull()
    expect(planAcademyPatch(academy, { ...settingsFormValuesOf(academy), serialPrefix: 'ACA' })).toEqual({ settings: { certificates: { serialPrefix: 'ACA' } } })
  })

  it('sends the self-issue switch with the prefix in one settings.certificates, and off clears it (J-F67)', () => {
    const academy = makeAcademy()
    const values = settingsFormValuesOf(academy)
    expect(values.selfIssue).toBe(false)
    expect(planAcademyPatch(academy, values)).toBeNull()
    expect(planAcademyPatch(academy, { ...values, selfIssue: true })).toEqual({ settings: { certificates: { selfIssue: true } } })
    expect(planAcademyPatch(academy, { ...values, selfIssue: true, serialPrefix: 'ACA' })).toEqual({ settings: { certificates: { serialPrefix: 'ACA', selfIssue: true } } })
    const on = makeAcademy({ settings: { ...academy.settings, certificates: { serialPrefix: null, selfIssue: true } } })
    expect(settingsFormValuesOf(on).selfIssue).toBe(true)
    expect(planAcademyPatch(on, settingsFormValuesOf(on))).toBeNull()
    expect(planAcademyPatch(on, { ...settingsFormValuesOf(on), selfIssue: false })).toEqual({ settings: { certificates: { selfIssue: null } } })
    expect(planAcademyPatch(on, { ...settingsFormValuesOf(on), selfIssue: undefined })).toBeNull()
  })

  it('adds the playback share under settings.learning and the catalog switch under settings.catalog in the same body (MOD-20)', () => {
    const academy = makeAcademy()
    const values = settingsFormValuesOf(academy)
    expect(planAcademyPatch(academy, { ...values, videoCompletionPercent: 80, publicBrowsing: true, weekStartsOn: 6 })).toEqual({
      settings: { scheduling: { weekStartsOn: 6 }, learning: { videoCompletionPercent: 80 }, catalog: { publicBrowsing: true } },
    })
  })

  it('clears the share with null and turns the switch off as null (not set), never as false', () => {
    const academy = makeAcademy({
      settings: { scheduling: { weekStartsOn: null, workingDays: null }, certificates: { serialPrefix: null }, learning: { videoCompletionPercent: 75 }, catalog: { publicBrowsing: true } },
    })
    const values = settingsFormValuesOf(academy)
    expect(values.videoCompletionPercent).toBe(75)
    expect(values.publicBrowsing).toBe(true)
    expect(planAcademyPatch(academy, values)).toBeNull()
    expect(planAcademyPatch(academy, { ...values, videoCompletionPercent: null, publicBrowsing: false })).toEqual({
      settings: { learning: { videoCompletionPercent: null }, catalog: { publicBrowsing: null } },
    })
  })

  it('reads a server before MOD-20 (no settings.learning / settings.catalog) as not set', () => {
    const academy = { ...makeAcademy(), settings: { scheduling: { weekStartsOn: null, workingDays: null }, certificates: { serialPrefix: null } } } as unknown as ReturnType<typeof makeAcademy>
    expect(settingsFormValuesOf(academy)).toMatchObject({ videoCompletionPercent: null, publicBrowsing: false })
    expect(planAcademyPatch(academy, settingsFormValuesOf(academy))).toBeNull()
    expect(planAcademyPatch(academy, { ...settingsFormValuesOf(academy), publicBrowsing: true })).toEqual({ settings: { catalog: { publicBrowsing: true } } })
  })
})
