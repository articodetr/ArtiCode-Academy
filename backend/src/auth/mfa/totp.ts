// MOD-01-H06 MFA (D-R105): time-based one-time passwords for academy accounts —
// RFC 6238 TOTP over RFC 4226 HOTP, with the RFC 4648 Base32 alphabet for the
// shared secret. Built on `node:crypto` only (no dependency); pure functions, no
// clock of their own — the caller passes the current time.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted on each side of the current one (clock drift between the server and the phone). */
export const TOTP_WINDOW = 1;
/** 160 bits, the HMAC-SHA-1 block recommendation of RFC 4226 — 32 Base32 characters. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Lengths (mod 8) an unpadded Base32 text can have: 0, 2, 4, 5 or 7 characters in its last group. */
const BASE32_VALID_REMAINDERS = new Set([0, 2, 4, 5, 7]);
const BASE32_CHARACTERS = /^[A-Za-z2-7]*$/;
const ASCII_WHITESPACE = /[ \t\n\r\f\v]/g;
const SIX_DIGITS = /^[0-9]{6}$/;

/** A new shared secret: 20 random bytes in Base32 (upper case, no padding). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** RFC 4648 Base32, upper case, without '=' padding. */
export function base32Encode(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

/**
 * Decodes RFC 4648 Base32 in either case, ignoring ASCII whitespace anywhere and
 * '=' padding at the end. Null for any other character (an '=' inside the text
 * included) or for a length no Base32 text can have. Bits left over after the
 * last whole byte are dropped.
 */
export function base32Decode(text: string): Buffer | null {
  if (typeof text !== 'string') return null;
  const stripped = text.replace(ASCII_WHITESPACE, '').replace(/=+$/, '');
  // Checked before upper-casing: 'ı' or 'ſ' would otherwise become 'I' or 'S'.
  if (!BASE32_CHARACTERS.test(stripped)) return null;
  const compact = stripped.toUpperCase();
  if (!BASE32_VALID_REMAINDERS.has(compact.length % 8)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of compact) {
    const value = BASE32_ALPHABET.indexOf(char);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** The TOTP time step of an instant: floor(seconds since the epoch ÷ period). */
export function totpStep(nowMs: number, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/**
 * The HOTP value of one counter (RFC 4226 §5.3): HMAC over the 8-byte big-endian
 * counter, dynamic truncation, the low `digits` decimal digits, zero-padded.
 */
export function totpCode(
  secret: Buffer,
  step: number,
  options: { digits?: number; algorithm?: 'sha1' | 'sha256' | 'sha512' } = {},
): string {
  const digits = options.digits ?? TOTP_DIGITS;
  const algorithm = options.algorithm ?? 'sha1';
  if (!Number.isSafeInteger(step) || step < 0) throw new RangeError('TOTP step must be a non-negative integer');
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) throw new RangeError('TOTP digits must be 1 to 10');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac(algorithm, secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Checks a 6-digit code typed by the user against the secret at `nowMs`.
 * Returns the step that matched — the caller stores it and passes it back as
 * `lastStep`, so a code (or an older one) is never accepted twice — or null.
 * ASCII whitespace in the code is ignored ("123 456"); anything but exactly six
 * digits afterwards, an undecodable or empty secret, or no match is null. The
 * steps are tried from the oldest to the newest of the window.
 */
export function matchTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastStep: number | null,
  window: number = TOTP_WINDOW,
): number | null {
  if (!Number.isInteger(window) || window < 0) throw new RangeError('TOTP window must be a non-negative integer');
  if (typeof code !== 'string') return null;
  const typed = code.replace(ASCII_WHITESPACE, '');
  if (!SIX_DIGITS.test(typed)) return null;
  const secret = base32Decode(secretBase32);
  if (!secret || secret.length === 0) return null;
  const current = totpStep(nowMs);
  if (!Number.isSafeInteger(current)) return null;
  const given = Buffer.from(typed, 'utf8');
  for (let step = current - window; step <= current + window; step += 1) {
    if (step < 0) continue;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step, { digits: TOTP_DIGITS }), 'utf8');
    if (expected.length === given.length && timingSafeEqual(expected, given)) return step;
  }
  return null;
}

/** The `otpauth://` URI an authenticator app reads from the QR code (Key Uri Format). */
export function otpauthUri(options: { issuer: string; account: string; secret: string }): string {
  const issuer = encodeURIComponent(options.issuer);
  const account = encodeURIComponent(options.account);
  return (
    `otpauth://totp/${issuer}:${account}?secret=${options.secret}&issuer=${issuer}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  );
}
