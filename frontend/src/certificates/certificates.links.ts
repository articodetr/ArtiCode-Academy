// The verification code of a certificate and the in-app paths of the
// certificates screens (J-F51). Pure; no React, no i18n. Unit-tested in
// certificates.links.test.ts.

/** The stored form of a verification code (D-R56): upper-case base32, 16..32 characters — the server makes 20. */
export const VERIFICATION_CODE_PATTERN = /^[A-Z2-7]{16,32}$/

/** The controller reads at most this many characters of the path parameter before normalising it. */
export const VERIFICATION_PARAM_MAX_LENGTH = 64

/**
 * A code as a person may type it (lower case, spaces, hyphens) → its stored
 * form, or null when it cannot be one — the server would then answer the same
 * `404 certificate_not_found` without a lookup, so the page says so without a
 * request. Mirror of `normalizeVerificationCode()` in
 * backend/src/certificates/certificates.policy.ts, after the controller's
 * `code.slice(0, 64)` — keep them in sync.
 */
export function normalizeVerificationCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.slice(0, VERIFICATION_PARAM_MAX_LENGTH).replace(/[\s-]+/g, '').toUpperCase()
  return VERIFICATION_CODE_PATTERN.test(code) ? code : null
}

/** For reading and typing by hand: groups of four (`K7Q2-M4XW-ZPLR-5TBC-3NHD`) — the server ignores the hyphens. */
export function groupVerificationCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

/** The public page that verifies a code (API-134). */
export function verificationPath(code: string): string {
  return `/verify/${encodeURIComponent(code)}`
}

/** The absolute verification link printed on a certificate: this app's origin and the public page. */
export function verificationUrl(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${verificationPath(code)}`
}

/** The print page of a certificate read through API-131 (holders of `certificates.read_all` or `certificates.issue`). */
export function certificatePrintPath(id: string): string {
  return `/certificates/${encodeURIComponent(id)}/print`
}

/** The print page of one's own — or a linked child's — certificate, read through API-135. */
export function myCertificatePrintPath(id: string): string {
  return `/my-certificates/${encodeURIComponent(id)}/print`
}
