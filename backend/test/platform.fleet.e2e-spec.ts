// TEST-210 (e2e) — MOD-18-T05 fleet health (roadmap §4m.5; API-196..198, D-R103):
// tiny HTTP servers on 127.0.0.1, started by this suite, impersonate academies
// (ready; not ready with an outdated schema; a 302; garbage; a gateway 502; an
// answer slower than the probe timeout; a closed port). Fixture academies of
// the platform registry point their `origin` at them (http on loopback is
// allowed because NODE_ENV is `test`), and each is probed through
// `POST /api/academies/:id/probe` → the expected snapshot row. Then the
// history pagination, `GET /api/fleet` (counts, `behind`, `stale`), support
// probing, the 404/409/400 refusals, the retention of 500 checks per academy,
// one periodic round (FleetService.probeAll restricted to the fixtures), and
// no audit row for any of it.
//
// Skipped without the platform database. Fixture academies (their checks
// cascade) and users are deleted in afterAll. The newest ACADEMY migration is
// a temporary folder (deterministic `behind`), the probe timeout 600 ms.
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeOutcome } from '../src/generated/platform/client.js';
import { FleetService } from '../src/platform/fleet/fleet.service.js';
import { ACADEMY_MIGRATIONS_DIR, FLEET_SETTINGS } from '../src/platform/fleet/fleet.settings.js';
import type { FleetSettings } from '../src/platform/fleet/fleet.settings.js';
import { PROBE_USER_AGENT } from '../src/platform/fleet/probe.client.js';
import {
  PLATFORM_TEST_ORIGIN,
  PLATFORM_TEST_RUN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformAccessTokenFor,
  platformDbReachable,
  platformTestDb,
} from './platform/helpers.js';
import type { PlatformUserFixture } from './platform/helpers.js';

const OLD_MIGRATION = '20261101000000_fleet_old';
const NEWEST_MIGRATION = '20261201000000_fleet_newest';
const TIMEOUT_MS = 600;
const SETTINGS: FleetSettings = { probeTimeoutMs: TIMEOUT_MS, probeIntervalSeconds: 300, production: false };

