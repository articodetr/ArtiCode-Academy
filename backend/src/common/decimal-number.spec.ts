import { isNumber, validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { IsDecimalNumber, hasAtMostDecimals } from './decimal-number.js';

class Priced {
  @IsDecimalNumber(2)
  amount: unknown;
}

const check = async (amount: unknown) => {
  const dto = Object.assign(new Priced(), { amount });
  return validate(dto);
};

describe('hasAtMostDecimals / IsDecimalNumber (KI-075, TEST-166)', () => {
  it('keeps the verdicts of class-validator for plain decimals', () => {
    const plain = [0, -0, 1, 12.5, 12.34, 0.1, 0.29, 999999.99, 1e21, 1.5e21, -3.75, 12.345, 1.005, 0.30000000000000004, 2.675, 1 / 3];
    for (const value of plain) {
      expect(hasAtMostDecimals(value, 2), String(value)).toBe(isNumber(value, { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }));
    }
    expect(hasAtMostDecimals(2.5, 1)).toBe(true);
    expect(hasAtMostDecimals(2.55, 1)).toBe(false);
  });

  it('refuses tiny exponent forms where class-validator throws', () => {
    for (const value of [1e-7, 5e-324, 3e-10]) {
      expect(() => isNumber(value, { maxDecimalPlaces: 2 }), String(value)).toThrow(TypeError);
      expect(hasAtMostDecimals(value, 2), String(value)).toBe(false);
    }
    // A mantissa with a dot is counted by class-validator and refused by both.
    expect(hasAtMostDecimals(1.5e-7, 2)).toBe(false);
  });

  it('refuses what is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '12.5', null, undefined, true, {}]) {
      expect(hasAtMostDecimals(value, 2), String(value)).toBe(false);
    }
  });

  it('as a decorator: an exponent form is a validation error with a clear message, not an exception', async () => {
    const errors = await check(1e-7);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.constraints).toEqual({ isDecimalNumber: 'amount must be a number with at most 2 decimal places' });
    expect(await check(12.34)).toEqual([]);
    expect(await check(12.345)).toHaveLength(1);
  });
});
