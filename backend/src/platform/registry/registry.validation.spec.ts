// TEST-209 (unit) — MOD-18-T04 the input rules of the registry: origins,
// hostnames, plan limits; each mirrors a CHECK of the platform migration.
import { describe, expect, it } from 'vitest';
import {
  ACADEMY_ORIGIN_PATTERN,
  ACADEMY_SLUG_PATTERN,
  PLAN_KEY_PATTERN,
  canonicalLimits,
  checkPlanLimits,
  isHostname,
  normalizeOrigin,
  readPlanLimits,
  sameLimits,
} from './registry.validation.js';

describe('registry input rules (TEST-209)', () => {
  it('slug and plan key follow the CHECKs', () => {
    for (const ok of ['a', 'al-noor', 'a1', 'x'.repeat(32), '0academy9']) expect(ACADEMY_SLUG_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', '-a', 'a-', 'Al-Noor', 'al_noor', 'x'.repeat(33), 'a b']) expect(ACADEMY_SLUG_PATTERN.test(bad), bad).toBe(false);
    for (const ok of ['standard', 'pro_2026', 'a-b', '9']) expect(PLAN_KEY_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', '_a', 'Pro', 'a b', 'x'.repeat(41)]) expect(PLAN_KEY_PATTERN.test(bad), bad).toBe(false);
  });

  it('normalizes an origin to https://host[:port] (http on loopback only) and is idempotent', () => {
    expect(normalizeOrigin('HTTPS://Al-Noor.Example.COM/')).toBe('https://al-noor.example.com');
    expect(normalizeOrigin('  https://example.com:443  ')).toBe('https://example.com');
    expect(normalizeOrigin('https://example.com:8443')).toBe('https://example.com:8443');
    expect(normalizeOrigin('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(normalizeOrigin('http://127.0.0.1')).toBe('http://127.0.0.1');
    expect(normalizeOrigin('https://مثال.example')).toMatch(/^https:\/\/xn--/);
    for (const stored of ['https://al-noor.example.com', 'http://localhost:8080', 'https://example.com:8443']) {
      expect(normalizeOrigin(stored)).toBe(stored);
      expect(ACADEMY_ORIGIN_PATTERN.test(stored)).toBe(true);
    }
  });

  it('refuses a path, a query, a fragment, credentials, http off loopback and other schemes', () => {
    for (const bad of [
      'https://example.com/app',
      'https://example.com?x=1',
      'https://example.com?',
      'https://example.com#top',
      'https://user:pw@example.com',
      'http://example.com',
      'http://10.0.0.1',
      'ftp://example.com',
      'example.com',
      'https://[::1]',
      'https://exa_mple.com',
      '',
      `https://${'a'.repeat(260)}.com`,
    ]) {
      expect(normalizeOrigin(bad), bad).toBeNull();
    }
  });

  it('accepts lower-case DNS hostnames with two labels or localhost', () => {
    for (const ok of ['al-noor.articode.example', 'example.com', 'localhost', 'a.b', 'xn--mgbh0fb.example']) expect(isHostname(ok), ok).toBe(true);
    for (const bad of ['', 'example', 'Example.com', '-a.com', 'a-.com', 'a..b', 'a.com.', 'a_b.com', `${'a'.repeat(64)}.com`, 42, null]) {
      expect(isHostname(bad), String(bad)).toBe(false);
    }
    expect(isHostname(`${'a.'.repeat(126)}ab`)).toBe(false); // 254 characters
  });

  it('checks plan limits: a flat object of ≤ 20 camelCase keys with non-negative integers or null', () => {
    expect(checkPlanLimits({})).toEqual({ problems: [], keys: [] });
    expect(checkPlanLimits({ students: 500, storageGb: null, teachers: 0 })).toEqual({ problems: [], keys: [] });
    for (const bad of [null, [], 'x', 3]) expect(checkPlanLimits(bad)).toEqual({ problems: ['not_an_object'], keys: [] });
    expect(checkPlanLimits({ Students: 1, 'max-users': 2, ok: 3 })).toEqual({ problems: ['key_format'], keys: ['Students', 'max-users'] });
    expect(checkPlanLimits({ a: -1, b: 1.5, c: '5', d: true, e: { x: 1 }, f: [1] })).toEqual({
      problems: ['value_type'],
      keys: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(checkPlanLimits(many)).toEqual({ problems: ['too_many_keys'], keys: [] });
    expect(checkPlanLimits({ ...many, Bad: -1 }).problems).toEqual(['too_many_keys', 'key_format', 'value_type']);
  });

  it('compares and stores limits independently of key order', () => {
    expect(Object.keys(canonicalLimits({ students: 1, admins: 2 }))).toEqual(['admins', 'students']);
    expect(sameLimits({ a: 1, b: null }, { b: null, a: 1 })).toBe(true);
    expect(sameLimits({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameLimits({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(readPlanLimits({ z: 1, a: null, junk: 'x' })).toEqual({ a: null, z: 1 });
    expect(readPlanLimits(null)).toEqual({});
  });
});
