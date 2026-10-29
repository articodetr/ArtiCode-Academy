import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_PASSWORD_MIN_LENGTH, PasswordService, passwordProblems } from './password.service.js';

describe('PasswordService (argon2id)', () => {
  const service = new PasswordService();

  it('produces argon2id hashes that verify only with the right password', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(await service.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await service.verify(hash, 'correct horse battery stapl')).toBe(false);
  });

  it('salts every hash and never throws on malformed input', async () => {
    const [a, b] = await Promise.all([service.hash('same password'), service.hash('same password')]);
    expect(a).not.toBe(b);
    expect(await service.verify('not-a-hash', 'x')).toBe(false);
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });

  it('enforces the length-based policy', () => {
    expect(passwordProblems('short')).toEqual(['at least 10 characters']);
    expect(passwordProblems('          ')).toEqual(['not only whitespace']);
    expect(passwordProblems('x'.repeat(129))).toEqual(['at most 128 characters']);
    expect(passwordProblems('long enough password')).toEqual([]);
    expect(passwordProblems('elevenchars', BOOTSTRAP_PASSWORD_MIN_LENGTH)).toEqual([
      `at least ${BOOTSTRAP_PASSWORD_MIN_LENGTH} characters`,
    ]);
  });
});
