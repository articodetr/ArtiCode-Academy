// TEST-207 (e2e) — MOD-18-T02 the platform application skeleton (roadmap §4m.5):
// PlatformAppModule boots alone with the shared configureApp(); API-176/177
// (liveness, and readiness against the REAL platform migrations); every route
// is protected unless @Public(); the guard order OriginGuard → PlatformAuthGuard
// → PlatformRolesGuard; an academy access token is refused; `support` is
// refused on a `super_admin` route; no academy module or route is loaded.
//
// The protected routes are a probe controller registered only in this test
// module. The first block needs no database; the second is skipped when the
// platform database is unreachable (test/platform/helpers.ts). Fixture users
// are deleted in afterAll; nothing is written to platform_audit_logs.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACADEMY_SWAGGER_TITLE } from '../src/app.setup.js';
import { TokenService } from '../src/auth/token.service.js';
import { PACKAGE_VERSION } from '../src/common/package-info.js';
import { NODE_ENVS, validateEnv } from '../src/config/env.schema.js';
import type { Env } from '../src/config/env.schema.js';
import { CurrentPlatformUser, PlatformRoles, Public } from '../src/platform/auth/platform.decorators.js';
import type { PlatformPrincipal } from '../src/platform/auth/platform-principal.js';
import { PLATFORM_MIGRATIONS_DIR } from '../src/platform/health/platform-health.service.js';
import { PLATFORM_APP_SETUP } from '../src/platform/platform-app.module.js';
import {
  PLATFORM_TEST_ORIGIN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformAccessTokenFor,
  platformDbReachable,
  platformTestDb,
} from './platform/helpers.js';

@Controller('platform-probe')
class PlatformProbeController {
  @Get('me')
  me(@CurrentPlatformUser() user: PlatformPrincipal | undefined): PlatformPrincipal | null {
    return user ?? null;
  }