interface FakeAcademy {
  server: Server;
  origin: string;
  port: number;
  requests: { path: string; headers: IncomingHttpHeaders }[];
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const timers = new Set<NodeJS.Timeout>();

async function startFake(handler: Handler): Promise<FakeAcademy> {
  const requests: FakeAcademy['requests'] = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}`, port, requests };
}

async function stopFake(fake: FakeAcademy | undefined): Promise<void> {
  if (!fake) return;
  fake.server.closeAllConnections();
  await new Promise<void>((resolve) => fake.server.close(() => resolve()));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const LIVENESS = {
  status: 'ok',
  service: 'articode-academy-api',
  version: '9.9.9',
  environment: 'production',
  timestamp: '2026-11-13T10:00:00.000Z',
  uptimeSeconds: 42,
};

function academyHandler(ready: boolean, applied: string): Handler {
  return (req, res) => {
    if (req.url === '/api/health') return sendJson(res, 200, LIVENESS);
    if (req.url === '/api/health/ready') {
      return sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        ...(ready ? {} : { reason: 'schema_outdated' }),
        checks: {
          database: { status: 'up', latencyMs: 2 },
          schema: { status: ready ? 'current' : 'outdated', expected: NEWEST_MIGRATION, applied },
        },
        timestamp: '2026-11-13T10:00:00.000Z',
      });
    }
    sendJson(res, 404, { statusCode: 404, message: 'Not Found' });
  };
}

const available = await platformDbReachable();

describe.skipIf(!available)('MOD-18-T05 fleet health (TEST-210)', () => {
  let app: NestExpressApplication;
  let migrationsRoot: string;
  let admin: PlatformUserFixture;
  let support: PlatformUserFixture;
  let adminToken: string;
  let supportToken: string;
  const fakes: Record<string, FakeAcademy> = {};
  const academyIds: Record<string, string> = {};
  let closedPort: number;

  const slug = (name: string) => `${PLATFORM_TEST_RUN}-fl-${name}`;

  async function createAcademy(name: string, origin: string | null, status: 'active' | 'provisioning' | 'archived' = 'active') {
    const academy = await platformTestDb().academy.create({
      data: {
        slug: slug(name),
        name: { ar: `أكاديمية ${name}`, en: `Fleet ${name}` },
        status,
        origin,
        archivedAt: status === 'archived' ? new Date() : null,
      },
      select: { id: true },
    });
    academyIds[name] = academy.id;
    return academy.id;
  }

  function probe(name: string, token = adminToken) {
    return request(app.getHttpServer()).post(`/api/academies/${academyIds[name]}/probe`).set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    migrationsRoot = await mkdtemp(join(tmpdir(), 'articode-fleet-'));
    for (const name of [OLD_MIGRATION, NEWEST_MIGRATION]) {
      await mkdir(join(migrationsRoot, name));
      await writeFile(join(migrationsRoot, name, 'migration.sql'), '-- fixture\n');
    }

    fakes['ready'] = await startFake(academyHandler(true, NEWEST_MIGRATION));
    fakes['outdated'] = await startFake(academyHandler(false, OLD_MIGRATION));
    const readyOrigin = fakes['ready'].origin;
    fakes['redirect'] = await startFake((req, res) => {
      res.writeHead(302, { location: `${readyOrigin}${req.url ?? '/'}` });
      res.end();
    });
    fakes['garbage'] = await startFake((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>not an academy</body></html>');
    });
    fakes['gateway'] = await startFake((_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>502 Bad Gateway</html>');
    });
    fakes['slow'] = await startFake((_req, res) => {
      const timer = setTimeout(() => sendJson(res, 200, LIVENESS), 5 * TIMEOUT_MS);
      timers.add(timer);
    });
    // A port nothing listens on any more.
    const closed = await startFake(() => undefined);
    closedPort = closed.port;
    await stopFake(closed);

    app = await createPlatformTestApp({
      configure: (builder) =>
        builder
          .overrideProvider(FLEET_SETTINGS)
          .useValue(SETTINGS)
          .overrideProvider(ACADEMY_MIGRATIONS_DIR)
          .useValue(migrationsRoot),
    });
    admin = await createPlatformUserFixture({ role: 'super_admin', fullName: 'Fleet Admin' });
    support = await createPlatformUserFixture({ role: 'support', fullName: 'Fleet Support' });
    adminToken = await platformAccessTokenFor(app, admin);
    supportToken = await platformAccessTokenFor(app, support);

    await createAcademy('ready', fakes['ready'].origin);
    await createAcademy('outdated', fakes['outdated'].origin, 'provisioning');
    await createAcademy('redirect', fakes['redirect'].origin);
    await createAcademy('garbage', fakes['garbage'].origin);
    await createAcademy('gateway', fakes['gateway'].origin);
    await createAcademy('slow', fakes['slow'].origin);
    await createAcademy('refused', `http://127.0.0.1:${closedPort}`);
    await createAcademy('localhost', `http://localhost:${fakes['ready'].port}`);
    await createAcademy('retention', fakes['ready'].origin);
    await createAcademy('noorigin', null);
    await createAcademy('archived', fakes['ready'].origin, 'archived');
  });

  afterAll(async () => {
    for (const timer of timers) clearTimeout(timer);
    const ids = Object.values(academyIds);
    if (ids.length > 0) await platformTestDb().academy.deleteMany({ where: { id: { in: ids } } });
    await deletePlatformUserFixtures([admin?.id, support?.id].filter((id): id is string => typeof id === 'string'));
    await app?.close();
    for (const fake of Object.values(fakes)) await stopFake(fake);
    if (migrationsRoot) await rm(migrationsRoot, { recursive: true, force: true });
    await closePlatformTestDb();
  });

  it('every fleet route needs a platform token', async () => {
    const server = app.getHttpServer();
    const id = academyIds['ready'];
    // Built one at a time: supertest shares one listening server per request chain.
    for (const send of [
      () => request(server).post(`/api/academies/${id}/probe`),
      () => request(server).get(`/api/academies/${id}/health-checks`),
      () => request(server).get('/api/fleet'),
    ]) {
      const res = await send();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthenticated');
    }
    expect(await platformTestDb().academyHealthCheck.count({ where: { academyId: id } })).toBe(0);
  });

  it('a ready academy: 201 with the snapshot, one row, two plain GETs at its origin', async () => {
    const res = await probe('ready').set('Origin', PLATFORM_TEST_ORIGIN).expect(201);
    expect(res.body).toMatchObject({
      academyId: academyIds['ready'],
      outcome: 'ready',
      httpStatus: 200,
      apiVersion: '9.9.9',
      environment: 'production',
      schemaStatus: 'current',
      schemaExpected: NEWEST_MIGRATION,
      schemaApplied: NEWEST_MIGRATION,
      reason: null,
      error: null,
      triggeredBy: { id: admin.id, fullName: 'Fleet Admin' },
      behind: false,
    });
    expect(typeof res.body.latencyMs).toBe('number');
    expect(new Date(res.body.checkedAt).toISOString()).toBe(res.body.checkedAt);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);

    const rows = await platformTestDb().academyHealthCheck.findMany({ where: { academyId: academyIds['ready'] } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: res.body.id, outcome: 'ready', triggeredById: admin.id });

    const asked = fakes['ready'].requests;
    expect(asked.map((r) => r.path)).toEqual(['/api/health', '/api/health/ready']);
    for (const { headers } of asked) {
      expect(headers['user-agent']).toBe(PROBE_USER_AGENT);
      expect(headers['accept']).toBe('application/json');
      expect(headers['authorization']).toBeUndefined();
      expect(headers['cookie']).toBeUndefined();
    }
  });

  it('support may probe; a not-ready academy with an outdated schema is `not_ready` and `behind`', async () => {
    const res = await probe('outdated', supportToken).expect(201);
    expect(res.body).toMatchObject({
      outcome: 'not_ready',
      httpStatus: 503,
      reason: 'schema_outdated',
      schemaStatus: 'outdated',
      schemaExpected: NEWEST_MIGRATION,
      schemaApplied: OLD_MIGRATION,
      triggeredBy: { id: support.id, fullName: 'Fleet Support' },
      behind: true,
    });
  });

  it('a redirect is `invalid` and never followed', async () => {
    const readyAsked = fakes['ready'].requests.length;
    const res = await probe('redirect').expect(201);
    expect(res.body).toMatchObject({ outcome: 'invalid', reason: 'redirect', httpStatus: 302, behind: null });
    expect(fakes['ready'].requests.length).toBe(readyAsked);
  });

  it('garbage is `invalid` (not JSON); a gateway 502 and a closed port are `unreachable`', async () => {
    expect((await probe('garbage').expect(201)).body).toMatchObject({
      outcome: 'invalid',
      reason: 'not_json',
      httpStatus: 200,
      apiVersion: null,
    });
    expect((await probe('gateway').expect(201)).body).toMatchObject({
      outcome: 'unreachable',
      reason: 'gateway_error',
      httpStatus: 502,
    });
    const refused = await probe('refused').expect(201);
    expect(refused.body).toMatchObject({ outcome: 'unreachable', reason: 'connection_failed', httpStatus: null, latencyMs: null });
    expect(refused.body.error).toMatch(/^liveness: /);
  });

  it('an answer slower than the timeout is `unreachable` (timeout); readiness is then not asked', async () => {
    const started = Date.now();
    const res = await probe('slow').expect(201);
    expect(Date.now() - started).toBeLessThan(4 * TIMEOUT_MS);
    expect(res.body).toMatchObject({
      outcome: 'unreachable',
      reason: 'timeout',
      error: `liveness: timed out after ${TIMEOUT_MS} ms`,
    });
    expect(fakes['slow'].requests.map((r) => r.path)).toEqual(['/api/health']);
  });

  it('http://localhost is allowed outside production', async () => {
    expect((await probe('localhost').expect(201)).body).toMatchObject({ outcome: 'ready', behind: false });
  });

  it('refusals: archived and origin-less academies (409), unknown (404), malformed id (400) — nothing written', async () => {
    const archived = await probe('archived').expect(409);
    expect(archived.body).toMatchObject({
      code: 'academy_not_probeable',
      academyId: academyIds['archived'],
      reason: 'archived',
    });
    const noOrigin = await probe('noorigin', supportToken).expect(409);
    expect(noOrigin.body).toMatchObject({ code: 'academy_not_probeable', reason: 'no_origin' });

    const unknown = '019a0000-0000-7000-8000-000000000000';
    const missing = await request(app.getHttpServer())
      .post(`/api/academies/${unknown}/probe`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(missing.body).toMatchObject({ code: 'academy_not_found', academyId: unknown });
    await request(app.getHttpServer()).post('/api/academies/abc/probe').set('Authorization', `Bearer ${adminToken}`).expect(400);

    expect(
      await platformTestDb().academyHealthCheck.count({
        where: { academyId: { in: [academyIds['archived'], academyIds['noorigin']] } },
      }),
    ).toBe(0);
  });

  it('history: newest first, keyset pages, a foreign cursor refused, an archived academy readable', async () => {
    await probe('ready').expect(201);
    await probe('ready').expect(201);
    const server = app.getHttpServer();
    const path = `/api/academies/${academyIds['ready']}/health-checks`;

    const first = await request(server).get(`${path}?limit=2`).set('Authorization', `Bearer ${supportToken}`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(server)
      .get(`${path}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    const stored = await platformTestDb().academyHealthCheck.findMany({
      where: { academyId: academyIds['ready'] },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    expect(ids).toEqual(stored.map((row) => row.id));
    expect(first.body.items[0]).toMatchObject({ outcome: 'ready', behind: false, triggeredBy: { id: admin.id } });

    const foreign = await request(server).get(`${path}?cursor=bm90LWEtY3Vyc29y`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    expect(foreign.body.code).toBe('cursor_invalid');
    await request(server).get(`${path}?limit=0`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    await request(server).get(`${path}?order=asc`).set('Authorization', `Bearer ${adminToken}`).expect(400);

    const archived = await request(server)
      .get(`/api/academies/${academyIds['archived']}/health-checks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(archived.body).toEqual({ items: [], nextCursor: null });
    await request(server)
      .get('/api/academies/019a0000-0000-7000-8000-000000000000/health-checks')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('the fleet: every academy but the archived ones, by slug, latest/behind/stale and consistent counts', async () => {
    const res = await request(app.getHttpServer()).get('/api/fleet').set('Authorization', `Bearer ${supportToken}`).expect(200);
    const body = res.body as {
      newestAcademyMigration: string | null;
      staleAfterSeconds: number;
      counts: Record<string, number>;
      items: {
        academy: { id: string; slug: string; status: string; origin: string | null; name: { ar: string } };
        latest: { outcome: ProbeOutcome; behind: boolean | null } | null;
        behind: boolean | null;
        stale: boolean;
      }[];
    };
    expect(body.newestAcademyMigration).toBe(NEWEST_MIGRATION);
    expect(body.staleAfterSeconds).toBe(3 * SETTINGS.probeIntervalSeconds);

    const slugs = body.items.map((item) => item.academy.slug);
    expect(slugs).toEqual([...slugs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(body.items.every((item) => item.academy.status !== 'archived')).toBe(true);

    const byName = (name: string) => body.items.find((item) => item.academy.id === academyIds[name]);
    expect(byName('archived')).toBeUndefined();
    expect(byName('ready')).toMatchObject({
      academy: { slug: slug('ready'), status: 'active', origin: fakes['ready'].origin, name: { ar: 'أكاديمية ready' } },
      latest: { outcome: 'ready', behind: false },
      behind: false,
      stale: false,
    });
    expect(byName('outdated')).toMatchObject({ latest: { outcome: 'not_ready' }, behind: true, stale: false });
    expect(byName('redirect')).toMatchObject({ latest: { outcome: 'invalid' }, behind: null });
    expect(byName('slow')).toMatchObject({ latest: { outcome: 'unreachable' } });
    expect(byName('noorigin')).toMatchObject({ academy: { origin: null }, latest: null, behind: null, stale: true });

    const { counts } = body;
    expect(counts['total']).toBe(body.items.length);
    expect(counts['ready']! + counts['notReady']! + counts['unreachable']! + counts['invalid']! + counts['never']!).toBe(counts['total']);
    expect(counts['behind']).toBe(body.items.filter((item) => item.behind === true).length);
    expect(counts['never']).toBe(body.items.filter((item) => item.latest === null).length);
  });

  it('keeps the newest 500 checks of an academy', async () => {
    const academyId = academyIds['retention']!;
    await platformTestDb().academyHealthCheck.createMany({
      data: Array.from({ length: 500 }, () => ({ academyId, outcome: 'unreachable' as const, reason: 'timeout' })),
    });
    const oldest = await platformTestDb().academyHealthCheck.findFirst({
      where: { academyId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const res = await probe('retention').expect(201);
    expect(await platformTestDb().academyHealthCheck.count({ where: { academyId } })).toBe(500);
    expect(await platformTestDb().academyHealthCheck.findUnique({ where: { id: oldest!.id } })).toBeNull();
    expect(await platformTestDb().academyHealthCheck.findUnique({ where: { id: res.body.id as string } })).not.toBeNull();
  });

  it('one periodic round probes every fixture that is not archived and has an origin, untriggered', async () => {
    const ids = Object.values(academyIds);
    const before = await platformTestDb().academyHealthCheck.count({ where: { academyId: { in: ids } } });
    const summary = await app.get(FleetService).probeAll({ ids });
    expect(summary).toEqual({
      probed: 9,
      ready: 3, // ready, localhost, retention
      notReady: 1,
      unreachable: 3, // gateway, slow, refused
      invalid: 2, // redirect, garbage
      behind: 1,
      failed: 0,
    });
    const after = await platformTestDb().academyHealthCheck.count({ where: { academyId: { in: ids } } });
    // The retention academy stays at 500 (one in, one out).
    expect(after - before).toBe(8);
    const untriggered = await platformTestDb().academyHealthCheck.count({
      where: { academyId: academyIds['outdated'], triggeredById: null },
    });
    expect(untriggered).toBe(1);
  });

  it('records no audit event for probes and reads', async () => {
    const count = await platformTestDb().platformAuditLog.count({
      where: {
        OR: [
          { actorPlatformUserId: { in: [admin.id, support.id] } },
          { entityId: { in: Object.values(academyIds) } },
        ],
      },
    });
    expect(count).toBe(0);
  });
});
