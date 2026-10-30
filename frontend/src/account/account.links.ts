// Pure helpers of the token links (MOD-03-T12). No React, no i18n.

/**
 * Shape of a verification token as the server issues it (32 random bytes,
 * base64url = 43 characters — backend/src/account/verification-token.service.ts).
 * A link that does not match is dead without asking the server.
 */
export const VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isTokenShaped(token: string | undefined): token is string {
  return typeof token === 'string' && VERIFICATION_TOKEN_PATTERN.test(token)
}

/**
 * The link an administrator hands over. The server returns an absolute link
 * when `APP_PUBLIC_URL` is set and a root-relative one (`/invite/<token>`)
 * otherwise; the latter is completed with the origin this app runs on.
 */
export function absoluteLink(link: string, origin: string): string {
  if (/^https?:\/\//i.test(link)) return link
  const base = origin.replace(/\/+$/, '')
  return `${base}${link.startsWith('/') ? link : `/${link}`}`
}

/** Policy mirror of backend/src/auth/password.service.ts (the server stays the authority). */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

/** True when the candidate satisfies the MOD-01 policy: length within bounds and not only whitespace. */
export function isAcceptablePassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH && password.trim().length > 0
}
