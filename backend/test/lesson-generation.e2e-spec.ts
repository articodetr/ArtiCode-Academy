// TEST-074 — MOD-07-T05 lesson generation from the weekly schedule
// (POST /api/classes/:id/schedule/generate, API-092) against the live
// development database. Skipped when no database is reachable. Fixture users
// (two holding the system `teacher` role), roles, a published course, a branch
// in a daylight-saving zone with one room, a room without a branch, classes,
// slots and lessons carry a unique prefix and are deleted at the end — classes
// first (slots and lessons cascade), then the course, the rooms and the
// branch. The academy's `settings.scheduling.workingDays` is changed for AC3
// and restored (finally and afterAll), as TEST-072 does. Audit events are
// counted by fixture actor above an id watermark.
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
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { zonedInstant } from '../src/schedule/lesson-generation.plan.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `Y${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-074 supertest';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
/** A zone with daylight-saving time in 2026 (clocks move on 2026-03-29 and 2026-10-25). */
const DST_ZONE = 'Europe/Berlin';

interface GeneratedLesson {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  deliveryMode: string;
  title: Record<string, string>;
  scheduleId: string | null;
  room: { id: string } | null;
  teacher: { userId: string } | null;
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

describe.skipIf(!available)('MOD-07 lesson generation (e2e, TEST-074)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let branchId: string;
  let roomBerlin: string;
  let roomSite: string;
  let academyId: string;
  let originalSettings: Prisma.JsonValue;
  let academyTimeZone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const generate = (classId: string, body: object, as = 'scheduler') => api().post(`${CLASSES}/${classId}/schedule/generate`).set(bearer(as)).send(body);
  const putSchedule = (classId: string, slots: unknown[]) => api().put(`${CLASSES}/${classId}/schedule`).set(bearer('scheduler')).send({ slots });
  /** A slot body with defaults: Sunday 10:00–11:00 from 2026-03-01, open-ended, no room, no teacher. */
  const slot = (over: Record<string, unknown> = {}) => ({ weekday: 0, startTime: '10:00', endTime: '11:00', effectiveFrom: '2026-03-01', ...over });
  /** The instant of a wall-clock time in the academy's zone, as the API returns it. */
  const academyInstant = (date: string, time: string) => zonedInstant(date, time, academyTimeZone).toISOString();
  const storedLessons = (classId: string) =>
    prisma.lesson.findMany({ where: { classId }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true, scheduleId: true, startsAt: true, status: true } });

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN.toLowerCase()}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[], login = false): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: login ? await passwords.hash(PASSWORD) : null,
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    if (login) {
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
      actors.push(user.id);
    }
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string, teachers: string[], actions: string[] = []): Promise<string> {
    const res = await api()
      .post(CLASSES)
      .set(bearer('scheduler'))
      .send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}`, en: `Class ${suffix}` }, capacity: 10 })
      .expect(201);
    const classId = res.body.id as string;
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${classId}/teachers`)
        .set(bearer('scheduler'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    for (const action of actions) await api().post(`${CLASSES}/${classId}/status`).set(bearer('scheduler')).send({ action }).expect(200);
    return classId;
  }

  async function setWorkingDays(days: number[] | null): Promise<void> {
    const current = (await prisma.academy.findUniqueOrThrow({ where: { id: academyId }, select: { settings: true } })).settings;
    const root = (current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}) as Record<string, unknown>;
    const scheduling = { ...(root['scheduling'] as Record<string, unknown> | undefined) };
    if (days === null) delete scheduling['workingDays'];
    else scheduling['workingDays'] = days;
    if (Object.keys(scheduling).length === 0) delete root['scheduling'];
    else root['scheduling'] = scheduling;
    await prisma.academy.update({ where: { id: academyId }, data: { settings: root as Prisma.InputJsonValue }, select: { id: true } });
  }

  const restoreSettings = () => prisma.academy.update({ where: { id: academyId }, data: { settings: originalSettings as Prisma.InputJsonValue }, select: { id: true } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const academy = await prisma.academy.findFirstOrThrow({ select: { id: true, settings: true, timezone: true } });
    academyId = academy.id;
    originalSettings = academy.settings;
    academyTimeZone = academy.timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة التوليد' }, status: 'published' }, select: { id: true } })).id;
    branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع برلين' }, timezone: DST_ZONE }, select: { id: true } })).id;
    roomBerlin = (await prisma.room.create({ data: { code: code('RB'), name: { ar: 'قاعة برلين' }, branchId }, select: { id: true } })).id;
    roomSite = (await prisma.room.create({ data: { code: code('RS'), name: { ar: 'قاعة المقر' } }, select: { id: true } })).id;
    const teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;

    const scheduler = await createRole('gscheduler', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'schedule.manage', 'lessons.read', 'lessons.manage']);
    const pure = await createRole('gpure', ['classes.read', 'schedule.manage']);
    await createUser('scheduler', [scheduler], true);
    await createUser('pure', [pure], true);
    await createUser('teacher', [teacherRoleId], true);
    await createUser('teacher2', [teacherRoleId]);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await restoreSettings();
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a range creates one lesson per effective slot occurrence: instants in the room’s branch zone (DST transition inside the range) or the academy’s, teacher from the slot or the lead, schedule_id set, title = class name; one lessons.created event', async () => {
    const classId = await createClass('A', [id('teacher'), id('teacher2')], ['open']);
    fx['classA'] = classId;
    const saved = await putSchedule(classId, [
      slot({ weekday: 0, startTime: '10:00', endTime: '11:00', roomId: roomBerlin, teacherUserId: id('teacher2') }),
      slot({ weekday: 2, startTime: '09:00', endTime: '10:30', roomId: roomSite }),
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const [sunday, tuesday] = saved.body.slots as { id: string; weekday: number }[];
    expect([sunday!.weekday, tuesday!.weekday]).toEqual([0, 2]);
    fx['slotSun'] = sunday!.id;
    fx['slotTue'] = tuesday!.id;

    const m = await mark();
    const res = await generate(classId, { from: '2026-03-22', to: '2026-04-04' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ classId, from: '2026-03-22', to: '2026-04-04', slots: 2, occurrences: 4, created: 4, existing: 0, offDays: 0 });
    const lessons = res.body.lessons as GeneratedLesson[];
    expect(lessons.map((lesson) => [lesson.startsAt, lesson.endsAt, lesson.room?.id ?? null, lesson.teacher?.userId ?? null, lesson.scheduleId])).toEqual([
      ['2026-03-22T09:00:00.000Z', '2026-03-22T10:00:00.000Z', roomBerlin, id('teacher2'), sunday!.id], // CET (+1)
      [academyInstant('2026-03-24', '09:00'), academyInstant('2026-03-24', '10:30'), roomSite, id('teacher'), tuesday!.id], // the lead teacher by default
      ['2026-03-29T08:00:00.000Z', '2026-03-29T09:00:00.000Z', roomBerlin, id('teacher2'), sunday!.id], // CEST (+2) — the clocks moved that morning
      [academyInstant('2026-03-31', '09:00'), academyInstant('2026-03-31', '10:30'), roomSite, id('teacher'), tuesday!.id],
    ]);
    expect(lessons[0]).toMatchObject({ title: { ar: 'فصل A', en: 'Class A' }, status: 'scheduled', deliveryMode: 'in_person', class: { id: classId }, syllabusItem: null, attendance: { recorded: 0 } });

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([['lessons.created', 'classes', classId]]);
    expect(events[0]!.metadata).toMatchObject({ code: code('A'), classId, count: 4 });
    expect((events[0]!.metadata as { lessonIds: string[] }).lessonIds).toEqual(lessons.map((lesson) => lesson.id));
    expect((await storedLessons(classId)).map((row) => row.scheduleId)).toEqual([sunday!.id, tuesday!.id, sunday!.id, tuesday!.id]);
    // The scheduler reads them back like any lesson.
    const listed = await api().get(LESSONS).query({ classId }).set(bearer('scheduler')).expect(200);
    expect(listed.body.items).toHaveLength(4);
  });

  it('AC2 — generation is repeatable: the same range creates nothing and records nothing; a wider range adds only the new dates; a cancelled generated lesson is not recreated', async () => {
    const classId = id('classA');
    const m = await mark();
    const again = await generate(classId, { from: '2026-03-22', to: '2026-04-04' }).expect(200);
    expect(again.body).toMatchObject({ slots: 2, occurrences: 4, created: 0, existing: 4, offDays: 0, lessons: [] });
    expect(await eventsSince(m)).toEqual([]);

    // Cancel the Sunday lesson of 03-29, then widen the range to 04-11: only 04-05 (Sunday) and 04-07 (Tuesday) are new.
    const cancelled = (await storedLessons(classId)).find((row) => row.startsAt.toISOString() === '2026-03-29T08:00:00.000Z')!;
    await api().post(`${LESSONS}/${cancelled.id}/status`).set(bearer('scheduler')).send({ action: 'cancel', reason: 'عطلة' }).expect(200);
    const wider = await generate(classId, { from: '2026-03-22', to: '2026-04-11' }).expect(200);
    expect(wider.body).toMatchObject({ slots: 2, occurrences: 6, created: 2, existing: 4, offDays: 0 });
    expect((wider.body.lessons as GeneratedLesson[]).map((lesson) => lesson.startsAt)).toEqual(['2026-04-05T08:00:00.000Z', academyInstant('2026-04-07', '09:00')]);
    expect(await prisma.lesson.count({ where: { classId } })).toBe(6);
    expect((await storedLessons(classId)).filter((row) => row.status === 'cancelled')).toHaveLength(1);
  });

  it('AC3 — dates outside settings.scheduling.workingDays are skipped (offDays), a slot is generated only inside its effective range, and a class without slots answers zeros without an event', async () => {
    const classId = await createClass('W', [id('teacher')], ['open']);
    await putSchedule(classId, [
      slot({ weekday: 0, effectiveFrom: '2026-04-12', effectiveTo: '2026-04-19' }),
      slot({ weekday: 2, effectiveFrom: '2026-04-12', effectiveTo: '2026-04-19' }),
    ]).expect(200);
    try {
      await setWorkingDays([1, 2, 3, 4, 5]);
      const m = await mark();
      // Sundays 04-12 and 04-19 are off days; Tuesday 04-14 is generated; 04-21 is past effectiveTo.
      const res = await generate(classId, { from: '2026-04-05', to: '2026-04-26' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ slots: 2, occurrences: 3, created: 1, existing: 0, offDays: 2 });
      expect((res.body.lessons as GeneratedLesson[]).map((lesson) => lesson.startsAt)).toEqual([academyInstant('2026-04-14', '10:00')]);
      expect((await eventsSince(m)).map((event) => event.action)).toEqual(['lessons.created']);
    } finally {
      await restoreSettings();
    }

    const empty = await createClass('E', [], ['open']);
    const m2 = await mark();
    const none = await generate(empty, { from: '2026-04-05', to: '2026-04-26' }).expect(200);
    expect(none.body).toMatchObject({ classId: empty, slots: 0, occurrences: 0, created: 0, existing: 0, offDays: 0, lessons: [] });
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC4 — a generated lesson that double-books a room against an existing lesson is refused by the MOD-06 constraint (409 lesson_conflict); nothing is created and nothing recorded', async () => {
    const other = await createClass('B', [id('teacher')], ['open']);
    // Class B holds roomBerlin on Sunday 2026-04-19 10:30–11:30 Berlin time (08:30–09:30Z); class A's Sunday slot there is 10:00–11:00 (08:00–09:00Z).
    const held = await api()
      .post(`${CLASSES}/${other}/lessons`)
      .set(bearer('scheduler'))
      .send({ title: { ar: 'درس يحجز القاعة' }, startsAt: '2026-04-19T08:30:00Z', endsAt: '2026-04-19T09:30:00Z', roomId: roomBerlin })
      .expect(201);
    const classId = id('classA');
    const before = await prisma.lesson.count({ where: { classId } });
    const m = await mark();
    const refused = await generate(classId, { from: '2026-04-19', to: '2026-04-19' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'lesson_conflict', resource: 'room', conflictingLessonId: held.body.id, conflictingClassId: other });
    expect(await prisma.lesson.count({ where: { classId } })).toBe(before);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC5 — refusals: validation 400, no schedule.manage 403, unknown class 404, completed class 409 class_not_schedulable, anonymous 401 — none recorded; schedule.manage alone (no classes.manage, not assigned) may generate the longest range', async () => {
    const classId = id('classA');
    // The completed class is a fixture (its MOD-05 events precede the watermark).
    const done = await createClass('D', [id('teacher')], ['open', 'start', 'complete']);
    const m = await mark();
    for (const body of [
      { from: '2026-05-01', to: '2026-04-30' }, // to before from
      { from: '2026-01-01', to: '2026-07-04' }, // 185 days
      { from: '2026-02-30', to: '2026-03-01' }, // no such day
      { from: '2026-05-01' }, // to missing
      { from: '2026-05-01', to: '2026-05-02', extra: true }, // unknown field
      { from: '2026-05-01T00:00:00Z', to: '2026-05-02' }, // not a calendar date
    ]) {
      expect((await generate(classId, body)).status, JSON.stringify(body)).toBe(400);
    }
    const forbidden = await generate(classId, { from: '2026-05-03', to: '2026-05-09' }, 'teacher');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'permission_denied', missing: ['schedule.manage'] });
    expect((await generate(NIL_ID, { from: '2026-05-03', to: '2026-05-09' }).expect(404)).body.code).toBe('class_not_found');
    const closed = await generate(done, { from: '2026-05-03', to: '2026-05-09' });
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'class_not_schedulable', status: 'completed' });
    await api().post(`${CLASSES}/${classId}/schedule/generate`).send({ from: '2026-05-03', to: '2026-05-09' }).expect(401);
    expect(await eventsSince(m)).toEqual([]);

    // 184 days (2026-05-03 … 2026-11-02) is the longest range; the pure scheduler is not a class teacher and holds no classes.manage.
    const pure = await generate(classId, { from: '2026-05-03', to: '2026-11-02' }, 'pure');
    expect(pure.status, JSON.stringify(pure.body).slice(0, 300)).toBe(200);
    expect(pure.body).toMatchObject({ slots: 2, occurrences: 53, created: 53, existing: 0, offDays: 0 });
    // The Sunday slot in Berlin keeps 10:00 local across the October transition: 08:00Z before, 09:00Z after.
    const starts = (pure.body.lessons as GeneratedLesson[]).filter((lesson) => lesson.scheduleId === id('slotSun')).map((lesson) => lesson.startsAt);
    expect(starts).toContain('2026-10-18T08:00:00.000Z');
    expect(starts).toContain('2026-10-25T09:00:00.000Z');
    expect(starts).toContain('2026-11-01T09:00:00.000Z');
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const res = await api().get('/api/docs-json').expect(200);
      const operation = res.body.paths['/api/classes/{id}/schedule/generate']?.post;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([{ bearer: [] }]);
      expect(operation.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/GenerateLessonsDto');
      expect(res.body.components.schemas.GeneratedLessonsDto.required).toEqual(expect.arrayContaining(['classId', 'from', 'to', 'slots', 'occurrences', 'created', 'existing', 'offDays', 'lessons']));
    },
    20_000,
  );
});
