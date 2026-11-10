// TEST-128 — MOD-09-T02 grade schemes (API-122..API-125) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a manager with a custom role holding `academy.settings.manage`, a teacher
// and a student with the system roles) and roles carry a unique tag and are
// deleted at the end; fixture schemes are named with the tag. The academy's
// own default scheme (if any) is restored in `finally`: the tests promote
// fixture schemes to the default, so never point this suite at a non-dev
// database. Audit events are counted by fixture actor above an id watermark.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedGradeScheme } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { DEFAULT_GRADE_SCHEME_BANDS } from '../src/grades/grade-schemes.defaults.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const TAG = `GS${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-128 supertest';
const SCHEMES = '/api/grade-schemes';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SCHEME_KEYS = ['bands', 'createdAt', 'finalGradeCount', 'id', 'isActive', 'isDefault', 'name', 'updatedAt'];

interface SchemeBody {
  id: string;
  name: { ar: string; en?: string };
  isDefault: boolean;
  isActive: boolean;
  bands: { minPercent: number; label: { ar: string }; letter: string | null; isPass: boolean }[];
  finalGradeCount: number | null;
}

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

describe.skipIf(!available)('MOD-09 grade schemes (e2e, TEST-128)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let originalDefaultId: string | null = null;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const schemes: Record<string, string> = {};
  const actors: string[] = [];

  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const name = (suffix: string) => ({ ar: `${TAG} ${suffix}` });
  const bands = (pass = 60) => [
    { minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false },
    { minPercent: pass, label: { ar: 'ناجح', en: 'Pass' }, isPass: true },
  ];
  const list = (as: string) => api().get(SCHEMES).set(bearer(as));
  const create = (body: object, as = 'manager') => api().post(SCHEMES).set(bearer(as)).send(body);
  const patch = (schemeId: string, body: object, as = 'manager') => api().patch(`${SCHEMES}/${schemeId}`).set(bearer(as)).send(body);
  const remove = (schemeId: string, as = 'manager') => api().delete(`${SCHEMES}/${schemeId}`).set(bearer(as));
  const findIn = (items: SchemeBody[], key: string) => items.find((item) => item.id === schemes[key]);

  async function createRole(roleName: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${roleName}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${roleName}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(userName: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(userName), fullName: `Test ${userName}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[userName] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(userName), password: PASSWORD }).expect(200);
    tokens[userName] = res.body.accessToken as string;
    actors.push(user.id);
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    originalDefaultId = (await prisma.gradeScheme.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    await createUser('manager', [await createRole('gsmanager', ['academy.settings.read', 'academy.settings.manage'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('student', [await systemRole('student')]);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Give the academy its own default back before the fixture schemes go.
        await prisma.$transaction(async (tx) => {
          await tx.gradeScheme.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
          if (originalDefaultId) await tx.gradeScheme.update({ where: { id: originalDefaultId }, data: { isDefault: true, isActive: true } });
        });
        await prisma.finalGrade.deleteMany({ where: { scheme: { name: { path: ['ar'], string_starts_with: TAG } } } });
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: TAG } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: TAG } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: TAG } } });
        await prisma.gradeScheme.deleteMany({ where: { name: { path: ['ar'], string_starts_with: TAG } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — creates a scheme with its bands ascending (the first scheme of the academy is the default); one event; teachers and students cannot write', async () => {
    const m = await mark();
    expect((await create({ name: name('A'), bands: bands() }, 'teacher')).status).toBe(403);
    expect((await create({ name: name('A'), bands: bands() }, 'student')).status).toBe(403);
    const res = await create({ name: { ...name('A'), en: 'Scheme A' }, bands: [...bands()].reverse() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as SchemeBody;
    expect(Object.keys(body).sort()).toEqual(SCHEME_KEYS);
    expect(body).toMatchObject({
      name: { ar: `${TAG} A`, en: 'Scheme A' },
      isDefault: originalDefaultId === null,
      isActive: true,
      finalGradeCount: 0,
      bands: [
        { minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false },
        { minPercent: 60, label: { ar: 'ناجح', en: 'Pass' }, letter: null, isPass: true },
      ],
    });
    schemes['A'] = body.id;
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['grade_schemes.created', 'grade_schemes', body.id, id('manager')]]);
    expect(events[0]!.metadata).toEqual({ isDefault: originalDefaultId === null, bandCount: 2 });
  });

  it('AC2 — refuses band lists that break the rules (grade_scheme_invalid) and malformed bodies, without an event', async () => {
    const m = await mark();
    const invalid = async (bandList: object[], problems: string[], duplicates: number[] = []) => {
      const res = await create({ name: name('X'), bands: bandList });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ code: 'grade_scheme_invalid', problems, duplicates });
    };
    await invalid([{ minPercent: 10, label: { ar: 'أ' }, isPass: false }, { minPercent: 60, label: { ar: 'ب' }, isPass: true }], ['no_zero_band']);
    await invalid([{ minPercent: 0, label: { ar: 'أ' }, isPass: false }, { minPercent: 60, label: { ar: 'ب' }, isPass: true }, { minPercent: 60, label: { ar: 'ج' }, isPass: true }], ['duplicate_min_percent'], [60]);
    await invalid([{ minPercent: 0, label: { ar: 'أ' }, isPass: false }, { minPercent: 60, label: { ar: 'ب' }, isPass: false }], ['no_passing_band']);
    await invalid(
      [{ minPercent: 0, label: { ar: 'أ' }, isPass: false }, { minPercent: 50, label: { ar: 'ب' }, isPass: true }, { minPercent: 80, label: { ar: 'ج' }, isPass: false }],
      ['pass_not_ascending'],
    );
    const malformed: object[] = [
      { name: name('X'), bands: [bands()[0]] }, // one band
      { name: name('X'), bands: [{ ...bands()[0], minPercent: '0' }, bands()[1]] }, // a string number
      { name: name('X'), bands: [bands()[0], { ...bands()[1], minPercent: 100.5 }] },
      { name: name('X'), bands: [bands()[0], { ...bands()[1], minPercent: 60.125 }] },
      { name: name('X'), bands: [bands()[0], { ...bands()[1], isPass: 'true' }] },
      { name: name('X'), bands: [bands()[0], { ...bands()[1], letter: 'ABCDE' }] },
      { name: name('X'), bands: [bands()[0], { ...bands()[1], label: { en: 'no arabic' } }] },
      { name: { en: 'no arabic' }, bands: bands() },
      { name: name('X'), bands: bands(), isDefault: 'yes' },
      { name: name('X'), bands: bands(), isActive: false }, // not a create field
    ];
    for (const body of malformed) expect((await create(body)).status, JSON.stringify(body)).toBe(400);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — a promotion makes the previous default step down in the same event; the default cannot be unset, deactivated or deleted, and an inactive scheme is promoted only with its activation', async () => {
    const m = await mark();
    const before = (await prisma.gradeScheme.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } })).id;
    const b = await create({ name: name('B'), bands: bands(50), isDefault: true });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    schemes['B'] = b.body.id as string;
    expect(b.body).toMatchObject({ isDefault: true });
    expect(await prisma.gradeScheme.count({ where: { isDefault: true } })).toBe(1);

    const promoted = await patch(schemes['A']!, { isDefault: true });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(promoted.body).toMatchObject({ isDefault: true });
    expect((await prisma.gradeScheme.findUniqueOrThrow({ where: { id: schemes['B']! } })).isDefault).toBe(false);

    expect((await patch(schemes['A']!, { isDefault: false })).body).toMatchObject({ code: 'grade_scheme_is_default', action: 'unset_default', schemeId: schemes['A'] });
    expect((await patch(schemes['A']!, { isActive: false })).body).toMatchObject({ code: 'grade_scheme_is_default', action: 'deactivate' });
    expect((await remove(schemes['A']!)).body).toMatchObject({ code: 'grade_scheme_is_default', action: 'delete' });
    await patch(schemes['B']!, { isActive: false }).expect(200);
    expect((await patch(schemes['B']!, { isDefault: true })).body).toMatchObject({ code: 'grade_scheme_is_default', action: 'promote_inactive' });
    const back = await patch(schemes['B']!, { isDefault: true, isActive: true });
    expect(back.body).toMatchObject({ isDefault: true, isActive: true });

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['grade_schemes.created', schemes['B'], { isDefault: true, bandCount: 2, demotedSchemeId: before }],
      ['grade_schemes.updated', schemes['A'], { fields: ['isDefault'], demotedSchemeId: schemes['B'] }],
      ['grade_schemes.updated', schemes['B'], { fields: ['isActive'] }],
      ['grade_schemes.updated', schemes['B'], { fields: ['isDefault', 'isActive'], demotedSchemeId: schemes['A'] }],
    ]);
  });

  it('AC4 — PATCH writes the smallest change: the same bands in another order write nothing; a body without fields is nothing_to_update; unknown ids are 404', async () => {
    const m = await mark();
    await patch(schemes['A']!, { bands: [...bands()].reverse(), name: { ar: `${TAG} A`, en: 'Scheme A' } }).expect(200);
    expect(await eventsSince(m)).toEqual([]);
    const renamed = await patch(schemes['A']!, { name: name('A2'), bands: [...bands(), { minPercent: 90, label: { ar: 'ممتاز' }, letter: 'A', isPass: true }] });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect((renamed.body as SchemeBody).bands.map((band) => band.minPercent)).toEqual([0, 60, 90]);
    expect((await patch(schemes['A']!, {})).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await patch(schemes['A']!, { bands: [bands()[1]] })).status).toBe(400);
    expect((await patch(NIL_ID, { isActive: true })).body).toMatchObject({ code: 'grade_scheme_not_found' });
    expect((await patch(schemes['A']!, { isActive: true }, 'teacher')).status).toBe(403);
    expect((await eventsSince(m)).map((event) => [event.action, event.metadata])).toEqual([['grade_schemes.updated', { fields: ['name', 'bands'] }]]);
  });

  it('AC5 — reading: everyone sees the active schemes (default first, no counts); the manager also the inactive ones with their final-grade counts', async () => {
    const c = await create({ name: name('C'), bands: bands() });
    schemes['C'] = c.body.id as string;
    await patch(schemes['C'], { isActive: false }).expect(200);
    for (const reader of ['student', 'teacher']) {
      const items = (await list(reader).expect(200)).body.items as SchemeBody[];
      expect(items[0]!.isDefault, reader).toBe(true);
      expect(items.every((item) => item.isActive && item.finalGradeCount === null), reader).toBe(true);
      expect(findIn(items, 'C'), reader).toBeUndefined();
      expect(findIn(items, 'A'), reader).toBeDefined();
    }
    const managed = (await list('manager').expect(200)).body.items as SchemeBody[];
    expect(findIn(managed, 'C')).toMatchObject({ isActive: false, finalGradeCount: 0 });
    expect(managed.filter((item) => item.isDefault)).toHaveLength(1);
    expect((await api().get(SCHEMES)).status).toBe(401);
  });

  it('AC6 — deletes an unused scheme that is not the default; a scheme used by a final grade is grade_scheme_in_use and stays', async () => {
    // A final grade that uses scheme C (fixtures written through Prisma: MOD-09-T05 writes them through the API).
    const course = await prisma.course.create({ data: { code: `${TAG}-CRS`, name: { ar: 'دورة' }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({ data: { courseId: course.id, code: `${TAG}-CLS`, name: { ar: 'فصل' }, capacity: 5 }, select: { id: true } });
    const enrollment = await prisma.enrollment.create({ data: { classId: klass.id, studentUserId: id('student'), status: 'active' }, select: { id: true } });
    await prisma.finalGrade.create({ data: { enrollmentId: enrollment.id, percent: 75, schemeId: schemes['C']!, bandLabel: { ar: 'ناجح' }, isPass: true, breakdown: [] } });

    const m = await mark();
    const used = await remove(schemes['C']!);
    expect(used.status).toBe(409);
    expect(used.body).toMatchObject({ code: 'grade_scheme_in_use', finalGradeCount: 1 });
    expect(findIn((await list('manager')).body.items as SchemeBody[], 'C')).toMatchObject({ finalGradeCount: 1 });
    expect((await remove(schemes['C']!, 'teacher')).status).toBe(403);
    expect((await remove(NIL_ID)).body).toMatchObject({ code: 'grade_scheme_not_found' });

    // A, no longer the default since AC3, goes; B stays the default.
    await remove(schemes['A']!).expect(204);
    expect(await prisma.gradeScheme.findUnique({ where: { id: schemes['A']! } })).toBeNull();
    expect(await prisma.gradeSchemeBand.count({ where: { schemeId: schemes['A']! } })).toBe(0);
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId])).toEqual([['grade_schemes.deleted', schemes['A']]]);
  });

  it('AC7 — the seed creates the default scheme once when the academy has none and never touches an existing one (inside a rolled-back transaction)', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        expect(await seedGradeScheme(tx)).toBe('kept'); // schemes exist
        await tx.finalGrade.deleteMany({});
        await tx.gradeScheme.deleteMany({});
        expect(await seedGradeScheme(tx)).toBe('created');
        expect(await seedGradeScheme(tx)).toBe('kept');
        const seeded = await tx.gradeScheme.findMany({ include: { bands: { orderBy: { minPercent: 'asc' } } } });
        expect(seeded).toHaveLength(1);
        expect(seeded[0]).toMatchObject({ isDefault: true, isActive: true, name: { ar: 'السلّم الافتراضي', en: 'Default scale' } });
        expect(seeded[0]!.bands.map((band) => [Number(band.minPercent), (band.label as { ar: string }).ar, band.letter, band.isPass])).toEqual(
          DEFAULT_GRADE_SCHEME_BANDS.map((band) => [band.minPercent, band.label.ar, band.letter, band.isPass]),
        );
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.gradeScheme.findUnique({ where: { id: schemes['B']! } })).not.toBeNull();
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/grade-schemes']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/grade-schemes/{id}']).sort()).toEqual(['delete', 'patch']);
      for (const schema of ['GradeSchemeDto', 'GradeSchemeListDto', 'GradeSchemeBandDto', 'CreateGradeSchemeDto', 'UpdateGradeSchemeDto', 'GradeSchemeBandInputDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );

  function id(userName: string): string {
    return fx[userName]!;
  }
});
