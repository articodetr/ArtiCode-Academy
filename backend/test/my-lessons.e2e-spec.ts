// TEST-079 — MOD-06-T04 «my lessons» (GET /api/me/lessons, API-101) against
// the live development database. Skipped when no database is reachable.
// Fixtures (users with the system `student`/`guardian`/`teacher` roles plus
// custom roles, a published course, two classes with lessons written through
// API-095, enrollments through API-057/059, attendance through API-100,
// guardian links) carry a unique prefix and are deleted at the end —
// enrollments first (Restrict), then classes (lessons and attendance
// cascade), course, users (links cascade) and roles. Read-only route: no
// audit event is expected, so no watermark is kept.
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

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `M${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-079 supertest';
const CLASSES = '/api/classes';
const MY_LESSONS = '/api/me/lessons';
const ITEM_KEYS = ['attendance', 'class', 'deliveryMode', 'description', 'endsAt', 'id', 'meetingUrl', 'relation', 'room', 'startsAt', 'status', 'student', 'syllabusItem', 'teacher', 'title'];
const SECRET_KEY = /hash|password/i;
const FORBIDDEN_KEYS = new Set(['email', 'username', 'phone', 'emailVerifiedAt', 'lastLoginAt', 'lockedUntil', 'note', 'recordedBy', 'recordedById', 'cancellationReason', 'userId', 'createdBy', 'createdById']);

interface ItemBody {
  id: string;
  title: Record<string, string>;
  startsAt: string;
  status: string;
  meetingUrl: string | null;
  teacher: Record<string, unknown> | null;
  class: { id: string; code: string };
  relation: 'self' | 'child';
  student: { id: string; fullName: string; displayName: string | null };
  attendance: { status: string; minutesLate: number | null; recordedAt: string } | null;
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

/** Every key of a JSON value, at any depth. */
function keysDeep(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((entry) => keysDeep(entry, into));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      keysDeep(entry, into);
    }
  }
  return into;
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-06 my lessons (e2e, TEST-079)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const lessons: Record<string, string> = {};
  const enrollments: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MY_LESSONS).query(query).set(bearer(as));
  const names = (items: ItemBody[]) => items.map((item) => Object.entries(lessons).find(([, lessonId]) => lessonId === item.id)?.[0] ?? item.id);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[], displayName: string | null = null): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, displayName, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function createClass(suffix: string, teachers: string[], actions: string[] = []): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    const classId = res.body.id as string;
    await api()
      .put(`${CLASSES}/${classId}/teachers`)
      .set(bearer('manager'))
      .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
      .expect(200);
    for (const action of actions) await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action }).expect(200);
    classes[suffix] = classId;
    return classId;
  }

  async function enroll(suffix: string, student: string): Promise<string> {
    const res = await api().post(`${CLASSES}/${classes[suffix]}/enrollments`).set(bearer('manager')).send({ studentId: id(student) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    enrollments[`${suffix}:${student}`] = res.body.id as string;
    return res.body.id as string;
  }

  async function createLesson(name: string, suffix: string, day: string, extra: Record<string, unknown> = {}): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes[suffix]}/lessons`)
      .set(bearer('manager'))
      .send({ title: { ar: `درس ${name}`, en: `Lesson ${name}` }, startsAt: `${day}T10:00:00Z`, endsAt: `${day}T11:30:00Z`, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    lessons[name] = res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (
      await prisma.course.create({
        data: { code: code('CRS'), name: { ar: 'دورة دروسي' }, status: 'published', syllabusItems: { create: [{ sortOrder: 1, title: { ar: 'البند 1' } }] } },
        select: { id: true },
      })
    ).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const manager = await createRole('mmanager', [
      'classes.read',
      'classes.manage',
      'classes.teachers.assign',
      'lessons.read',
      'lessons.manage',
      'attendance.read',
      'attendance.record',
      'enrollments.manage',
    ]);
    const outsider = await createRole('moutsider', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [teacherRole]);
    await createUser('s1', [studentRole], 'سامي');
    await createUser('s2', [studentRole]);
    await createUser('s3', [studentRole]);
    await createUser('guardian', [guardianRole]);
    await createUser('exguardian', [outsider]); // linked to s1 but without the guardian role
    await createUser('nobody', [studentRole]); // no enrollment at all

    await createClass('A', [id('teacher')], ['open']);
    await createClass('B', [id('teacher')], ['open']);
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('A', 's3');
    await enroll('B', 's2');
    const left = await enroll('B', 's1');
    await api().post(`/api/enrollments/${left}/status`).set(bearer('manager')).send({ action: 'withdraw', reason: 'انتقال' }).expect(200);
    await api().post(`/api/enrollments/${enrollments['A:s3']}/status`).set(bearer('manager')).send({ action: 'complete' }).expect(200);
    await prisma.guardianStudent.createMany({
      data: [
        { guardianUserId: id('guardian'), studentUserId: id('s1'), relationship: 'father', isPrimary: true },
        { guardianUserId: id('guardian'), studentUserId: id('s2'), relationship: 'father', isPrimary: true },
        { guardianUserId: id('exguardian'), studentUserId: id('s1'), relationship: 'other' },
      ],
    });
    const item = (await prisma.courseSyllabusItem.findFirstOrThrow({ where: { courseId }, select: { id: true } })).id;
    await createLesson('L1', 'A', '2026-01-10', { description: { ar: 'مقدمة' }, syllabusItemId: item, meetingUrl: 'https://meet.example.com/l1', deliveryMode: 'live_online' });
    await createLesson('L2', 'A', '2027-06-01');
    await createLesson('L3', 'A', '2026-01-11');
    await createLesson('LB', 'B', '2026-01-12');
    await api().post(`/api/lessons/${lessons['L3']}/status`).set(bearer('manager')).send({ action: 'cancel', reason: 'سبب داخلي' }).expect(200);
    await api()
      .put(`/api/lessons/${lessons['L1']}/attendance`)
      .set(bearer('manager'))
      .send({ records: [{ studentId: id('s1'), status: 'present' }, { studentId: id('s3'), status: 'late', minutesLate: 5, note: 'ملاحظة سرية' }] })
      .expect(200);
    await api().put(`/api/lessons/${lessons['LB']}/attendance`).set(bearer('manager')).send({ records: [{ studentId: id('s2'), status: 'absent', note: 'سري أيضاً' }] }).expect(200);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a student sees the lessons of their active classes (cancelled ones with their status) with their own attendance, not a class they left; filters and keyset pages work', async () => {
    const res = await mine('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as ItemBody[];
    expect(names(items)).toEqual(['L1', 'L3', 'L2']); // by start time; LB is hidden (withdrawn from B)
    expect(res.body.nextCursor).toBeNull();
    expect(Object.keys(items[0]!).sort()).toEqual(ITEM_KEYS);
    expect(items[0]).toMatchObject({
      id: lessons['L1'],
      title: { ar: 'درس L1', en: 'Lesson L1' },
      description: { ar: 'مقدمة' },
      deliveryMode: 'live_online',
      startsAt: '2026-01-10T10:00:00.000Z',
      endsAt: '2026-01-10T11:30:00.000Z',
      status: 'scheduled',
      meetingUrl: 'https://meet.example.com/l1',
      room: null,
      teacher: { fullName: 'Test teacher', displayName: null },
      syllabusItem: { sortOrder: 1, title: { ar: 'البند 1' } },
      class: { id: classes['A'], code: code('A'), status: 'open', course: { id: courseId, code: code('CRS') } },
      relation: 'self',
      student: { id: id('s1'), fullName: 'Test s1', displayName: 'سامي' },
      attendance: { status: 'present', minutesLate: null },
    });
    expect(typeof items[0]!.attendance?.recordedAt).toBe('string');
    expect(items[1]).toMatchObject({ id: lessons['L3'], status: 'cancelled', attendance: null });
    expect(items[2]).toMatchObject({ id: lessons['L2'], attendance: null });

    expect(names((await mine('s1', { status: 'cancelled' }).expect(200)).body.items)).toEqual(['L3']);
    expect(names((await mine('s1', { from: '2026-01-10T12:00:00Z', to: '2027-12-31T00:00:00Z' }).expect(200)).body.items)).toEqual(['L3', 'L2']);
    expect(names((await mine('s1', { classId: classes['A']! }).expect(200)).body.items)).toEqual(['L1', 'L3', 'L2']);
    expect((await mine('s1', { classId: classes['B']! }).expect(200)).body.items).toEqual([]); // left B — its lessons are not theirs
    expect((await mine('s1', { studentId: id('s2') }).expect(200)).body.items).toEqual([]); // another student is never theirs
    expect(names((await mine('s1', { studentId: id('s1') }).expect(200)).body.items)).toEqual(['L1', 'L3', 'L2']);
    expect(names((await mine('s1', { order: 'desc' }).expect(200)).body.items)).toEqual(['L2', 'L3', 'L1']);

    const paged: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const step = await mine('s1', { limit: '1', ...(cursor ? { cursor } : {}) }).expect(200);
      paged.push(...names(step.body.items as ItemBody[]));
      cursor = step.body.nextCursor as string | null;
      if (cursor === null) break;
    }
    expect(paged).toEqual(['L1', 'L3', 'L2']);
    expect((await mine('s1', { cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
  });

  it('AC1b — a completed enrollment still shows the class’s lessons with the student’s own attendance (status and minutes, never the note)', async () => {
    const items = (await mine('s3').expect(200)).body.items as ItemBody[];
    expect(names(items)).toEqual(['L1', 'L3', 'L2']);
    expect(items[0]!.attendance).toEqual({ status: 'late', minutesLate: 5, recordedAt: items[0]!.attendance!.recordedAt });
    expect(JSON.stringify(items)).not.toContain('سرية');
  });

  it('AC2 — a guardian sees their linked children’s lessons (one item per child), narrows by studentId, and loses an unlinked child or everything without the role; a link without the role grants nothing', async () => {
    const all = (await mine('guardian').expect(200)).body.items as ItemBody[];
    // A's lessons twice (s1, s2 — by student id), B's once (s2); by start time: L1 (A), L3 (A), LB (B), L2 (A).
    const byStudentId = [id('s1'), id('s2')].sort();
    expect(all.map((item) => [names([item])[0], item.relation, item.student.id])).toEqual([
      ['L1', 'child', byStudentId[0]],
      ['L1', 'child', byStudentId[1]],
      ['L3', 'child', byStudentId[0]],
      ['L3', 'child', byStudentId[1]],
      ['LB', 'child', id('s2')],
      ['L2', 'child', byStudentId[0]],
      ['L2', 'child', byStudentId[1]],
    ]);
    const l1OfS1 = all.find((item) => item.id === lessons['L1'] && item.student.id === id('s1'))!;
    const l1OfS2 = all.find((item) => item.id === lessons['L1'] && item.student.id === id('s2'))!;
    expect(l1OfS1.attendance).toMatchObject({ status: 'present' });
    expect(l1OfS2.attendance).toBeNull();
    expect(all.find((item) => item.id === lessons['LB'])!.attendance).toMatchObject({ status: 'absent', minutesLate: null });
    expect(JSON.stringify(all)).not.toContain('سري');

    expect(names((await mine('guardian', { studentId: id('s2') }).expect(200)).body.items)).toEqual(['L1', 'L3', 'LB', 'L2']);
    expect(names((await mine('guardian', { studentId: id('s1') }).expect(200)).body.items)).toEqual(['L1', 'L3', 'L2']);
    expect((await mine('guardian', { studentId: id('s3') }).expect(200)).body.items).toEqual([]); // not linked
    expect(names((await mine('guardian', { classId: classes['B']! }).expect(200)).body.items)).toEqual(['LB']);
    // `limit` counts lessons: one lesson of A yields two items.
    const firstPage = await mine('guardian', { limit: '1' }).expect(200);
    expect(names(firstPage.body.items as ItemBody[])).toEqual(['L1', 'L1']);
    expect(firstPage.body.nextCursor).not.toBeNull();

    expect((await mine('exguardian').expect(200)).body.items).toEqual([]);

    // Unlink s2: only s1's lessons remain. Take the role away: nothing remains. Both restored afterwards.
    const guardianRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'guardian' }, select: { id: true } })).id;
    await prisma.guardianStudent.delete({ where: { guardianUserId_studentUserId: { guardianUserId: id('guardian'), studentUserId: id('s2') } } });
    try {
      expect((await mine('guardian').expect(200)).body.items.map((item: ItemBody) => item.student.id)).toEqual([id('s1'), id('s1'), id('s1')]);
      await prisma.userRole.deleteMany({ where: { userId: id('guardian'), roleId: guardianRoleId } });
      try {
        expect((await mine('guardian').expect(200)).body.items).toEqual([]);
      } finally {
        await prisma.userRole.create({ data: { userId: id('guardian'), roleId: guardianRoleId } });
      }
    } finally {
      await prisma.guardianStudent.create({ data: { guardianUserId: id('guardian'), studentUserId: id('s2'), relationship: 'father', isPrimary: true } });
    }
  });

  it('AC3 — a user without an owned enrollment gets an empty list, not 403; anonymous is 401; bad queries are 400', async () => {
    expect((await mine('nobody').expect(200)).body).toEqual({ items: [], nextCursor: null });
    expect((await mine('manager').expect(200)).body).toEqual({ items: [], nextCursor: null }); // keys over every class grant nothing here
    expect((await mine('teacher').expect(200)).body).toEqual({ items: [], nextCursor: null }); // teaching is not owning (API-093 is the teacher's list)
    await api().get(MY_LESSONS).expect(401);
    const badQueries: Record<string, string>[] = [{ from: '2026-01-10' }, { to: '2026-01-10T10:00:00' }, { studentId: 'x' }, { classId: 'x' }, { status: 'done' }, { limit: '0' }, { limit: '101' }, { order: 'sideways' }, { weekday: '1' }];
    for (const query of badQueries) {
      expect((await mine('s1', query)).status, JSON.stringify(query)).toBe(400);
    }
  });

  it('AC4 — no secret, contact or account field, no teacher id, no note, no recorder and no cancellation reason reach the response', async () => {
    for (const who of ['s1', 's3', 'guardian']) {
      const body = (await mine(who).expect(200)).body;
      const keys = keysDeep(body);
      expect(keys.some((key) => SECRET_KEY.test(key)), who).toBe(false);
      expect(keys.filter((key) => FORBIDDEN_KEYS.has(key)), who).toEqual([]);
      for (const item of body.items as ItemBody[]) {
        if (item.teacher) expect(Object.keys(item.teacher).sort()).toEqual(['displayName', 'fullName']);
        expect(Object.keys(item.student).sort()).toEqual(['displayName', 'fullName', 'id']);
        if (item.attendance) expect(Object.keys(item.attendance).sort()).toEqual(['minutesLate', 'recordedAt', 'status']);
      }
    }
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/lessons'])).toEqual(['get']);
      for (const schema of ['MyLessonListDto', 'MyLessonItemDto', 'MyLessonAttendanceDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
      expect(docs.body.components.schemas.MyLessonItemDto.properties.relation).toMatchObject({ enum: ['self', 'child'] });
      expect(docs.body.components.schemas.MyLessonItemDto.properties).not.toHaveProperty('cancellationReason');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
