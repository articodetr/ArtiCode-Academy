// TEST-036 (unit part) — MOD-02/MOD-14 update planning (diff against the
// current row, whole-object name comparison, null clears, fixed field order)
// and the format rules (IANA time zone, ISO 4217 currency) — pure functions,
// no database.
import type { AcademyPatch, CurrentAcademyRow } from './academy.changes.js';
import { ACADEMY_PATCH_FIELDS, isEmptyAcademyPatch, planAcademyUpdate, sameLocalizedText } from './academy.changes.js';
import { CURRENCY_PATTERN, currencyParam, isIanaTimeZone, supportedTimeZones } from './academy.validation.js';

function row(overrides: Partial<CurrentAcademyRow> = {}): CurrentAcademyRow {
  return {
    name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' },
    logoUrl: null,
    defaultLocale: 'ar',
    timezone: 'Asia/Riyadh',
    currency: 'SAR',
    contactEmail: 'info@example.test',
    contactPhone: null,
    ...overrides,
  };
}

describe('academy update planning', () => {
  it('detects an empty body and nothing else', () => {
    expect(isEmptyAcademyPatch({})).toBe(true);
    expect(isEmptyAcademyPatch({ logoUrl: undefined })).toBe(true);
    expect(isEmptyAcademyPatch({ logoUrl: null })).toBe(false);
    expect(isEmptyAcademyPatch({ name: { ar: 'x' } })).toBe(false);
  });

  it('writes only the fields whose value changes, in the fixed order of ACADEMY_PATCH_FIELDS', () => {
    const patch: AcademyPatch = {
      contactPhone: '+966500000000',
      currency: 'SAR', // unchanged
      timezone: 'Europe/Istanbul',
      defaultLocale: 'ar', // unchanged
      logoUrl: 'https://cdn.example.test/logo.png',
    };
    const plan = planAcademyUpdate(row(), patch);
    expect(plan.fields).toEqual(['logoUrl', 'timezone', 'contactPhone']);
    expect(plan.data).toEqual({ logoUrl: 'https://cdn.example.test/logo.png', timezone: 'Europe/Istanbul', contactPhone: '+966500000000' });
    expect(ACADEMY_PATCH_FIELDS).toEqual(['name', 'logoUrl', 'defaultLocale', 'timezone', 'currency', 'contactEmail', 'contactPhone']);
  });

  it('yields no fields for an idempotent PATCH, including an equal name object', () => {
    const plan = planAcademyUpdate(row(), {
      name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' },
      logoUrl: null,
      contactEmail: 'info@example.test',
      currency: 'SAR',
    });
    expect(plan.fields).toEqual([]);
    expect(plan.data).toEqual({});
  });

  it('compares the name as a whole object: a changed or dropped locale is a change, an absent one equals a missing one', () => {
    expect(sameLocalizedText({ ar: 'أ', en: 'A' }, { ar: 'أ', en: 'A' })).toBe(true);
    expect(sameLocalizedText({ ar: 'أ' }, { ar: 'أ', en: undefined })).toBe(true);
    expect(sameLocalizedText({ ar: 'أ', en: 'A' }, { ar: 'أ' })).toBe(false);
    expect(sameLocalizedText({ ar: 'أ' }, { ar: 'ب' })).toBe(false);
    expect(sameLocalizedText({ ar: 'أ', tr: 'T' }, { ar: 'أ' })).toBe(false);

    const plan = planAcademyUpdate(row(), { name: { ar: 'أكاديمية آرتي كود' } });
    expect(plan.fields).toEqual(['name']);
    expect(plan.data).toEqual({ name: { ar: 'أكاديمية آرتي كود' } });
  });

  it('clears nullable fields with null and treats null equal to null as unchanged', () => {
    const plan = planAcademyUpdate(row(), { contactEmail: null, logoUrl: null, contactPhone: null });
    expect(plan.fields).toEqual(['contactEmail']);
    expect(plan.data).toEqual({ contactEmail: null });
  });
});

describe('academy format rules', () => {
  it('accepts canonical IANA zone names and UTC only', () => {
    expect(isIanaTimeZone('Asia/Riyadh')).toBe(true);
    expect(isIanaTimeZone('Europe/Istanbul')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Etc/UTC')).toBe(false); // not in the canonical list
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isIanaTimeZone('asia/riyadh')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(300);
    expect(zones).toContain('UTC');
    expect(zones).toEqual([...zones].sort());
  });

  it('upper-cases the currency before the ISO 4217 pattern checks it', () => {
    expect(currencyParam({ value: ' sar ' })).toBe('SAR');
    expect(currencyParam({ value: 42 })).toBe(42);
    expect(currencyParam({ value: null })).toBeNull();
    for (const code of ['SAR', 'TRY', 'USD']) expect(CURRENCY_PATTERN.test(code), code).toBe(true);
    for (const code of ['sar', 'SA', 'SAR1', 'S4R', '']) expect(CURRENCY_PATTERN.test(code), code).toBe(false);
  });
});
