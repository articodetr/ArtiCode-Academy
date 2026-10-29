// TEST-019 — identifiers shown on the public invitation preview are masked.
import { maskEmail, maskUsername } from './account.masking.js';

describe('invitation preview masking (TEST-019)', () => {
  it('masks e-mail addresses to the first character and the domain', () => {
    expect(maskEmail('sara@example.test')).toBe('s***@example.test');
    expect(maskEmail('s@example.test')).toBe('s***@example.test');
    expect(maskEmail('@example.test')).toBe('***');
    expect(maskEmail('sara@')).toBe('***');
    expect(maskEmail('no-at-sign')).toBe('***');
  });

  it('masks usernames to the first two characters', () => {
    expect(maskUsername('sara.ahmed')).toBe('sa***');
    expect(maskUsername('abc')).toBe('ab***');
    expect(maskUsername('ab')).toBe('***');
    expect(maskUsername('')).toBe('***');
  });
});
