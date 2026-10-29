// TEST-014 — MOD-03-T02 normalisation and format rules.
import {
  E164_PATTERN,
  REFERENCE_NUMBER_PATTERN,
  USERNAME_PATTERN,
  calendarDateToDate,
  identifierParam,
  isCalendarDate,
  normalizeIdentifier,
  normalizeText,
  textParam,
} from './users.validation.js';

describe('users validation', () => {
  it('normalises identifiers to trimmed lower-case and treats blanks as absent', () => {
    expect(normalizeIdentifier('  Sara.Ahmed@Example.COM ')).toBe('sara.ahmed@example.com');
    expect(normalizeIdentifier('SARA_01')).toBe('sara_01');
    expect(normalizeIdentifier('')).toBeUndefined();
    expect(normalizeIdentifier('   ')).toBeUndefined();
    expect(normalizeIdentifier(null)).toBeUndefined();
    expect(normalizeIdentifier(undefined)).toBeUndefined();
    expect(identifierParam({ value: ' Ali@Example.com ' })).toBe('ali@example.com');
    // Non-strings are left for the validator to reject with 400.
    expect(identifierParam({ value: 42 })).toBe(42);
    expect(identifierParam({ value: { a: 1 } })).toEqual({ a: 1 });
  });

  it('trims free text without changing its case', () => {
    expect(normalizeText('  سارة أحمد ')).toBe('سارة أحمد');
    expect(normalizeText('Sara Ahmed')).toBe('Sara Ahmed');
    expect(normalizeText('')).toBeUndefined();
    expect(textParam({ value: ' x ' })).toBe('x');
    expect(textParam({ value: 7 })).toBe(7);
  });

  it('accepts only real calendar days written as YYYY-MM-DD', () => {
    for (const ok of ['2012-05-01', '2024-02-29', '1999-12-31']) expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of ['2026-02-30', '2023-02-29', '2026-13-01', '2026-1-1', '01/05/2012', '2012-05-01T00:00:00Z', '', 20120501, null]) {
      expect(isCalendarDate(bad), String(bad)).toBe(false);
    }
    expect(calendarDateToDate('2012-05-01').toISOString()).toBe('2012-05-01T00:00:00.000Z');
  });

  it('defines the username, phone and reference-number formats', () => {
    for (const ok of ['sara', 'sara.ahmed', 'student_01', 'a-b', '007', 'x'.repeat(64)]) expect(USERNAME_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['ab', 'Sara', '.sara', 'sara ahmed', 'sara@x', 'x'.repeat(65), 'سارة']) expect(USERNAME_PATTERN.test(bad), bad).toBe(false);

    for (const ok of ['+905551234567', '+12025550123', '+4412345678']) expect(E164_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['05551234567', '+0555123', '+90 555 123 4567', '+9055512345678901', '+123456']) expect(E164_PATTERN.test(bad), bad).toBe(false);

    for (const ok of ['S-2026-001', 'EMP/12', 'a.b_c', '1']) expect(REFERENCE_NUMBER_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', ' S1', 'S 1', '-S1', 'x'.repeat(33), 'رقم']) expect(REFERENCE_NUMBER_PATTERN.test(bad), bad).toBe(false);
  });
});
