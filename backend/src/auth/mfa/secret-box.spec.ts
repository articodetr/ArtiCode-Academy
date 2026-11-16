// TEST-225 (MOD-01-H06 MFA, D-R107): the TOTP secret sealed with AES-256-GCM.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MFA_KEY_BYTES, SEALED_SECRET_PATTERN, openSecret, parseMfaKey, sealSecret } from './secret-box.js';

const KEY = randomBytes(MFA_KEY_BYTES);
const OTHER_KEY = randomBytes(MFA_KEY_BYTES);
const USER = '019a8c1e-3f2b-7c4d-9e5f-0a1b2c3d4e5f';
const OTHER_USER = '019a8c1e-3f2b-7c4d-9e5f-0a1b2c3d4e60';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** The sealed text with one bit flipped in the decoded bytes of part 1 (IV), 2 (ciphertext) or 3 (tag). */
function flipByte(sealed: string, part: 1 | 2 | 3, index = 0): string {
  const parts = sealed.split('.');
  const bytes = Buffer.from(parts[part], 'base64url');
  bytes[index] ^= 0x01;
  parts[part] = bytes.toString('base64url');
  return parts.join('.');
}

describe('MFA secret box (TEST-225)', () => {
  it('seals into v1.<iv>.<ciphertext>.<tag> and opens with the same key and additional data', () => {
    const sealed = sealSecret(KEY, SECRET, USER);
    expect(sealed).toMatch(SEALED_SECRET_PATTERN);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(SECRET);
    const [, iv, ciphertext, tag] = sealed.split('.');
    expect(Buffer.from(iv, 'base64url').length).toBe(12);
    expect(Buffer.from(ciphertext, 'base64url').length).toBe(SECRET.length);
    expect(Buffer.from(tag, 'base64url').length).toBe(16);
    expect(openSecret(KEY, sealed, USER)).toBe(SECRET);
  });

  it('round-trips non-ASCII and empty plaintext', () => {
    expect(openSecret(KEY, sealSecret(KEY, 'سرّ — secret', USER), USER)).toBe('سرّ — secret');
    expect(openSecret(KEY, sealSecret(KEY, '', USER), USER)).toBe('');
  });

  it('uses a fresh IV for every seal', () => {
    const first = sealSecret(KEY, SECRET, USER);
    const second = sealSecret(KEY, SECRET, USER);
    expect(second).not.toBe(first);
    expect(second.split('.')[1]).not.toBe(first.split('.')[1]);
  });

  it('does not open with another key or for another user', () => {
    const sealed = sealSecret(KEY, SECRET, USER);
    expect(openSecret(OTHER_KEY, sealed, USER)).toBeNull();
    expect(openSecret(KEY, sealed, OTHER_USER)).toBeNull();
    expect(openSecret(KEY, sealed, '')).toBeNull();
  });

  it('does not open after any change to the IV, the ciphertext or the tag', () => {
    const sealed = sealSecret(KEY, SECRET, USER);
    expect(openSecret(KEY, flipByte(sealed, 1), USER)).toBeNull();
    expect(openSecret(KEY, flipByte(sealed, 1, 11), USER)).toBeNull();
    expect(openSecret(KEY, flipByte(sealed, 2), USER)).toBeNull();
    expect(openSecret(KEY, flipByte(sealed, 2, SECRET.length - 1), USER)).toBeNull();
    expect(openSecret(KEY, flipByte(sealed, 3), USER)).toBeNull();
    expect(openSecret(KEY, flipByte(sealed, 3, 15), USER)).toBeNull();
  });

  it('returns null for malformed or foreign texts and a bad key — never throws', () => {
    const sealed = sealSecret(KEY, SECRET, USER);
    const [, iv, ciphertext, tag] = sealed.split('.');
    const malformed = [
      '',
      'v1',
      'v1...',
      `v2.${iv}.${ciphertext}.${tag}`,
      `V1.${iv}.${ciphertext}.${tag}`,
      `v1.${iv}.${ciphertext}`,
      `v1.${iv}.${ciphertext}.${tag}.extra`,
      `v1.${iv}=.${ciphertext}.${tag}`,
      `v1.${iv.slice(1)}.${ciphertext}.${tag}`,
      `v1.${iv}.${ciphertext}.${tag.slice(1)}`,
      `v1.${iv}.${ciphertext}+.${tag}`,
      ` ${sealed}`,
      `${sealed}\n`,
      'not a sealed secret',
    ];
    for (const text of malformed) {
      expect(SEALED_SECRET_PATTERN.test(text)).toBe(false);
      expect(openSecret(KEY, text, USER)).toBeNull();
    }
    expect(openSecret(KEY, null as unknown as string, USER)).toBeNull();
    expect(openSecret(Buffer.alloc(16), sealed, USER)).toBeNull();
    expect(openSecret('key' as unknown as Buffer, sealed, USER)).toBeNull();
  });

  it('rejects a non-canonical part that decodes to the same bytes', () => {
    const sealed = sealSecret(KEY, SECRET, USER);
    const parts = sealed.split('.');
    // A 16-byte tag is 22 characters; the last one carries 4 unused bits.
    const last = parts[3].at(-1) as string;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = alphabet[alphabet.indexOf(last) ^ 0x01];
    parts[3] = `${parts[3].slice(0, -1)}${twin}`;
    const altered = parts.join('.');
    expect(Buffer.from(parts[3], 'base64url').equals(Buffer.from(sealed.split('.')[3], 'base64url'))).toBe(true);
    expect(openSecret(KEY, altered, USER)).toBeNull();
  });

  it('refuses to seal with a key that is not 32 bytes', () => {
    expect(() => sealSecret(Buffer.alloc(31), SECRET, USER)).toThrow(Error);
    expect(() => sealSecret(Buffer.alloc(33), SECRET, USER)).toThrow(Error);
  });
});

