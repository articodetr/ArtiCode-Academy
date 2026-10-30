// Maps a failed public account request (API-016/017/020) to a translation key
// and says whether the link is dead — then the page shows the message instead
// of the form (T12 AC2). Codes: backend/src/users/users.errors.ts (invitation_*,
// reset_*) and backend/src/auth/auth.errors.ts (password_weak, rate_limited, origin_forbidden).
import { ApiError } from '../api/client'
import { PASSWORD_MIN_LENGTH } from './account.links'

export type AccountFlow = 'invitation' | 'reset'

export interface AccountFailure {
  /** Translation key, e.g. `account.errors.invitation_expired`. */
  key: string
  params?: Record<string, string | number>
  /** The token can never work: show the message without the form. */
  terminal: boolean
}

const TERMINAL_CODES: Readonly<Record<AccountFlow, ReadonlySet<string>>> = {
  invitation: new Set(['invitation_invalid', 'invitation_consumed', 'invitation_expired']),
  reset: new Set(['reset_invalid', 'reset_expired']),
}

/** A failure the page reports before any request: the token in the URL is malformed. */
export function malformedLinkFailure(flow: AccountFlow): AccountFailure {
  return { key: `account.errors.${flow === 'invitation' ? 'invitation_invalid' : 'reset_invalid'}`, terminal: true }
}

function problemsOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('problems' in body)) return []
  const { problems } = body as { problems: unknown }
  return Array.isArray(problems) ? problems.filter((item): item is string => typeof item === 'string') : []
}

export function describeAccountFailure(error: unknown, flow: AccountFlow): AccountFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', terminal: false }

  if (error.code && TERMINAL_CODES[flow].has(error.code)) {
    return { key: `account.errors.${error.code}`, terminal: true }
  }
  if (error.code === 'password_weak' || (error.status === 400 && !error.code)) {
    // The reset confirm refuses the current password with a dedicated problem line.
    const same = problemsOf(error.body).some((problem) => /different/i.test(problem))
    return same
      ? { key: 'account.errors.password_same', terminal: false }
      : { key: 'account.errors.password_weak', params: { min: PASSWORD_MIN_LENGTH }, terminal: false }
  }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited', terminal: false }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden', terminal: false }
  if (error.status >= 500) return { key: 'login.errors.server', terminal: false }
  return { key: 'login.errors.generic', terminal: false }
}
