// TEST-223 — MOD-02-T04, public part: `GET /api/academy/public` (API-205), the
// branding of the sign-in page, against the live development database.
// Skipped when no database is reachable.
//
// The suite only reads the single shared `academy` row (it never writes it), so
// it needs no fixture. Audit events are looked for by this suite's own
// User-Agent above an id watermark: an anonymous read has no actor, and other
// clients of the shared database must never pollute the count. The rate-limit
// test runs last — once it has tripped, this app instance answers 429 on the
// route for a minute (in-memory throttler, one per app).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { readSettings } from '../src/academy/academy.settings.js';
import { readLocalizedText } from '../src/authorization/localized-text.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const USER_AGENT = `TEST-223 supertest ${RUN}`;
const PUBLIC = '/api/academy/public';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const PUBLIC_KEYS = ['catalogPublic', 'defaultLocale', 'logoUrl', 'name'];
/** API-205: 60 requests per minute per IP. */
const LIMIT = 60;

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-02-T04 public academy branding (e2e, TEST-223)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const api = () => request(app.getHttpServer());
  const anonymous = () => api().get(PUBLIC).set('User-Agent', USER_AGENT);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma?.$disconnect();
    await app?.close();
  });

  it('AC1 — answers without a token: 200, while the signed-in read next to it still needs one', async () => {
    const res = await anonymous();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // An invalid bearer token changes nothing on a public route.
    await api().get(PUBLIC).set({ 'User-Agent': USER_AGENT, Authorization: 'Bearer not-a-token' }).expect(200);
    // The private read is not opened by its public sibling.
    const privateRead = await api().get('/api/academy').set('User-Agent', USER_AGENT).expect(401);
    expect(privateRead.body.code).toBe('unauthenticated');
  });

  it('AC2 — exactly name, logoUrl, defaultLocale and catalogPublic (MOD-20), equal to the stored row; never an id, slug, contact, zone, currency or settings', async () => {
    const res = await anonymous().expect(200);
    const row = await prisma.academy.findFirstOrThrow({ select: { slug: true, name: true, logoUrl: true, defaultLocale: true, contactEmail: true, contactPhone: true, settings: true } });
    expect(Object.keys(res.body).sort()).toEqual(PUBLIC_KEYS);
    expect(res.body).toEqual({
      name: readLocalizedText(row.name) ?? { ar: row.slug },
      logoUrl: row.logoUrl,
      defaultLocale: row.defaultLocale,
      // TEST-248: true only when settings.catalog.publicBrowsing is exactly true.
      catalogPublic: readSettings(row.settings).catalog.publicBrowsing === true,
    });
    expect(typeof res.body.catalogPublic).toBe('boolean');
    expect(Object.keys(res.body.name as object).every((locale) => ['ar', 'en', 'tr'].includes(locale))).toBe(true);
    const text = JSON.stringify(res.body);
    for (const secret of [row.contactEmail, row.contactPhone]) if (secret) expect(text).not.toContain(secret);
  });

  it('AC3 — records no audit event', async () => {
    const before = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    for (let i = 0; i < 3; i += 1) await anonymous().expect(200);
    const recorded = await prisma.auditLog.count({ where: { id: { gt: before?.id ?? NIL_ID }, userAgent: USER_AGENT } });
    expect(recorded).toBe(0);
  });

  it('AC4 — answers 503 academy_not_configured when the database holds no academy row', async () => {
    // The shared row is never deleted: the app's own database handle answers "no row" for one request instead.
    const service = app.get(PrismaService);
    const real = service.db;
    const spy = vi.spyOn(service, 'db', 'get').mockReturnValue({ ...real, academy: { findFirst: async () => null } } as unknown as typeof real);
    try {
      const res = await anonymous();
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, code: 'academy_not_configured' });
    } finally {
      spy.mockRestore();
    }
    await anonymous().expect(200);
  });

  it(
    'AC5 — the OpenAPI document shows the route without a security scheme and the four-field schema',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const path = docs.body.paths[PUBLIC];
      expect(Object.keys(path)).toEqual(['get']);
      expect(path.get.security ?? []).toEqual([]);
      expect(path.get.tags).toEqual(['academy']);
      expect(path.get.responses).toHaveProperty('200');
      expect(path.get.responses).toHaveProperty('429');
      expect(path.get.responses).toHaveProperty('503');
      expect(Object.keys(docs.body.components.schemas['AcademyPublicDto'].properties).sort()).toEqual(PUBLIC_KEYS);
      // The signed-in read keeps its bearer scheme.
      expect(docs.body.paths['/api/academy'].get.security).toEqual([{ bearer: [] }]);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );

  // Last: from here on this app instance answers 429 on the route for a minute.
  it('AC6 — is rate limited per IP: at most 60 requests a minute, then 429 rate_limited', async () => {
    let limited: request.Response | undefined;
    let answered = 0;
    for (let i = 0; i < LIMIT + 10 && !limited; i += 1) {
      const res = await anonymous();
      if (res.status === 429) limited = res;
      else answered += 1;
    }
    expect(limited?.body).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    // The earlier tests already used part of the minute's budget: never more than the limit was served.
    expect(answered).toBeLessThanOrEqual(LIMIT);
  });
});
