// Turns the general settings form into the smallest PATCH body (API-036), on
// the pattern of users/users.patch.ts: only fields whose normalised value
// differs from the loaded academy are sent; a cleared nullable field becomes
// null; the localized name travels as a whole object when any of its locales
// changes; the weekly-schedule keys travel under `settings.scheduling`, key by
// key (academy.settings.ts — J-F02), and since J-F51 the certificate prefix
// under `settings.certificates` in the same body; nothing changed → null.
import type { Academy, AcademyLocale, AcademySettingsInput, LocalizedLabel, UpdateAcademyInput } from '../api/academy'
import { planCertificatesPatch, planSchedulingPatch, schedulingFormValuesOf, serialPrefixOf } from './academy.settings'
import type { SchedulingFormValues } from './academy.settings'
import { normaliseCurrency } from './academy.validation'

/** Form values: every text field a string (empty = cleared where the server allows it), plus the weekly schedule and the certificate prefix. */
export interface GeneralSettingsFormValues extends SchedulingFormValues {
  /** `settings.certificates.serialPrefix` as typed; blank = not set (the default `CERT`). */
  serialPrefix?: string
  nameAr: string
  nameEn?: string
  nameTr?: string
  logoUrl?: string
  defaultLocale: AcademyLocale
  timezone: string
  currency: string
  contactEmail?: string
  contactPhone?: string
}

const text = (value: string | null | undefined) => value ?? ''

/** Initial values of the form from the loaded academy (null → empty string). */
export function settingsFormValuesOf(academy: Academy): GeneralSettingsFormValues {
  return {
    nameAr: academy.name.ar,
    nameEn: text(academy.name.en),
    nameTr: text(academy.name.tr),
    logoUrl: text(academy.logoUrl),
    defaultLocale: academy.defaultLocale,
    timezone: academy.timezone,
    currency: academy.currency,
    contactEmail: text(academy.contactEmail),
    contactPhone: text(academy.contactPhone),
    ...schedulingFormValuesOf(academy.settings.scheduling),
    serialPrefix: text(serialPrefixOf(academy.settings)),
  }
}

/** The localized name the server will store: `ar` trimmed, blank optional locales dropped (as `toLocalizedText`). */
export function nameOf(values: GeneralSettingsFormValues): LocalizedLabel {
  const name: LocalizedLabel = { ar: values.nameAr.trim() }
  const en = (values.nameEn ?? '').trim()
  const tr = (values.nameTr ?? '').trim()
  if (en) name.en = en
  if (tr) name.tr = tr
  return name
}

/** Equal when every locale matches (an absent locale equals a missing one) — the server's `sameLocalizedText`. */
export function sameName(a: LocalizedLabel, b: LocalizedLabel): boolean {
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null)
}

/** The PATCH value for a nullable field, or undefined when it did not change. */
function changedNullable(current: string | null, next: string | undefined, lowerCase = false): string | null | undefined {
  const trimmed = (next ?? '').trim()
  const value = lowerCase ? trimmed.toLowerCase() : trimmed
  if (value === (current ?? '')) return undefined
  return value === '' ? null : value
}

/**
 * The PATCH body that moves `current` to `values`, or null when nothing
 * differs. Required fields (`nameAr`, `timezone`, `currency`, `defaultLocale`)
 * are only sent when changed and non-blank — the form rules refuse blanks
 * before this runs; the server never accepts null for them.
 */
export function planAcademyPatch(current: Academy, values: GeneralSettingsFormValues): UpdateAcademyInput | null {
  const body: UpdateAcademyInput = {}

  const name = nameOf(values)
  if (name.ar && !sameName(current.name, name)) body.name = name

  const logoUrl = changedNullable(current.logoUrl, values.logoUrl)
  if (logoUrl !== undefined) body.logoUrl = logoUrl

  if (values.defaultLocale && values.defaultLocale !== current.defaultLocale) body.defaultLocale = values.defaultLocale

  const timezone = (values.timezone ?? '').trim()
  if (timezone && timezone !== current.timezone) body.timezone = timezone

  const currency = normaliseCurrency(values.currency)
  if (currency && currency !== current.currency) body.currency = currency

  const contactEmail = changedNullable(current.contactEmail, values.contactEmail, true)
  if (contactEmail !== undefined) body.contactEmail = contactEmail
  const contactPhone = changedNullable(current.contactPhone, values.contactPhone)
  if (contactPhone !== undefined) body.contactPhone = contactPhone

  const settings: AcademySettingsInput = {}
  const scheduling = planSchedulingPatch(current.settings.scheduling, values)
  if (scheduling) settings.scheduling = scheduling
  const certificates = planCertificatesPatch(serialPrefixOf(current.settings), values.serialPrefix)
  if (certificates) settings.certificates = certificates
  if (Object.keys(settings).length > 0) body.settings = settings

  return Object.keys(body).length === 0 ? null : body
}
