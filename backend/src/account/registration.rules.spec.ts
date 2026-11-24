// PORTAL-03 (#207) — the body rules of self-registration and the per-client trackers of its limits; no database.
import { describe, expect, it } from 'vitest';
import {
  FULL_NAME_MAX_LENGTH,
  PENDING_SELF_REGISTRATION_WHERE,
  checkCompleteBody,
  checkRegisterBody,
  emailProblem,
  fullNameProblem,
  isPendingSelfRegistration,
  localeProblem,
  normalizeRegistrationEmail,
  passwordShapeProblem,
} from './registration.rules.js';
import { completionClientTracker, registrationClientTracker } from './registration.throttle.js';

describe('registration.rules — fields', () => {
  it('words a full name in the contract problem codes, counting characters as a person sees them', () => {
    expect(fullNameProblem(undefined)).toBe('required');
    expect(fullNameProblem('')).toBe('required');
    expect(fullNameProblem('   ')).toBe('blank');
    expect(fullNameProblem('س')).toBe('too_short');
    expect(fullNameProblem(' س ')).toBe('too_short');
    expect(fullNameProblem('سا')).toBeNull();
    expect(fullNameProblem('👩‍🎓x')).toBeNull();
    expect(fullNameProblem('a'.repeat(FULL_NAME_MAX_LENGTH))).toBeNull();
    expect(fullNameProblem('a'.repeat(FULL_NAME_MAX_LENGTH + 1))).toBe('too_long');
    // 200 emoji are 400 UTF-16 units but 200 characters.
    expect(fullNameProblem('😀'.repeat(FULL_NAME_MAX_LENGTH))).toBeNull();
    for (const wrong of [42, true, null, ['Sara'], { ar: 'سارة' }]) expect(fullNameProblem(wrong), String(wrong)).toBe('invalid_format');
    expect(fullNameProblem('Sara\nAhmed')).toBe('invalid_format');
  });

  it('words an e-mail address', () => {
    expect(emailProblem(undefined)).toBe('required');
    expect(emailProblem('')).toBe('required');
    expect(emailProblem('  ')).toBe('blank');
    expect(emailProblem('sara@example.test')).toBeNull();
    expect(emailProblem('  Sara@Example.Test ')).toBeNull();
    for (const wrong of ['sara', 'sara@', '@example.test', 'sara@example', 'sa ra@example.test', 'sara\t@example.test']) {
      expect(emailProblem(wrong), wrong).toBe('invalid_format');
    }
    expect(emailProblem(`${'a'.repeat(310)}@example.test`)).toBe('too_long');
    expect(emailProblem(7)).toBe('invalid_format');
    expect(emailProblem(null)).toBe('invalid_format');
  });

  it('accepts an absent locale or one of ar/en/tr only', () => {
    expect(localeProblem(undefined)).toBeNull();
    for (const locale of ['ar', 'en', 'tr']) expect(localeProblem(locale)).toBeNull();
    for (const wrong of [null, 'fr', 'AR', '', 1]) expect(localeProblem(wrong), String(wrong)).toBe('invalid_format');
  });

  it('requires a password string (its policy is password_weak, checked later)', () => {
    expect(passwordShapeProblem(undefined)).toBe('required');
    expect(passwordShapeProblem('')).toBe('required');
    expect(passwordShapeProblem('short')).toBeNull();
    expect(passwordShapeProblem(12345678901)).toBe('invalid_format');
  });

  it('recognises a self-registered account awaiting its holder by the row alone: pending and without a password', () => {
    expect(isPendingSelfRegistration({ status: 'pending', passwordHash: null })).toBe(true);
    expect(isPendingSelfRegistration({ status: 'pending', passwordHash: '$argon2id$v=19$…' })).toBe(false);
    for (const status of ['invited', 'active', 'suspended', 'archived']) {
      expect(isPendingSelfRegistration({ status, passwordHash: null }), status).toBe(false);
    }
    // The query-filter form says the same.
    expect(isPendingSelfRegistration(PENDING_SELF_REGISTRATION_WHERE)).toBe(true);
    expect(PENDING_SELF_REGISTRATION_WHERE).toEqual({ status: 'pending', passwordHash: null });
  });

  it('normalises the address like every stored e-mail', () => {
    expect(normalizeRegistrationEmail('  Sara.Ahmed@Example.TEST ')).toBe('sara.ahmed@example.test');
  });
});

