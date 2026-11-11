import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/**
 * True when `value` is a finite number with at most `places` decimals.
 *
 * KI-075: class-validator 0.15.1 `isNumber(value, { maxDecimalPlaces })` counts
 * the decimals by splitting `value.toString()` on the dot, so an exponent form
 * without one (`1e-7`, `5e-324`) reads `undefined.length` and throws a
 * TypeError inside the ValidationPipe — a 500 instead of a 400. Rounding to
 * `places` and comparing gives the same verdict for every plain decimal (the
 * shortest representation of a double has at most `places` decimals exactly
 * when rounding to them gives the double back: 12.5 and 1e21 pass; 12.345,
 * 1.005 and 0.30000000000000004 fail) and refuses tiny exponent forms.
 */
export function hasAtMostDecimals(value: unknown, places: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number(value.toFixed(places)) === value;
}

/**
 * `@IsNumber({ maxDecimalPlaces: places, allowNaN: false, allowInfinity: false })`
 * without the KI-075 crash: a finite JSON number with at most `places` decimals.
 */
export function IsDecimalNumber(places: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isDecimalNumber',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [places],
      options: { message: `$property must be a number with at most ${places} decimal place${places === 1 ? '' : 's'}`, ...options },
      validator: {
        validate(value: unknown): boolean {
          return hasAtMostDecimals(value, places);
        },
      },
    });
  };
}
