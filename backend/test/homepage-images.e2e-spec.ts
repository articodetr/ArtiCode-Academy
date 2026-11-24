// Homepage images (Settings → «صور الصفحة الرئيسية») against the live
// development database: GET /api/academy/homepage-images, PUT and DELETE
// /api/academy/homepage-images/:key, the public GET /api/academy/media/:file
// and the `homepageImages` field of API-205. Skipped when no database is
// reachable.
//
// The pictures go to a fresh temporary MEDIA_STORAGE_DIR, set BEFORE the
// application is imported, and deleted at the end. The suite starts from the
// built-in defaults (it removes `settings.homepageImages` from the shared
// academy row) and restores the row's original `settings` in afterAll — the
// development database is shared with a running dev server. Fixture users and
// roles carry a unique suffix and are deleted at the end; audit events are
// counted by fixture actor above an id watermark, so other clients of the
// database never pollute the counts. The app listens on a loopback port once,
// so concurrent requests share one server (supertest would otherwise open and
// close it per request).
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });
const MEDIA_DIR = await mkdtemp(join(tmpdir(), 'articode-homepage-images-e2e-'));
process.env['MEDIA_STORAGE_DIR'] = MEDIA_DIR;

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { AuditService } = await import('../src/audit/audit.service.js');
const { MediaStorageService } = await import('../src/academy/media-storage.service.js');
const { HomepageImagesService } = await import('../src/academy/homepage-images.service.js');

/**
 * One request on a raw socket that announces `body.length` bytes. With
 * `sendOnly`, only that many bytes are written and the request waits for the
 * answer: an answer that comes while most of the body was never sent proves
 * the server did not wait to read it. The socket is dropped after the answer,
 * and a client error after the answer arrived is not a failure of the test.
 */
function rawRequest(
  app: NestExpressApplication,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
  sendOnly?: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const port = (app.getHttpServer() as { address(): AddressInfo }).address().port;
  return new Promise((resolve, reject) => {
    let answered = false;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('no answer within 10 s'));
    }, 10_000);
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { ...headers, 'Content-Length': String(body.length) } }, (res) => {
      answered = true;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        req.destroy();
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
      });
      res.on('error', (error) => {
        if (!answered) reject(error);
      });
    });
    req.on('error', (error) => {
      if (!answered) {
        clearTimeout(timer);
        reject(error);
      }
    });
    if (sendOnly === undefined) req.end(body);
    else req.write(body.subarray(0, sendOnly));
  });
}

/** The names of the Express middleware of an application (body parsers included). */
function middlewareNames(app: NestExpressApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as { router: { stack: Array<{ name: string }> } };
  return express.router.stack.map((layer) => layer.name);
}

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = `homepage-images supertest ${RUN}`;
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const LIST = '/api/academy/homepage-images';
const PUBLIC = '/api/academy/public';
const KEYS = ['heroStudent', 'aboutLearners', 'promoTraining', 'whyClassroom'];
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_URL = /^\/api\/academy\/media\/([0-9a-f]{32}\.(png|jpg|webp))$/;

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
// Skipped: nothing will use the temporary directory.
if (!available) await rm(MEDIA_DIR, { recursive: true, force: true });

// --- Fixture pictures, built in code ---------------------------------------

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A real RGBA PNG (a browser decodes it): half-transparent pixels, a tEXt chunk with a location, bytes after IEND. */
function png(width: number, height: number, shade = 255, options: { idat?: Buffer } = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = shade;
    row[4 + x * 4] = 128;
  }
  const pixels = options.idat ?? deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from('Location\0GPS 24.7136N 46.6753E', 'latin1')),
    pngChunk('IDAT', pixels),
    pngChunk('IEND'),
    Buffer.from('<html>appended</html>'),
  ]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out.writeUInt16BE(payload.length + 2, 2);
  payload.copy(out, 4);
  return out;
}

/** A structurally valid baseline JPEG with an EXIF block that carries a GPS position. */
function jpeg(width: number, height: number): Buffer {
  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  for (let component = 0; component < 3; component += 1) frame.set([component + 1, 0x11, 0], 6 + component * 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.from('Exif\0\0II*\0\x08\0\0\0\0\0\0\0\0\0GPS 24.7136N 46.6753E', 'latin1')),
    jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    jpegSegment(0xc0, frame),
    jpegSegment(0xc4, Buffer.concat([Buffer.from([0, 0, 1]), Buffer.alloc(14), Buffer.from([0])])),
    jpegSegment(0xda, Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd9]),
  ]);
}

