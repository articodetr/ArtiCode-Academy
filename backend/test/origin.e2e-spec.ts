// TEST-013 — MOD-01-H02: Origin / Fetch Metadata guard on state-changing
// requests. Runs without a database (the guard answers before any handler).
// CORS_ORIGIN is set here to model a real deployment: the web app on
// https://app.academy.test, the API on api.academy.test, a sibling subdomain
// evil.academy.test (same-site, no preflight) and the default local Vite origin.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['CORS_ORIGIN'] = 'http://localhost:5173, https://app.academy.test';

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');

const LOGIN = '/api/auth/login';
const CREDENTIALS = { identifier: 'origin-probe@example.test', password: 'probe-only-password' };
/** Statuses that prove the request got past the guard to the login handler (credentials checked, or no DB). */
const PASSED_GUARD = [401, 503];

describe('MOD-01-H02 origin guard (e2e, TEST-013)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets allowlisted origins through, however they are spelled', async () => {
    for (const origin of ['https://app.academy.test', 'HTTPS://APP.ACADEMY.TEST:443', 'http://localhost:5173']) {
      const res = await api().post(LOGIN).set('Origin', origin).send(CREDENTIALS);
      expect(PASSED_GUARD, origin).toContain(res.status);
    }
    // A same-site deployment (app.* → api.*) legitimately sends Sec-Fetch-Site: same-site.
    const sameSite = await api().post(LOGIN).set('Origin', 'https://app.academy.test').set('Sec-Fetch-Site', 'same-site').send(CREDENTIALS);
    expect(PASSED_GUARD).toContain(sameSite.status);
  });

  it('rejects foreign, parent and sibling-subdomain origins with 403 origin_forbidden', async () => {
    const rejected = [
      ['https://evil.test', 'cross-site'],
      ['https://academy.test', 'same-site'],
      ['https://evil.academy.test', 'same-site'],
      ['https://app.academy.test.evil.test', 'cross-site'],
      ['http://app.academy.test', 'same-site'],
      ['https://app.academy.test:8443', 'same-site'],
      ['null', 'cross-site'],
      ['not-an-origin', 'cross-site'],
    ] as const;
    for (const [origin, site] of rejected) {
      const res = await api().post(LOGIN).set('Origin', origin).set('Sec-Fetch-Site', site).send(CREDENTIALS);
      expect(res.status, origin).toBe(403);
      expect(res.body, origin).toMatchObject({ statusCode: 403, error: 'Forbidden', code: 'origin_forbidden' });
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('accepts the request’s own origin (Swagger UI) only when scheme and host match', async () => {
    const own = await api().post(LOGIN).set('Host', 'api.academy.test').set('Origin', 'http://api.academy.test').send(CREDENTIALS);
    expect(PASSED_GUARD).toContain(own.status);
    // The test server speaks plain http: an https Origin is another origin (behind a TLS proxy this needs `trust proxy`, MOD-01-H01).
    const mismatch = await api().post(LOGIN).set('Host', 'api.academy.test').set('Origin', 'https://api.academy.test').send(CREDENTIALS);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('origin_forbidden');
  });

  it('accepts loopback origins outside production (a second Vite dev server on :5174)', async () => {
    for (const origin of ['http://localhost:5174', 'http://127.0.0.1:4173']) {
      const res = await api().post(LOGIN).set('Origin', origin).send(CREDENTIALS);
      expect(PASSED_GUARD, origin).toContain(res.status);
    }
    expect((await api().post(LOGIN).set('Origin', 'http://evil.localhost:5174').send(CREDENTIALS)).status).toBe(403);
  });

  it('without Origin, trusts non-browser clients and uses Fetch Metadata when present', async () => {
    expect(PASSED_GUARD).toContain((await api().post(LOGIN).send(CREDENTIALS)).status);
    expect(PASSED_GUARD).toContain((await api().post(LOGIN).set('Sec-Fetch-Site', 'same-origin').send(CREDENTIALS)).status);
    expect(PASSED_GUARD).toContain((await api().post(LOGIN).set('Sec-Fetch-Site', 'none').send(CREDENTIALS)).status);
    for (const site of ['cross-site', 'same-site']) {
      const res = await api().post(LOGIN).set('Sec-Fetch-Site', site).send(CREDENTIALS);
      expect(res.status, site).toBe(403);
      expect(res.body.code, site).toBe('origin_forbidden');
    }
  });

  it('covers every state-changing route before authentication and never blocks reads', async () => {
    // Cookie routes: the rejected request never reaches the handler, so no cookie is touched.
    const refresh = await api().post('/api/auth/refresh').set('Origin', 'https://evil.academy.test').set('Cookie', 'aca_refresh=stolen').send();
    expect(refresh.status).toBe(403);
    expect(refresh.body.code).toBe('origin_forbidden');
    expect(refresh.headers['set-cookie']).toBeUndefined();
    const logout = await api().post('/api/auth/logout').set('Origin', 'https://evil.academy.test').set('Cookie', 'aca_refresh=stolen').send();
    expect(logout.status).toBe(403);
    // Bearer-protected route: origin is checked before the missing token is (403 instead of 401).
    const protectedRoute = await api().post('/api/auth/logout-all').set('Origin', 'https://evil.test').send();
    expect(protectedRoute.status).toBe(403);
    expect(protectedRoute.body.code).toBe('origin_forbidden');
    expect((await api().post('/api/auth/logout-all').set('Origin', 'https://app.academy.test').send()).body.code).toBe('unauthenticated');
    const createUser = await api().post('/api/users').set('Origin', 'https://evil.test').send({ kind: 'student', fullName: 'x' });
    expect(createUser.body.code).toBe('origin_forbidden');

    // Safe methods are never blocked (no CSRF risk; the browser enforces CORS on the response).
    const read = await api().get('/api/health').set('Origin', 'https://evil.test').set('Sec-Fetch-Site', 'cross-site').expect(200);
    expect(read.headers['access-control-allow-origin']).toBeUndefined();
    await api().get('/api/auth/me').set('Origin', 'https://evil.test').expect(401);
    // The CORS preflight still answers for allowlisted origins.
    const preflight = await api()
      .options(LOGIN)
      .set('Origin', 'https://app.academy.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://app.academy.test');
  });
});