describe('registration.rules — bodies', () => {
  it('returns the normalised input of a valid registration', () => {
    expect(checkRegisterBody({ fullName: '  سارة أحمد ', email: ' Sara@Example.Test', locale: 'en' })).toEqual({
      ok: true,
      value: { fullName: 'سارة أحمد', email: 'sara@example.test', locale: 'en' },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test' })).toEqual({
      ok: true,
      value: { fullName: 'Sara', email: 'sara@example.test', locale: null },
    });
  });

  it('puts every problem under its field and every unexpected field in unknown', () => {
    expect(checkRegisterBody({ fullName: 'S', email: 'nope', locale: 'fr', password: 'x', roleKeys: ['academy_admin'] })).toEqual({
      ok: false,
      violations: { fields: { fullName: ['too_short'], email: ['invalid_format'], locale: ['invalid_format'] }, unknown: ['password', 'roleKeys'] },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test', role: 'staff' })).toEqual({
      ok: false,
      violations: { fields: {}, unknown: ['role'] },
    });
  });

  it('reads a body that is not a JSON object as an empty one', () => {
    for (const body of [undefined, null, 'text', 42, ['fullName']]) {
      expect(checkRegisterBody(body), String(body)).toEqual({
        ok: false,
        violations: { fields: { fullName: ['required'], email: ['required'] }, unknown: [] },
      });
    }
  });

  it('checks a completion: the password required, the name optional, nothing else accepted', () => {
    expect(checkCompleteBody({ password: 'Correct-Horse-9' })).toEqual({ ok: true, value: { password: 'Correct-Horse-9', fullName: null } });
    expect(checkCompleteBody({ password: 'Correct-Horse-9', fullName: '  New Name ' })).toEqual({
      ok: true,
      value: { password: 'Correct-Horse-9', fullName: 'New Name' },
    });
    expect(checkCompleteBody({})).toEqual({ ok: false, violations: { fields: { password: ['required'] }, unknown: [] } });
    expect(checkCompleteBody({ password: 'Correct-Horse-9', fullName: ' ', email: 'x@example.test' })).toEqual({
      ok: false,
      violations: { fields: { fullName: ['blank'] }, unknown: ['email'] },
    });
    expect(checkCompleteBody({ password: 'Correct-Horse-9', fullName: null })).toEqual({
      ok: false,
      violations: { fields: { fullName: ['invalid_format'] }, unknown: [] },
    });
  });
});

describe('registration.throttle — the per-client key', () => {
  it('keys a registration by IP and the address as it will be stored', () => {
    expect(registrationClientTracker({ ip: '10.0.0.1', body: { email: ' Sara@Example.Test ' } })).toBe('10.0.0.1|register:sara@example.test');
    expect(registrationClientTracker({ ip: '10.0.0.1', body: { email: 42 } })).toBe('10.0.0.1|register:');
    expect(registrationClientTracker({ ip: '10.0.0.1' })).toBe('10.0.0.1|register:');
    expect(registrationClientTracker({ body: { email: 'a@b.test' } })).toBe('|register:a@b.test');
  });

  it('keys a completion by IP and a digest of the token, never the token itself', () => {
    const token = 'A'.repeat(43);
    const key = completionClientTracker({ ip: '10.0.0.1', params: { token } });
    const DIGEST_KEY = /^10\.0\.0\.1\|register-complete:[0-9a-f]{32}$/;
    expect(key).toMatch(DIGEST_KEY);
    expect(key).not.toContain(token);
    expect(completionClientTracker({ ip: '10.0.0.1', params: { token } })).toBe(key);
    expect(completionClientTracker({ ip: '10.0.0.2', params: { token } })).not.toBe(key);
    expect(completionClientTracker({ ip: '10.0.0.1', params: { token: 'B'.repeat(43) } })).not.toBe(key);
    expect(completionClientTracker({ ip: '10.0.0.1' })).toMatch(DIGEST_KEY);
  });
});
