// Format rules of the academy settings (MOD-02/MOD-14, D-R10): the IANA time
// zone must be one the runtime knows (`Intl.supportedValuesOf('timeZone')` —
// canonical names only, so aliases such as `Asia/Calcutta` are refused) or the
// bare `UTC`, which V8 leaves out of that list although every runtime and
// PostgreSQL accept it (it is also what the local seed holds); the currency an
// ISO 4217 code (three upper-case letters, the CHECK
// `ck_academy_currency_iso4217` repeats it in the database). Pure functions
// plus one class-validator decorator; unit-tested in academy.changes.spec.ts.
// The frontend mirrors both rules (academy.validation.ts).
import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** Accepted besides the canonical list: the neutral zone every runtime formats. */
export const UTC_TIME_ZONE = 'UTC';

/** Canonical IANA zone names known to this Node/ICU build plus `UTC`, resolved once. */
const SUPPORTED_TIME_ZONES: ReadonlySet<string> = new Set([UTC_TIME_ZONE, ...Intl.supportedValuesOf('timeZone')]);

/** ISO 4217 alphabetic code — three upper-case letters (as the database CHECK). */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Longest time zone name accepted before even looking it up. */
export const TIME_ZONE_MAX_LENGTH = 64;

/** True for a canonical IANA time zone name (or `UTC`) the runtime can format dates in. */
export function isIanaTimeZone(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_TIME_ZONES.has(value);
}

/** The supported zones, sorted — what a picker can offer. */
export function supportedTimeZones(): string[] {
  return [...SUPPORTED_TIME_ZONES].sort();
}

/** @Transform for the currency: trimmed and upper-cased so `sar` becomes `SAR`; other types are left for the validator. */
export function currencyParam({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/** class-validator decorator: the property must be a canonical IANA time zone name. */
export function IsIanaTimeZone(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a canonical IANA time zone name such as "Asia/Riyadh"`,
        ...options,
      },
      validator: { validate: (value: unknown) => isIanaTimeZone(value) },
    });
  };
}