describe('MFA key parsing (TEST-225)', () => {
  const RAW = randomBytes(MFA_KEY_BYTES);

  it('accepts a 32-byte key in base64, unpadded base64 and base64url, trimmed', () => {
    const padded = RAW.toString('base64');
    expect(padded).toHaveLength(44);
    expect(parseMfaKey(padded)?.equals(RAW)).toBe(true);
    expect(parseMfaKey(padded.replace(/=+$/, ''))?.equals(RAW)).toBe(true);
    expect(parseMfaKey(RAW.toString('base64url'))?.equals(RAW)).toBe(true);
    expect(parseMfaKey(`  ${padded}\n`)?.equals(RAW)).toBe(true);
  });

  it('accepts the fixed keys whose encodings use + / and - _', () => {
    const key = Buffer.alloc(MFA_KEY_BYTES, 0xfb);
    expect(key.toString('base64')).toContain('+');
    expect(parseMfaKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseMfaKey(key.toString('base64url'))?.equals(key)).toBe(true);
  });

  it('rejects 31 or 33 bytes, garbage, mixed alphabets and inner whitespace', () => {
    expect(parseMfaKey(randomBytes(31).toString('base64'))).toBeNull();
    expect(parseMfaKey(randomBytes(33).toString('base64'))).toBeNull();
    expect(parseMfaKey(randomBytes(31).toString('base64url'))).toBeNull();
    expect(parseMfaKey(randomBytes(33).toString('base64url'))).toBeNull();
    expect(parseMfaKey('')).toBeNull();
    expect(parseMfaKey('   ')).toBeNull();
    expect(parseMfaKey('not a key at all, just some text!')).toBeNull();
    expect(parseMfaKey(RAW.toString('hex'))).toBeNull(); // 64 hex characters decode to 48 bytes
    const padded = RAW.toString('base64');
    expect(parseMfaKey(`${padded.slice(0, 20)} ${padded.slice(20)}`)).toBeNull();
    expect(parseMfaKey(`${padded}=`)).toBeNull();
    expect(parseMfaKey(`=${padded}`)).toBeNull();
    const fb = Buffer.alloc(MFA_KEY_BYTES, 0xfb).toString('base64');
    expect(parseMfaKey(`${fb.replace('+', '-').slice(0, 10)}${fb.slice(10)}`)).toBeNull(); // '-' and '+' together
    expect(parseMfaKey(null as unknown as string)).toBeNull();
  });
});
