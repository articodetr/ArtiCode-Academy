// TEST-036 — MOD-02/MOD-14 minimum (GET /api/academy, PATCH /api/academy —
// API-035/API-036) against the live development database. Skipped when no
// database is reachable. The suite edits the single shared `academy` row and
// restores every original value in afterAll (finally) — the development
// database is shared with other sessions. Fixture users/roles carry a unique
// suffix and are deleted at the end (their audit rows stay — KI-032); audit
// events are counted by fixture actor above an id watermark, as in TEST-030,
// so other clients of the database never pollute the counts.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-036 supertest';
const ACADEMY = '/api/academy';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = ['contactEmail', 'contactPhone', 'createdAt', 'currency', 'defaultLocale', 'id', 'logoUrl', 'name', 'slug', 'timezone', 'updatedAt'];
const SENSITIVE_KEY = /hash|password|secret|token/i;

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

/** The patchable columns of the row, read before the suite and written back after it. */
const RESTORE_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  defaultLocale: true,
  timezone: true,
  currency: true,
  contactEmail: true,
  contactPhone: true,
  updatedAt: true,
} satisfies Prisma.AcademySelect;

type OriginalRow = Prisma.AcademyGetPayload<{ select: typeof RESTORE_SELECT }>;

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out.add(key);
      collectKeys(nested, out);
    }
  }
  return out;
}

