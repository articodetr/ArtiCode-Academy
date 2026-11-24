// Pure rules of a student creating their own account (PORTAL-03/04, the agreed contract v2 in GitHub #207): the limits of
// the two fields, mirrored for immediate feedback (the server stays the judge), and which name a completed link sends.
// A length is counted in characters as a person sees them (code points), so an emoji is one. No React, no I/O.
import type { RegistrationProblem } from '../api/registration'
import { EMAIL_MAX_LENGTH } from '../users/users.validation'

export const FULL_NAME_MIN_LENGTH = 2
export const FULL_NAME_MAX_LENGTH = 200
export { EMAIL_MAX_LENGTH }

/** A shape check only: one `@`, something on each side and a dot in the domain. The server decides the rest. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function characterCount(text: string): number {
  return [...text].length
}

/** What is wrong with a typed full name, in the server's problem codes; null when it is fine. */
export function fullNameProblem(value: unknown): RegistrationProblem | null {
  if (typeof value !== 'string' || value.length === 0) return 'required'
  const name = value.trim()
  if (name.length === 0) return 'blank'
  const length = characterCount(name)
  if (length < FULL_NAME_MIN_LENGTH) return 'too_short'
  if (length > FULL_NAME_MAX_LENGTH) return 'too_long'
  return null
}

/** What is wrong with a typed e-mail, in the server's problem codes; null when it is fine. */
export function emailProblem(value: unknown): RegistrationProblem | null {
  if (typeof value !== 'string' || value.length === 0) return 'required'
  const email = value.trim()
  if (email.length === 0) return 'blank'
  if (characterCount(email) > EMAIL_MAX_LENGTH) return 'too_long'
  return EMAIL_SHAPE.test(email) ? null : 'invalid_format'
}

/** The name a completed link sends: the trimmed new one, or undefined when the visitor left it as the server showed it. */
export function changedFullName(shown: string, typed: unknown): string | undefined {
  if (typeof typed !== 'string') return undefined
  const name = typed.trim()
  return name === shown.trim() ? undefined : name
}
