// The caller's own two-step verification (MOD-01-H06 — API-206..API-210, backend/src/auth/mfa/mfa.{controller,dto}.ts):
// status, setup, enabling, disabling and new recovery codes. No permission key — ownership; every call carries the
// access token, and the refresh cookie (Path /api/auth) only tells the server which session is this device's (it
// stays when the other sessions are signed out). The secret (setup) and the recovery codes (enable, regenerate)
// arrive in ONE answer each and are never readable again: callers keep them in component state only — never in
// storage, never in a log. The sign-in step (API-211) is not here: it belongs to api/auth.ts.
import { apiRequest } from './client'

/** A TOTP code as typed: six digits, spaces allowed (`MFA_CODE_MAX_LENGTH`). */
export const MFA_CODE_MAX_LENGTH = 16
/** A recovery code as typed: `XXXXX-XXXXX`, spaces and dashes allowed, any case (`MFA_RECOVERY_CODE_MAX_LENGTH`). */
export const MFA_RECOVERY_CODE_MAX_LENGTH = 32
/** Longest password the server reads (`PASSWORD_MAX_LENGTH` in backend/src/auth/password.service.ts). */
export const MFA_PASSWORD_MAX_LENGTH = 128

/** `MfaStatusDto` (API-206). */
export interface MfaStatus {
  /** False when the server has no MFA key: every write answers `503 mfa_unavailable`, and an account with MFA on cannot finish signing in. */
  available: boolean
  enabled: boolean
  /** When it was turned on; null while it is off. */
  enabledAt: string | null
  /** Unused recovery codes (0..10); null while it is off. */
  recoveryCodesLeft: number | null
  /** A setup started less than 10 minutes ago awaits its confirmation; always false while it is on. */
  pendingSetup: boolean
}

/** `MfaSetupDto` (API-207): shown in this answer only. */
export interface MfaSetup {
  /** The shared secret, Base32 without padding (32 characters). */
  secret: string
  /** The same secret as an `otpauth://` URI, to draw as a QR code. */
  otpauthUri: string
  /** Confirm with a code before this instant (10 minutes). */
  expiresAt: string
}

/** `MfaEnabledDto` (API-208). */
export interface MfaEnabled {
  enabledAt: string
  /** Ten one-time codes `XXXXX-XXXXX`, shown in this answer only. */
  recoveryCodes: string[]
  /** Other sessions of the caller that were signed out; this device's session stays. */
  revokedSessions: number
}

/** `MfaDisabledDto` (API-209). */
export interface MfaDisabled {
  revokedSessions: number
}

/** `MfaRecoveryCodesDto` (API-210): ten new codes, shown in this answer only; every earlier code stops working. */
export interface MfaRecoveryCodes {
  recoveryCodes: string[]
}

/** `MfaDisableRequestDto`: the password and exactly one second factor. */
export type MfaDisableInput = { password: string; code: string } | { password: string; recoveryCode: string }

export const MFA_PATHS = {
  status: '/api/auth/mfa',
  setup: '/api/auth/mfa/setup',
  enable: '/api/auth/mfa/enable',
  disable: '/api/auth/mfa/disable',
  recoveryCodes: '/api/auth/mfa/recovery-codes',
} as const

/** API-206: never 503 — without the server key it answers `available: false`. */
export function getMfaStatus(signal?: AbortSignal): Promise<MfaStatus> {
  return apiRequest<MfaStatus>(MFA_PATHS.status, { signal })
}

/** API-207: 503 `mfa_unavailable`, 400 `password_invalid`, 409 `mfa_already_enabled`, 429 `rate_limited`. */
export function setupMfa(password: string): Promise<MfaSetup> {
  return apiRequest<MfaSetup>(MFA_PATHS.setup, { method: 'POST', body: { password } })
}

/** API-208: 503, 409 `mfa_already_enabled`, 409 `mfa_setup_required` (no setup, or older than 10 minutes), 400 `mfa_code_invalid`, 429. */
export function enableMfa(code: string): Promise<MfaEnabled> {
  return apiRequest<MfaEnabled>(MFA_PATHS.enable, { method: 'POST', body: { code } })
}

/** API-209: 503, 400 `mfa_factor_required`, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`, 429. */
export function disableMfa(input: MfaDisableInput): Promise<MfaDisabled> {
  // Exactly one factor travels, whatever else the caller's object carries.
  const body = 'code' in input ? { password: input.password, code: input.code } : { password: input.password, recoveryCode: input.recoveryCode }
  return apiRequest<MfaDisabled>(MFA_PATHS.disable, { method: 'POST', body })
}

/** API-210: 503, 400 `password_invalid`, 409 `mfa_not_enabled`, 400 `mfa_code_invalid`, 429. */
export function regenerateRecoveryCodes(password: string, code: string): Promise<MfaRecoveryCodes> {
  return apiRequest<MfaRecoveryCodes>(MFA_PATHS.recoveryCodes, { method: 'POST', body: { password, code } })
}
