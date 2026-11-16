// MOD-01-H06 MFA (D-R107): the TOTP secret is stored encrypted — AES-256-GCM
// with a 12-byte random IV and a 16-byte tag, under a 32-byte server key. The
// sealed text is `v1.<iv>.<ciphertext>.<tag>`, each part base64url without
// padding. The additional data (the user's id) is authenticated with the
// ciphertext, so a secret copied onto another user's row never opens. Pure:
// `node:crypto` only — the key is handed in by the caller.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MFA_KEY_BYTES = 32;

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/** A well-formed sealed secret: version 1, a 16-character IV, the ciphertext, a 22-character tag (base64url, no padding). */
export const SEALED_SECRET_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$/;

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const URL_BASE64 = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Reads the server key from its configured text: standard base64 (padded or
 * not) or base64url, surrounding whitespace ignored. Null unless it decodes to
 * exactly 32 bytes from a canonical encoding of one alphabet (no mixed
 * alphabets, no inner whitespace, no stray padding).
 */
export function parseMfaKey(raw: string): Buffer | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  const standard = STANDARD_BASE64.test(text);
  if (!standard && !URL_BASE64.test(text)) return null;
  if (text.includes('=') && text.length % 4 !== 0) return null;
  const body = text.replace(/=+$/, '');
  const key = Buffer.from(body, standard ? 'base64' : 'base64url');
  if (key.length !== MFA_KEY_BYTES) return null;
  // Re-encoding must give the same text back — rejects non-zero trailing bits.
  if (key.toString('base64url') !== body.replace(/\+/g, '-').replace(/\//g, '_')) return null;
  return key;
}

/** Encrypts `plaintext` bound to `aad`. Throws when the key is not 32 bytes (a configuration error). */
export function sealSecret(key: Buffer, plaintext: string, aad: string): string {
  if (!Buffer.isBuffer(key) || key.length !== MFA_KEY_BYTES) {
    throw new Error(`MFA key must be ${MFA_KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

/**
 * Decrypts a sealed secret. Null — never an exception — for a malformed or
 * non-canonical text, another version, a wrong key or additional data, or any
 * change to the IV, the ciphertext or the tag.
 */
export function openSecret(key: Buffer, sealed: string, aad: string): string | null {
  try {
    if (!Buffer.isBuffer(key) || key.length !== MFA_KEY_BYTES) return null;
    if (typeof sealed !== 'string' || typeof aad !== 'string' || !SEALED_SECRET_PATTERN.test(sealed)) return null;
    const [, ivText, ciphertextText, tagText] = sealed.split('.');
    const iv = canonicalBase64Url(ivText);
    const ciphertext = canonicalBase64Url(ciphertextText);
    const tag = canonicalBase64Url(tagText);
    if (!iv || !ciphertext || !tag || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The bytes of a base64url part, or null when re-encoding them would not give the same text. */
function canonicalBase64Url(text: string): Buffer | null {
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}
