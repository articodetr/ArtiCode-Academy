// TEST-072 — MOD-07-T03 weekly class schedule (GET/PUT /api/classes/:id/schedule,
// API-088/API-089) against the live development database. Skipped when no
// database is reachable. Fixture users (two holding the system `teacher`
// role), roles, a published course, classes, rooms and slots carry a unique
// prefix and are deleted at the end — classes first (their slots cascade),
// then rooms. The academy's `settings.scheduling.workingDays` is changed for
// AC4 and restored in afterAll (finally), as TEST-036 does for the academy
// row. Audit events are counted by fixture actor above an id watermark.
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
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `W${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-072 supertest';
const CLASSES = '/api/classes';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SLOT_KEYS = ['createdAt', 'effectiveFrom', 'effectiveTo', 'endTime', 'id', 'room', 'startTime', 'teacher', 'updatedAt', 'weekday'];

interface SlotBody {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  room: { id: string; code: string } | null;
  teacher: { userId: string; fullName: string } | null;
  effectiveFrom: string;
  effectiveTo: string | null;
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

describe.skipIf(!available)('MOD-07 class schedule (e2e, TEST-072)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let roomActive: string;
  let roomInactive: string;
  let academyId: string;
  let originalSettings: Prisma.JsonValue;
  let timezone: string;
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
  const schedulePath = (classId: string) => `${CLASSES}/${classId}/schedule`;
  const put = (classId: string, slots: unknown, as = 'scheduler') => api().put(schedulePath(classId)).set(bearer(as)).send({ slots });
  const get = (classId: string, as = 'scheduler') => api().get(schedulePath(classId)).set(bearer(as));
  /** A slot body with defaults: Sunday 10:00–11:00 from 2026-01-01, open-ended, no room, no teacher. */
  const slot = (over: Record<string, unknown> = {}) => ({ weekday: 0, startTime: '10:00', endTime: '11:00', effectiveFrom: '2026-01-01', ...over });

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

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string, teachers: string[] = []): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('scheduler')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${res.body.id}/teachers`)
        .set(bearer('scheduler'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    return res.body.id as string;
  }

  const setStatus = (classId: string, action: string) => api().post(`${CLASSES}/${classId}/status`).set(bearer('scheduler')).send({ action }).expect(200);

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

  const storedSlots = (classId: string) =>
    prisma.classSchedule.findMany({ where: { classId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }], select: { id: true, teacherUserId: true, effectiveFrom: true, effectiveTo: true } });

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
    timezone = academy.timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الجدول' }, status: 'published' }, select: { id: true } })).id;
    roomActive = (await prisma.room.create({ data: { code: code('R1'), name: { ar: 'قاعة 1' } }, select: { id: true } })).id;
    roomInactive = (await prisma.room.create({ data: { code: code('R2'), name: { ar: 'قاعة موقوفة' }, isActive: false }, select: { id: true } })).id;
    const teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;

    const scheduler = await createRole('scheduler', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'schedule.manage']);
    const reader = await createRole('clsreader', ['classes.read']);
    const outsider = await createRole('clsoutsider', ['courses.read']);
    await createUser('scheduler', [scheduler], true);
    await createUser('teacher', [reader, teacherRoleId], true);
    await createUser('teacher2', [teacherRoleId]);
    await createUser('reader', [reader], true);
    await createUser('outsider', [outsider], true);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.academy.update({ where: { id: academyId }, data: { settings: originalSettings as Prisma.InputJsonValue }, select: { id: true } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — reading follows the class visibility (assigned teacher 200, other classes.read holder 404, no key 403, anonymous 401); writing needs schedule.manage', async () => {
    const classId = await createClass('V', [id('teacher')]);
    await get(classId, 'teacher').expect(200);
    const hidden = await get(classId, 'reader');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'class_not_found', classId });
    await get(classId, 'outsider').expect(403);
    await api().get(schedulePath(classId)).expect(401);
    await get(NIL_ID).expect(404);

    const m = await mark();
    const refused = await put(classId, [slot()], 'teacher');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'permission_denied', missing: ['schedule.manage'] });
    const unknown = await put(NIL_ID, [slot()]);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('class_not_found');
    expect(await storedSlots(classId)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC2 — the replacement writes the diff with one event carrying its counts; the same list in another order writes nothing', async () => {
    const classId = await createClass('A', [id('teacher')]);
    const m = await mark();
    const res = await put(classId, [
      slot({ weekday: 2, startTime: '09:00', endTime: '10:30', roomId: roomActive, teacherUserId: id('teacher'), effectiveTo: '2026-06-30' }),
      slot({ weekday: 0 }),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const slots = res.body.slots as SlotBody[];
    expect(slots.map((entry) => [entry.weekday, entry.startTime, entry.endTime])).toEqual([
      [0, '10:00', '11:00'],
      [2, '09:00', '10:30'],
    ]);
    expect(Object.keys(slots[0]!).sort()).toEqual(SLOT_KEYS);
    expect(slots[0]).toMatchObject({ room: null, teacher: null, effectiveFrom: '2026-01-01', effectiveTo: null });
    expect(slots[1]).toMatchObject({
      room: { id: roomActive, code: code('R1'), name: { ar: 'قاعة 1' }, branch: null },
      teacher: { userId: id('teacher'), fullName: 'Test teacher' },
      effectiveTo: '2026-06-30',
    });
    expect((await get(classId, 'teacher').expect(200)).body).toEqual(res.body);

    // Same list, reversed, with the ids: nothing to write.
    const same = await put(classId, [
      { ...slot({ weekday: 2, startTime: '09:00', endTime: '10:30', roomId: roomActive, teacherUserId: id('teacher'), effectiveTo: '2026-06-30' }), id: slots[1]!.id },
      { ...slot({ weekday: 0 }), id: slots[0]!.id },
    ]);
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body).toEqual(res.body);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['classes.schedule.changed', 'classes', classId, { code: code('A'), added: 2, updated: 0, removed: 0, slots: 2 }],
    ]);

    // Keep one (changed), drop one, add one.
    const m2 = await mark();
    const next = await put(classId, [{ ...slot({ weekday: 0, endTime: '11:30' }), id: slots[0]!.id }, slot({ weekday: 4, roomId: roomActive })]);
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect((next.body.slots as SlotBody[]).map((entry) => [entry.weekday, entry.endTime, entry.id === slots[0]!.id])).toEqual([
      [0, '11:30', true],
      [4, '11:00', false],
    ]);
    expect(await prisma.classSchedule.count({ where: { id: slots[1]!.id } })).toBe(0);
    expect((await eventsSince(m2)).map((event) => event.metadata)).toEqual([{ code: code('A'), added: 1, updated: 1, removed: 1, slots: 2 }]);
    const empty = await put(classId, []).expect(200);
    expect(empty.body.slots).toEqual([]);
  });

  it('AC3 — a room or teacher double booking is 409 schedule_conflict naming the kind and the slot of the other class; inside one request too; adjacent slots are fine', async () => {
    const a = await createClass('C1', [id('teacher')]);
    const b = await createClass('C2', [id('teacher')]);
    const first = await put(a, [slot({ roomId: roomActive, teacherUserId: id('teacher') })]).expect(200);
    const held = (first.body.slots as SlotBody[])[0]!;
    const m = await mark();

    const room = await put(b, [slot({ startTime: '10:30', endTime: '11:30', roomId: roomActive })]);
    expect(room.status).toBe(409);
    expect(room.body).toMatchObject({ code: 'schedule_conflict', kind: 'room', conflictingSlotId: held.id, conflictingClassId: a, slot: { index: 0, weekday: 0, startTime: '10:30', roomId: roomActive } });
    const teacher = await put(b, [slot({ startTime: '10:30', endTime: '11:30', teacherUserId: id('teacher') })]);
    expect(teacher.status).toBe(409);
    expect(teacher.body).toMatchObject({ code: 'schedule_conflict', kind: 'teacher', conflictingSlotId: held.id, conflictingClassId: a });
    const within = await put(b, [slot({ weekday: 3, roomId: roomActive }), slot({ weekday: 3, startTime: '10:45', endTime: '12:00', roomId: roomActive })]);
    expect(within.status).toBe(409);
    expect(within.body).toMatchObject({ code: 'schedule_conflict', kind: 'room', conflictingSlotId: null, conflictingClassId: b, slot: { index: 1, startTime: '10:45' } });
    expect(await storedSlots(b)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);

    // Adjacent (11:00–12:00 after 10:00–11:00), another weekday, and a disjoint effective range are all accepted.
    const ok = await put(b, [
      slot({ startTime: '11:00', endTime: '12:00', roomId: roomActive, teacherUserId: id('teacher') }),
      slot({ weekday: 1, roomId: roomActive, teacherUserId: id('teacher') }),
      slot({ roomId: roomActive, effectiveFrom: '2020-01-01', effectiveTo: '2025-12-31' }),
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.slots).toHaveLength(3);
  });

  it('AC4 — a weekday outside settings.scheduling.workingDays is 422 non_working_day; without the setting every weekday is accepted', async () => {
    const classId = await createClass('W');
    try {
      await setWorkingDays([0, 1, 2, 3, 4]);
      const m = await mark();
      const refused = await put(classId, [slot({ weekday: 0 }), slot({ weekday: 5 })]);
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: 'non_working_day', weekday: 5 });
      expect(await storedSlots(classId)).toEqual([]);
      expect(await eventsSince(m)).toEqual([]);
      await put(classId, [slot({ weekday: 4 })]).expect(200);
      await setWorkingDays(null);
      await put(classId, [slot({ weekday: 5 })]).expect(200);
    } finally {
      await prisma.academy.update({ where: { id: academyId }, data: { settings: originalSettings as Prisma.InputJsonValue }, select: { id: true } });
    }
  });

  it('AC5 — a teacher who is not assigned to the class is 422 teacher_not_assigned; an inactive or unknown room is refused; removing a teacher from the class clears their slots', async () => {
    const classId = await createClass('T', [id('teacher')]);
    const m = await mark();
    const notAssigned = await put(classId, [slot({ teacherUserId: id('teacher2') })]);
    expect(notAssigned.status).toBe(422);
    expect(notAssigned.body).toMatchObject({ code: 'teacher_not_assigned', userId: id('teacher2') });
    const inactive = await put(classId, [slot({ roomId: roomInactive })]);
    expect(inactive.status).toBe(422);
    expect(inactive.body).toMatchObject({ code: 'room_inactive', roomId: roomInactive });
    const unknown = await put(classId, [slot({ roomId: NIL_ID })]);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'room_not_found', roomId: NIL_ID });
    expect(await eventsSince(m)).toEqual([]);

    // Assign teacher2 as assistant, schedule them, then take them off the class: the slot keeps its time and loses its teacher (D-R26).
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('scheduler')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }, { userId: id('teacher2'), role: 'assistant' }] }).expect(200);
    const scheduled = await put(classId, [slot({ teacherUserId: id('teacher2') }), slot({ weekday: 3, teacherUserId: id('teacher') })]);
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
    const m2 = await mark();
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('scheduler')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    expect((await storedSlots(classId)).map((row) => row.teacherUserId)).toEqual([null, id('teacher')]);
    const events = await eventsSince(m2);
    expect(events.map((event) => event.action)).toEqual(['classes.teachers.changed']);
    expect(events[0]!.metadata).toMatchObject({ removed: [id('teacher2')], clearedSlots: 1 });
    expect((await get(classId).expect(200)).body.slots.map((entry: SlotBody) => entry.teacher)).toEqual([null, { userId: id('teacher'), fullName: 'Test teacher' }]);
  });

  it('AC6 — completing (or cancelling) a class ends its open slots today in the academy’s time zone, frees the room, and freezes the schedule (409 class_not_schedulable)', async () => {
    const today = calendarDateIn(timezone);
    const tomorrow = calendarDateIn(timezone, new Date(Date.now() + 24 * 60 * 60 * 1000));
    // A room of its own: roomActive is already booked on Sunday 10:00–11:00 by AC3's class.
    const room = (await prisma.room.create({ data: { code: code('R3'), name: { ar: 'قاعة 3' } }, select: { id: true } })).id;
    const classId = await createClass('F', [id('teacher')]);
    await setStatus(classId, 'open');
    await setStatus(classId, 'start');
    const res = await put(classId, [
      slot({ weekday: 0, roomId: room }), // open-ended → today
      slot({ weekday: 1, effectiveTo: '2099-12-31' }), // far future → today
      slot({ weekday: 2, effectiveFrom: '2020-01-01', effectiveTo: '2020-06-30' }), // already over → untouched
      slot({ weekday: 3, effectiveFrom: '2099-01-01' }), // starts later → ends on its first day
    ]).expect(200);
    expect(res.body.slots).toHaveLength(4);
    const m = await mark();

    const completed = await setStatus(classId, 'complete');
    expect(completed.body.status).toBe('completed');
    const rows = await storedSlots(classId);
    expect(rows.map((row) => row.effectiveTo?.toISOString().slice(0, 10) ?? null)).toEqual([today, today, '2020-06-30', '2099-01-01']);
    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['classes.status.changed']);
    expect(events[0]!.metadata).toMatchObject({ action: 'complete', closedSlots: 3 });

    const frozen = await put(classId, [slot({ weekday: 5 })]);
    expect(frozen.status).toBe(409);
    expect(frozen.body).toMatchObject({ code: 'class_not_schedulable', status: 'completed' });
    await get(classId).expect(200);

    // The room is free again from tomorrow for another class at the same time.
    const other = await createClass('G');
    const booked = await put(other, [slot({ weekday: 0, roomId: room, effectiveFrom: tomorrow })]);
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    const cancelled = await createClass('H');
    await put(cancelled, [slot({ weekday: 6 })]).expect(200);
    const m2 = await mark();
    await setStatus(cancelled, 'cancel');
    expect((await storedSlots(cancelled))[0]!.effectiveTo?.toISOString().slice(0, 10)).toBe(today);
    expect((await eventsSince(m2))[0]!.metadata).toMatchObject({ action: 'cancel', closedSlots: 1 });
  });

  it('AC7 — two classes booking the same room at the same time at once: exactly one succeeds (the EXCLUDE constraint decides)', async () => {
    const a = await createClass('X1');
    const b = await createClass('X2');
    const m = await mark();
    const results = await Promise.all([
      put(a, [slot({ weekday: 5, startTime: '14:00', endTime: '15:00', roomId: roomActive })]),
      put(b, [slot({ weekday: 5, startTime: '14:30', endTime: '15:30', roomId: roomActive })]),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const refused = results.find((res) => res.status === 409)!;
    expect(refused.body).toMatchObject({ code: 'schedule_conflict', kind: 'room' });
    expect(await prisma.classSchedule.count({ where: { classId: { in: [a, b] } } })).toBe(1);
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['classes.schedule.changed']);
  });

  it('AC8 — validation: bad weekday, time, order, dates, ids, unknown fields and more than 50 slots are 400 without any write', async () => {
    const classId = await createClass('B');
    const m = await mark();
    const bodies: unknown[] = [
      [slot({ weekday: 7 })],
      [slot({ weekday: '0' })],
      [slot({ startTime: '25:00' })],
      [slot({ startTime: '9:00' })],
      [slot({ startTime: '11:00', endTime: '11:00' })],
      [slot({ startTime: '11:00', endTime: '10:00' })],
      [slot({ effectiveFrom: '2026-02-30' })],
      [slot({ effectiveFrom: '2026-02-01', effectiveTo: '2026-01-31' })],
      [slot({ roomId: 'not-a-uuid' })],
      [slot({ teacherUserId: 12 })],
      [slot({ id: 'not-a-uuid' })],
      [slot({ color: 'red' })],
      Array.from({ length: 51 }, (_, index) => slot({ weekday: index % 7, startTime: `${String(8 + (index % 10)).padStart(2, '0')}:00`, endTime: `${String(9 + (index % 10)).padStart(2, '0')}:00` })),
      'not-a-list',
    ];
    for (const body of bodies) {
      const res = await api().put(schedulePath(classId)).set(bearer('scheduler')).send({ slots: body });
      expect(res.status, JSON.stringify(body).slice(0, 120)).toBe(400);
    }
    expect((await api().put(schedulePath(classId)).set(bearer('scheduler')).send({})).status).toBe(400);
    expect((await api().put(`${CLASSES}/not-a-uuid/schedule`).set(bearer('scheduler')).send({ slots: [] })).status).toBe(400);
    expect(await storedSlots(classId)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);
  });

  it(
    'documents the two routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/schedule']).sort()).toEqual(['get', 'put']);
      expect(docs.body.components.schemas).toHaveProperty('ClassScheduleDto');
      expect(docs.body.components.schemas).toHaveProperty('ReplaceClassScheduleDto');
      expect(docs.body.components.schemas).toHaveProperty('ScheduleSlotInputDto');
      expect(docs.body.components.schemas.ScheduleSlotDto.properties.effectiveTo).toMatchObject({ type: 'string', nullable: true });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
