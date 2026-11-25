// PORTAL-03/04 (#207, contract v3) — the body rules of self-registration, the marker rule, the wrong-password count
// of a link and the per-client trackers of its limits; no database.
import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH } from '../auth/password.service.js';
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
import { REGISTRATION_PASSWORD_ATTEMPTS, wrongPasswordAttempts } from './registration.service.js';
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

  it('requires a password string of at most the policy maximum (the rest of its policy is password_weak, checked later)', () => {
    expect(passwordShapeProblem(undefined)).toBe('required');
    expect(passwordShapeProblem('')).toBe('required');
    expect(passwordShapeProblem('short')).toBeNull();
    expect(passwordShapeProblem(' '.repeat(12))).toBeNull();
    expect(passwordShapeProblem('x'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(passwordShapeProblem('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe('too_long');
    expect(passwordShapeProblem(12345678901)).toBe('invalid_format');
    expect(passwordShapeProblem(null)).toBe('invalid_format');
  });

  it('recognises a self-registered account awaiting its holder by its marker (contract v3): pending and self_registered_at set', () => {
    const at = new Date('2026-11-25T10:00:00.000Z');
    expect(isPendingSelfRegistration({ status: 'pending', selfRegisteredAt: at })).toBe(true);
    // Pending without the marker is an account awaiting approval, with or without a password.
    expect(isPendingSelfRegistration({ status: 'pending', selfRegisteredAt: null })).toBe(false);
    for (const status of ['invited', 'active', 'suspended', 'archived']) {
      expect(isPendingSelfRegistration({ status, selfRegisteredAt: at }), status).toBe(false);
    }
    // The query-filter form says the same.
    expect(PENDING_SELF_REGISTRATION_WHERE).toEqual({ status: 'pending', selfRegisteredAt: { not: null } });
  });

  it('normalises the address like every stored e-mail', () => {
    expect(normalizeRegistrationEmail('  Sara.Ahmed@Example.TEST ')).toBe('sara.ahmed@example.test');
  });
});

describe('registration.rules — bodies', () => {
  const PASSWORD = 'Correct-Horse-9';

  it('returns the normalised input of a valid registration, the password as typed', () => {
    expect(checkRegisterBody({ fullName: '  سارة أحمد ', email: ' Sara@Example.Test', password: ` ${PASSWORD} `, locale: 'en' })).toEqual({
      ok: true,
      value: { fullName: 'سارة أحمد', email: 'sara@example.test', password: ` ${PASSWORD} `, locale: 'en' },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test', password: PASSWORD })).toEqual({
      ok: true,
      value: { fullName: 'Sara', email: 'sara@example.test', password: PASSWORD, locale: null },
    });
  });

  it('puts every problem under its field and every unexpected field in unknown', () => {
    expect(checkRegisterBody({ fullName: 'S', email: 'nope', locale: 'fr', password: 7, roleKeys: ['academy_admin'] })).toEqual({
      ok: false,
      violations: {
        fields: { fullName: ['too_short'], email: ['invalid_format'], password: ['invalid_format'], locale: ['invalid_format'] },
        unknown: ['roleKeys'],
      },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test', password: PASSWORD, role: 'staff' })).toEqual({
      ok: false,
      violations: { fields: {}, unknown: ['role'] },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test' })).toEqual({
      ok: false,
      violations: { fields: { password: ['required'] }, unknown: [] },
    });
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) })).toEqual({
      ok: false,
      violations: { fields: { password: ['too_long'] }, unknown: [] },
    });
    // A short password has the right shape: its policy is password_weak, the service's next check.
    expect(checkRegisterBody({ fullName: 'Sara', email: 'sara@example.test', password: 'short' }).ok).toBe(true);
  });

  it('reads a body that is not a JSON object as an empty one', () => {
    for (const body of [undefined, null, 'text', 42, ['fullName']]) {
      expect(checkRegisterBody(body), String(body)).toEqual({
        ok: false,
        violations: { fields: { fullName: ['required'], email: ['required'], password: ['required'] }, unknown: [] },
      });
    }
  });

  it('checks a completion: the password chosen at registration only, nothing else accepted', () => {
    expect(checkCompleteBody({ password: PASSWORD })).toEqual({ ok: true, value: { password: PASSWORD } });
    expect(checkCompleteBody({})).toEqual({ ok: false, violations: { fields: { password: ['required'] }, unknown: [] } });
    // The name was fixed at registration: v2's optional fullName is refused like any other field.
    expect(checkCompleteBody({ password: PASSWORD, fullName: 'New Name', email: 'x@example.test' })).toEqual({
      ok: false,
      violations: { fields: {}, unknown: ['email', 'fullName'] },
    });
    expect(checkCompleteBody({ password: null })).toEqual({ ok: false, violations: { fields: { password: ['invalid_format'] }, unknown: [] } });
    expect(checkCompleteBody({ password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) })).toEqual({
      ok: false,
      violations: { fields: { password: ['too_long'] }, unknown: [] },
    });
  });
});

describe('registration.service — the wrong-password count of a link', () => {
  it('reads the attempts from the link metadata, 0 when absent or malformed', () => {
    expect(wrongPasswordAttempts(null)).toBe(0);
    expect(wrongPasswordAttempts({ via: 'self_registration', email: 'a@b.test' })).toBe(0);
    expect(wrongPasswordAttempts({ via: 'self_registration', attempts: 3 })).toBe(3);
    for (const wrong of [-1, 1.5, '2', null, [1]]) expect(wrongPasswordAttempts({ attempts: wrong }), String(wrong)).toBe(0);
    expect(wrongPasswordAttempts([1, 2])).toBe(0);
    expect(REGISTRATION_PASSWORD_ATTEMPTS).toBe(5);
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
