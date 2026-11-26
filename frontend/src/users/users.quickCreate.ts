// The one-step «إضافة طالب» / «إضافة مدرس» form: three fields turned into the
// body of POST /api/users (API-014). The server gives the kind's role and
// profile; no username, password, locale, profile object or extra role travels.
// The other kinds (staff, guardian — and an admin through the extra roles) keep
// the full creation wizard.
import type { CreateUserInput, UserKind } from '../api/users'
import { E164_PATTERN } from './users.validation'

/** The kinds the quick form creates. */
export const QUICK_CREATE_KINDS = ['student', 'teacher'] as const
export type QuickCreateKind = (typeof QUICK_CREATE_KINDS)[number]

/** The kinds left to the full wizard («حساب آخر»). */
export const OTHER_USER_KINDS: readonly UserKind[] = ['staff', 'guardian']

export function isQuickCreateKind(value: string): value is QuickCreateKind {
  return (QUICK_CREATE_KINDS as readonly string[]).includes(value)
}

export function isOtherUserKind(value: string): value is UserKind {
  return (OTHER_USER_KINDS as readonly string[]).includes(value)
}

/** A teacher must be reachable by phone; a student's phone is a backup and optional. */
export const PHONE_REQUIRED: Readonly<Record<QuickCreateKind, boolean>> = {
  student: false,
  teacher: true,
}

/** Mirrors `CreateUserDto.fullName` (2–200 characters after trim). */
export const FULL_NAME_MIN_LENGTH = 2
export const FULL_NAME_MAX_LENGTH = 200

export interface QuickCreateValues {
  fullName?: string
  email?: string
  phone?: string
}

const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0

/**
 * A phone as people type it, turned into what the server checks (E.164): Arabic-Indic digits become Latin ones,
 * spaces, dashes, dots, brackets and the invisible direction marks a copied number can carry are dropped, and a
 * leading international `00` becomes `+`. Anything else is left for the format check to refuse.
 */
export function normalizePhone(value: string): string {
  const latin = value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
  const compact = latin.replace(/[\s\-‐-―().[\]‎‏‪-‮⁦-⁩]/g, '')
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact
}

export type PhoneProblem = 'required' | 'format'

/** What is wrong with the typed phone of `kind`, or null. */
export function phoneProblem(kind: QuickCreateKind, value: unknown): PhoneProblem | null {
  const phone = typeof value === 'string' ? normalizePhone(value) : ''
  if (!phone) return PHONE_REQUIRED[kind] ? 'required' : null
  return E164_PATTERN.test(phone) ? null : 'format'
}

/** The body of API-014: the kind, the trimmed name, the lower-cased e-mail and the normalised phone when given. */
export function buildQuickCreateInput(kind: QuickCreateKind, values: QuickCreateValues): CreateUserInput {
  const input: CreateUserInput = {
    kind,
    fullName: (values.fullName ?? '').trim(),
    email: (values.email ?? '').trim().toLowerCase(),
  }
  const phone = normalizePhone(values.phone ?? '')
  if (phone) input.phone = phone
  return input
}
