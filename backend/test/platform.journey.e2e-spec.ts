// TEST-212 (e2e) — the MOD-18 module gate (MOD-18-T06; roadmap §4m.5): WF-16
// «a platform operator registers and watches a real academy», through HTTP,
// with a REAL academy API and the platform API running side by side in this
// process — the academy on an ephemeral loopback port against the development
// academy database, the platform against the development platform database.
// Nothing is stubbed: the probe asks the academy's own public endpoints.
//
// WF-16, step by step:
//
//   0. two platform accounts exist, created out of band by the CLI functions
//      (createPlatformUser() of platform-bootstrap.ts — `npm run
//      platform:create-user`): a `super_admin` and a `support` operator
//                                     → `platform.users.created` ×2 (no actor, via cli)
//   1. the super admin signs in (API-178): a short-lived access token and the
//      httpOnly `pla_refresh` cookie  → `platform.auth.login.succeeded`
//      and reads their account (API-181) — the role `super_admin`
//   2. creates a plan (API-192)       → `platform.plans.created`
//   3. registers the academy (API-184) with its public origin — the real
//      academy API of this run on http://localhost:<port> (http on loopback is
//      allowed outside production); it starts `provisioning`
//                                     → `platform.academies.created`
//   4. records its primary domain (API-188) → `platform.domains.added`
//   5. opens a trial subscription on the plan (API-194)
//                                     → `platform.subscriptions.created`
//   6. activates the academy (API-187, provisioning → active)
//                                     → `platform.academies.status.changed`
//   7. probes it (API-196): the platform asks GET /api/health and
//      /api/health/ready of the academy → `ready`, the academy's version and
//      environment, schema `current` with the newest academy migration as both
//      expected and applied, `behind: false` (the academy and the platform
//      build carry the same `prisma/migrations`); one snapshot row, no event
//   8. the fleet (API-198) lists it ready and fresh; its history (API-197)
//      holds the probe; the academy detail (API-185) shows the primary domain,
//      the trial and the latest check
//   9. the support operator signs in   → `platform.auth.login.succeeded`
//      reads the fleet and the academy, and may not change its status
//      (API-187 → `403 role_forbidden`, nothing written)
//  10. the super admin suspends the academy (active → suspended)
//                                     → `platform.academies.status.changed`
//      the fleet still lists it, suspended
//  11. the session: refresh (API-179) rotates the cookie and the access token
//      (no event); logout (API-180) revokes the sign-in → `platform.auth.logout`;
//      the logged-out cookie refreshes no more (401, no event)
//  12. the audit trail of the journey: exactly the eleven events above, in order,
//      with no secret — nothing for a read, the probe, the refusal or a refresh
//  13. cleanup: the academy (its domain, subscription and health checks
//      cascade), the plan and both accounts; the audit rows stay (append-only)
//
// Skipped unless BOTH the platform database and the academy database are
// reachable. Fixture names carry the run id (PLATFORM_TEST_RUN).
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { assertNoSecrets } from '../src/audit/audit-metadata.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PACKAGE_VERSION } from '../src/common/package-info.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPlatformUser } from '../src/platform/auth/platform-bootstrap.js';
import { PLATFORM_REFRESH_COOKIE_NAME } from '../src/platform/auth/platform-cookies.js';
import {
  PLATFORM_TEST_ORIGIN,
  PLATFORM_TEST_RUN,
  closePlatformTestDb,
  createPlatformTestApp,
  deletePlatformUserFixtures,
  platformDbReachable,
  platformTestDb,
} from './platform/helpers.js';

// helpers.js has loaded the env files: DATABASE_URL / DB_APP_* are in process.env.
const ACADEMY_DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = PLATFORM_TEST_RUN;
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const USER_AGENT = 'TEST-212 WF-16';
const SLUG = `${RUN}-wf16`;
const PLAN_KEY = `${RUN}-wf16`;
const HOSTNAME = `wf16.${RUN}.example.test`;

async function academyDbReachable(): Promise<boolean> {
  if (!ACADEMY_DATABASE_URL) return false;
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: ACADEMY_DATABASE_URL, connectionTimeoutMillis: 3000 }) });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

