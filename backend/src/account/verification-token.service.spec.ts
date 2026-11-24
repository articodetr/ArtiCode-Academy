// TEST-018 — one-time tokens of the account flows: shape, hashing, lifetimes.
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import {
  SELF_REGISTRATION_VIA,
  VERIFICATION_TOKEN_PATTERN,
  VerificationTokenService,
  isSelfRegistrationToken,
  tokenVia,
} from './verification-token.service.js';

function service(hours = 48, minutes = 30): VerificationTokenService {
  const values: Record<string, number> = { AUTH_INVITATION_TTL_HOURS: hours, AUTH_PASSWORD_RESET_TTL_MINUTES: minutes };
  return new VerificationTokenService({ get: (key: string) => values[key] } as unknown as ConfigService<Env, true>);
}

describe('VerificationTokenService (TEST-018)', () => {
  it('generates 43-character base64url tokens, all different, and keeps only a SHA-256 hex hash', () => {
    const tokens = service();
    const generated = Array.from({ length: 50 }, () => tokens.generate());
    for (const { token, hash } of generated) {
      expect(token).toMatch(VERIFICATION_TOKEN_PATTERN);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(tokens.hash(token));
      expect(hash).not.toContain(token);
    }
    expect(new Set(generated.map((item) => item.token)).size).toBe(50);
    expect(tokens.hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('recognises well-formed tokens before the database is asked', () => {
    const tokens = service();
    expect(tokens.isWellFormed(tokens.generate().token)).toBe(true);
    for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, 42, null, undefined]) {
      expect(tokens.isWellFormed(bad)).toBe(false);
    }
  });

  it('derives the lifetimes from AUTH_INVITATION_TTL_HOURS and AUTH_PASSWORD_RESET_TTL_MINUTES', () => {
    const tokens = service(48, 30);
    const from = new Date('2026-10-30T12:00:00.000Z');
    expect(tokens.invitationExpiry(from).toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(tokens.passwordResetExpiry(from).toISOString()).toBe('2026-10-30T12:30:00.000Z');

    const custom = service(1, 5);
    expect(custom.invitationTtlMs).toBe(3_600_000);
    expect(custom.passwordResetTtlMs).toBe(300_000);
    expect(custom.invitationExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the self-registration token kind (PORTAL-03)', () => {
  it('accepts an e-mail-verification token issued by self-registration only', () => {
    expect(SELF_REGISTRATION_VIA).toBe('self_registration');
    expect(isSelfRegistrationToken({ purpose: 'email_verification', metadata: { via: 'self_registration', email: 'a@b.test' } })).toBe(true);
    // An API-165/166 confirmation (via self | invitation), any other purpose, or no metadata: never a registration link.
    expect(isSelfRegistrationToken({ purpose: 'email_verification', metadata: { via: 'self', email: 'a@b.test' } })).toBe(false);
    expect(isSelfRegistrationToken({ purpose: 'email_verification', metadata: { via: 'invitation', email: 'a@b.test' } })).toBe(false);
    expect(isSelfRegistrationToken({ purpose: 'email_verification', metadata: null })).toBe(false);
    expect(isSelfRegistrationToken({ purpose: 'invitation', metadata: { via: 'self_registration' } })).toBe(false);
    expect(isSelfRegistrationToken({ purpose: 'password_reset', metadata: { via: 'self_registration' } })).toBe(false);
  });

  it('reads the via of a token from its metadata object only', () => {
    expect(tokenVia({ via: 'admin' })).toBe('admin');
    expect(tokenVia({ via: 3 })).toBeNull();
    expect(tokenVia(['via'])).toBeNull();
    expect(tokenVia('self_registration')).toBeNull();
    expect(tokenVia(null)).toBeNull();
    expect(tokenVia(undefined)).toBeNull();
  });
});