describe.skipIf(!available)('MOD-02/MOD-14 academy settings (e2e, TEST-036)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let original: OriginalRow;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  /** Id of the newest event (UUIDv7 = insertion order); events of a step are those above it. */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  const currentRow = () => prisma.academy.findUniqueOrThrow({ where: { id: original.id }, select: RESTORE_SELECT });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    original = await prisma.academy.findFirstOrThrow({ select: RESTORE_SELECT });

    const manager = await createRole('manager', ['academy.settings.manage']);
    const reader = await createRole('reader', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    for (const name of ['manager', 'reader']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      if (original) {
        const { id, updatedAt: _updatedAt, ...values } = original;
        await prisma.academy.update({ where: { id }, data: { ...values, name: values.name as Prisma.InputJsonValue } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('AC1 — GET /api/academy answers every signed-in user (a role without any admin key) with the explicit projection, and 401 anonymously', async () => {
    await api().get(ACADEMY).expect(401);

    const res = await api().get(ACADEMY).set(bearer('reader')).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body.id).toBe(original.id);
    expect(res.body.name).toEqual(original.name);
    expect(typeof res.body.name.ar).toBe('string');
    expect(res.body.timezone).toBe(original.timezone);
    expect(res.body.currency).toBe(original.currency);
    expect(res.body.defaultLocale).toBe(original.defaultLocale);
    expect(res.body.updatedAt).toBe(original.updatedAt.toISOString());
    for (const key of collectKeys(res.body)) expect(key).not.toMatch(SENSITIVE_KEY);
    expect(res.body).not.toHaveProperty('settings');
    expect(res.body).not.toHaveProperty('platformAcademyId');
    expect(res.body).not.toHaveProperty('singleton');

    // The manager reads the same thing — no extra fields for the writer.
    const asManager = await api().get(ACADEMY).set(bearer('manager')).expect(200);
    expect(asManager.body).toEqual(res.body);
  });

  it('AC2 — PATCH without academy.settings.manage is 403 permission_denied with the missing key, the row untouched and no event', async () => {
    const m = await mark();
    const res = await api().patch(ACADEMY).set(bearer('reader')).send({ currency: 'USD' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
    expect(res.body.missing).toEqual(['academy.settings.manage']);
    expect(await currentRow()).toEqual(original);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — validation: unknown time zone, non-ISO currency, name without ar, bad URL/e-mail/phone, null on NOT NULL columns and out-of-scope fields are 400 without any write', async () => {
    const m = await mark();
    const invalid: Record<string, unknown>[] = [
      { timezone: 'Mars/Olympus' },
      { timezone: 'asia/riyadh' },
      { timezone: '' },
      { timezone: null },
      { timezone: 42 },
      { currency: 'SA' },
      { currency: 'SAR1' },
      { currency: 'S4R' },
      { currency: null },
      { name: { en: 'No Arabic' } },
      { name: { ar: '' } },
      { name: { ar: 'x', fr: 'y' } },
      { name: 'plain string' },
      { name: null },
      { logoUrl: 'ftp://cdn.example.test/logo.png' },
      { logoUrl: 'not a url' },
      { contactEmail: 'not-an-email' },
      { contactPhone: '0555123456' },
      { defaultLocale: 'fr' },
      { defaultLocale: null },
      // Out of scope (D-R10) — rejected by forbidNonWhitelisted.
      { slug: `other-${RUN}` },
      { settings: { theme: 'dark' } },
      { platformAcademyId: NIL_ID },
      { singleton: false },
      { id: NIL_ID },
    ];
    for (const body of invalid) {
      const res = await api().patch(ACADEMY).set(bearer('manager')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code, JSON.stringify(body)).toBeUndefined();
    }
    expect(await currentRow()).toEqual(original);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — an empty body is 400 nothing_to_update without any write', async () => {
    const m = await mark();
    const res = await api().patch(ACADEMY).set(bearer('manager')).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('nothing_to_update');
    expect(await currentRow()).toEqual(original);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC4 — a real PATCH returns the entity, writes exactly the changed fields in one transaction with exactly one academy.updated (names only); the same body again changes nothing', async () => {
    // Every value differs from the original so `fields` is deterministic whatever the seed holds.
    const nextName = { ar: `أكاديمية الاختبار ${RUN}`, en: `Test Academy ${RUN}`, tr: '' };
    const nextTimezone = original.timezone === 'Europe/Istanbul' ? 'Asia/Riyadh' : 'Europe/Istanbul';
    const nextCurrency = original.currency === 'TRY' ? 'SAR' : 'TRY';
    const nextLocale = original.defaultLocale === 'en' ? 'tr' : 'en';
    const nextLogo = `https://cdn.example.test/${RUN}/logo.png`;
    const nextEmail = `Contact-${RUN}@Example.TEST`;
    const nextPhone = original.contactPhone === '+905551234567' ? '+966500000001' : '+905551234567';
    const body = {
      name: nextName,
      logoUrl: nextLogo,
      defaultLocale: nextLocale,
      timezone: nextTimezone,
      currency: ` ${nextCurrency.toLowerCase()} `,
      contactEmail: ` ${nextEmail} `,
      contactPhone: nextPhone,
    };

    const m = await mark();
    const res = await api().patch(ACADEMY).set(bearer('manager')).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body.name).toEqual({ ar: nextName.ar, en: nextName.en }); // blank `tr` dropped
    expect(res.body.logoUrl).toBe(nextLogo);
    expect(res.body.defaultLocale).toBe(nextLocale);
    expect(res.body.timezone).toBe(nextTimezone);
    expect(res.body.currency).toBe(nextCurrency); // upper-cased
    expect(res.body.contactEmail).toBe(nextEmail.toLowerCase()); // trimmed + lower-cased
    expect(res.body.contactPhone).toBe(nextPhone);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(original.updatedAt.getTime());

    const row = await currentRow();
    expect(row.name).toEqual({ ar: nextName.ar, en: nextName.en });
    expect(row.timezone).toBe(nextTimezone);
    expect(row.currency).toBe(nextCurrency);
    expect(row.contactEmail).toBe(nextEmail.toLowerCase());
    expect(row.updatedAt.toISOString()).toBe(res.body.updatedAt);

    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('academy.updated');
    expect(event.actorUserId).toBe(fx['manager']);
    expect(event.entityType).toBe('academy');
    expect(event.entityId).toBe(original.id);
    expect(event.metadata).toEqual({ fields: ['name', 'logoUrl', 'defaultLocale', 'timezone', 'currency', 'contactEmail', 'contactPhone'] });
    // Names only: no value of the request reached the log.
    const serialized = JSON.stringify(event.metadata);
    for (const value of [nextName.en, nextLogo, nextEmail.toLowerCase(), nextPhone, nextTimezone]) expect(serialized).not.toContain(value);
    expect(event.ipAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(event.userAgent).toBe(USER_AGENT);

    // Idempotent: the same body (before normalisation) changes nothing and records nothing.
    const again = await mark();
    const same = await api().patch(ACADEMY).set(bearer('manager')).send(body).expect(200);
    expect(same.body).toEqual(res.body);
    expect(await eventsSince(again)).toEqual([]);
    expect((await currentRow()).updatedAt.toISOString()).toBe(res.body.updatedAt);

    // GET reflects the write for every reader.
    const read = await api().get(ACADEMY).set(bearer('reader')).expect(200);
    expect(read.body).toEqual(res.body);
  });

  it('AC4 — null clears the nullable fields only, with one event naming them in the fixed order; a partial body leaves the rest alone', async () => {
    const before = await currentRow();
    const m = await mark();
    const res = await api().patch(ACADEMY).set(bearer('manager')).send({ contactPhone: null, logoUrl: null, contactEmail: null, currency: before.currency });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.logoUrl).toBeNull();
    expect(res.body.contactEmail).toBeNull();
    expect(res.body.contactPhone).toBeNull();
    expect(res.body.name).toEqual(before.name);
    expect(res.body.timezone).toBe(before.timezone);
    expect(res.body.currency).toBe(before.currency);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['academy.updated']);
    expect(events[0]!.metadata).toEqual({ fields: ['logoUrl', 'contactEmail', 'contactPhone'] });
  });

  it(
    'checks the Origin of the writing request and documents both routes in OpenAPI',
    async () => {
      const before = await currentRow();
      const evil = await api()
        .patch(ACADEMY)
        .set(bearer('manager'))
        .set('Origin', 'https://evil.example')
        .send({ currency: 'USD' });
      expect(evil.status).toBe(403);
      expect(evil.body.code).toBe('origin_forbidden');
      expect(await currentRow()).toEqual(before);

      const docs = await api().get('/api/docs-json').expect(200);
      const path = docs.body.paths['/api/academy'];
      expect(Object.keys(path).sort()).toEqual(['get', 'patch']);
      expect(path.get.security).toEqual([{ bearer: [] }]);
      expect(path.get.responses).toHaveProperty('200');
      expect(path.get.responses).toHaveProperty('503');
      expect(path.patch.responses).toHaveProperty('400');
      expect(path.patch.responses).toHaveProperty('403');
      expect(path.patch.responses).toHaveProperty('503');
      expect(docs.body.components.schemas).toHaveProperty('UpdateAcademyDto');
      expect(docs.body.components.schemas).toHaveProperty('AcademyDto');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
