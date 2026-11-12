// Maps a failed certificates request to a translation key. Codes:
// backend/src/certificates/certificates.errors.ts — the one MOD-10 dictionary
// (API-130..API-136) — plus the auth/permission guards. The public
// verification (API-134) has its own reading, describeVerificationFailure():
// the visitor is told whether the code is unknown, whether to wait a minute or
// whether to try again. Unit-tested in certificates.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export { failureMessage }

export type CertificatesFailure = UsersFailure

const KNOWN_CODES = new Set([
  'class_not_found',
  'class_not_completed',
  'certificate_request_invalid',
  'certificate_not_found',
  'certificate_revoked',
  'cursor_invalid',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function describeCertificatesFailure(error: unknown): CertificatesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: CertificatesFailure = { key: `certificates.errors.${error.code}` }
    const missing = strings(body.missing)
    if (missing.length > 0) failure.params = { list: `(${missing.join(', ')})` }
    return failure
  }
  if (error.status === 400) return { key: 'certificates.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** True for the failure of one code (`certificates.errors.<code>`). */
export function isCertificatesFailure(failure: CertificatesFailure, code: string): boolean {
  return failure.key === `certificates.errors.${code}`
}

/**
 * An issuing request (API-132) refused because the class or its roster changed
 * elsewhere — the class is no longer completed (or gone), or an enrollment
 * named no longer belongs to it: the same request cannot succeed again, so
 * the dialog closes and the preview is read again.
 */
export function isStaleIssue(failure: CertificatesFailure): boolean {
  return ['class_not_completed', 'certificate_request_invalid', 'class_not_found'].some((code) => isCertificatesFailure(failure, code))
}

/**
 * A revocation (API-133) refused because the certificate changed elsewhere —
 * revoked meanwhile, or gone: the dialog closes and the certificate is read again.
 */
export function isStaleRevocation(failure: CertificatesFailure): boolean {
  return ['certificate_revoked', 'certificate_not_found'].some((code) => isCertificatesFailure(failure, code))
}

/** What the public verification page says when API-134 fails. */
export interface VerificationFailure {
  /** Translation key. */
  key: string
  /** The code can never verify (unknown or malformed — the same 404, D-R56): no retry button. */
  terminal: boolean
}

export function describeVerificationFailure(error: unknown): VerificationFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }
  if (error.status === 404) return { key: 'certificates.verify.notFound', terminal: true }
  // 60 verifications per minute per IP (AuthThrottlerGuard — SEC-R-19).
  if (error.status === 429 || error.code === 'rate_limited') return { key: 'certificates.verify.rateLimited', terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}
