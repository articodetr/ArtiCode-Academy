// TEST-073 — MOD-07-T04 timetable readings: the academy schedule
// (GET /api/schedule, API-090) and «my schedule» (GET /api/me/schedule,
// API-091) against the live development database. Skipped when no database
// is reachable. Fixtures (users with the system `student`/`guardian`/`teacher`
// roles plus custom roles, a branch with its own time zone, two rooms, a
// published course, three classes with slots written through API-089,
// enrollments through API-057/059, guardian links) carry a unique prefix and
// are deleted at the end — enrollments first (Restrict), then classes (their
// slots cascade), course, rooms, branch, users (links cascade) and roles.
// Read-only routes: no audit event is expected, so no watermark is kept.
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
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `T${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-073 supertest';
const CLASSES = '/api/classes';
const SCHEDULE = '/api/schedule';
const MY_SCHEDULE = '/api/me/schedule';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SLOT_KEYS = ['class', 'createdAt', 'effectiveFrom', 'effectiveTo', 'endTime', 'id', 'room', 'startTime', 'teacher', 'timeZone', 'updatedAt', 'weekday'];
const ITEM_KEYS = ['class', 'effectiveFrom', 'effectiveTo', 'endTime', 'id', 'relation', 'room', 'startTime', 'student', 'teacher', 'timeZone', 'weekday'];
const SECRET_KEY = /hash|password/i;
const CONTACT_KEYS = new Set(['email', 'username', 'phone', 'emailVerifiedAt', 'lastLoginAt', 'lockedUntil']);

interface SlotBody {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  timeZone: string;
  room: { id: string; code: string; branch: { id: string; code: string } | null } | null;
  teacher: Record<string, unknown> | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  class: { id: string; code: string; status: string; course: { id: string; code: string } };
}

interface ItemBody extends SlotBody {
  relation: 'self' | 'child' | 'teacher';
  student: { id: string; fullName: string; displayName: string | null } | null;
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

/** Every key of a nested value that looks like a secret or a contact field. */
function suspiciousKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => suspiciousKeys(entry, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const here = `${path}.${key}`;
    const own = SECRET_KEY.test(key) || CONTACT_KEYS.has(key) ? [here] : [];
    return [...own, ...suspiciousKeys(entry, here)];
  });
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-07 timetable readings (e2e, TEST-073)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let timezone: string;
  let branchTimeZone: string;
  let branchId: string;
  let courseId: string;
  let roomBranch: string;
  let roomSite: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const slots: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const academy = (query: Record<string, string> = {}, as = 'scheduler') => api().get(SCHEDULE).query(query).set(bearer(as));
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MY_SCHEDULE).query(query).set(bearer(as));
  /** The fixture slots of a response (the shared dev DB may hold slots of other classes). */
  const ours = <T extends SlotBody>(list: T[]) => list.filter((entry) => Object.values(classes).includes(entry.class.id));
  const names = (list: SlotBody[]) => list.map((entry) => Object.entries(slots).find(([, slotId]) => slotId === entry.id)?.[0] ?? entry.id);

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

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        displayName: name === 'student' ? 'Stu' : null,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function createClass(suffix: string, teachers: string[], open: boolean): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('scheduler')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    const classId = res.body.id as string;
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${classId}/teachers`)
        .set(bearer('scheduler'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    if (open) await api().post(`${CLASSES}/${classId}/status`).set(bearer('scheduler')).send({ action: 'open' }).expect(200);
    classes[suffix] = classId;
    return classId;
  }

  async function enroll(classId: string, studentId: string): Promise<string> {
    const res = await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('scheduler')).send({ studentId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  async function putSlots(classId: string, list: Array<{ name: string; slot: Record<string, unknown> }>): Promise<void> {
    const res = await api()
      .put(`${CLASSES}/${classId}/schedule`)
      .set(bearer('scheduler'))
      .send({ slots: list.map(({ slot }) => slot) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const { name, slot } of list) {
      const written = (res.body.slots as SlotBody[]).find((entry) => entry.weekday === slot['weekday'] && entry.startTime === slot['startTime'])!;
      slots[name] = written.id;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    timezone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;
    branchTimeZone = timezone === 'Asia/Tokyo' ? 'Europe/Istanbul' : 'Asia/Tokyo';
    branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع الجدول' }, timezone: branchTimeZone }, select: { id: true } })).id;
    roomBranch = (await prisma.room.create({ data: { code: code('R1'), name: { ar: 'قاعة الفرع' }, branchId }, select: { id: true } })).id;
    roomSite = (await prisma.room.create({ data: { code: code('R2'), name: { ar: 'قاعة المقر' } }, select: { id: true } })).id;
    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الجدول' }, status: 'published' }, select: { id: true } })).id;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const scheduler = await createRole('scheduler', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'schedule.manage', 'schedule.read', 'enrollments.manage']);
    const manager = await createRole('clsmanager', ['classes.manage']);
    const reader = await createRole('schreader', ['schedule.read']);
    const outsider = await createRole('schoutsider', ['courses.read']);
    await createUser('scheduler', [scheduler]);
    await createUser('manager', [manager]);
    await createUser('teacher', [reader, teacherRole]);
    await createUser('teacher2', [reader, teacherRole]);
    await createUser('student', [reader, studentRole]);
    await createUser('student2', [reader, studentRole]);
    await createUser('guardian', [reader, guardianRole]);
    await createUser('exguardian', [reader]); // linked to the student but without the guardian role
    await createUser('nokey', [outsider]);

    await createClass('A', [id('teacher'), id('teacher2')], true);
    await createClass('B', [id('teacher2')], true);
    await createClass('C', [], false);
    await enroll(classes['A']!, id('student'));
    const withdrawn = await enroll(classes['B']!, id('student'));
    await api().post(`/api/enrollments/${withdrawn}/status`).set(bearer('scheduler')).send({ action: 'withdraw' }).expect(200);
    await enroll(classes['B']!, id('student2'));
    await prisma.guardianStudent.createMany({
      data: [
        { guardianUserId: id('guardian'), studentUserId: id('student'), relationship: 'father', isPrimary: true },
        { guardianUserId: id('exguardian'), studentUserId: id('student'), relationship: 'other' },
      ],
    });

    await putSlots(classes['A']!, [
      { name: 'A1', slot: { weekday: 0, startTime: '10:00', endTime: '11:00', roomId: roomBranch, teacherUserId: id('teacher'), effectiveFrom: '2026-01-01' } },
      { name: 'A2', slot: { weekday: 2, startTime: '12:00', endTime: '13:00', roomId: roomSite, teacherUserId: id('teacher2'), effectiveFrom: '2026-01-01' } },
      { name: 'A3', slot: { weekday: 4, startTime: '09:00', endTime: '10:00', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' } },
    ]);
    await putSlots(classes['B']!, [{ name: 'B1', slot: { weekday: 0, startTime: '11:00', endTime: '12:00', roomId: roomBranch, teacherUserId: id('teacher2'), effectiveFrom: '2026-01-01' } }]);
    await putSlots(classes['C']!, [{ name: 'C1', slot: { weekday: 3, startTime: '15:00', endTime: '16:00', effectiveFrom: '2026-01-01' } }]);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
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

  it('AC1 — my schedule: a student sees the slots of their active classes only, a guardian their child’s (while holding the role), a teacher their classes’; others get an empty list', async () => {
    const student = await mine('student');
    expect(student.status, JSON.stringify(student.body)).toBe(200);
    const items = student.body.items as ItemBody[];
    expect(items.map((item) => [names([item])[0], item.relation, item.student?.id])).toEqual([
      ['A1', 'self', id('student')],
      ['A2', 'self', id('student')],
    ]);
    expect(Object.keys(items[0]!).sort()).toEqual(ITEM_KEYS);
    expect(items[0]).toMatchObject({
      weekday: 0,
      startTime: '10:00',
      endTime: '11:00',
      timeZone: branchTimeZone,
      room: { id: roomBranch, code: code('R1'), name: { ar: 'قاعة الفرع' }, branch: { id: branchId, code: code('BR'), name: { ar: 'فرع الجدول' } } },
      teacher: { fullName: 'Test teacher', displayName: null },
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      class: { id: classes['A'], code: code('A'), name: { ar: 'فصل A' }, status: 'open', course: { id: courseId, code: code('CRS'), name: { ar: 'دورة الجدول' } } },
      student: { id: id('student'), fullName: 'Test student', displayName: 'Stu' },
    });
    expect(items[0]!.teacher).not.toHaveProperty('userId');
    expect(items[1]).toMatchObject({ timeZone: timezone, room: { id: roomSite, branch: null }, teacher: { fullName: 'Test teacher2' } });

    const student2 = await mine('student2').expect(200);
    expect(names(student2.body.items)).toEqual(['B1']);

    const guardian = await mine('guardian').expect(200);
    expect((guardian.body.items as ItemBody[]).map((item) => [names([item])[0], item.relation, item.student?.fullName])).toEqual([
      ['A1', 'child', 'Test student'],
      ['A2', 'child', 'Test student'],
    ]);
    expect((await mine('exguardian').expect(200)).body.items).toEqual([]);

    const teacher = await mine('teacher').expect(200);
    expect((teacher.body.items as ItemBody[]).map((item) => [names([item])[0], item.relation, item.student])).toEqual([
      ['A1', 'teacher', null],
      ['A2', 'teacher', null],
    ]);
    const teacher2 = await mine('teacher2').expect(200);
    expect(names(teacher2.body.items)).toEqual(['A1', 'B1', 'A2']);
    expect((await mine('scheduler').expect(200)).body.items).toEqual([]);
  });

  it('AC1b — one item per slot and relation: a teacher whose child is enrolled in their class sees its slots twice', async () => {
    await prisma.guardianStudent.create({ data: { guardianUserId: id('teacher'), studentUserId: id('student'), relationship: 'mother' } });
    const guardianRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'guardian' }, select: { id: true } })).id;
    await prisma.userRole.create({ data: { userId: id('teacher'), roleId: guardianRoleId } });
    try {
      const res = await mine('teacher').expect(200);
      expect((res.body.items as ItemBody[]).map((item) => [names([item])[0], item.relation, item.student?.id ?? null])).toEqual([
        ['A1', 'child', id('student')],
        ['A1', 'teacher', null],
        ['A2', 'child', id('student')],
        ['A2', 'teacher', null],
      ]);
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: id('teacher'), roleId: guardianRoleId } });
      await prisma.guardianStudent.deleteMany({ where: { guardianUserId: id('teacher') } });
    }
  });

  it('AC2 — my schedule needs schedule.read; the academy schedule needs schedule.manage or classes.manage (either one); anonymous is 401', async () => {
    const noKey = await mine('nokey');
    expect(noKey.status).toBe(403);
    expect(noKey.body).toMatchObject({ code: 'permission_denied', missing: ['schedule.read'] });
    const refused = await academy({}, 'nokey');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'permission_denied', missing: ['schedule.manage', 'classes.manage'] });
    expect((await academy({}, 'student')).status).toBe(403);
    await academy({ classId: classes['A']! }, 'manager').expect(200);
    await academy({ classId: classes['A']! }, 'scheduler').expect(200);
    await api().get(SCHEDULE).expect(401);
    await api().get(MY_SCHEDULE).expect(401);
  });

  it('AC3 — the academy schedule: filters and `on` return the right slots; a slot whose range ended is hidden after it; the default is today in the academy’s time zone', async () => {
    const all = await academy();
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.on).toBe(calendarDateIn(timezone));
    const oursToday = ours(all.body.slots as SlotBody[]);
    expect(names(oursToday)).toEqual(['A1', 'B1', 'A2', 'C1']);
    expect(Object.keys(oursToday[0]!).sort()).toEqual(SLOT_KEYS);
    expect(oursToday[0]).toMatchObject({
      timeZone: branchTimeZone,
      room: { id: roomBranch, branch: { id: branchId } },
      teacher: { userId: id('teacher'), fullName: 'Test teacher' },
      class: { id: classes['A'], code: code('A'), status: 'open', course: { code: code('CRS') } },
    });
    expect(oursToday[2]).toMatchObject({ timeZone: timezone, room: { id: roomSite, branch: null } });
    expect(oursToday[3]).toMatchObject({ timeZone: timezone, room: null, teacher: null, class: { status: 'planned' } });

    const byClass = await academy({ classId: classes['A']! }).expect(200);
    expect(names(byClass.body.slots)).toEqual(['A1', 'A2']);
    const past = await academy({ classId: classes['A']!, on: '2025-06-03' }).expect(200);
    expect(past.body.on).toBe('2025-06-03');
    expect(names(past.body.slots)).toEqual(['A3']);
    expect(names((await academy({ classId: classes['A']!, on: '2025-12-31' }).expect(200)).body.slots)).toEqual(['A3']);
    expect(names((await academy({ classId: classes['A']!, on: '2026-01-01' }).expect(200)).body.slots)).toEqual(['A1', 'A2']);
    expect(names((await academy({ classId: classes['A']!, on: '2024-12-31' }).expect(200)).body.slots)).toEqual([]);

    expect(names(ours((await academy({ roomId: roomBranch }).expect(200)).body.slots))).toEqual(['A1', 'B1']);
    expect(names(ours((await academy({ branchId }).expect(200)).body.slots))).toEqual(['A1', 'B1']);
    expect(names(ours((await academy({ branchId: 'none' }).expect(200)).body.slots))).toEqual(['A2']);
    expect(names(ours((await academy({ teacherUserId: id('teacher2') }).expect(200)).body.slots))).toEqual(['B1', 'A2']);
    expect(names(ours((await academy({ weekday: '0' }).expect(200)).body.slots))).toEqual(['A1', 'B1']);
    expect(names((await academy({ classId: classes['B']!, weekday: '2' }).expect(200)).body.slots)).toEqual([]);
    expect(names((await academy({ classId: NIL_ID }).expect(200)).body.slots)).toEqual([]);

    // My schedule honours `on` the same way.
    expect(names((await mine('student', { on: '2025-06-03' }).expect(200)).body.items)).toEqual(['A3']);
    expect(names((await mine('student', { on: '2024-06-03' }).expect(200)).body.items)).toEqual([]);
  });

  it('AC3b — validation: a bad date, weekday, id or an unknown filter is 400', async () => {
    const queries: Record<string, string>[] = [
      { on: '2026-02-30' },
      { on: '2026-2-3' },
      { on: '' },
      { weekday: '7' },
      { weekday: '-1' },
      { weekday: 'abc' },
      { weekday: '' },
      { weekday: '03' },
      { branchId: 'not-a-uuid' },
      { roomId: '12' },
      { teacherUserId: 'x' },
      { classId: 'none' },
      { status: 'open' },
    ];
    for (const query of queries) expect((await academy(query)).status, JSON.stringify(query)).toBe(400);
    expect((await mine('student', { on: '2026-13-01' })).status).toBe(400);
    expect((await mine('student', { classId: classes['A']! })).status).toBe(400);
  });

  it('AC4 — no secret, contact or account field reaches either response', async () => {
    const all = await academy().expect(200);
    const own = await mine('teacher2').expect(200);
    expect(suspiciousKeys(all.body)).toEqual([]);
    expect(suspiciousKeys(own.body)).toEqual([]);
    for (const item of own.body.items as ItemBody[]) {
      expect(Object.keys(item.teacher ?? {}).sort()).toEqual(item.teacher ? ['displayName', 'fullName'] : []);
      if (item.student) expect(Object.keys(item.student).sort()).toEqual(['displayName', 'fullName', 'id']);
    }
  });

  it(
    'documents the two routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/schedule'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/me/schedule'])).toEqual(['get']);
      expect(docs.body.components.schemas).toHaveProperty('AcademyScheduleDto');
      expect(docs.body.components.schemas).toHaveProperty('TimetableSlotDto');
      expect(docs.body.components.schemas).toHaveProperty('MyScheduleDto');
      expect(docs.body.components.schemas).toHaveProperty('MyScheduleItemDto');
      expect(docs.body.components.schemas.TimetableSlotDto.properties).toHaveProperty('timeZone');
      expect(docs.body.components.schemas.TimetableSlotDto.properties).toHaveProperty('effectiveTo');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
