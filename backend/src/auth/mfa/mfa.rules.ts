// MOD-01-H06 MFA-T02 — the pure rules of the caller's own two-step verification
// routes (API-206..API-210): which second factor a disable request carries,
// and the issuer and account names an authenticator app shows for the
// `otpauth://` URI. No framework or database imports.
import { readLocalizedText } from '../../authorization/localized-text.js';

/** The issuer shown by the authenticator app when the academy row or its name is missing. */
export const DEFAULT_MFA_ISSUER = 'ArtiCode Academy';

/** The second factor of a request that accepts either a TOTP code or a recovery code (API-209). */
export type MfaFactor = { kind: 'code'; value: string } | { kind: 'recovery_code'; value: string };

/**
 * The single factor of `{ code?, recoveryCode? }`, or null when both or
 * neither were sent (`400 mfa_factor_required`). `null` and `undefined` mean
 * absent; an empty string never reaches here (the DTO refuses it).
 */
export function factorOf(body: { code?: string | null; recoveryCode?: string | null }): MfaFactor | null {
  const hasCode = typeof body.code === 'string';
  const hasRecovery = typeof body.recoveryCode === 'string';
  if (hasCode === hasRecovery) return null;
  return hasCode ? { kind: 'code', value: body.code! } : { kind: 'recovery_code', value: body.recoveryCode! };
}

/**
 * The Key URI Format separates issuer and account with a colon, so neither may
 * contain one: colons become spaces, runs of whitespace one space, and the
 * ends are trimmed.
 */
function labelPart(text: string): string {
  return text.replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The issuer of the `otpauth://` URI: the academy's English name, else its Arabic name, else {@link DEFAULT_MFA_ISSUER}. */
export function mfaIssuer(academyName: unknown): string {
  const name = readLocalizedText(academyName);
  for (const candidate of [name?.en, name?.ar]) {
    const part = typeof candidate === 'string' ? labelPart(candidate) : '';
    if (part.length > 0) return part;
  }
  return DEFAULT_MFA_ISSUER;
}

/** The account of the `otpauth://` URI: the caller's e-mail, else their username, else their id. */
export function mfaAccountLabel(user: { id: string; email: string | null; username: string | null }): string {
  for (const candidate of [user.email, user.username]) {
    const part = candidate ? labelPart(candidate) : '';
    if (part.length > 0) return part;
  }
  return user.id;
}