  @Get('super')
  @PlatformRoles('super_admin')
  superOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('support')
  @PlatformRoles('support')
  supportRoute(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  @HttpCode(200)
  @PlatformRoles('super_admin')
  write(@Body() body: Record<string, unknown>): { keys: number } {
    return { keys: Object.keys(body).length };
  }

  @Get('public')
  @Public()
  open(@CurrentPlatformUser() user: PlatformPrincipal | undefined): { user: PlatformPrincipal | null } {
    return { user: user ?? null };
  }
}

const REAL_MIGRATIONS = join(process.cwd(), 'prisma', 'platform', 'migrations');

/** The newest real platform migration, read here without the code under test. */
function newestRealMigration(): string {
  const names = readdirSync(REAL_MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .filter((entry) => existsSync(join(REAL_MIGRATIONS, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
  return names[names.length - 1]!;
}

/** An access token of the ACADEMY API (its own TokenService, issuer and audience). */
async function academyAccessToken(): Promise<string> {
  const env = validateEnv({ JWT_SECRET: process.env['JWT_SECRET'] });
  const tokens = new TokenService({ get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>);
  const signed = await tokens.signAccessToken({ userId: '019a7d00-0000-7000-8000-000000000001', roles: ['academy_admin'] });
  return signed.token;
}

const available = await platformDbReachable();

describe('platform app skeleton — MOD-18-T02 (e2e, TEST-207)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createPlatformTestApp({ controllers: [PlatformProbeController] });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health (API-176) is public and names the platform service', async () => {
    const res = await api().get('/api/health').expect(200).expect('Content-Type', /application\/json/);
    expect(res.body).toMatchObject({ status: 'ok', service: 'articode-platform-api', version: PACKAGE_VERSION });
    expect(NODE_ENVS).toContain(res.body.environment);
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    // configureApp(): helmet headers, no X-Powered-By.
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('loads no academy module and serves no academy route', async () => {
    const names = [...app.get(ModulesContainer).values()].map((module) => module.metatype?.name);
    expect(names).toEqual(expect.arrayContaining(['PlatformAppModule', 'PlatformPrismaModule', 'PlatformAuthModule', 'PlatformHealthModule']));
    for (const academy of ['AppModule', 'PrismaModule', 'AuthModule', 'AuditModule', 'HealthModule', 'UsersModule', 'AcademyModule']) {
      expect(names).not.toContain(academy);
    }
    for (const path of ['/api/academy', '/api/users', '/api/courses', '/api/audit-logs']) {
      await api().get(path).expect(404);
    }
  });

  it('protects every route without @Public(): 401 unauthenticated, 401 token_invalid for garbage and for an academy access token', async () => {
    const none = await api().get('/api/platform-probe/me').expect(401);
    expect(none.body).toMatchObject({ statusCode: 401, code: 'unauthenticated' });

    const garbage = await api().get('/api/platform-probe/me').set('Authorization', 'Bearer not-a-token').expect(401);
    expect(garbage.body).toMatchObject({ code: 'token_invalid' });

    const academy = await api().get('/api/platform-probe/me').set('Authorization', `Bearer ${await academyAccessToken()}`).expect(401);
    expect(academy.body).toMatchObject({ code: 'token_invalid' });

    // A public route ignores a bad token (best effort) and has no principal.
    const open = await api().get('/api/platform-probe/public').set('Authorization', 'Bearer not-a-token').expect(200);
    expect(open.body).toEqual({ user: null });
  });

  it('OriginGuard runs first: a foreign Origin on a POST is 403 origin_forbidden before authentication', async () => {
    const res = await api().post('/api/platform-probe/write').set('Origin', 'https://evil.example').send({}).expect(403);
    expect(res.body).toMatchObject({ code: 'origin_forbidden' });
    // The academy frontend's origin is not on the platform allowlist either (loopback is, outside production).
    const academyFrontend = await api().post('/api/platform-probe/write').set('Origin', 'https://academy.example').send({}).expect(403);
    expect(academyFrontend.body).toMatchObject({ code: 'origin_forbidden' });
    // An allowed origin reaches the auth guard.
    const allowed = await api().post('/api/platform-probe/write').set('Origin', PLATFORM_TEST_ORIGIN).send({}).expect(401);
    expect(allowed.body).toMatchObject({ code: 'unauthenticated' });
  });

  // KI-081: configureApp() used to give the platform the academy's OpenAPI title.
  // 20 s: the first OpenAPI build can exceed Vitest's 5 s under parallel e2e load (KI-040).
  it(
    'serves its own OpenAPI document: `ArtiCode Platform API`, platform routes only (KI-081)',
    async () => {
      const res = await api().get('/api/docs-json').expect(200);
      expect(res.body.info).toMatchObject({
        title: PLATFORM_APP_SETUP.swaggerTitle,
        description: PLATFORM_APP_SETUP.swaggerDescription,
        version: PACKAGE_VERSION,
      });
      expect(res.body.info.title).toBe('ArtiCode Platform API');
      expect(res.body.info.title).not.toBe(ACADEMY_SWAGGER_TITLE);
      expect(res.body.paths).toHaveProperty('/api/health/ready');
      expect(res.body.paths).toHaveProperty('/api/auth/login');
      expect(res.body.paths).not.toHaveProperty('/api/academy');
    },
    20_000,
  );

  describe.skipIf(!available)('with the platform database', () => {
    const fixtureIds: string[] = [];
    let superAdmin: Awaited<ReturnType<typeof createPlatformUserFixture>>;
    let support: Awaited<ReturnType<typeof createPlatformUserFixture>>;

    beforeAll(async () => {
      superAdmin = await createPlatformUserFixture({ role: 'super_admin' });
      support = await createPlatformUserFixture({ role: 'support' });
      fixtureIds.push(superAdmin.id, support.id);
    });

    afterAll(async () => {
      await deletePlatformUserFixtures(fixtureIds);
      await closePlatformTestDb();
    });

    it('GET /api/health/ready (API-177) is ready with the schema `current` against the real platform migrations', async () => {
      const res = await api().get('/api/health/ready').expect(200);
      const newest = newestRealMigration();
      expect(res.body).toMatchObject({
        status: 'ready',
        checks: { database: { status: 'up' }, schema: { status: 'current', expected: newest, applied: newest } },
      });
      expect(res.body.reason).toBeUndefined();
    });

    it('readiness is 503 schema_outdated when the build ships a migration the platform database lacks', async () => {
      const root = await mkdtemp(join(tmpdir(), 'articode-platform-ready-'));
      const future = '29991231235959_future';
      await mkdir(join(root, future), { recursive: true });
      await writeFile(join(root, future, 'migration.sql'), 'SELECT 1;');
      const other = await createPlatformTestApp({
        configure: (builder) => builder.overrideProvider(PLATFORM_MIGRATIONS_DIR).useValue(root),
      });
      try {
        const res = await request(other.getHttpServer()).get('/api/health/ready').expect(503);
        expect(res.body).toMatchObject({
          status: 'not_ready',
          reason: 'schema_outdated',
          checks: { database: { status: 'up' }, schema: { status: 'outdated', expected: future, applied: newestRealMigration() } },
        });
      } finally {
        await other.close();
        await rm(root, { recursive: true, force: true });
      }
    });

    it('a platform token reaches a protected route with the principal read from platform_users', async () => {
      const token = await platformAccessTokenFor(app, superAdmin);
      const res = await api().get('/api/platform-probe/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body).toEqual({
        id: superAdmin.id,
        email: superAdmin.email,
        fullName: superAdmin.fullName,
        role: 'super_admin',
        tokenId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
    });

    it('roles: support is 403 role_forbidden on a super_admin route; super_admin passes every role check', async () => {
      const supportToken = await platformAccessTokenFor(app, support);
      const refused = await api().get('/api/platform-probe/super').set('Authorization', `Bearer ${supportToken}`).expect(403);
      expect(refused.body).toMatchObject({ statusCode: 403, code: 'role_forbidden', required: ['super_admin'] });
      await api().get('/api/platform-probe/support').set('Authorization', `Bearer ${supportToken}`).expect(200);
      // A write route with an allowed Origin: support refused, super_admin through.
      const write = await api()
        .post('/api/platform-probe/write')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('Authorization', `Bearer ${supportToken}`)
        .send({ a: 1 })
        .expect(403);
      expect(write.body).toMatchObject({ code: 'role_forbidden' });

      const superToken = await platformAccessTokenFor(app, superAdmin);
      await api().get('/api/platform-probe/super').set('Authorization', `Bearer ${superToken}`).expect(200);
      await api().get('/api/platform-probe/support').set('Authorization', `Bearer ${superToken}`).expect(200);
      const ok = await api()
        .post('/api/platform-probe/write')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ a: 1, b: 2 })
        .expect(200);
      expect(ok.body).toEqual({ keys: 2 });
      // A foreign Origin is refused even with a valid token.
      await api()
        .post('/api/platform-probe/write')
        .set('Origin', 'https://evil.example')
        .set('Authorization', `Bearer ${superToken}`)
        .send({})
        .expect(403);
    });

    it('the role comes from the row, not from the token', async () => {
      // A token minted as super_admin for the support user: the row says support.
      const forged = await platformAccessTokenFor(app, { id: support.id, role: 'super_admin' });
      const res = await api().get('/api/platform-probe/super').set('Authorization', `Bearer ${forged}`).expect(403);
      expect(res.body).toMatchObject({ code: 'role_forbidden' });
    });

    it('refuses a suspended (403) or a deleted (401 session_invalid) user, an expired token and a token older than the last password change; a sign-in lock does not end a session', async () => {
      const suspended = await createPlatformUserFixture({ role: 'super_admin', status: 'suspended' });
      const locked = await createPlatformUserFixture({ role: 'super_admin', lockedUntil: new Date(Date.now() + 10 * 60_000) });
      const changed = await createPlatformUserFixture({ role: 'super_admin' });
      const gone = await createPlatformUserFixture({ role: 'support' });
      fixtureIds.push(suspended.id, locked.id, changed.id, gone.id);

      const me = async (token: string) => api().get('/api/platform-probe/me').set('Authorization', `Bearer ${token}`);

      const s = await me(await platformAccessTokenFor(app, suspended));
      expect([s.status, s.body.code]).toEqual([403, 'account_suspended']);

      // A lock blocks new sign-ins only (POST /api/auth/login, T03), never a running session.
      const l = await me(await platformAccessTokenFor(app, locked));
      expect([l.status, l.body.id]).toEqual([200, locked.id]);

      const changedToken = await platformAccessTokenFor(app, changed);
      await platformTestDb().platformUser.update({
        where: { id: changed.id },
        data: { passwordChangedAt: new Date(Date.now() + 2000) },
      });
      const c = await me(changedToken);
      expect([c.status, c.body.code]).toEqual([401, 'token_invalid']);

      const goneToken = await platformAccessTokenFor(app, gone);
      await deletePlatformUserFixtures([gone.id]);
      const g = await me(goneToken);
      expect([g.status, g.body.code]).toEqual([401, 'session_invalid']);

      const e = await me(await platformAccessTokenFor(app, superAdmin, -30));
      expect([e.status, e.body.code]).toEqual([401, 'token_expired']);
    });
  });
});
