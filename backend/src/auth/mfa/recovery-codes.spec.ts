// TEST-225 (MOD-01-H06 MFA, D-R105): one-time recovery codes.
import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_KEY_INFO,
  RECOVERY_CODE_LENGTH,
  deriveRecoveryCodeKey,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes.js';

const FORMATTED = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

describe('MFA recovery codes (TEST-225)', () => {
  it('has a 32-symbol alphabet without 0, 1, I and O', () => {
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);
    for (const excluded of ['0', '1', 'I', 'O']) expect(RECOVERY_CODE_ALPHABET).not.toContain(excluded);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(RECOVERY_CODE_LENGTH).toBe(10);
  });

  it('generates ten distinct codes formatted XXXXX-XXXXX from the alphabet only', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(FORMATTED);
      expect(normalizeRecoveryCode(code)).toBe(code.replace('-', ''));
    }
  });

  it('generates the requested count and refuses an impossible one', () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
    expect(() => generateRecoveryCodes(0)).toThrow(RangeError);
    expect(() => generateRecoveryCodes(2.5)).toThrow(RangeError);
  });

  it('uses every symbol of the alphabet across many codes', () => {
    const symbols = new Set(generateRecoveryCodes(100).join('').replace(/-/g, ''));
    expect([...symbols].sort().join('')).toBe([...RECOVERY_CODE_ALPHABET].sort().join(''));
  });

  it('normalizes lower case, spaces and dashes', () => {
    expect(normalizeRecoveryCode('ABCDE-23456')).toBe('ABCDE23456');
    expect(normalizeRecoveryCode('abcde-23456')).toBe('ABCDE23456');
    expect(normalizeRecoveryCode(' abcde 23456 ')).toBe('ABCDE23456');
    expect(normalizeRecoveryCode('ab-cd-e2-34-56')).toBe('ABCDE23456');
    expect(normalizeRecoveryCode('ABCDE23456')).toBe('ABCDE23456');
  });

  it('rejects a wrong length or a symbol outside the alphabet', () => {
    expect(normalizeRecoveryCode('ABCDE-2345')).toBeNull(); // 9
    expect(normalizeRecoveryCode('ABCDE-234567')).toBeNull(); // 11
    expect(normalizeRecoveryCode('')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-2345O')).toBeNull(); // O
    expect(normalizeRecoveryCode('ABCDE-23450')).toBeNull(); // 0
    expect(normalizeRecoveryCode('ABCDE-23451')).toBeNull(); // 1
    expect(normalizeRecoveryCode('ABCDE-2345I')).toBeNull(); // I
    expect(normalizeRecoveryCode('abcde-2345i')).toBeNull(); // i upper-cases to I
    expect(normalizeRecoveryCode('ABCDE_23456')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE.23456')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-2345ſ')).toBeNull(); // long s would upper-case to S
    expect(normalizeRecoveryCode('ABCDE-2345é')).toBeNull();
    expect(normalizeRecoveryCode(42 as unknown as string)).toBeNull();
  });

  it('hashes a normalized code with a key derived from the MFA key and bound to the user (stable 64-character hex)', () => {
    const mfaKey = Buffer.alloc(32, 7);
    const key = deriveRecoveryCodeKey(mfaKey);
    const user = '0196f3a2-0000-7000-8000-000000000001';
    // Independent recomputation of the definition: HKDF-SHA-256 (empty salt, the versioned info), then HMAC-SHA-256.
    const expectedKey = Buffer.from(hkdfSync('sha256', mfaKey, Buffer.alloc(0), RECOVERY_CODE_KEY_INFO, 32));
    expect(key.equals(expectedKey)).toBe(true);
    expect(key.equals(mfaKey)).toBe(false);
    const hash = hashRecoveryCode(key, user, 'ABCDE23456');
    expect(hash).toBe(createHmac('sha256', expectedKey).update(`${user}:ABCDE23456`).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(key, user, 'ABCDE23456')).toBe(hash);
    expect(hashRecoveryCode(key, user.toUpperCase(), 'ABCDE23456')).toBe(hash);
    expect(hashRecoveryCode(key, user, normalizeRecoveryCode('abcde-23456') as string)).toBe(hash);
    expect(hashRecoveryCode(key, user, 'ABCDE23457')).not.toBe(hash);
    // Another user, another key, or the plain SHA-256 of the code: never the same stored value.
    expect(hashRecoveryCode(key, '0196f3a2-0000-7000-8000-000000000002', 'ABCDE23456')).not.toBe(hash);
    expect(hashRecoveryCode(deriveRecoveryCodeKey(Buffer.alloc(32, 8)), user, 'ABCDE23456')).not.toBe(hash);
    expect(hash).not.toBe(createHash('sha256').update('ABCDE23456').digest('hex'));
  });
});
