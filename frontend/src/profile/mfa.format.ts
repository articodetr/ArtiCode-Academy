// Pure helpers of the two-step verification card of «حسابي» (API-206..API-210): how a secret and a typed code are
// read, and the text of the recovery-codes file. The shape rules mirror the server's — keep them in sync with
// backend/src/auth/mfa/totp.ts (`matchTotp`: six ASCII digits after the spaces are dropped) and
// backend/src/auth/mfa/recovery-codes.ts (`normalizeRecoveryCode`: ten symbols of the 32-symbol alphabet, without
// 0, 1, I and O, after the spaces and dashes are dropped). They only save a request that could not succeed — every
// wrong guess counts towards the server's limit of 10 per 15 minutes; the server stays the judge.

/** Digits of a verification code (TOTP, RFC 6238 as the server issues it). */
export const TOTP_CODE_LENGTH = 6

/** At or under this many unused recovery codes the card warns (API-206 `recoveryCodesLeft`). */
export const LOW_RECOVERY_CODES = 3

/** Name of the downloaded text file. */
export const RECOVERY_CODES_FILE_NAME = 'recovery-codes.txt'

const WHITESPACE = /\s+/g
const SIX_DIGITS = /^[0-9]{6}$/
const RECOVERY_SEPARATORS = /[\s-]/g
const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]*$/
/** Ten symbols out of the digits 2–9 and the upper-case letters without I and O. */
const RECOVERY_CODE = /^[2-9A-HJ-NP-Z]{10}$/
/** Arabic-Indic (U+0660..U+0669) and Persian (U+06F0..U+06F9) digits — what an Arabic keyboard may type. */
const EASTERN_DIGITS = /[٠-٩۰-۹]/g

/** The Base32 secret in groups of four, easier to type into an authenticator app: `JBSW Y3DP …`. */
export function groupSecret(secret: string): string {
  return (secret.replace(WHITESPACE, '').match(/.{1,4}/g) ?? []).join(' ')
}

/** A typed verification code as it is sent: spaces dropped, Arabic-Indic and Persian digits as 0–9. */
export function compactCode(input: string): string {
  return input.replace(WHITESPACE, '').replace(EASTERN_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
}

/** Whether the typed text is six digits (spaces between them are fine). */
export function isTotpCode(input: string): boolean {
  return SIX_DIGITS.test(compactCode(input))
}

/**
 * A typed recovery code as it is sent — `XXXXX-XXXXX`, upper case — or null when it cannot be one: spaces and
 * dashes are dropped and the case does not matter, but exactly ten symbols of the alphabet must remain (a typed
 * 0, 1, I or O is refused, never guessed).
 */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.replace(RECOVERY_SEPARATORS, '')
  // Checked before upper-casing: 'ı' or 'ſ' would otherwise become 'I' or 'S'.
  if (!ASCII_ALPHANUMERIC.test(compact)) return null
  const symbols = compact.toUpperCase()
  return RECOVERY_CODE.test(symbols) ? `${symbols.slice(0, 5)}-${symbols.slice(5)}` : null
}

/** Whether so few recovery codes are left that new ones should be made (null = two-step verification is off). */
export function isLowOnRecoveryCodes(left: number | null): boolean {
  return left !== null && left <= LOW_RECOVERY_CODES
}

/** The codes as they are copied: one per line. */
export function recoveryCodesClipboardText(codes: readonly string[]): string {
  return codes.join('\n')
}

export interface RecoveryCodesFileLines {
  /** First line: what the file is. */
  title: string
  /** Second line: when the codes were made. */
  generatedAt: string
  /** Last line: how to keep and use them. */
  hint: string
}

/**
 * The downloaded text file: a title, when the codes were made, one code per line and a closing hint. It names no
 * account — a found file should not say whose door it opens. CRLF line ends and a BOM, so the plainest Windows
 * editor shows the lines and the Arabic header as written.
 */
export function recoveryCodesFileText(codes: readonly string[], lines: RecoveryCodesFileLines): string {
  return `﻿${[lines.title, lines.generatedAt, '', ...codes, '', lines.hint].join('\r\n')}\r\n`
}
