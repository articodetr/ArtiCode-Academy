// A student creating their own account (PORTAL-03, the agreed contract v2 in GitHub #207). Public routes: no access
// token, no session refresh. The password is chosen only after the e-mailed link is opened, so nobody can prepare an
// account on someone else's address. The raw token goes only to its own route and is never stored.
// `POST /api/account/register` answers 202 with no body whatever the address, so nothing about an account is revealed.
// Until Geabel's PR-2 and PR-3 are merged these routes do not exist on the server: every screen stays closed behind
// `selfRegistration` of API-205 (isSelfRegistrationOpen()).
import { apiRequest } from './client'

export type RegistrationLocale = 'ar' | 'en' | 'tr'

/** Body of `POST /api/account/register`. Any other field (a password, a role) is refused by the server. */
export interface RegisterInput {
  /** 2..200 characters. */
  fullName: string
  /** At most 320 characters. */
  email: string
  locale?: RegistrationLocale
}

/** `GET /api/account/register/:token`: what the page shows before the password is chosen. */
export interface RegistrationPreview {
  fullName: string
  /** Masked, e.g. `s***@example.test`. */
  maskedEmail: string
  /** ISO 8601 */
  expiresAt: string
}

/** Body of `POST /api/account/register/:token/complete`. */
export interface CompleteRegistrationInput {
  password: string
  /** Only when the visitor changed it. */
  fullName?: string
}

/** The problem codes of `400 registration_invalid`, under each field's name. */
export const REGISTRATION_PROBLEMS = ['required', 'too_short', 'too_long', 'invalid_format', 'blank'] as const
export type RegistrationProblem = (typeof REGISTRATION_PROBLEMS)[number]

export const REGISTRATION_PATHS = {
  register: '/api/account/register',
  link: (token: string) => `/api/account/register/${encodeURIComponent(token)}`,
  complete: (token: string) => `/api/account/register/${encodeURIComponent(token)}/complete`,
} as const

/** 202 with no body. 400 registration_invalid, 403 registration_disabled | origin_forbidden, 429 rate_limited. */
export async function requestRegistration(input: RegisterInput): Promise<void> {
  await apiRequest<void>(REGISTRATION_PATHS.register, { method: 'POST', body: input, auth: false, retry: false })
}

/** 404 registration_link_invalid, 410 registration_link_expired, 403 registration_disabled. */
export function getRegistrationLink(token: string, signal?: AbortSignal): Promise<RegistrationPreview> {
  return apiRequest<RegistrationPreview>(REGISTRATION_PATHS.link(token), { signal, auth: false, retry: false })
}

/**
 * Activates the account and confirms the address; opens no session, so the visitor signs in next.
 * Also 400 password_weak { problems } and 400 registration_invalid { fields, unknown }.
 */
export async function completeRegistration(token: string, input: CompleteRegistrationInput): Promise<void> {
  await apiRequest<{ completed: true }>(REGISTRATION_PATHS.complete(token), { method: 'POST', body: input, auth: false, retry: false })
}