function riffChunk(fourcc: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length + (payload.length & 1));
  out.write(fourcc, 0, 'latin1');
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}

/** An extended lossless WebP with alpha, an EXIF and an XMP chunk. */
function webp(width: number, height: number): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x10 | 0x08 | 0x04; // alpha, EXIF, XMP
  header.writeUIntLE(width - 1, 4, 3);
  header.writeUIntLE(height - 1, 7, 3);
  const bitstream = Buffer.alloc(13, 0x55);
  bitstream[0] = 0x2f;
  bitstream.writeUInt32LE(((width - 1) | ((height - 1) << 14) | (1 << 28)) >>> 0, 1);
  const body = Buffer.concat([
    riffChunk('VP8X', header),
    riffChunk('VP8L', bitstream),
    riffChunk('EXIF', Buffer.from('II*\0GPS 24.7136N 46.6753E', 'latin1')),
    riffChunk('XMP ', Buffer.from('<x:xmpmeta>GPSLatitude</x:xmpmeta>')),
  ]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

// ---------------------------------------------------------------------------

describe.skipIf(!available)('homepage images (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let academyId: string;
  let originalSettings: Prisma.JsonValue;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `hi-${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);
  const put = (key: string, body: Buffer | string | undefined, type: string | null, as = 'manager') => {
    const req = api().put(`${LIST}/${key}`).set(bearer(as));
    if (type !== null) req.set('Content-Type', type);
    return body === undefined ? req : req.send(body);
  };
  const files = async () => (await readdir(MEDIA_DIR)).sort();
  const storedImages = async () => {
    const row = await prisma.academy.findUniqueOrThrow({ where: { id: academyId }, select: { settings: true } });
    const settings = row.settings as Record<string, unknown> | null;
    return (settings?.['homepageImages'] ?? null) as Record<string, { file: string }> | null;
  };

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_hi_${name}_${RUN}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleId: string): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId }] } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  /** The published URL of a key, from the list. */
  async function urlOf(key: string): Promise<string | null> {
    const res = await api().get(LIST).set(bearer('manager')).expect(200);
    return (res.body.items as Array<{ key: string; url: string | null }>).find((item) => item.key === key)!.url;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const row = await prisma.academy.findFirstOrThrow({ select: { id: true, settings: true } });
    academyId = row.id;
    originalSettings = row.settings;
    // Start from the built-in defaults; everything else of the settings stays.
    const { homepageImages: _ignored, ...rest } = (row.settings ?? {}) as Record<string, unknown>;
    await prisma.academy.update({ where: { id: academyId }, data: { settings: rest as Prisma.InputJsonValue } });

    await createUser('manager', await createRole('manager', ['academy.settings.manage']));
    await createUser('reader', await createRole('reader', ['courses.read', 'academy.settings.read']));
    for (const name of ['manager', 'reader']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (academyId) await prisma.academy.update({ where: { id: academyId }, data: { settings: (originalSettings ?? {}) as Prisma.InputJsonValue } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
      await rm(MEDIA_DIR, { recursive: true, force: true });
    }
  });

  it('AC1 — the list names the four defaults and the limits; 401 without a token, 403 without academy.settings.manage', async () => {
    const res = await api().get(LIST).set(bearer('manager')).expect(200);
    expect(res.body).toEqual({
      items: KEYS.map((key) => ({ key, custom: false, url: null, contentType: null, width: null, height: null, bytes: null, updatedAt: null })),
      maxBytes: MAX_BYTES,
      contentTypes: TYPES,
    });
    expect((await api().get(LIST).expect(401)).body.code).toBe('unauthenticated');
    const denied = await api().get(LIST).set(bearer('reader')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['academy.settings.manage'] });
    // API-205 says "default" for every key.
    expect((await api().get(PUBLIC).expect(200)).body.homepageImages).toEqual({ heroStudent: null, aboutLearners: null, promoTraining: null, whyClassroom: null });
  });

  it('AC2 — PUT of a PNG publishes it: a file without metadata on disk, the reference, one event, the public URL and the bytes with their headers', async () => {
    const m = await mark();
    const source = png(96, 120);
    const res = await put('heroStudent', source, 'image/png');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const hero = res.body.items[0];
    expect(hero).toMatchObject({ key: 'heroStudent', custom: true, contentType: 'image/png', width: 96, height: 120 });
    expect(hero.url).toMatch(MEDIA_URL);
    expect(Date.parse(hero.updatedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.items.slice(1).every((item: { custom: boolean }) => !item.custom)).toBe(true);

    const file = MEDIA_URL.exec(hero.url)![1]!;
    expect(await files()).toEqual([file]);
    const stored = await readFile(join(MEDIA_DIR, file));
    expect(stored.length).toBe(hero.bytes);
    expect(stored.length).toBeLessThan(source.length);
    expect(stored.toString('latin1')).not.toContain('GPS');
    expect(stored.toString('latin1')).not.toContain('appended');
    expect((await storedImages())?.['heroStudent']).toMatchObject({ file, contentType: 'image/png', width: 96, height: 120, bytes: stored.length });

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['academy.homepage_image.updated']);
    expect(events[0]).toMatchObject({ actorUserId: fx['manager'], entityType: 'academy', entityId: academyId });
    expect(events[0]!.metadata).toEqual({ key: 'heroStudent', contentType: 'image/png', width: 96, height: 120, bytes: stored.length, replaced: false });
    expect(JSON.stringify(events[0]!.metadata)).not.toContain(file.slice(0, 32));

    // API-205 carries the URL — and still nothing else.
    const publicRes = await api().get(PUBLIC).expect(200);
    expect(publicRes.headers['cache-control']).toBe('no-cache');
    expect(publicRes.body.homepageImages).toEqual({ heroStudent: hero.url, aboutLearners: null, promoTraining: null, whyClassroom: null });

    // The media route: public, the stored bytes, the headers of the contract.
    const media = await api().get(hero.url).buffer(true);
    expect(media.status).toBe(200);
    expect(Buffer.isBuffer(media.body)).toBe(true);
    expect((media.body as Buffer).equals(stored)).toBe(true);
    expect(media.headers['content-type']).toBe('image/png');
    expect(media.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect(media.headers['content-disposition']).toBe('inline');
    expect(media.headers['etag']).toBe(`"${file.slice(0, 32)}"`);
    expect(media.headers['content-length']).toBe(String(stored.length));
    // A public picture another origin may embed: CORP cross-origin here, helmet's same-origin everywhere else.
    expect(media.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(publicRes.headers['cross-origin-resource-policy']).toBe('same-origin');

    // Revalidation and HEAD never read the file body; a 304 does not even open or stat it.
    const storage = app.get(MediaStorageService);
    const open = vi.spyOn(storage, 'open');
    const stat = vi.spyOn(storage, 'stat');
    try {
      const notModified = await api().get(hero.url).set('If-None-Match', media.headers['etag']!).expect(304);
      expect(notModified.headers['etag']).toBe(media.headers['etag']);
      expect(notModified.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(notModified.headers['cross-origin-resource-policy']).toBe('cross-origin');
      await api().get(hero.url).set('If-None-Match', `W/"other", ${media.headers['etag']}`).expect(304);
      expect(open).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
      const head = await api().head(hero.url).expect(200);
      expect(head.headers['content-length']).toBe(String(stored.length));
      expect(head.headers['content-type']).toBe('image/png');
      expect(head.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(stat).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
      // A stale ETag is a full answer.
      await api().get(hero.url).set('If-None-Match', '"0000"').expect(200);
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
      stat.mockRestore();
    }

    // Four pictures per page view: never limited by the login throttler (60/min on API-205).
    const statuses = await Promise.all(Array.from({ length: 70 }, () => api().get(hero.url).then((r) => r.status)));
    expect(new Set(statuses)).toEqual(new Set([200]));
    // No audit event for reads.
    expect((await eventsSince(m)).length).toBe(1);
  });

  it('AC3 — replacing a picture deletes the previous file after the commit: its URL is 404 at once, the new one 200, replaced: true', async () => {
    const before = await urlOf('heroStudent');
    const m = await mark();
    const res = await put('heroStudent', png(100, 130, 40), 'image/png').expect(200);
    const after = res.body.items[0].url as string;
    expect(after).not.toBe(before);
    expect(await files()).toEqual([MEDIA_URL.exec(after)![1]]);
    expect((await api().get(before!).expect(404)).body.code).toBe('media_not_found');
    await api().get(after).expect(200);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, (event.metadata as { replaced: boolean }).replaced])).toEqual([['academy.homepage_image.updated', true]]);
  });

  it('AC4 — a WebP and a JPEG for two other places: alpha kept, EXIF/XMP removed, the right type and extension', async () => {
    const webpRes = await put('aboutLearners', webp(960, 680), 'image/webp').expect(200);
    const about = webpRes.body.items[1];
    expect(about).toMatchObject({ key: 'aboutLearners', custom: true, contentType: 'image/webp', width: 960, height: 680 });
    expect(about.url).toMatch(/\.webp$/);
    const webpBytes = await readFile(join(MEDIA_DIR, MEDIA_URL.exec(about.url)![1]!));
    expect(webpBytes.toString('latin1')).not.toContain('GPS');
    expect(webpBytes[20]! & 0x10).toBe(0x10); // alpha flag kept
    expect(webpBytes[20]! & 0x0c).toBe(0); // EXIF and XMP flags cleared
    expect(webpBytes.readUInt32LE(4)).toBe(webpBytes.length - 8);

    const jpegRes = await put('promoTraining', jpeg(900, 560), 'image/jpeg; charset=binary').expect(200);
    const promo = jpegRes.body.items[2];
    expect(promo).toMatchObject({ key: 'promoTraining', custom: true, contentType: 'image/jpeg', width: 900, height: 560 });
    expect(promo.url).toMatch(/\.jpg$/);
    const jpegBytes = await readFile(join(MEDIA_DIR, MEDIA_URL.exec(promo.url)![1]!));
    expect(jpegBytes.toString('latin1')).not.toContain('Exif');
    expect(jpegBytes.toString('latin1')).not.toContain('GPS');
    const media = await api().get(promo.url).expect(200);
    expect(media.headers['content-type']).toBe('image/jpeg');
    expect((await files()).length).toBe(3);
  });

  it('AC5 — DELETE restores the default of that key only: the file goes, its URL is 404, one event; a second DELETE is a no-op', async () => {
    const url = await urlOf('aboutLearners');
    const m = await mark();
    const res = await api().delete(`${LIST}/aboutLearners`).set(bearer('manager')).expect(200);
    expect(res.body.items[1]).toEqual({ key: 'aboutLearners', custom: false, url: null, contentType: null, width: null, height: null, bytes: null, updatedAt: null });
    expect(res.body.items[0].custom).toBe(true);
    expect(res.body.items[2].custom).toBe(true);
    expect(await files()).not.toContain(MEDIA_URL.exec(url!)![1]);
    expect((await files()).length).toBe(2);
    await api().get(url!).expect(404);
    expect((await storedImages())?.['aboutLearners']).toBeUndefined();
    expect((await api().get(PUBLIC).expect(200)).body.homepageImages.aboutLearners).toBeNull();
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([['academy.homepage_image.reset', { key: 'aboutLearners' }]]);

    const m2 = await mark();
    const again = await api().delete(`${LIST}/aboutLearners`).set(bearer('manager')).expect(200);
    expect(again.body).toEqual(res.body);
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC6 — refusals write no file, no reference and no event', async () => {
    const m = await mark();
    const filesBefore = await files();
    const imagesBefore = await storedImages();
    const good = png(64, 64);

    expect((await api().put(`${LIST}/heroStudent`).set('Content-Type', 'image/png').send(good).expect(401)).body.code).toBe('unauthenticated');
    expect((await put('heroStudent', good, 'image/png', 'reader').expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['academy.settings.manage'] });
    expect((await api().delete(`${LIST}/heroStudent`).set(bearer('reader')).expect(403)).body.code).toBe('permission_denied');
    expect((await put('heroStudent', good, 'image/png').set('Origin', 'https://evil.example').expect(403)).body.code).toBe('origin_forbidden');

    const unknown = await put('banner', good, 'image/png').expect(404);
    expect(unknown.body).toMatchObject({ code: 'homepage_image_unknown', key: 'banner', keys: KEYS });
    expect((await api().delete(`${LIST}/banner`).set(bearer('manager')).expect(404)).body.code).toBe('homepage_image_unknown');

    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    for (const [body, type] of [
      [svg, 'image/svg+xml'],
      ['{"a":1}', 'application/json'],
      [good, 'application/octet-stream'],
      [good, 'image/gif'],
    ] as const) {
      const res = await put('heroStudent', body as Buffer | string, type).expect(415);
      expect(res.body, type).toMatchObject({ code: 'image_type_unsupported', contentTypes: TYPES });
    }
    expect((await put('heroStudent', undefined, null).expect(415)).body.code).toBe('image_type_unsupported');

    expect((await put('heroStudent', Buffer.alloc(0), 'image/png').expect(400)).body).toMatchObject({ code: 'image_invalid', reason: 'empty' });
    expect((await put('heroStudent', undefined, 'image/png').expect(400)).body).toMatchObject({ code: 'image_invalid', reason: 'empty' });
    expect((await put('heroStudent', Buffer.from(svg), 'image/png').expect(400)).body).toMatchObject({ code: 'image_invalid', reason: 'unrecognized' });
    expect((await put('heroStudent', Buffer.from('GIF89a@\0@\0', 'latin1'), 'image/png').expect(400)).body.reason).toBe('unrecognized');
    expect((await put('heroStudent', Buffer.from('<!doctype html><p>x</p>'), 'image/webp').expect(400)).body.reason).toBe('unrecognized');
    expect((await put('heroStudent', good, 'image/jpeg').expect(400)).body).toMatchObject({ code: 'image_invalid', reason: 'type_mismatch' });
    expect((await put('heroStudent', good.subarray(0, good.length - 40), 'image/png').expect(400)).body).toMatchObject({ code: 'image_invalid', reason: 'corrupt' });

    const tooSmall = await put('heroStudent', png(63, 64), 'image/png').expect(400);
    expect(tooSmall.body).toMatchObject({ code: 'image_dimensions_invalid', width: 63, height: 64, minSide: 64, maxSide: 8000, maxPixels: 40_000_000 });
    const tooMany = await put('heroStudent', png(8000, 5001, 255, { idat: deflateSync(Buffer.alloc(16)) }), 'image/png').expect(400);
    expect(tooMany.body).toMatchObject({ code: 'image_dimensions_invalid', width: 8000, height: 5001 });

    const large = await put('heroStudent', Buffer.concat([good, Buffer.alloc(MAX_BYTES + 1 - good.length)]), 'image/png').expect(413);
    expect(large.body).toMatchObject({ statusCode: 413, code: 'image_too_large', maxBytes: MAX_BYTES });

    expect(await files()).toEqual(filesBefore);
    expect(await storedImages()).toEqual(imagesBefore);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC6b — the raw image body is read on this route only: other routes keep their JSON parser and their own 413', async () => {
    // PATCH /api/academy never reads an image body (no parser), so it sees an empty body.
    const patched = await api().patch('/api/academy').set(bearer('manager')).set('Content-Type', 'image/png').send(png(64, 64)).expect(400);
    expect(patched.body.code).toBe('nothing_to_update');
    // A JSON body over 100 KB elsewhere is still the generic 413, not image_too_large.
    const jsonTooLarge = await api().patch('/api/academy').set(bearer('manager')).send({ pad: 'x'.repeat(110 * 1024) }).expect(413);
    expect(jsonTooLarge.body.code).toBeUndefined();
    // The academy app carries the raw parser (the platform app does not — test/platform.app.e2e-spec.ts).
    expect(middlewareNames(app)).toContain('rawParser');
  });

  it('AC6c — an anonymous upload is never buffered: a 5.3 MB body without a bearer token is 401 from the guards, not 413', async () => {
    const m = await mark();
    const filesBefore = await files();
    const big = Buffer.concat([png(64, 64), Buffer.alloc(5_300_000)]);
    // Only the first 64 KB are ever sent: the 401 arrives without the server waiting for (or reading) the rest.
    const anonymous = await rawRequest(app, 'PUT', `${LIST}/heroStudent`, { 'Content-Type': 'image/png', 'User-Agent': USER_AGENT }, big, 64 * 1024);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });
    // With a bearer token (any) the parser reads it and its limit answers first.
    const withToken = await rawRequest(app, 'PUT', `${LIST}/heroStudent`, { 'Content-Type': 'image/png', Authorization: 'Bearer not-a-token' }, big);
    expect(withToken.status).toBe(413);
    expect(withToken.body).toMatchObject({ code: 'image_too_large', maxBytes: MAX_BYTES });
    expect(await files()).toEqual(filesBefore);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC6d — a referenced file missing on disk is 404 without the picture’s cache headers, logged once per file', async () => {
    const url = (await urlOf('heroStudent'))!;
    const file = MEDIA_URL.exec(url)![1]!;
    const bytes = await readFile(join(MEDIA_DIR, file));
    const warn = vi.spyOn(Logger.prototype, 'warn');
    await rm(join(MEDIA_DIR, file));
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await api().get(url).expect(404);
        expect(res.body.code).toBe('media_not_found');
        expect(res.headers['cache-control'] ?? '').not.toContain('immutable');
        expect(res.headers['etag'] ?? '').not.toContain(file.slice(0, 32)); // Express's own weak ETag of the JSON body, never the picture's
        await api().head(url).expect(404);
      }
      const logged = warn.mock.calls.map(([message]) => String(message)).filter((message) => message.includes(file));
      expect(logged).toHaveLength(1);
      expect(logged[0]).not.toContain(MEDIA_DIR);
    } finally {
      warn.mockRestore();
      await writeFile(join(MEDIA_DIR, file), bytes);
    }
    await api().get(url).expect(200);
  });

  it('AC7 — the media route serves only a referenced file: unreferenced, malformed and traversal names are 404 media_not_found', async () => {
    const outside = join(MEDIA_DIR, '..', `outside-${RUN}.png`);
    await writeFile(outside, png(64, 64));
    // A well-formed name nobody references, even when the file exists on disk.
    const orphan = `${'5f'.repeat(16)}.png`;
    await writeFile(join(MEDIA_DIR, orphan), png(64, 64));
    try {
      for (const path of [
        `/api/academy/media/${orphan}`,
        `/api/academy/media/${'5f'.repeat(16)}.svg`,
        `/api/academy/media/${'5F'.repeat(16)}.png`,
        '/api/academy/media/not-a-file.png',
        `/api/academy/media/..%2Foutside-${RUN}.png`,
        `/api/academy/media/..%5Coutside-${RUN}.png`,
        '/api/academy/media/%2e%2e%2f%2e%2e%2fpackage.json',
        '/api/academy/media/.tmp-0123456789abcdef',
      ]) {
        const res = await api().get(path);
        expect(res.status, path).toBe(404);
        expect(res.body.code, path).toBe('media_not_found');
      }
    } finally {
      await rm(outside, { force: true });
      await rm(join(MEDIA_DIR, orphan), { force: true });
    }
  });

  it('AC8 — a database failure during the write leaves the previous reference and file in place and no new file', async () => {
    const before = await storedImages();
    const filesBefore = await files();
    const m = await mark();
    const audit = app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (entry, tx) => {
      if (entry.action === 'academy.homepage_image.updated') throw new Error('simulated database failure');
      return original(entry, tx);
    });
    try {
      const res = await put('heroStudent', png(70, 70, 10), 'image/png');
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await storedImages()).toEqual(before);
    expect(await files()).toEqual(filesBefore);
    await api().get(await urlOf('heroStudent') as string).expect(200);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC9 — a media directory that cannot be written answers 503 media_storage_unavailable and changes nothing', async () => {
    const storage = app.get(MediaStorageService) as unknown as { directory: string };
    const blocker = join(MEDIA_DIR, '..', `blocker-${RUN}`);
    await writeFile(blocker, 'a file where a directory should be');
    const real = storage.directory;
    const before = await storedImages();
    const m = await mark();
    storage.directory = join(blocker, 'media');
    try {
      const res = await put('whyClassroom', png(80, 76), 'image/png').expect(503);
      expect(res.body.code).toBe('media_storage_unavailable');
      expect(JSON.stringify(res.body)).not.toContain(blocker);
      // The rest of the API keeps working.
      await api().get(LIST).set(bearer('manager')).expect(200);
    } finally {
      storage.directory = real;
      await rm(blocker, { force: true });
    }
    expect(await storedImages()).toEqual(before);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC10 — two uploads of the same key at once end with one reference and one file, and one event each', async () => {
    const m = await mark();
    const [a, b] = await Promise.all([put('whyClassroom', png(800, 760, 1), 'image/png'), put('whyClassroom', png(800, 760, 2), 'image/png')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const images = await storedImages();
    const winner = images?.['whyClassroom']?.file;
    expect(winner).toMatch(/^[0-9a-f]{32}\.png$/);
    const names = await files();
    // heroStudent + promoTraining + the surviving whyClassroom picture.
    expect(names.length).toBe(3);
    expect(names).toContain(winner);
    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['academy.homepage_image.updated', 'academy.homepage_image.updated']);
    expect(events.map((event) => (event.metadata as { replaced: boolean }).replaced).sort()).toEqual([false, true]);
  });

  it('AC11 — PATCH /api/academy of another setting keeps settings.homepageImages as it is', async () => {
    const before = await storedImages();
    const current = await api().get('/api/academy').set(bearer('manager')).expect(200);
    const percent = current.body.settings.learning.videoCompletionPercent === 77 ? 78 : 77;
    await api().patch('/api/academy').set(bearer('manager')).send({ settings: { learning: { videoCompletionPercent: percent } } }).expect(200);
    expect(await storedImages()).toEqual(before);
    // settings.homepageImages is not a PATCH-able key.
    const refused = await api().patch('/api/academy').set(bearer('manager')).send({ settings: { homepageImages: { heroStudent: null } } }).expect(400);
    expect(JSON.stringify(refused.body)).toContain('homepageImages');
    expect(await storedImages()).toEqual(before);
  });

  it('AC11b — the sweep deletes old temporary and unreferenced files and keeps every referenced, recent or foreign one (the boot sweep is off under NODE_ENV=test — homepage-images.service.spec.ts)', async () => {
    const referenced = await files(); // every file now on disk is referenced by a key
    const images = await storedImages();
    expect(new Set(Object.values(images ?? {}).map((reference) => reference.file))).toEqual(new Set(referenced));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const planted = {
      oldTemporary: `.tmp-${'a7'.repeat(16)}`,
      newTemporary: `.tmp-${'b8'.repeat(16)}`,
      oldOrphan: `${'c9'.repeat(16)}.webp`,
      newOrphan: `${'da'.repeat(16)}.png`,
      foreign: `notes-${RUN}.txt`,
    };
    for (const name of Object.values(planted)) await writeFile(join(MEDIA_DIR, name), 'x');
    for (const name of [planted.oldTemporary, planted.oldOrphan, planted.foreign, ...referenced]) await utimes(join(MEDIA_DIR, name), old, old);
    try {
      const result = await app.get(HomepageImagesService).sweepMedia();
      expect(result).toEqual({ temporary: 1, orphans: 1 });
      expect(await files()).toEqual([...referenced, planted.newTemporary, planted.newOrphan, planted.foreign].sort());
      for (const file of referenced) await api().get(`/api/academy/media/${file}`).expect(200);
    } finally {
      for (const name of Object.values(planted)) await rm(join(MEDIA_DIR, name), { force: true });
    }
  });

  it(
    'AC12 — the OpenAPI document lists the routes: a binary image body, the public media route without a security scheme, and homepageImages in API-205',
    async () => {
      const port = (app.getHttpServer() as { address(): AddressInfo }).address().port;
      const docs = (await (await fetch(`http://127.0.0.1:${port}/api/docs-json`)).json()) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
        components: { schemas: Record<string, { properties: Record<string, unknown> }> };
      };
      expect(Object.keys(docs.paths[LIST]!)).toEqual(['get']);
      expect(Object.keys(docs.paths[`${LIST}/{key}`]!).sort()).toEqual(['delete', 'put']);
      const upload = docs.paths[`${LIST}/{key}`]!['put']! as { requestBody: { content: Record<string, { schema: unknown }> }; responses: Record<string, unknown>; security: unknown };
      expect(Object.keys(upload.requestBody.content).sort()).toEqual([...TYPES].sort());
      expect(upload.requestBody.content['image/png']!.schema).toEqual({ type: 'string', format: 'binary' });
      for (const status of ['200', '400', '401', '403', '404', '413', '415', '503']) expect(upload.responses, status).toHaveProperty(status);
      expect(upload.security).toEqual([{ bearer: [] }]);
      const media = docs.paths['/api/academy/media/{file}']!['get']! as { security?: unknown; responses: Record<string, unknown> };
      expect(media.security ?? []).toEqual([]);
      expect(media.responses).toHaveProperty('404');
      expect(docs.components.schemas['AcademyPublicDto']!.properties).toHaveProperty('homepageImages');
      expect(Object.keys(docs.components.schemas['HomepageImageDto']!.properties).sort()).toEqual(
        ['bytes', 'contentType', 'custom', 'height', 'key', 'updatedAt', 'url', 'width'],
      );
    },
    30_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
