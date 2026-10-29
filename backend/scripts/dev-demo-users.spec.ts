import { describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  DEMO_EMAIL_DOMAIN_DEFAULT,
  DEMO_PASSWORD_MIN_LENGTH,
  demoEmail,
  demoUsersInputProblems,
  isRefusedEnvironment,
  normalizeDomain,
} from './dev-demo-users.js';

describe('dev-demo-users (development tool)', () => {
  it('defines one admin, one teacher and one student with the matching profile', () => {
    expect(DEMO_ACCOUNTS.map((account) => account.localPart)).toEqual(['admin', 'teacher', 'student']);
    expect(DEMO_ACCOUNTS.map((account) => account.roleKey)).toEqual(['academy_admin', 'teacher', 'student']);
    expect(DEMO_ACCOUNTS[0]?.profile).toBeNull();
    expect(DEMO_ACCOUNTS[1]?.profile).toEqual({ kind: 'employee', employeeKind: 'teacher' });
    expect(DEMO_ACCOUNTS[2]?.profile).toEqual({ kind: 'student' });
    expect(DEMO_ACCOUNTS.map((account) => demoEmail(account, DEMO_EMAIL_DOMAIN_DEFAULT))).toEqual([
      'admin@articode.com',
      'teacher@articode.com',
      'student@articode.com',
    ]);
  });

  it('refuses NODE_ENV=production and nothing else', () => {
    expect(isRefusedEnvironment('production')).toBe(true);
    expect(isRefusedEnvironment(' Production ')).toBe(true);
    for (const nodeEnv of ['development', 'test', '', undefined]) {
      expect(isRefusedEnvironment(nodeEnv), String(nodeEnv)).toBe(false);
    }
  });

  it('normalises the e-mail domain and rejects malformed ones', () => {
    expect(normalizeDomain(undefined)).toBe('articode.com');
    expect(normalizeDomain('   ')).toBe('articode.com');
    expect(normalizeDomain('  Demo.Example.ORG ')).toBe('demo.example.org');

    const password = 'x'.repeat(DEMO_PASSWORD_MIN_LENGTH);
    expect(demoUsersInputProblems({ domain: 'articode.com', password })).toEqual([]);
    expect(demoUsersInputProblems({ domain: 'demo.academy.example', password })).toEqual([]);
    for (const domain of ['localhost', 'bad domain.com', '-x.com', 'x.com/', 'a@b.com', 'x..com', '']) {
      expect(demoUsersInputProblems({ domain, password }), domain).toHaveLength(1);
    }
  });

  it('applies the first-admin password minimum to the shared password', () => {
    expect(DEMO_PASSWORD_MIN_LENGTH).toBe(12);
    expect(demoUsersInputProblems({ domain: 'articode.com', password: '11223344' })).toEqual([
      'password must be at least 12 characters',
    ]);
    expect(demoUsersInputProblems({ domain: 'articode.com', password: ' '.repeat(12) })).toEqual([
      'password must be not only whitespace',
    ]);
    expect(demoUsersInputProblems({ domain: 'articode.com', password: '112233445566' })).toEqual([]);
  });
});
