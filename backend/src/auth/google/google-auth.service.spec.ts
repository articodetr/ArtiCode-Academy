// PORTAL-04 — GoogleAuthService without a database: the pure account rules,
// and the order of the callback's checks before anything touches Google or
// the database (unconfigured, refused at Google, the state cookie).
import { GoogleAuthService, fullNameFrom, isPendingSelfRegistration, isUnavailable } from './google-auth.service.js';
import { deriveStateKey, newGoogleAttempt, signGoogleState } from './google-state.js';

const NOW = new Date('2026-11-24T10:00:00.000Z');
const SECRET = 'google-service-test-secret-'.repeat(2);
const CONFIG = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'test-only-secret', redirectUri: 'https://academy.example/api/auth/google/callback' };
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

function makeService(config: typeof CONFIG | null = CONFIG) {
  const authenticate = vi.fn();
  const prisma = { db: {} };
  const env = { get: vi.fn((key: string) => (key === 'JWT_SECRET' ? SECRET : undefined)) };
  const service = new GoogleAuthService(prisma as never, { record: vi.fn() } as never, { beginSession: vi.fn() } as never, { authenticate } as never, config, env as never);
  return { service, authenticate };
}

describe('the account rules', () => {
  const active = { status: 'active' as const, deletedAt: null, lockedUntil: null };

  it('treats suspended, archived, soft-deleted and locked accounts as unavailable — a lock only while it lasts', () => {
    expect(isUnavailable(active, NOW)).toBe(false);
    expect(isUnavailable({ ...active, status: 'suspended' }, NOW)).toBe(true);
    expect(isUnavailable({ ...active, status: 'archived' }, NOW)).toBe(true);
    expect(isUnavailable({ ...active, deletedAt: NOW }, NOW)).toBe(true);
    expect(isUnavailable({ ...active, lockedUntil: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(true);
    expect(isUnavailable({ ...active, lockedUntil: new Date(NOW.getTime() - 60_000) }, NOW)).toBe(false);
    // Invited and pending accounts are not "unavailable": they get link_required or the activation.
    expect(isUnavailable({ ...active, status: 'invited' }, NOW)).toBe(false);
    expect(isUnavailable({ ...active, status: 'pending' }, NOW)).toBe(false);
  });

  it('recognises a pending self-registered account by its missing password', () => {
    expect(isPendingSelfRegistration({ status: 'pending', passwordHash: null })).toBe(true);
    expect(isPendingSelfRegistration({ status: 'pending', passwordHash: '$argon2id$…' })).toBe(false);
    expect(isPendingSelfRegistration({ status: 'invited', passwordHash: null })).toBe(false);
    expect(isPendingSelfRegistration({ status: 'active', passwordHash: null })).toBe(false);
  });

  it('names a new account from Google, cleaned, else from the e-mail', () => {
    expect(fullNameFrom({ name: '  Sara   Ahmed ', email: 'sara@example.test' })).toBe('Sara Ahmed');
    expect(fullNameFrom({ name: 'سارة\u0000أحمد\n', email: 'sara@example.test' })).toBe('سارة أحمد');
    expect(fullNameFrom({ name: null, email: 'sara.ahmed@example.test' })).toBe('sara.ahmed');
    expect(fullNameFrom({ name: ' x ', email: 'sara@example.test' })).toBe('sara');
    expect(fullNameFrom({ name: null, email: 'a@example.test' })).toBe('a@example.test');
    expect([...fullNameFrom({ name: 'ب'.repeat(300), email: 'a@example.test' })]).toHaveLength(200);
  });
});

describe('GoogleAuthService', () => {
  it('start refuses with 503 google_unavailable when Google is not configured', async () => {
    const { service } = makeService(null);
    expect(service.configured).toBe(false);
    await expect(service.start('/')).rejects.toMatchObject({ status: 503, code: 'google_unavailable' });
  });

  it('start answers the authorization URL and a state token that carries the safe returnTo', async () => {
    const { service } = makeService();
    const { url, stateToken } = await service.start('//evil.example');
    expect(new URL(url).searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(stateToken.split('.')).toHaveLength(3);
    // Without a code from Google the callback goes no further than the state check.
    const outcome = await service.callback({ state: new URL(url).searchParams.get('state'), error: 'access_denied' }, stateToken, CTX);
    expect(outcome).toEqual({ kind: 'failure', code: 'cancelled', returnTo: '/' });
  });

  it('callback: unavailable, then cancelled/failed for a Google error, then failed without a valid matching state — Google is never asked', async () => {
    const unconfigured = makeService(null);
    expect(await unconfigured.service.callback({ code: 'c', state: 's' }, undefined, CTX)).toMatchObject({ kind: 'failure', code: 'unavailable' });

    const { service, authenticate } = makeService();
    const attempt = newGoogleAttempt('/catalog');
    const cookie = await signGoogleState(deriveStateKey(SECRET), attempt);
    expect(await service.callback({ error: 'access_denied' }, cookie, CTX)).toEqual({ kind: 'failure', code: 'cancelled', returnTo: '/catalog' });
    expect(await service.callback({ error: 'server_error' }, cookie, CTX)).toEqual({ kind: 'failure', code: 'failed', returnTo: '/catalog' });
    expect(await service.callback({ code: 'c', state: attempt.state }, undefined, CTX)).toEqual({ kind: 'failure', code: 'failed', returnTo: '/' });
    expect(await service.callback({ code: 'c', state: attempt.state }, 'forged.cookie.value', CTX)).toEqual({ kind: 'failure', code: 'failed', returnTo: '/' });
    const otherKey = await signGoogleState(deriveStateKey(`${SECRET}-other`), attempt);
    expect(await service.callback({ code: 'c', state: attempt.state }, otherKey, CTX)).toMatchObject({ code: 'failed' });
    expect(await service.callback({ code: 'c', state: 'another-state' }, cookie, CTX)).toEqual({ kind: 'failure', code: 'failed', returnTo: '/catalog' });
    expect(await service.callback({ code: 'c', state: [attempt.state] }, cookie, CTX)).toMatchObject({ code: 'failed' });
    expect(await service.callback({ state: attempt.state }, cookie, CTX)).toMatchObject({ code: 'failed' });
    expect(await service.callback({ code: ['a', 'b'], state: attempt.state }, cookie, CTX)).toMatchObject({ code: 'failed' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('callback: a failure at Google (exchange or ID token) is failed, with the returnTo of the attempt', async () => {
    const { service, authenticate } = makeService();
    const attempt = newGoogleAttempt('/my-school');
    const cookie = await signGoogleState(deriveStateKey(SECRET), attempt);
    authenticate.mockRejectedValueOnce(new Error('network'));
    expect(await service.callback({ code: 'c', state: attempt.state }, cookie, CTX)).toEqual({ kind: 'failure', code: 'failed', returnTo: '/my-school' });
    expect(authenticate).toHaveBeenCalledWith({ code: 'c', codeVerifier: attempt.codeVerifier, nonce: attempt.nonce });
  });
});
