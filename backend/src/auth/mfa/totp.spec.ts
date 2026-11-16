// TEST-225 (MOD-01-H06 MFA, D-R105): TOTP, HOTP and Base32 against their RFC vectors.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_WINDOW,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  matchTotp,
  otpauthUri,
  totpCode,
  totpStep,
} from './totp.js';

const SEED_SHA1 = Buffer.from('12345678901234567890', 'ascii');
const SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii');
const SEED_SHA512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii');

/** RFC 6238 Appendix B: Unix seconds → 8-digit TOTP for SHA-1, SHA-256 and SHA-512. */
const RFC6238_VECTORS: Array<[number, string, string, string]> = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

/** RFC 4226 Appendix D: the 6-digit HOTP of counters 0..9 with the SHA-1 seed. */
const RFC4226_VECTORS = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

/** RFC 4648 §10. */
const BASE32_VECTORS: Array<[string, string]> = [
  ['', ''],
  ['f', 'MY'],
  ['fo', 'MZXQ'],
  ['foo', 'MZXW6'],
  ['foob', 'MZXW6YQ'],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI'],
];

describe('TOTP and HOTP (TEST-225)', () => {
  it('has the agreed parameters', () => {
    expect(TOTP_PERIOD_SECONDS).toBe(30);
    expect(TOTP_DIGITS).toBe(6);
    expect(TOTP_WINDOW).toBe(1);
    expect(TOTP_SECRET_BYTES).toBe(20);
  });

  it('matches the RFC 6238 Appendix B vectors for SHA-1, SHA-256 and SHA-512 (8 digits)', () => {
    for (const [seconds, sha1, sha256, sha512] of RFC6238_VECTORS) {
      const step = totpStep(seconds * 1000);
      expect(totpCode(SEED_SHA1, step, { digits: 8 })).toBe(sha1);
      expect(totpCode(SEED_SHA1, step, { digits: 8, algorithm: 'sha1' })).toBe(sha1);
      expect(totpCode(SEED_SHA256, step, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
      expect(totpCode(SEED_SHA512, step, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
    }
  });

  it('matches the RFC 4226 Appendix D HOTP vectors (6 digits by default)', () => {
    RFC4226_VECTORS.forEach((expected, counter) => {
      expect(totpCode(SEED_SHA1, counter)).toBe(expected);
    });
  });

  it('computes the time step as floor(seconds ÷ period)', () => {
    expect(totpStep(0)).toBe(0);
    expect(totpStep(29_999)).toBe(0);
    expect(totpStep(30_000)).toBe(1);
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(1111111109 * 1000)).toBe(37037036);
    expect(totpStep(20000000000 * 1000)).toBe(666666666);
    expect(totpStep(120_000, 60)).toBe(2);
  });

  it('refuses a negative or fractional step and an impossible digit count', () => {
    expect(() => totpCode(SEED_SHA1, -1)).toThrow(RangeError);
    expect(() => totpCode(SEED_SHA1, 1.5)).toThrow(RangeError);
    expect(() => totpCode(SEED_SHA1, 1, { digits: 0 })).toThrow(RangeError);
    expect(() => totpCode(SEED_SHA1, 1, { digits: 11 })).toThrow(RangeError);
  });

  it('generates a 32-character Base32 secret of 20 random bytes, different every time', () => {
    const first = generateTotpSecret();
    const second = generateTotpSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(first)?.length).toBe(20);
    expect(second).not.toBe(first);
  });

  it('builds the otpauth:// URI with the issuer and account encoded', () => {
    expect(otpauthUri({ issuer: 'ArtiCode Academy', account: 'st@articode.com', secret: 'JBSWY3DPEHPK3PXP' })).toBe(
      'otpauth://totp/ArtiCode%20Academy:st%40articode.com?secret=JBSWY3DPEHPK3PXP' +
        '&issuer=ArtiCode%20Academy&algorithm=SHA1&digits=6&period=30',
    );
    expect(otpauthUri({ issuer: 'أكاديمية', account: 'a:b&c', secret: 'MZXW6' })).toBe(
      `otpauth://totp/${encodeURIComponent('أكاديمية')}:a%3Ab%26c?secret=MZXW6` +
        `&issuer=${encodeURIComponent('أكاديمية')}&algorithm=SHA1&digits=6&period=30`,
    );
  });
});

describe('Base32 (TEST-225)', () => {
  it('encodes and decodes the RFC 4648 §10 vectors without padding', () => {
    for (const [plain, encoded] of BASE32_VECTORS) {
      expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded);
      expect(base32Decode(encoded)?.toString('ascii')).toBe(plain);
    }
  });

  it('round-trips random bytes of every length up to 40', () => {
    for (let length = 0; length <= 40; length += 1) {
      const bytes = randomBytes(length);
      const encoded = base32Encode(bytes);
      expect(encoded).not.toContain('=');
      expect(base32Decode(encoded)?.equals(bytes)).toBe(true);
    }
  });

  it('decodes lower case, spaces and trailing padding', () => {
    expect(base32Decode('mzxw6ytboi')?.toString('ascii')).toBe('foobar');
    expect(base32Decode('MZXW 6YTB OI')?.toString('ascii')).toBe('foobar');
    expect(base32Decode(' mzxw\t6ytb\noi ')?.toString('ascii')).toBe('foobar');
    expect(base32Decode('MY======')?.toString('ascii')).toBe('f');
    expect(base32Decode('MZXW6YQ=')?.toString('ascii')).toBe('foob');
    expect(base32Decode('MZXW6===')?.toString('ascii')).toBe('foo');
  });

  it('returns null for characters outside the alphabet, inner padding or an impossible length', () => {
    expect(base32Decode('MZXW1')).toBeNull(); // '1' is not Base32
    expect(base32Decode('MZXW8')).toBeNull();
    expect(base32Decode('MZXW0')).toBeNull();
    expect(base32Decode('MZ=XW6')).toBeNull(); // '=' inside
    expect(base32Decode('MZXW-6')).toBeNull();
    expect(base32Decode('MZXWé')).toBeNull();
    expect(base32Decode('MZXWı')).toBeNull(); // dotless i would upper-case to 'I'
    expect(base32Decode('M')).toBeNull(); // 1 character
    expect(base32Decode('MZX')).toBeNull(); // 3 characters
    expect(base32Decode('MZXW6Y')).toBeNull(); // 6 characters
  });
});

describe('matchTotp (TEST-225)', () => {
  const SECRET = 'JBSWY3DPEHPK3PXP';
  const KEY = base32Decode(SECRET) as Buffer;
  const NOW = Date.UTC(2026, 10, 16, 9, 0, 10); // 10 s into a step
  const CURRENT = totpStep(NOW);
  const codeAt = (step: number) => totpCode(KEY, step);

  it('uses distinct codes for the steps of this test', () => {
    const codes = [-2, -1, 0, 1, 2].map((offset) => codeAt(CURRENT + offset));
    expect(new Set(codes).size).toBe(5);
  });

  it('accepts the current code and returns its step', () => {
    expect(matchTotp(SECRET, codeAt(CURRENT), NOW, null)).toBe(CURRENT);
    expect(matchTotp(SECRET.toLowerCase(), codeAt(CURRENT), NOW, null)).toBe(CURRENT);
  });

  it('accepts one step either side and rejects two', () => {
    expect(matchTotp(SECRET, codeAt(CURRENT - 1), NOW, null)).toBe(CURRENT - 1);
    expect(matchTotp(SECRET, codeAt(CURRENT + 1), NOW, null)).toBe(CURRENT + 1);
    expect(matchTotp(SECRET, codeAt(CURRENT - 2), NOW, null)).toBeNull();
    expect(matchTotp(SECRET, codeAt(CURRENT + 2), NOW, null)).toBeNull();
    expect(matchTotp(SECRET, codeAt(CURRENT + 2), NOW, null, 2)).toBe(CURRENT + 2);
    expect(matchTotp(SECRET, codeAt(CURRENT + 1), NOW, null, 0)).toBeNull();
  });

  it('never accepts a step at or before the last one used (replay guard)', () => {
    expect(matchTotp(SECRET, codeAt(CURRENT), NOW, CURRENT)).toBeNull();
    expect(matchTotp(SECRET, codeAt(CURRENT), NOW, CURRENT + 1)).toBeNull();
    expect(matchTotp(SECRET, codeAt(CURRENT - 1), NOW, CURRENT - 1)).toBeNull();
    expect(matchTotp(SECRET, codeAt(CURRENT), NOW, CURRENT - 1)).toBe(CURRENT);
    expect(matchTotp(SECRET, codeAt(CURRENT + 1), NOW, CURRENT)).toBe(CURRENT + 1);
  });

  it('ignores ASCII whitespace in the typed code', () => {
    const code = codeAt(CURRENT);
    expect(matchTotp(SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, NOW, null)).toBe(CURRENT);
    expect(matchTotp(SECRET, ` ${code}\t`, NOW, null)).toBe(CURRENT);
  });

  it('rejects anything but exactly six digits', () => {
    const code = codeAt(CURRENT);
    expect(matchTotp(SECRET, code.slice(0, 5), NOW, null)).toBeNull();
    expect(matchTotp(SECRET, `${code}0`, NOW, null)).toBeNull();
    expect(matchTotp(SECRET, `${code.slice(0, 5)}a`, NOW, null)).toBeNull();
    expect(matchTotp(SECRET, `${code.slice(0, 3)}-${code.slice(3)}`, NOW, null)).toBeNull();
    expect(matchTotp(SECRET, '١٢٣٤٥٦', NOW, null)).toBeNull(); // Arabic-Indic digits
    expect(matchTotp(SECRET, '', NOW, null)).toBeNull();
  });

  it('rejects a wrong code and an undecodable or empty secret', () => {
    const window = new Set([-1, 0, 1].map((offset) => codeAt(CURRENT + offset)));
    let candidate = Number(codeAt(CURRENT));
    let wrong = '';
    do {
      candidate = (candidate + 1) % 1_000_000;
      wrong = candidate.toString().padStart(6, '0');
    } while (window.has(wrong));
    expect(matchTotp(SECRET, wrong, NOW, null)).toBeNull();
    expect(matchTotp('NOT-BASE32!', codeAt(CURRENT), NOW, null)).toBeNull();
    expect(matchTotp('', codeAt(CURRENT), NOW, null)).toBeNull();
  });

  it('does not try a negative step at the start of the epoch', () => {
    expect(matchTotp(SECRET, codeAt(0), 1_000, null)).toBe(0);
    expect(matchTotp(SECRET, codeAt(1), 1_000, null)).toBe(1);
  });
});
