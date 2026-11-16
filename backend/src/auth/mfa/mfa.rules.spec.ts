// TEST-226 (MOD-01-H06 MFA-T02): the pure rules of the enrolment and
// management routes — the single factor of a disable request and the names in
// the `otpauth://` URI.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MFA_ISSUER, factorOf, mfaAccountLabel, mfaIssuer } from './mfa.rules.js';

describe('factorOf (API-209)', () => {
  it('takes exactly one of code and recoveryCode', () => {
    expect(factorOf({ code: '123456' })).toEqual({ kind: 'code', value: '123456' });
    expect(factorOf({ recoveryCode: 'ABCDE-FGHJK' })).toEqual({ kind: 'recovery_code', value: 'ABCDE-FGHJK' });
    expect(factorOf({ code: '123456', recoveryCode: null })).toEqual({ kind: 'code', value: '123456' });
    expect(factorOf({ code: undefined, recoveryCode: 'ABCDE-FGHJK' })).toEqual({ kind: 'recovery_code', value: 'ABCDE-FGHJK' });
  });

  it('refuses both and neither', () => {
    expect(factorOf({})).toBeNull();
    expect(factorOf({ code: null, recoveryCode: null })).toBeNull();
    expect(factorOf({ code: '123456', recoveryCode: 'ABCDE-FGHJK' })).toBeNull();
  });
});

describe('mfaIssuer', () => {
  it('prefers the English name, then the Arabic one', () => {
    expect(mfaIssuer({ ar: 'أكاديمية أرتي', en: 'Arti Academy' })).toBe('Arti Academy');
    expect(mfaIssuer({ ar: 'أكاديمية أرتي' })).toBe('أكاديمية أرتي');
    expect(mfaIssuer({ ar: 'أكاديمية أرتي', en: '   ' })).toBe('أكاديمية أرتي');
  });

  it('falls back to the default without a usable name', () => {
    expect(mfaIssuer(null)).toBe(DEFAULT_MFA_ISSUER);
    expect(mfaIssuer(undefined)).toBe(DEFAULT_MFA_ISSUER);
    expect(mfaIssuer({ en: 'No Arabic' })).toBe(DEFAULT_MFA_ISSUER);
    expect(mfaIssuer({ ar: ' : ' })).toBe(DEFAULT_MFA_ISSUER);
    expect(mfaIssuer('Arti Academy')).toBe(DEFAULT_MFA_ISSUER);
  });

  it('never keeps a colon (the label separator) and folds whitespace', () => {
    expect(mfaIssuer({ ar: 'x', en: '  Arti:  Istanbul \n Branch ' })).toBe('Arti Istanbul Branch');
  });
});

describe('mfaAccountLabel', () => {
  const id = '019a7c2e-5b1d-7f3a-9c4e-2d8b6a1f0e37';

  it('uses the e-mail, else the username, else the id', () => {
    expect(mfaAccountLabel({ id, email: 'sara@example.com', username: 'sara' })).toBe('sara@example.com');
    expect(mfaAccountLabel({ id, email: null, username: 'sara' })).toBe('sara');
    expect(mfaAccountLabel({ id, email: null, username: null })).toBe(id);
    expect(mfaAccountLabel({ id, email: '', username: ':' })).toBe(id);
  });
});
