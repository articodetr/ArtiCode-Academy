// E-mail verification (LR-01-T02 — J-F54): API-165 POST
// /api/account/email-verification/request (signed in, no permission key — the
// caller's own address) and API-166 POST
// /api/account/email-verification/:token/confirm (public — the link of the
// confirmation e-mail, `<APP_PUBLIC_URL>/verify-email/<token>`). Types mirror
// RequestEmailVerificationResponseDto / ConfirmEmailVerificationResponseDto of
// backend/src/account/account.dto.ts. The token travels in the e-mail only
// (D-R78): API-165 never returns it, and the confirm page sends it to its own
// public route only, never stores it, and opens no session.
import { apiRequest } from './client'
import type { MailDelivery } from './account'

/** `RequestEmailVerificationResponseDto` (202): no token and no link, ever. */
export interface EmailVerificationRequest {
  /** ISO 8601 — when the e-mailed link stops working (AUTH_EMAIL_VERIFICATION_TTL_HOURS, 48 h by default). */
  expiresAt: string
  /** `sent`, `logged` (development) or `failed` (ask again later). */
  delivery: MailDelivery
}

/** `ConfirmEmailVerificationResponseDto` (200). */
export interface EmailVerificationConfirmation {
  /** ISO 8601 — when the address was confirmed (now). */
  emailVerifiedAt: string
}

export const EMAIL_VERIFICATION_PATHS = {
  request: '/api/account/email-verification/request',
  confirm: (token: string) => `/api/account/email-verification/${encodeURIComponent(token)}/confirm`,
} as const

/**
 * API-165: 422 `email_missing`, 409 `email_already_verified { emailVerifiedAt }`, 503
 * `mail_unavailable` (MAIL_TRANSPORT=none), 429 `rate_limited` (3 per account in 15 minutes).
 */
export function requestEmailVerification(): Promise<EmailVerificationRequest> {
  return apiRequest<EmailVerificationRequest>(EMAIL_VERIFICATION_PATHS.request, { method: 'POST' })
}

/**
 * API-166 (public): no access token is attached and a 401 never triggers a session refresh.
 * 404 `verification_invalid`, 410 `verification_expired { expiredAt }`, 429 `rate_limited`.
 */
export function confirmEmailVerification(token: string): Promise<EmailVerificationConfirmation> {
  return apiRequest<EmailVerificationConfirmation>(EMAIL_VERIFICATION_PATHS.confirm(token), { method: 'POST', auth: false, retry: false })
}
