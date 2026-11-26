// Pure rules of a student creating their own account (PORTAL-04): the limits of the name and the e-mail,
// and the password with its confirmation, mirrored for immediate feedback (the server stays the judge). A length of the
// name or the e-mail is counted in characters as a person sees them (code points), so an emoji is one; the password
// follows the invitation's policy mirror (account.links.ts — backend passwordProblems()). No React, no I/O.
import type { RegistrationProblem } from '../api/registration'
import { isAcceptablePassword } from '../account/account.links'
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

/** What is wrong with a chosen password: missing, or outside the policy; null when it is fine. Never trimmed. */
export function passwordProblem(value: unknown): 'required' | 'policy' | null {
  if (typeof value !== 'string' || value.length === 0) return 'required'
  return isAcceptablePassword(value) ? null : 'policy'
}

/** What is wrong with the confirmation of a chosen password; null when it repeats it exactly. */
export function confirmationProblem(password: unknown, confirmation: unknown): 'required' | 'mismatch' | null {
  if (typeof confirmation !== 'string' || confirmation.length === 0) return 'required'
  return confirmation === password ? null : 'mismatch'
}
