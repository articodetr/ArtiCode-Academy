// A student creating their own account (PORTAL-04 — the owner's request of 2026-11-26: no e-mail to confirm). Public
// routes: no access token, no session refresh. `POST /api/account/register` creates the account ACTIVE as a student (its
// e-mail not verified) and signs it in at once: it answers 201 with the session body of a sign-in (API-005 — the access
// token in the JSON, the refresh cookie set by the server), so register() stores the token like completeRegistration()
// does and the caller adopts the session. An address that already has an account is `409 email_in_use` (nothing about
// that account changes). The password goes once, exactly as typed, and is never stored. Every screen stays closed behind
// `selfRegistration` of API-205 (isSelfRegistrationOpen()).
// The e-mailed link of the earlier contract (v3: GET …/register/:token and POST …/register/:token/complete) is kept for
// the links already sent (StudentRegisterCompletePage.tsx); its raw token goes only to its own route and is never stored.
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
 * Creates the student account and opens its session: 201 with the session body, whose access token is stored here (in
 * memory) — the refresh cookie by the server; the caller adopts the session. 403 registration_disabled |
 * origin_forbidden, 400 registration_invalid { fields, unknown }, 400 password_weak { problems },
 * 409 email_in_use { field: 'email' }, 429 rate_limited. Only the four fields of the contract are sent.
 */
export async function register(input: RegisterInput): Promise<SessionResponse> {
  const body: RegisterInput = { fullName: input.fullName, email: input.email, password: input.password }
  if (input.locale !== undefined) body.locale = input.locale
  const session = await apiRequest<SessionResponse>(REGISTRATION_PATHS.register, {
    method: 'POST',
    body,
    auth: false,
    retry: false,
  })
  setAccessToken(session.accessToken, session.user.id)
  return session
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
