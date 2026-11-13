// TEST-209 (e2e) — MOD-18-T04 the academies registry of the platform (roadmap
// §4m.5; API-183..195) through HTTP with a `super_admin` and a `support`
// fixture: support reads and never writes (403 role_forbidden); the academy
// state machine with origin_required; one primary domain (a promotion demotes);
// one current subscription; the date problems; an archived academy is
// read-only; exactly one platform audit event per effective write and none on a
// refusal or a PATCH without a difference (counted above an id watermark, by
// fixture actor — other suites share the dev platform database); OpenAPI.
//
// Skipped without the platform database. Fixtures carry the run id
// (PLATFORM_TEST_RUN) in every slug, plan key and hostname and are deleted in
// afterAll (academies cascade their domains, subscriptions and health checks;
// the test's plans go after them). Audit rows stay — the table is append-only.
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const RUN = PLATFORM_TEST_RUN;
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const UNKNOWN_ID = '019a7d00-0000-7000-8000-00000000abcd';
const slug = (suffix: string) => `${RUN}-${suffix}`;
const host = (suffix: string) => `${suffix}.${RUN}.example.test`;
const planKey = (suffix: string) => `${RUN}-${suffix}`;

const available = await platformDbReachable();

describe.skipIf(!available)('platform academies registry — MOD-18-T04 (e2e, TEST-209)', () => {
  let app: NestExpressApplication;
  let superAdmin: Awaited<ReturnType<typeof createPlatformUserFixture>>;
  let support: Awaited<ReturnType<typeof createPlatformUserFixture>>;
  let superToken: string;
  let supportToken: string;
  const db = () => platformTestDb();
  const api = () => request(app.getHttpServer());

  type Method = 'get' | 'post' | 'patch' | 'delete';
  const as = (token: string, method: Method, path: string) => {
    const req = api()[method](path).set('Authorization', `Bearer ${token}`);
    return method === 'get' ? req : req.set('Origin', PLATFORM_TEST_ORIGIN);
  };
  const asSuper = (method: Method, path: string) => as(superToken, method, path);
  const asSupport = (method: Method, path: string) => as(supportToken, method, path);

  /** Id of the newest platform event (UUIDv7 = insertion order); a step's events are those above it. */
  async function mark(): Promise<string> {
    const latest = await db().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    db().platformAuditLog.findMany({
      where: { id: { gt: markId }, actorPlatformUserId: { in: [superAdmin.id, support.id] } },
      orderBy: { id: 'asc' },
      select: { action: true, entityType: true, entityId: true, metadata: true, actorPlatformUserId: true, userAgent: true },
    });

  async function createAcademy(suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; body: Record<string, unknown> }> {
    const res = await asSuper('post', '/api/academies').send({ slug: slug(suffix), name: { ar: `أكاديمية ${suffix}` }, ...extra }).expect(201);
    return { id: res.body.id as string, body: res.body };
  }

  async function createPlan(suffix: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await asSuper('post', '/api/plans').send({ key: planKey(suffix), name: { ar: `خطة ${suffix}` }, ...extra }).expect(201);
    return res.body.id as string;
  }

  const primaries = async (academyId: string) =>
    (await db().domain.findMany({ where: { academyId, isPrimary: true }, select: { hostname: true } })).map((d) => d.hostname);

  beforeAll(async () => {
    app = await createPlatformTestApp();
    superAdmin = await createPlatformUserFixture({ role: 'super_admin' });
    support = await createPlatformUserFixture({ role: 'support' });
    superToken = await platformAccessTokenFor(app, superAdmin);
    supportToken = await platformAccessTokenFor(app, support);
  });

  afterAll(async () => {
    if (available) {
      await db().academy.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
      await db().plan.deleteMany({ where: { key: { startsWith: `${RUN}-` } } });
      await deletePlatformUserFixtures([superAdmin?.id, support?.id].filter((id): id is string => typeof id === 'string'));
      await closePlatformTestDb();
    }
    await app?.close();
  });

  it('API-184: registers a provisioning academy (normalized input) with exactly one event; a duplicate slug and bad input record nothing', async () => {
    const m = await mark();
    const res = await asSuper('post', '/api/academies')
      .set('User-Agent', 'registry-e2e')
      .send({
        slug: `  ${slug('main').toUpperCase()} `,
        name: { ar: ' أكاديمية النور ', en: 'Al-Noor', tr: '' },
        origin: 'HTTPS://Main.Example.TEST/',
        contactEmail: ' Owner@Example.TEST ',
        notes: ' first ',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      slug: slug('main'),
      name: { ar: 'أكاديمية النور', en: 'Al-Noor' },
      status: 'provisioning',
      origin: 'https://main.example.test',
      contactEmail: 'owner@example.test',
      notes: 'first',
      archivedAt: null,
      primaryDomain: null,
      currentSubscription: null,
      latestHealthCheck: null,
      createdBy: { id: superAdmin.id, fullName: superAdmin.fullName },
      domains: [],
      subscriptions: [],
    });
    expect(res.body.name).not.toHaveProperty('tr');
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
    const events = await eventsSince(m);
    expect(events).toEqual([
      {
        action: 'platform.academies.created',
        entityType: 'academies',
        entityId: res.body.id,
        metadata: { slug: slug('main') },
        actorPlatformUserId: superAdmin.id,
        userAgent: 'registry-e2e',
      },
    ]);

    const m2 = await mark();
    const dup = await asSuper('post', '/api/academies').send({ slug: slug('main'), name: { ar: 'نسخة' } }).expect(409);
    expect(dup.body).toMatchObject({ statusCode: 409, code: 'academy_slug_taken', slug: slug('main') });
    for (const bad of [
      { slug: '-bad-', name: { ar: 'x' } },
      { slug: 'x'.repeat(33), name: { ar: 'x' } },
      { slug: slug('b1'), name: { en: 'no arabic' } },
      { slug: slug('b2'), name: { ar: '   ' } },
      { slug: slug('b3'), name: { ar: 'x', fr: 'y' } },
      { slug: slug('b4'), name: { ar: 'x' }, origin: 'http://example.com' },
      { slug: slug('b5'), name: { ar: 'x' }, origin: 'https://example.com/path' },
      { slug: slug('b6'), name: { ar: 'x' }, contactEmail: 'not-an-email' },
      { slug: slug('b7'), name: { ar: 'x' }, notes: 'n'.repeat(2001) },
      { slug: slug('b8'), name: { ar: 'x' }, status: 'active' },
      { slug: 42, name: { ar: 'x' } },
    ]) {
      const r = await asSuper('post', '/api/academies').send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);
    expect(await db().academy.count({ where: { slug: { in: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'].map(slug) } } })).toBe(0);
  });

  it('support reads (200) but every write is 403 role_forbidden, with no event', async () => {
    const { id } = await createAcademy('sup');
    const planId = await createPlan('sup');
    const domain = await asSuper('post', `/api/academies/${id}/domains`).send({ hostname: host('sup'), kind: 'custom' }).expect(201);
    const domainId = domain.body.domains[0].id as string;
    const sub = await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId, status: 'trial', startsAt: '2026-12-01T00:00:00Z' }).expect(201);

    await asSupport('get', `/api/academies?q=${RUN}`).expect(200);
    const detail = await asSupport('get', `/api/academies/${id}`).expect(200);
    expect(detail.body.domains).toHaveLength(1);
    await asSupport('get', '/api/plans?includeInactive=true').expect(200);

    const m = await mark();
    const writes: [Method, string, Record<string, unknown>][] = [
      ['post', '/api/academies', { slug: slug('sup2'), name: { ar: 'x' } }],
      ['patch', `/api/academies/${id}`, { notes: 'x' }],
      ['post', `/api/academies/${id}/status`, { action: 'archive' }],
      ['post', `/api/academies/${id}/domains`, { hostname: host('sup2'), kind: 'custom' }],
      ['patch', `/api/academies/${id}/domains/${domainId}`, { isPrimary: true }],
      ['delete', `/api/academies/${id}/domains/${domainId}`, {}],
      ['post', '/api/plans', { key: planKey('sup2'), name: { ar: 'x' } }],
      ['patch', `/api/plans/${planId}`, { isActive: false }],
      ['post', `/api/academies/${id}/subscriptions`, { planId, status: 'active', startsAt: '2026-12-01T00:00:00Z' }],
      ['patch', `/api/subscriptions/${sub.body.id}`, { status: 'active' }],
    ];
    for (const [method, path, body] of writes) {
      const res = await asSupport(method, path).send(body);
      expect([res.status, res.body.code], `${method} ${path}`).toEqual([403, 'role_forbidden']);
      expect(res.body.required).toEqual(['super_admin']);
    }
    expect(await eventsSince(m)).toEqual([]);
    // Without a token every route is 401.
    await api().get('/api/academies').expect(401);
    await api().get('/api/plans').expect(401);
  });

  it('API-183: newest first with keyset pages, status / includeArchived filters, literal case-insensitive search and the per-item summaries', async () => {
    const a = await createAcademy('lista', { name: { ar: 'قائمة أ', en: `List ${RUN} 5% off` } });
    const b = await createAcademy('listb', { name: { ar: 'قائمة ب', en: `List ${RUN} 5ab` } });
    const c = await createAcademy('listc', { name: { ar: `قائمة ${RUN} ج` }, origin: 'https://listc.example.test' });
    await asSuper('post', `/api/academies/${c.id}/status`).send({ action: 'archive' }).expect(200);

    // Health checks are written by the probe (T05); two rows here, the newest wins.
    await db().academyHealthCheck.create({ data: { academyId: a.id, outcome: 'not_ready', checkedAt: new Date(Date.now() - 60_000), reason: 'schema_outdated' } });
    await db().academyHealthCheck.create({
      data: { academyId: a.id, outcome: 'ready', httpStatus: 200, latencyMs: 12, apiVersion: '0.1.0', environment: 'production', schemaStatus: 'current', schemaExpected: '20261112083749_mod12_notifications', schemaApplied: '20261112083749_mod12_notifications' },
    });
    await asSuper('post', `/api/academies/${a.id}/domains`).send({ hostname: host('lista'), kind: 'platform_subdomain', isPrimary: true }).expect(201);

    // Literal: `%` is no wildcard (it would also match "5ab"); case-insensitive on the name.
    const pct = await asSupport('get', `/api/academies?q=${encodeURIComponent(`${RUN.toUpperCase()} 5%`)}`).expect(200);
    expect(pct.body.items.map((item: { id: string }) => item.id)).toEqual([a.id]);
    const underscore = await asSupport('get', `/api/academies?q=${encodeURIComponent(`${RUN} 5_b`)}`).expect(200);
    expect(underscore.body.items).toEqual([]);
    // The Arabic name and the slug are searched too.
    const arabic = await asSupport('get', `/api/academies?q=${encodeURIComponent(`قائمة ${RUN}`)}&includeArchived=true`).expect(200);
    expect(arabic.body.items.map((item: { id: string }) => item.id)).toEqual([c.id]);

    // Default: archived left out; includeArchived / status=archived bring it back.
    const mine = await asSupport('get', `/api/academies?q=${RUN}-list`).expect(200);
    expect(mine.body.items.map((item: { id: string }) => item.id)).toEqual([b.id, a.id]);
    const all = await asSupport('get', `/api/academies?q=${RUN}-list&includeArchived=true`).expect(200);
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual([c.id, b.id, a.id]);
    const archived = await asSupport('get', `/api/academies?q=${RUN}-list&status=archived`).expect(200);
    expect(archived.body.items.map((item: { id: string }) => item.id)).toEqual([c.id]);
    const provisioning = await asSupport('get', `/api/academies?q=${RUN}-list&status=provisioning&includeArchived=true`).expect(200);
    expect(provisioning.body.items.map((item: { id: string }) => item.id)).toEqual([b.id, a.id]);

    // Keyset pages of one, newest first.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `/api/academies?q=${RUN}-list&includeArchived=true&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await asSupport('get', query).expect(200);
      expect(page.body.items).toHaveLength(1);
      seen.push(page.body.items[0].id);
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([c.id, b.id, a.id]);

    const fresh = await asSupport('get', `/api/academies?q=${RUN}-lista`).expect(200);
    expect(fresh.body.items[0]).toMatchObject({
      id: a.id,
      slug: slug('lista'),
      status: 'provisioning',
      primaryDomain: host('lista'),
      currentSubscription: null,
      latestHealthCheck: { outcome: 'ready', httpStatus: 200, latencyMs: 12, schemaStatus: 'current', schemaApplied: '20261112083749_mod12_notifications', reason: null },
    });
    expect(Object.keys(fresh.body.items[0]).sort()).toEqual(
      ['contactEmail', 'createdAt', 'currentSubscription', 'id', 'latestHealthCheck', 'name', 'origin', 'primaryDomain', 'slug', 'status', 'updatedAt'].sort(),
    );

    for (const bad of ['cursor=not-a-cursor', 'limit=0', 'limit=101', 'status=gone', 'includeArchived=yes']) {
      const r = await asSupport('get', `/api/academies?${bad}`);
      expect(r.status, bad).toBe(400);
    }
    const badCursor = await asSupport('get', '/api/academies?cursor=bm90LWEtY3Vyc29y').expect(400);
    expect(badCursor.body.code).toBe('cursor_invalid');
    await asSupport('get', `/api/academies/${UNKNOWN_ID}`).expect(404);
  });

  it('API-186: smallest diff with one event; no difference, {} and an immutable slug write nothing', async () => {
    const { id } = await createAcademy('patch', { contactEmail: 'a@example.test' });
    const m = await mark();
    const res = await asSuper('patch', `/api/academies/${id}`)
      .send({ name: { ar: 'أكاديمية patch' }, contactEmail: 'A@Example.test', notes: 'note', origin: 'https://Patch.example.test' })
      .expect(200);
    expect(res.body).toMatchObject({ notes: 'note', origin: 'https://patch.example.test', contactEmail: 'a@example.test' });
    let events = await eventsSince(m);
    expect(events.map((e) => [e.action, e.entityId, e.metadata])).toEqual([
      ['platform.academies.updated', id, { slug: slug('patch'), fields: ['origin', 'notes'] }],
    ]);

    const m2 = await mark();
    await asSuper('patch', `/api/academies/${id}`).send({ notes: 'note', name: { ar: 'أكاديمية patch' } }).expect(200);
    expect((await asSuper('patch', `/api/academies/${id}`).send({}).expect(400)).body.code).toBe('nothing_to_update');
    await asSuper('patch', `/api/academies/${id}`).send({ slug: slug('other') }).expect(400);
    await asSuper('patch', `/api/academies/${id}`).send({ name: null }).expect(400);
    await asSuper('patch', `/api/academies/${UNKNOWN_ID}`).send({ notes: 'x' }).expect(404);
    expect(await eventsSince(m2)).toEqual([]);

    const cleared = await asSuper('patch', `/api/academies/${id}`).send({ notes: null, contactEmail: '  ' }).expect(200);
    expect(cleared.body).toMatchObject({ notes: null, contactEmail: null });
    events = await eventsSince(m2);
    expect(events.map((e) => e.metadata)).toEqual([{ slug: slug('patch'), fields: ['contactEmail', 'notes'] }]);
  });

  it('API-187: the state machine — origin_required, invalid_transition, archive is read-only, restore', async () => {
    const { id } = await createAcademy('state');
    const planId = await createPlan('state');
    const m = await mark();

    const noOrigin = await asSuper('post', `/api/academies/${id}/status`).send({ action: 'activate' }).expect(422);
    expect(noOrigin.body).toMatchObject({ code: 'origin_required', academyId: id, action: 'activate' });
    const wrong = await asSuper('post', `/api/academies/${id}/status`).send({ action: 'suspend' }).expect(409);
    expect(wrong.body).toMatchObject({ code: 'invalid_transition', entity: 'academy', from: 'provisioning', action: 'suspend', allowed: ['activate', 'archive'] });
    await asSuper('post', `/api/academies/${id}/status`).send({ action: 'nope' }).expect(400);
    expect(await eventsSince(m)).toEqual([]);

    await asSuper('patch', `/api/academies/${id}`).send({ origin: 'http://localhost:8080' }).expect(200);
    const active = await asSuper('post', `/api/academies/${id}/status`).send({ action: 'activate', reason: ' go live ' }).expect(200);
    expect(active.body).toMatchObject({ status: 'active', archivedAt: null });
    const keepOrigin = await asSuper('patch', `/api/academies/${id}`).send({ origin: null }).expect(422);
    expect(keepOrigin.body).toMatchObject({ code: 'origin_required', action: 'clear_origin' });

    await asSuper('post', `/api/academies/${id}/status`).send({ action: 'suspend' }).expect(200);
    const archived = await asSuper('post', `/api/academies/${id}/status`).send({ action: 'archive' }).expect(200);
    expect(archived.body.status).toBe('archived');
    expect(Number.isNaN(Date.parse(archived.body.archivedAt))).toBe(false);

    // Archived = read-only for the academy, its domains and its subscriptions.
    const m2 = await mark();
    expect((await asSuper('patch', `/api/academies/${id}`).send({ notes: 'x' }).expect(409)).body).toMatchObject({ code: 'academy_archived', academyId: id });
    expect((await asSuper('post', `/api/academies/${id}/domains`).send({ hostname: host('state'), kind: 'custom' }).expect(409)).body.code).toBe('academy_archived');
    expect(
      (await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId, status: 'active', startsAt: '2026-12-01T00:00:00Z' }).expect(409)).body.code,
    ).toBe('academy_archived');
    expect((await asSuper('post', `/api/academies/${id}/status`).send({ action: 'archive' }).expect(409)).body).toMatchObject({ from: 'archived', allowed: ['restore'] });
    expect(await eventsSince(m2)).toEqual([]);

    const restored = await asSuper('post', `/api/academies/${id}/status`).send({ action: 'restore' }).expect(200);
    expect(restored.body).toMatchObject({ status: 'suspended', archivedAt: null });
    await asSuper('post', `/api/academies/${id}/status`).send({ action: 'activate' }).expect(200);

    const events = await eventsSince(m);
    expect(events.map((e) => [e.action, e.entityType, e.entityId, e.metadata])).toEqual([
      ['platform.academies.updated', 'academies', id, { slug: slug('state'), fields: ['origin'] }],
      ['platform.academies.status.changed', 'academies', id, { slug: slug('state'), action: 'activate', from: 'provisioning', to: 'active', reason: 'go live' }],
      ['platform.academies.status.changed', 'academies', id, { slug: slug('state'), action: 'suspend', from: 'active', to: 'suspended' }],
      ['platform.academies.status.changed', 'academies', id, { slug: slug('state'), action: 'archive', from: 'suspended', to: 'archived' }],
      ['platform.academies.status.changed', 'academies', id, { slug: slug('state'), action: 'restore', from: 'archived', to: 'suspended' }],
      ['platform.academies.status.changed', 'academies', id, { slug: slug('state'), action: 'activate', from: 'suspended', to: 'active' }],
    ]);
  });

  it('API-188..190: at most one primary domain — adding or promoting a primary demotes the old one; refusals record nothing', async () => {
    const { id } = await createAcademy('dom');
    const other = await createAcademy('dom2');
    const m = await mark();

    const first = await asSuper('post', `/api/academies/${id}/domains`).send({ hostname: ` ${host('d1').toUpperCase()} `, kind: 'platform_subdomain' }).expect(201);
    expect(first.body.domains).toEqual([expect.objectContaining({ hostname: host('d1'), kind: 'platform_subdomain', isPrimary: false, verifiedAt: null })]);
    const d1 = first.body.domains[0].id as string;
    const second = await asSuper('post', `/api/academies/${id}/domains`).send({ hostname: host('d2'), kind: 'custom', isPrimary: true }).expect(201);
    expect(second.body.primaryDomain).toBe(host('d2'));
    const d2 = second.body.domains[0].id as string; // primary first
    const third = await asSuper('post', `/api/academies/${id}/domains`).send({ hostname: host('d3'), kind: 'custom', isPrimary: true }).expect(201);
    const d3 = third.body.domains[0].id as string;
    expect(await primaries(id)).toEqual([host('d3')]);
    const promoted = await asSuper('patch', `/api/academies/${id}/domains/${d1}`).send({ isPrimary: true }).expect(200);
    expect(promoted.body.domains.map((d: { hostname: string; isPrimary: boolean }) => [d.hostname, d.isPrimary])).toEqual([
      [host('d1'), true],
      [host('d2'), false],
      [host('d3'), false],
    ]);
    expect(await primaries(id)).toEqual([host('d1')]);

    const m2 = await mark();
    await asSuper('patch', `/api/academies/${id}/domains/${d1}`).send({ isPrimary: true }).expect(200); // already primary: no write
    expect((await asSuper('patch', `/api/academies/${id}/domains/${d2}`).send({ isPrimary: false }).expect(400)).body).toMatchObject({ code: 'domain_demote_forbidden' });
    await asSuper('patch', `/api/academies/${id}/domains/${d2}`).send({ isPrimary: 'true' }).expect(400);
    await asSuper('patch', `/api/academies/${id}/domains/${d2}`).send({}).expect(400);
    expect((await asSuper('post', `/api/academies/${other.id}/domains`).send({ hostname: host('d2'), kind: 'custom' }).expect(409)).body).toMatchObject({
      code: 'domain_taken',
      hostname: host('d2'),
    });
    expect((await asSuper('patch', `/api/academies/${other.id}/domains/${d2}`).send({ isPrimary: true }).expect(404)).body.code).toBe('domain_not_found');
    expect((await asSuper('delete', `/api/academies/${other.id}/domains/${d2}`).expect(404)).body.code).toBe('domain_not_found');
    expect((await asSuper('post', `/api/academies/${UNKNOWN_ID}/domains`).send({ hostname: host('d9'), kind: 'custom' }).expect(404)).body.code).toBe('academy_not_found');
    for (const bad of [
      { hostname: 'nodot', kind: 'custom' },
      { hostname: 'bad_host.example.test', kind: 'custom' },
      { hostname: host('d8'), kind: 'wildcard' },
      { hostname: host('d8'), kind: 'custom', isPrimary: 'yes' },
    ]) {
      const r = await asSuper('post', `/api/academies/${id}/domains`).send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);

    const removed = await asSuper('delete', `/api/academies/${id}/domains/${d1}`).expect(200);
    expect(removed.body.primaryDomain).toBeNull();
    expect(removed.body.domains.map((d: { hostname: string }) => d.hostname)).toEqual([host('d2'), host('d3')]);

    const events = await eventsSince(m);
    expect(events.map((e) => [e.action, e.entityType, e.entityId, e.metadata])).toEqual([
      ['platform.domains.added', 'academies', id, { domainId: d1, hostname: host('d1'), kind: 'platform_subdomain', isPrimary: false }],
      ['platform.domains.added', 'academies', id, { domainId: d2, hostname: host('d2'), kind: 'custom', isPrimary: true }],
      ['platform.domains.added', 'academies', id, { domainId: d3, hostname: host('d3'), kind: 'custom', isPrimary: true, demotedDomainId: d2 }],
      ['platform.domains.updated', 'academies', id, { domainId: d1, hostname: host('d1'), isPrimary: true, demotedDomainId: d3 }],
      ['platform.domains.removed', 'academies', id, { domainId: d1, hostname: host('d1'), kind: 'platform_subdomain', isPrimary: true }],
    ]);
  });

  it('API-191..193: plans — normalized limits, key taken, invalid limits, inactive filter, immutable key, smallest diff', async () => {
    const m = await mark();
    const created = await asSuper('post', '/api/plans')
      .send({ key: ` ${planKey('std').toUpperCase()} `, name: { ar: 'قياسية', en: 'Standard' }, limits: { students: 500, storageGb: null, admins: 3 } })
      .expect(201);
    expect(created.body).toMatchObject({ key: planKey('std'), name: { ar: 'قياسية', en: 'Standard' }, isActive: true, limits: { admins: 3, storageGb: null, students: 500 } });
    expect(Object.keys(created.body.limits)).toEqual(['admins', 'storageGb', 'students']);
    const id = created.body.id as string;
    const empty = await asSuper('post', '/api/plans').send({ key: planKey('free'), name: { ar: 'مجانية' }, isActive: false }).expect(201);
    expect(empty.body).toMatchObject({ limits: {}, isActive: false });

    const m2 = await mark();
    expect((await asSuper('post', '/api/plans').send({ key: planKey('std'), name: { ar: 'x' } }).expect(409)).body).toMatchObject({ code: 'plan_key_taken', key: planKey('std') });
    const badLimits = await asSuper('post', '/api/plans').send({ key: planKey('bad'), name: { ar: 'x' }, limits: { Students: 1, teachers: -2, rooms: 2.5 } }).expect(400);
    expect(badLimits.body).toMatchObject({ code: 'plan_limits_invalid', problems: ['key_format', 'value_type'], keys: ['Students', 'teachers', 'rooms'] });
    expect((await asSuper('post', '/api/plans').send({ key: planKey('bad'), name: { ar: 'x' }, limits: [1] }).expect(400)).body.problems).toEqual(['not_an_object']);
    await asSuper('post', '/api/plans').send({ key: 'Bad Key', name: { ar: 'x' } }).expect(400);
    await asSuper('patch', `/api/plans/${id}`).send({ key: planKey('renamed') }).expect(400);
    expect((await asSuper('patch', `/api/plans/${id}`).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await asSuper('patch', `/api/plans/${id}`).send({ limits: null }).expect(400)).body.code).toBe('plan_limits_invalid');
    await asSuper('patch', `/api/plans/${id}`).send({ limits: { students: 500, admins: 3, storageGb: null }, isActive: true }).expect(200); // no difference
    expect((await asSuper('patch', `/api/plans/${UNKNOWN_ID}`).send({ isActive: false }).expect(404)).body.code).toBe('plan_not_found');
    expect(await eventsSince(m2)).toEqual([]);

    const updated = await asSuper('patch', `/api/plans/${id}`).send({ limits: { students: 1000 }, name: { ar: 'قياسية' } }).expect(200);
    expect(updated.body).toMatchObject({ limits: { students: 1000 }, name: { ar: 'قياسية' } });
    expect(updated.body.name).not.toHaveProperty('en');

    const active = await asSupport('get', '/api/plans').expect(200);
    const keys = active.body.items.map((p: { key: string }) => p.key);
    expect(keys).toContain(planKey('std'));
    expect(keys).not.toContain(planKey('free'));
    const every = await asSupport('get', '/api/plans?includeInactive=true').expect(200);
    const everyKeys: string[] = every.body.items.map((p: { key: string }) => p.key);
    expect(everyKeys).toEqual(expect.arrayContaining([planKey('std'), planKey('free')]));
    expect(everyKeys.indexOf(planKey('free'))).toBeLessThan(everyKeys.indexOf(planKey('std'))); // by key

    const events = await eventsSince(m);
    expect(events.map((e) => [e.action, e.entityType, e.metadata])).toEqual([
      ['platform.plans.created', 'plans', { key: planKey('std') }],
      ['platform.plans.created', 'plans', { key: planKey('free') }],
      ['platform.plans.updated', 'plans', { key: planKey('std'), fields: ['name', 'limits'] }],
    ]);
  });

  it('API-194/195: one current subscription, the date problems, the status moves and an archived academy that may only end one', async () => {
    const { id } = await createAcademy('subs', { origin: 'https://subs.example.test' });
    const planId = await createPlan('subs');
    const inactivePlan = await createPlan('subsoff', { isActive: false });
    const m = await mark();

    const noPlan = await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId: UNKNOWN_ID, status: 'trial', startsAt: '2026-12-01T00:00:00Z' }).expect(404);
    expect(noPlan.body.code).toBe('plan_not_found');
    const inactive = await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId: inactivePlan, status: 'trial', startsAt: '2026-12-01T00:00:00Z' }).expect(422);
    expect(inactive.body).toMatchObject({ code: 'plan_inactive', planId: inactivePlan, key: planKey('subsoff') });
    const dates = await asSuper('post', `/api/academies/${id}/subscriptions`)
      .send({ planId, status: 'active', startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z', trialEndsAt: '2026-12-15T00:00:00Z' })
      .expect(400);
    expect(dates.body).toMatchObject({ code: 'subscription_invalid', problems: ['ends_before_start', 'trial_end_without_trial'] });
    for (const bad of [
      { planId, status: 'canceled', startsAt: '2026-12-01T00:00:00Z' },
      { planId, status: 'trial', startsAt: '2026-12-01' },
      { planId, status: 'trial', startsAt: '2026-02-30T00:00:00Z' },
      { planId, status: 'trial' },
      { planId: 'x', status: 'trial', startsAt: '2026-12-01T00:00:00Z' },
    ]) {
      const r = await asSuper('post', `/api/academies/${id}/subscriptions`).send(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await eventsSince(m)).toEqual([]);

    const trial = await asSuper('post', `/api/academies/${id}/subscriptions`)
      .send({ planId, status: 'trial', startsAt: '2026-12-01T00:00:00+03:00', trialEndsAt: '2026-12-15T00:00:00Z', notes: ' pilot ' })
      .expect(201);
    expect(trial.body).toMatchObject({
      academyId: id,
      plan: { id: planId, key: planKey('subs'), isActive: true },
      status: 'trial',
      startsAt: '2026-11-30T21:00:00.000Z',
      endsAt: null,
      trialEndsAt: '2026-12-15T00:00:00.000Z',
      notes: 'pilot',
    });
    const subId = trial.body.id as string;
    const second = await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId, status: 'active', startsAt: '2027-01-01T00:00:00Z' }).expect(409);
    expect(second.body).toMatchObject({ code: 'subscription_current_exists', subscriptionId: subId });

    const m2 = await mark();
    await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'trial', notes: 'pilot' }).expect(200); // no difference
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'past_due' }).expect(409)).body).toMatchObject({
      code: 'invalid_transition',
      entity: 'subscription',
      from: 'trial',
      to: 'past_due',
      allowed: ['active', 'canceled', 'expired'],
    });
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ endsAt: '2026-11-01T00:00:00Z' }).expect(400)).body.problems).toEqual(['ends_before_start']);
    await asSuper('patch', `/api/subscriptions/${subId}`).send({ planId }).expect(400);
    await asSuper('patch', `/api/subscriptions/${subId}`).send({ startsAt: '2026-12-02T00:00:00Z' }).expect(400);
    expect((await asSuper('patch', `/api/subscriptions/${UNKNOWN_ID}`).send({ notes: 'x' }).expect(404)).body.code).toBe('subscription_not_found');
    expect(await eventsSince(m2)).toEqual([]);

    // trial → active (its trial end stays as history), a list item shows it as current.
    const activated = await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'active', endsAt: '2027-12-01T00:00:00Z' }).expect(200);
    expect(activated.body).toMatchObject({ status: 'active', endsAt: '2027-12-01T00:00:00.000Z', trialEndsAt: '2026-12-15T00:00:00.000Z' });
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ trialEndsAt: '2026-12-20T00:00:00Z' }).expect(400)).body.problems).toEqual(['trial_end_without_trial']);
    const listed = await asSupport('get', `/api/academies?q=${RUN}-subs`).expect(200);
    expect(listed.body.items[0].currentSubscription).toMatchObject({ id: subId, planId, planKey: planKey('subs'), status: 'active', endsAt: '2027-12-01T00:00:00.000Z' });

    // Archived: only ending the subscription is accepted; then it is terminal.
    await asSuper('post', `/api/academies/${id}/status`).send({ action: 'archive' }).expect(200);
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ notes: 'x' }).expect(409)).body.code).toBe('academy_archived');
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'past_due' }).expect(409)).body.code).toBe('academy_archived');
    const canceled = await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'canceled', notes: 'closed' }).expect(200);
    expect(canceled.body).toMatchObject({ status: 'canceled', notes: 'closed' });
    await asSuper('post', `/api/academies/${id}/status`).send({ action: 'restore' }).expect(200);
    expect((await asSuper('patch', `/api/subscriptions/${subId}`).send({ status: 'active' }).expect(409)).body).toMatchObject({ from: 'canceled', allowed: [] });

    // With the old one ended, a new current subscription is accepted; the detail lists both, newest first.
    const next = await asSuper('post', `/api/academies/${id}/subscriptions`).send({ planId, status: 'past_due', startsAt: '2027-01-01T00:00:00Z' }).expect(201);
    const detail = await asSupport('get', `/api/academies/${id}`).expect(200);
    expect(detail.body.subscriptions.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      [next.body.id, 'past_due'],
      [subId, 'canceled'],
    ]);
    expect(detail.body.currentSubscription).toMatchObject({ id: next.body.id, status: 'past_due' });

    const events = (await eventsSince(m)).filter((e) => e.action.startsWith('platform.subscriptions.'));
    expect(events.map((e) => [e.action, e.entityType, e.metadata])).toEqual([
      ['platform.subscriptions.created', 'subscriptions', { academyId: id, planKey: planKey('subs'), status: 'trial' }],
      ['platform.subscriptions.updated', 'subscriptions', { academyId: id, planKey: planKey('subs'), status: 'active', fields: ['status', 'endsAt'], from: 'trial' }],
      ['platform.subscriptions.updated', 'subscriptions', { academyId: id, planKey: planKey('subs'), status: 'canceled', fields: ['status', 'notes'], from: 'active' }],
      ['platform.subscriptions.created', 'subscriptions', { academyId: id, planKey: planKey('subs'), status: 'past_due' }],
    ]);
    expect(events[0]!.entityId).toBe(subId);
    expect(events[3]!.entityId).toBe(next.body.id);
  });

  it('OpenAPI lists the registry routes', async () => {
    const docs = await api().get('/api/docs-json').expect(200);
    const paths = docs.body.paths as Record<string, Record<string, unknown>>;
    const methods = (path: string) => Object.keys(paths[path] ?? {});
    expect(methods('/api/academies')).toEqual(expect.arrayContaining(['get', 'post']));
    expect(methods('/api/academies/{id}')).toEqual(expect.arrayContaining(['get', 'patch']));
    expect(methods('/api/academies/{id}/status')).toEqual(['post']);
    expect(methods('/api/academies/{id}/domains')).toEqual(['post']);
    expect(methods('/api/academies/{id}/domains/{domainId}')).toEqual(expect.arrayContaining(['patch', 'delete']));
    expect(methods('/api/plans')).toEqual(expect.arrayContaining(['get', 'post']));
    expect(methods('/api/plans/{id}')).toEqual(['patch']);
    expect(methods('/api/academies/{id}/subscriptions')).toEqual(['post']);
    expect(methods('/api/subscriptions/{id}')).toEqual(['patch']);
    for (const schema of ['AcademyItemDto', 'AcademyDetailDto', 'CreateAcademyDto', 'UpdateAcademyDto', 'DomainDto', 'PlanDto', 'CreatePlanDto', 'SubscriptionDto', 'CreateSubscriptionDto']) {
      expect(docs.body.components.schemas, schema).toHaveProperty(schema);
    }
  });
});
