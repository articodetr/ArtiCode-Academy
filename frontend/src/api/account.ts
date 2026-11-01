// Account-lifecycle endpoints (MOD-03-T03 invitations, MOD-03-T05 password
// reset) consumed by the invitation and reset screens (MOD-03-T12):
// API-015 POST /api/users/:id/invitations, API-016 GET /api/account/invitations/:token,
// API-017 POST /api/account/invitations/:token/accept, API-019 POST /api/users/:id/password-reset,
// API-020 POST /api/account/password-reset/:token/confirm. Types mirror
// backend/src/account/account.dto.ts. The raw token is sent only to its own
// public route and is never stored anywhere (T12 AC1).
import { setAccessToken } from '../auth/token-store'
import { apiRequest } from './client'
import type { SessionResponse } from './client'

export type MailDeliveryStatus = 'skipped' | 'logged' | 'sent' | 'failed'

export interface MailDelivery {
  /** `none` (nothing sent — D-R08), `log` (development) or a provider name later. */
  transport: string
  status: MailDeliveryStatus
}

/** Body of API-015 and API-019: the one-time link, shown to the issuer exactly once. */
export interface IssuedLink {
  userId: string
  token: string
  /** `<APP_PUBLIC_URL>/invite/<token>` (or `/reset-password/<token>`), root-relative when APP_PUBLIC_URL is not set. */
  link: string
  /** ISO 8601 */
  expiresAt: string
  delivery: MailDelivery
}

/** Body of API-016: what the invitation page shows before the password is chosen. */
export interface InvitationPreview {
  fullName: string
  displayName: string | null
  locale: string | null
  /** Masked (`s***@example.test`) or null for a username-only account. */
  email: string | null
  /** Masked (`sa***`) or null. */
  username: string | null
  /** Role keys, sorted. */
  roles: string[]
  /** ISO 8601 */
  expiresAt: string
}

export const ACCOUNT_PATHS = {
  issueInvitation: (userId: string) => `/api/users/${encodeURIComponent(userId)}/invitations`,
  issuePasswordReset: (userId: string) => `/api/users/${encodeURIComponent(userId)}/password-reset`,
  invitation: (token: string) => `/api/account/invitations/${encodeURIComponent(token)}`,
  acceptInvitation: (token: string) => `/api/account/invitations/${encodeURIComponent(token)}/accept`,
  confirmPasswordReset: (token: string) => `/api/account/password-reset/${encodeURIComponent(token)}/confirm`,
} as const

/** Needs `users.create`; the account must be `invited` (409 user_not_invitable otherwise). */
export function issueInvitation(userId: string): Promise<IssuedLink> {
  return apiRequest<IssuedLink>(ACCOUNT_PATHS.issueInvitation(userId), { method: 'POST' })
}

/** Needs `users.update`; the account must be `active` (409 user_not_resettable otherwise). */
export function issuePasswordReset(userId: string): Promise<IssuedLink> {
  return apiRequest<IssuedLink>(ACCOUNT_PATHS.issuePasswordReset(userId), { method: 'POST' })
}

/** Public: no access token is attached, and a 401 never triggers a session refresh. */
export function previewInvitation(token: string, signal?: AbortSignal): Promise<InvitationPreview> {
  return apiRequest<InvitationPreview>(ACCOUNT_PATHS.invitation(token), { signal, auth: false, retry: false })
}

/** Public: consumes the token, activates the account and returns a session exactly like login. */
export async function acceptInvitation(token: string, password: string): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>(ACCOUNT_PATHS.acceptInvitation(token), {
    method: 'POST',
    body: { password },
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken, session.user.id)
  return session
}

/** Public: consumes the token, stores the new password, signs the account out everywhere and returns a fresh session. */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>(ACCOUNT_PATHS.confirmPasswordReset(token), {
    method: 'POST',
    body: { newPassword },
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken, session.user.id)
  return session
}