/** The newest ACADEMY migration of this checkout, read here without the code under test. */
function newestAcademyMigration(): string {
  const dir = join(process.cwd(), 'prisma', 'migrations');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .filter((entry) => existsSync(join(dir, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
  return names[names.length - 1]!;
}

/** The `pla_refresh` value a response set, or undefined (absent or cleared). */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  const line = lines.find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`));
  const value = line?.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value ? value : undefined;
}

const available = (await platformDbReachable()) && (await academyDbReachable());

describe.skipIf(!available)('WF-16 a platform operator registers and watches a real academy — the MOD-18 gate (e2e, TEST-212)', () => {
  let academyApp: NestExpressApplication;
  let platformApp: NestExpressApplication;
  let academyOrigin: string;
  const passwords = new PasswordService();
  const accounts = {
    superAdmin: { id: '', email: `${RUN}-wf16-super@example.test`, fullName: 'WF-16 Super Admin', password: randomBytes(24).toString('base64url') },
    support: { id: '', email: `${RUN}-wf16-support@example.test`, fullName: 'WF-16 Support', password: randomBytes(24).toString('base64url') },
  };
  /** Every password, token and cookie of the run — none may appear in an audit row. */
  const secrets: string[] = [accounts.superAdmin.password, accounts.support.password];
  let mark = NIL_ID;
  let academyId: string | undefined;
  let planId: string | undefined;

  const api = () => request(platformApp.getHttpServer());
  /** A request as the Super Admin frontend sends it (Origin on writes, the journey's User-Agent). */
  const as = (token: string, method: 'get' | 'post', path: string) => {
    const req = api()[method](path).set('Authorization', `Bearer ${token}`).set('User-Agent', USER_AGENT);
    return method === 'get' ? req : req.set('Origin', PLATFORM_TEST_ORIGIN);
  };
  const login = (account: { email: string; password: string }) =>
    api().post('/api/auth/login').set('Origin', PLATFORM_TEST_ORIGIN).set('User-Agent', USER_AGENT).send({ identifier: account.email, password: account.password });

  beforeAll(async () => {
    // The real academy API on an ephemeral loopback port: the platform probes it over HTTP.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    academyApp = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(academyApp);
    await academyApp.listen(0, '127.0.0.1');
    academyOrigin = `http://localhost:${(academyApp.getHttpServer().address() as AddressInfo).port}`;

    platformApp = await createPlatformTestApp();

    const latest = await platformTestDb().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    mark = latest?.id ?? NIL_ID;

    // Step 0 — the accounts, through the CLI's own function (one `platform.users.created` each).
    for (const [key, role] of [['superAdmin', 'super_admin'], ['support', 'support']] as const) {
      const account = accounts[key];
      const created = await createPlatformUser(platformTestDb(), { email: account.email, fullName: account.fullName, password: account.password, role }, passwords);
      if (created.outcome !== 'created') throw new Error(`fixture ${key} not created: ${created.reason}`);
      account.id = created.userId;
    }
  });

  afterAll(async () => {
    if (available) {
      if (academyId) await platformTestDb().academy.deleteMany({ where: { id: academyId } });
      if (planId) await platformTestDb().plan.deleteMany({ where: { id: planId } });
      await deletePlatformUserFixtures([accounts.superAdmin.id, accounts.support.id].filter((id) => id !== ''));
      await closePlatformTestDb();
    }
    await platformApp?.close();
    await academyApp?.close();
  });

  it(
    'registers, activates, probes, watches and suspends a real academy with the exact audit trail',
    async () => {
      const newest = newestAcademyMigration();

      // The academy really is up, ready and current — what the probe will find.
      const academyReady = await request(academyApp.getHttpServer()).get('/api/health/ready').expect(200);
      expect(academyReady.body).toMatchObject({ status: 'ready', checks: { schema: { status: 'current', expected: newest, applied: newest } } });

      // 1. The super admin signs in.
      const signedIn = await login(accounts.superAdmin).expect(200);
      expect(signedIn.body).toMatchObject({ tokenType: 'Bearer', user: { id: accounts.superAdmin.id, role: 'super_admin', status: 'active' } });
      const firstCookie = refreshCookie(signedIn);
      expect(firstCookie).toEqual(expect.any(String));
      let superToken = signedIn.body.accessToken as string;
      secrets.push(superToken, firstCookie!);
      const me = await as(superToken, 'get', '/api/auth/me').expect(200);
      expect(me.body).toEqual({ id: accounts.superAdmin.id, email: accounts.superAdmin.email, fullName: accounts.superAdmin.fullName, role: 'super_admin', status: 'active' });

      // 2. A plan.
      const plan = await as(superToken, 'post', '/api/plans')
        .send({ key: PLAN_KEY, name: { ar: 'خطة الرحلة', en: 'Journey plan' }, limits: { students: 500, storageGb: null } })
        .expect(201);
      planId = plan.body.id as string;
      expect(plan.body).toMatchObject({ key: PLAN_KEY, limits: { students: 500, storageGb: null }, isActive: true });

      // 3. The academy, pointed at the real academy API of this run.
      const created = await as(superToken, 'post', '/api/academies')
        .send({ slug: SLUG, name: { ar: 'أكاديمية الرحلة', en: 'Journey Academy' }, origin: academyOrigin, contactEmail: 'owner@example.test' })
        .expect(201);
      academyId = created.body.id as string;
      expect(created.body).toMatchObject({ slug: SLUG, status: 'provisioning', origin: academyOrigin, primaryDomain: null, currentSubscription: null, latestHealthCheck: null, createdBy: { id: accounts.superAdmin.id } });

      // 4. Its primary domain.
      const domain = await as(superToken, 'post', `/api/academies/${academyId}/domains`)
        .send({ hostname: HOSTNAME, kind: 'platform_subdomain', isPrimary: true })
        .expect(201);
      expect(domain.body).toMatchObject({ primaryDomain: HOSTNAME, domains: [{ hostname: HOSTNAME, kind: 'platform_subdomain', isPrimary: true, verifiedAt: null }] });
      const domainId = domain.body.domains[0].id as string;

      // 5. A trial subscription.
      const startsAt = new Date(Date.now() - 60_000).toISOString();
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 3_600_000).toISOString();
      const subscription = await as(superToken, 'post', `/api/academies/${academyId}/subscriptions`)
        .send({ planId, status: 'trial', startsAt, trialEndsAt })
        .expect(201);
      const subscriptionId = subscription.body.id as string;
      expect(subscription.body).toMatchObject({ academyId, status: 'trial', plan: { id: planId, key: PLAN_KEY }, endsAt: null });

      // 6. Activate.
      const activated = await as(superToken, 'post', `/api/academies/${academyId}/status`).send({ action: 'activate' }).expect(200);
      expect(activated.body).toMatchObject({ status: 'active', currentSubscription: { id: subscriptionId, planKey: PLAN_KEY, status: 'trial' } });

      // 7. Probe: the platform asks the academy's public endpoints.
      const probed = await as(superToken, 'post', `/api/academies/${academyId}/probe`).expect(201);
      expect(probed.body).toMatchObject({
        academyId,
        outcome: 'ready',
        httpStatus: 200,
        apiVersion: PACKAGE_VERSION,
        environment: 'test',
        schemaStatus: 'current',
        schemaExpected: newest,
        schemaApplied: newest,
        reason: null,
        error: null,
        behind: false,
        triggeredBy: { id: accounts.superAdmin.id, fullName: accounts.superAdmin.fullName },
      });
      expect(typeof probed.body.latencyMs).toBe('number');
      const checks = await platformTestDb().academyHealthCheck.findMany({ where: { academyId }, select: { id: true, outcome: true, triggeredById: true } });
      expect(checks).toEqual([{ id: probed.body.id, outcome: 'ready', triggeredById: accounts.superAdmin.id }]);

      // 8. The fleet, the history and the detail.
      const fleet = await as(superToken, 'get', '/api/fleet').expect(200);
      expect(fleet.body.newestAcademyMigration).toBe(newest);
      const listed = (fleet.body.items as { academy: { id: string } }[]).find((item) => item.academy.id === academyId);
      expect(listed).toMatchObject({
        academy: { slug: SLUG, status: 'active', origin: academyOrigin, name: { ar: 'أكاديمية الرحلة', en: 'Journey Academy' } },
        latest: { id: probed.body.id, outcome: 'ready', behind: false },
        behind: false,
        stale: false,
      });
      const history = await as(superToken, 'get', `/api/academies/${academyId}/health-checks`).expect(200);
      expect(history.body).toMatchObject({ items: [{ id: probed.body.id, outcome: 'ready' }], nextCursor: null });

      // 9. The support operator: reads, never writes.
      const supportIn = await login(accounts.support).expect(200);
      expect(supportIn.body.user).toMatchObject({ id: accounts.support.id, role: 'support' });
      const supportToken = supportIn.body.accessToken as string;
      secrets.push(supportToken, refreshCookie(supportIn) ?? '');
      const supportFleet = await as(supportToken, 'get', '/api/fleet').expect(200);
      expect((supportFleet.body.items as { academy: { id: string } }[]).some((item) => item.academy.id === academyId)).toBe(true);
      const detail = await as(supportToken, 'get', `/api/academies/${academyId}`).expect(200);
      expect(detail.body).toMatchObject({
        status: 'active',
        primaryDomain: HOSTNAME,
        currentSubscription: { id: subscriptionId, planKey: PLAN_KEY, status: 'trial' },
        latestHealthCheck: { id: probed.body.id, outcome: 'ready', apiVersion: PACKAGE_VERSION, schemaStatus: 'current' },
        domains: [{ id: domainId, hostname: HOSTNAME }],
        subscriptions: [{ id: subscriptionId }],
      });
      expect(JSON.stringify(detail.body)).not.toMatch(/hash|password/i);
      const refused = await as(supportToken, 'post', `/api/academies/${academyId}/status`).send({ action: 'suspend' }).expect(403);
      expect(refused.body).toMatchObject({ code: 'role_forbidden' });
      expect((await platformTestDb().academy.findUniqueOrThrow({ where: { id: academyId }, select: { status: true } })).status).toBe('active');

      // 10. The super admin suspends it; the fleet still lists it.
      const suspended = await as(superToken, 'post', `/api/academies/${academyId}/status`).send({ action: 'suspend', reason: 'WF-16 journey' }).expect(200);
      expect(suspended.body).toMatchObject({ status: 'suspended' });
      const afterSuspend = await as(superToken, 'get', '/api/fleet').expect(200);
      expect((afterSuspend.body.items as { academy: { id: string; status: string } }[]).find((item) => item.academy.id === academyId)?.academy.status).toBe('suspended');

      // 11. The session: refresh rotates, logout revokes, the logged-out cookie is dead.
      const refreshed = await api()
        .post('/api/auth/refresh')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('User-Agent', USER_AGENT)
        .set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${firstCookie}`)
        .expect(200);
      const secondCookie = refreshCookie(refreshed);
      expect(secondCookie).toEqual(expect.any(String));
      expect(secondCookie).not.toBe(firstCookie);
      expect(refreshed.body.user).toMatchObject({ id: accounts.superAdmin.id, role: 'super_admin' });
      superToken = refreshed.body.accessToken as string;
      secrets.push(superToken, secondCookie!);
      await as(superToken, 'get', '/api/auth/me').expect(200);

      const loggedOut = await api()
        .post('/api/auth/logout')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('User-Agent', USER_AGENT)
        .set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${secondCookie}`)
        .expect(204);
      expect(refreshCookie(loggedOut)).toBeUndefined();
      const dead = await api()
        .post('/api/auth/refresh')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${secondCookie}`)
        .expect(401);
      expect(dead.body.code).toBe('refresh_reused');

      // 12. The audit trail of the journey's people and things, in order.
      const subjects = [accounts.superAdmin.id, accounts.support.id, academyId, planId, subscriptionId];
      const events = await platformTestDb().platformAuditLog.findMany({
        where: {
          id: { gt: mark },
          OR: [{ actorPlatformUserId: { in: [accounts.superAdmin.id, accounts.support.id] } }, { entityId: { in: subjects } }],
        },
        orderBy: { id: 'asc' },
        select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true, userAgent: true },
      });
      const familyId = (events.find((event) => event.action === 'platform.auth.login.succeeded')?.metadata as { familyId?: string } | null)?.familyId;
      expect(events.map((event) => [event.action, event.actorPlatformUserId, event.entityType, event.entityId, event.metadata])).toEqual([
        ['platform.users.created', null, 'platform_users', accounts.superAdmin.id, { role: 'super_admin', via: 'cli' }],
        ['platform.users.created', null, 'platform_users', accounts.support.id, { role: 'support', via: 'cli' }],
        ['platform.auth.login.succeeded', accounts.superAdmin.id, 'platform_users', accounts.superAdmin.id, { via: 'password', familyId: expect.any(String) }],
        ['platform.plans.created', accounts.superAdmin.id, 'plans', planId, { key: PLAN_KEY }],
        ['platform.academies.created', accounts.superAdmin.id, 'academies', academyId, { slug: SLUG }],
        ['platform.domains.added', accounts.superAdmin.id, 'academies', academyId, { domainId, hostname: HOSTNAME, kind: 'platform_subdomain', isPrimary: true }],
        ['platform.subscriptions.created', accounts.superAdmin.id, 'subscriptions', subscriptionId, { academyId, planKey: PLAN_KEY, status: 'trial' }],
        ['platform.academies.status.changed', accounts.superAdmin.id, 'academies', academyId, { slug: SLUG, action: 'activate', from: 'provisioning', to: 'active' }],
        ['platform.auth.login.succeeded', accounts.support.id, 'platform_users', accounts.support.id, { via: 'password', familyId: expect.any(String) }],
        ['platform.academies.status.changed', accounts.superAdmin.id, 'academies', academyId, { slug: SLUG, action: 'suspend', from: 'active', to: 'suspended', reason: 'WF-16 journey' }],
        ['platform.auth.logout', accounts.superAdmin.id, 'platform_users', accounts.superAdmin.id, { scope: 'device', familyId }],
      ]);
      // Every write carried the journey's User-Agent; the CLI creations have none.
      expect(events.slice(2).every((event) => event.userAgent === USER_AGENT)).toBe(true);
      for (const event of events) {
        assertNoSecrets(event.metadata as Record<string, unknown> | null);
        const text = JSON.stringify(event.metadata);
        for (const secret of secrets.filter((value) => value.length > 0)) expect(text).not.toContain(secret);
      }
    },
    90_000,
  );
});
