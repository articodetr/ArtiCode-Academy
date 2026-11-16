// MOD-01-H06 MFA (D-R105): one-time recovery codes for an account whose
// authenticator is lost. Ten codes of ten symbols from a 32-symbol alphabet
// without the look-alikes 0, 1, I and O (50 bits each), shown as XXXXX-XXXXX;
// only a keyed hash of each is stored (HMAC-SHA-256 under a key derived from
// AUTH_MFA_ENCRYPTION_KEY, bound to the user id): 50 bits are too few for a
// plain hash — a dump of the table could be swept offline (NIST SP 800-63B
// 5.1.2.2 asks look-up secrets under 112 bits to be salted and keyed).
// Pure: `node:crypto` only.
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
/** Symbols per code, shown as XXXXX-XXXXX. */
export const RECOVERY_CODE_LENGTH = 10;
/** 32 symbols: digits 2–9 and the upper-case letters without I and O. */
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const GROUP_LENGTH = RECOVERY_CODE_LENGTH / 2;
const NORMALIZED_CODE = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);
const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]*$/;
const SEPARATORS = /[\s-]/g;

/**
 * A new set of distinct codes, formatted 'XXXXX-XXXXX'. Each symbol is one random
 * byte masked to 5 bits — 32 divides 256, so every symbol is equally likely.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RangeError('Recovery code count must be an integer from 1 to 100');
  }
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    let symbols = '';
    for (const byte of bytes) symbols += RECOVERY_CODE_ALPHABET[byte & 31];
    codes.add(`${symbols.slice(0, GROUP_LENGTH)}-${symbols.slice(GROUP_LENGTH)}`);
  }
  return [...codes];
}

/**
 * The code as it is hashed: whitespace and dashes removed, upper case. Null
 * unless exactly ten symbols of the alphabet remain (a typed 0, 1, I or O is
 * refused, not guessed).
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(SEPARATORS, '');
  // Checked before upper-casing: 'ı' or 'ſ' would otherwise become 'I' or 'S'.
  if (!ASCII_ALPHANUMERIC.test(compact)) return null;
  const normalized = compact.toUpperCase();
  return NORMALIZED_CODE.test(normalized) ? normalized : null;
}

/** HKDF `info` of the recovery-code key: a key of its own, never the sealing key itself. */
export const RECOVERY_CODE_KEY_INFO = 'articode.mfa.recovery-codes.v1';

/** The 32-byte HMAC key of the recovery codes, derived (HKDF-SHA-256) from the 32-byte MFA key. */
export function deriveRecoveryCodeKey(mfaKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', mfaKey, Buffer.alloc(0), RECOVERY_CODE_KEY_INFO, 32));
}

/**
 * The stored form of a normalized code: HMAC-SHA-256 under the derived key of
 * `<user id>:<code>`, 64 lower-case hex characters. Without the key a dump of
 * the table reveals nothing, and the same code of two users never shares a hash.
 */
export function hashRecoveryCode(recoveryKey: Buffer, userId: string, normalized: string): string {
  return createHmac('sha256', recoveryKey).update(`${userId.toLowerCase()}:${normalized}`, 'utf8').digest('hex');
}
