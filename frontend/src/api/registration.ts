// A student creating their own account (PORTAL-04, contract v3 — the owner's request of 2026-11-25). Public routes: no
// access token, no session refresh. The password is chosen on /register, and the e-mailed link activates the account only
// when the person types that same password again: someone who registers another person's address cannot take the account
// over when its owner clicks the link (the owner does not know the password), and the person who registered proves both
// the mailbox and the password. The completion then opens the session directly, like an accepted invitation.
// `POST /api/account/register` answers 202 with no body whatever the address, so nothing about an account is revealed.
// The raw token goes only to its own route and is never stored. Every screen stays closed behind `selfRegistration` of
// API-205 (isSelfRegistrationOpen()).
import { setAccessToken } from '../auth/token-store'
import { apiRequest } from './client'
import type { SessionResponse } from './client'

export type RegistrationLocale = 'ar' | 'en' | 'tr'

/** Body of `POST /api/account/register`. Any other field (a role, a confirmation) is refused by the server. */
export interface RegisterInput {
  /** 2..200 characters. */
  fullName: string
  /** At most 320 characters. */
  email: string
  /** As typed — never trimmed. The invitation's policy (account.links.ts mirrors it). */
  password: string
  locale?: RegistrationLocale
}

/** `GET /api/account/register/:token`: what the page shows before the password is typed again. */
export interface RegistrationPreview {
  fullName: string
  /** Masked, e.g. `s***@example.test`. */
  maskedEmail: string
  /** ISO 8601 */
  expiresAt: string
}

/** Body of `POST /api/account/register/:token/complete`: the password chosen at registration, nothing else. */
export interface CompleteRegistrationInput {
  password: string
}

/** The problem codes of `400 registration_invalid`, under each field's name. */
export const REGISTRATION_PROBLEMS = ['required', 'too_short', 'too_long', 'invalid_format', 'blank'] as const
export type RegistrationProblem = (typeof REGISTRATION_PROBLEMS)[number]

export const REGISTRATION_PATHS = {
  register: '/api/account/register',
  link: (token: string) => `/api/account/register/${encodeURIComponent(token)}`,
  complete: (token: string) => `/api/account/register/${encodeURIComponent(token)}/complete`,
} as const

/**
 * 202 with no body. 403 registration_disabled | origin_forbidden, 400 registration_invalid { fields, unknown },
 * 400 password_weak { problems } (checked before the 202: it says nothing about any account), 429 rate_limited.
 */
export async function requestRegistration(input: RegisterInput): Promise<void> {
  await apiRequest<void>(REGISTRATION_PATHS.register, { method: 'POST', body: input, auth: false, retry: false })
}

/** 404 registration_link_invalid, 410 registration_link_expired, 403 registration_disabled. */
export function getRegistrationLink(token: string, signal?: AbortSignal): Promise<RegistrationPreview> {
  return apiRequest<RegistrationPreview>(REGISTRATION_PATHS.link(token), { signal, auth: false, retry: false })
}

/**
 * Activates the account with the password chosen at registration and returns a session exactly like an accepted
 * invitation (API-017): the access token is stored here (in memory), the refresh cookie by the server; the caller adopts
 * the session. Also 400 registration_password_incorrect { attemptsLeft } (after five wrong passwords the link is
 * retired: 404 next), 400 registration_invalid, 404 registration_link_invalid, 410 registration_link_expired,
 * 403 registration_disabled, 429 rate_limited.
 */
export async function completeRegistration(token: string, input: CompleteRegistrationInput): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>(REGISTRATION_PATHS.complete(token), {
    method: 'POST',
    body: { password: input.password },
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken, session.user.id)
  return session
}
