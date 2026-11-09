// TEST-077 — MOD-06-T02 lessons (API-093..API-098) against the live development
// database. Skipped when no database is reachable. Fixture users (two holding
// the system `teacher` role), roles, two published courses with syllabus
// items, classes, rooms and lessons carry a unique prefix and are deleted at
// the end — classes first (their lessons and attendance cascade), then
// courses (items cascade) and rooms. Audit events are counted by fixture
// actor above an id watermark.
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
const PREFIX = `N${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-077 supertest';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const LESSON_KEYS = [
  'attendance',
  'attendanceTakenAt',
  'cancellationReason',
  'class',
  'createdAt',
  'deliveryMode',
  'description',
  'endsAt',
  'id',
  'meetingUrl',
  'room',
  'scheduleId',
  'startsAt',
  'status',
  'syllabusItem',
  'teacher',
  'timeZone',
  'title',
  'updatedAt',
];

interface LessonBody {
  id: string;
  class: { id: string; code: string; status: string; course: { id: string; code: string } };
  title: Record<string, string>;
  description: Record<string, string> | null;
  deliveryMode: string;
  startsAt: string;
  endsAt: string;
  status: string;
  room: { id: string; code: string } | null;
  timeZone: string;
  teacher: { userId: string; fullName: string } | null;
  syllabusItem: { id: string; sortOrder: number } | null;
  scheduleId: string | null;
  meetingUrl: string | null;
  cancellationReason: string | null;
  attendanceTakenAt: string | null;
  attendance: { recorded: number; present: number; absent: number; late: number; excused: number };
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

describe.skipIf(!available)('MOD-06 lessons (e2e, TEST-077)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let otherCourseId: string;
  let itemA1: string;
  let itemA2: string;
  let itemOther: string;
  let roomA: string;
  let roomB: string;
  let roomInactive: string;
  let roomBranch: string;
  let academyTimeZone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  /** A lesson body with defaults: 2026-11-10 10:00–11:30 UTC, no room, no teacher given (→ the lead teacher). */
  const lesson = (over: Record<string, unknown> = {}) => ({ title: { ar: 'درس' }, startsAt: '2026-11-10T10:00:00Z', endsAt: '2026-11-10T11:30:00Z', ...over });
  const create = (classId: string, body: object, as = 'manager') => api().post(`${CLASSES}/${classId}/lessons`).set(bearer(as)).send(body);
  const patch = (lessonId: string, body: object, as = 'manager') => api().patch(`${LESSONS}/${lessonId}`).set(bearer(as)).send(body);
  const act = (lessonId: string, action: string, reason?: string, as = 'manager') =>
    api().post(`${LESSONS}/${lessonId}/status`).set(bearer(as)).send(reason === undefined ? { action } : { action, reason });
  const get = (lessonId: string, as = 'manager') => api().get(`${LESSONS}/${lessonId}`).set(bearer(as));
  const list = (query: Record<string, string> = {}, as = 'manager') => api().get(LESSONS).query(query).set(bearer(as));
  const ours = (items: LessonBody[]) => items.filter((entry) => Object.values(classes).includes(entry.class.id));

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[], login = true): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: login ? await passwords.hash(PASSWORD) : null, status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
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
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    const classId = res.body.id as string;
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${classId}/teachers`)
        .set(bearer('manager'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    for (const action of actions) await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action }).expect(200);
    classes[suffix] = classId;
    return classId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const course = await prisma.course.create({
      data: { code: code('CRS'), name: { ar: 'دورة الدروس' }, status: 'published', syllabusItems: { create: [{ sortOrder: 1, title: { ar: 'البند 1' } }, { sortOrder: 2, title: { ar: 'البند 2' } }] } },
      select: { id: true, syllabusItems: { orderBy: { sortOrder: 'asc' }, select: { id: true } } },
    });
    courseId = course.id;
    itemA1 = course.syllabusItems[0]!.id;
    itemA2 = course.syllabusItems[1]!.id;
    const other = await prisma.course.create({
      data: { code: code('OTH'), name: { ar: 'دورة أخرى' }, status: 'published', syllabusItems: { create: [{ sortOrder: 1, title: { ar: 'بند آخر' } }] } },
      select: { id: true, syllabusItems: { select: { id: true } } },
    });
    otherCourseId = other.id;
    itemOther = other.syllabusItems[0]!.id;
    roomA = (await prisma.room.create({ data: { code: code('RA'), name: { ar: 'قاعة أ' } }, select: { id: true } })).id;
    roomB = (await prisma.room.create({ data: { code: code('RB'), name: { ar: 'قاعة ب' } }, select: { id: true } })).id;
    roomInactive = (await prisma.room.create({ data: { code: code('RX'), name: { ar: 'قاعة موقوفة' }, isActive: false }, select: { id: true } })).id;
    // D-R41: a room in a branch with its own zone, and the academy's zone for every other lesson.
    const branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع برلين' }, timezone: 'Europe/Berlin' }, select: { id: true } })).id;
    roomBranch = (await prisma.room.create({ data: { code: code('RZ'), name: { ar: 'قاعة الفرع' }, branchId }, select: { id: true } })).id;
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    const teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;
    const studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    const manager = await createRole('lmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'lessons.read', 'lessons.manage', 'enrollments.manage']);
    const teaching = await createRole('lteacher', ['classes.read', 'lessons.read', 'lessons.manage']);
    const staff = await createRole('lstaff', ['classes.read', 'classes.manage', 'lessons.read']);
    const outsider = await createRole('loutsider', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [teaching, teacherRoleId]);
    await createUser('teacher2', [teaching, teacherRoleId]);
    await createUser('staff', [staff]);
    await createUser('outsider', [outsider]);
    await createUser('student', [studentRoleId], false);

    await createClass('A', [id('teacher'), id('teacher2')], ['open']);
    await createClass('B', [id('teacher2')]);
    await createClass('C', []);
    await createClass('D', [id('teacher')], ['open', 'start', 'complete']);
  });

  afterAll(async () => {
    try {
      if (prisma) {
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

  it('AC1 — a teacher creates and reads lessons of their assigned classes only; staff reads everything and writes nothing; no key is 403; anonymous 401', async () => {
    const m = await mark();
    const created = await create(classes['A']!, lesson({ roomId: roomA, syllabusItemId: itemA1, meetingUrl: 'https://meet.example.com/a' }), 'teacher');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const body = created.body as LessonBody;
    expect(Object.keys(body).sort()).toEqual(LESSON_KEYS);
    expect(body).toMatchObject({
      class: { id: classes['A'], code: code('A'), status: 'open', course: { id: courseId, code: code('CRS') } },
      title: { ar: 'درس' },
      description: null,
      deliveryMode: 'in_person',
      startsAt: '2026-11-10T10:00:00.000Z',
      endsAt: '2026-11-10T11:30:00.000Z',
      status: 'scheduled',
      room: { id: roomA, code: code('RA') },
      timeZone: academyTimeZone, // D-R41: no branch on the room → the academy's zone
      teacher: { userId: id('teacher'), fullName: 'Test teacher' }, // the lead teacher by default
      syllabusItem: { id: itemA1, sortOrder: 1 },
      scheduleId: null,
      meetingUrl: 'https://meet.example.com/a',
      cancellationReason: null,
      attendanceTakenAt: null,
      attendance: { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 },
    });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([['lessons.created', 'classes', classes['A']]]);
    expect(events[0]!.metadata).toEqual({ code: code('A'), classId: classes['A'], count: 1, lessonIds: [body.id] });

    // The assistant may write in A too; nobody but a manager in B (teacher is not assigned there → 404, not 403).
    await create(classes['A']!, lesson({ startsAt: '2026-11-11T10:00:00Z', endsAt: '2026-11-11T11:00:00Z', teacherUserId: null }), 'teacher2').expect(201);
    const hidden = await create(classes['B']!, lesson(), 'teacher');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'class_not_found', classId: classes['B'] });
    const inB = await create(classes['B']!, lesson({ startsAt: '2026-11-12T10:00:00Z', endsAt: '2026-11-12T11:00:00Z' }));
    expect(inB.status, JSON.stringify(inB.body)).toBe(201);
    expect((inB.body as LessonBody).teacher?.userId).toBe(id('teacher2'));

    // Reading: the teacher sees A's lessons, not B's; staff (classes.manage) sees both but cannot write; outsider has no key.
    await get(body.id, 'teacher').expect(200);
    const notVisible = await get(inB.body.id as string, 'teacher');
    expect(notVisible.status).toBe(404);
    expect(notVisible.body).toMatchObject({ code: 'lesson_not_found', lessonId: inB.body.id });
    expect(ours((await list({}, 'teacher').expect(200)).body.items).map((entry) => entry.class.code)).toEqual([code('A'), code('A')]);
    expect(ours((await list({}, 'staff').expect(200)).body.items).map((entry) => entry.class.code)).toEqual([code('A'), code('A'), code('B')]);
    expect((await create(classes['A']!, lesson(), 'staff')).status).toBe(403);
    expect((await patch(body.id, { title: { ar: 'x' } }, 'staff')).status).toBe(403);
    expect((await list({}, 'outsider')).status).toBe(403);
    await api().get(LESSONS).expect(401);
    await api().post(`${CLASSES}/${classes['A']}/lessons`).send(lesson()).expect(401);
    expect((await get(NIL_ID)).status).toBe(404);
  });

  it('AC2 — creation rules: closed class, unassigned teacher, foreign syllabus item, bad time range, unknown or inactive room — all refused without an event', async () => {
    const m = await mark();
    const closed = await create(classes['D']!, lesson());
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'class_closed', classId: classes['D'], status: 'completed' });
    const notAssigned = await create(classes['B']!, lesson({ teacherUserId: id('teacher') }));
    expect(notAssigned.status).toBe(422);
    expect(notAssigned.body).toMatchObject({ code: 'teacher_not_assigned', userId: id('teacher') });
    const mismatch = await create(classes['A']!, lesson({ syllabusItemId: itemOther }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body).toMatchObject({ code: 'syllabus_item_mismatch', syllabusItemId: itemOther, courseId });
    const unknownItem = await create(classes['A']!, lesson({ syllabusItemId: NIL_ID }));
    expect(unknownItem.status).toBe(404);
    expect(unknownItem.body.code).toBe('syllabus_item_not_found');
    const inverted = await create(classes['A']!, lesson({ startsAt: '2026-11-10T11:00:00Z', endsAt: '2026-11-10T10:00:00Z' }));
    expect(inverted.status).toBe(400);
    expect(inverted.body).toMatchObject({ code: 'time_range_invalid', maxHours: 12 });
    const tooLong = await create(classes['A']!, lesson({ startsAt: '2026-11-20T08:00:00Z', endsAt: '2026-11-20T20:00:01Z' }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('time_range_invalid');
    const inactive = await create(classes['A']!, lesson({ roomId: roomInactive }));
    expect(inactive.status).toBe(422);
    expect(inactive.body).toMatchObject({ code: 'room_inactive', roomId: roomInactive });
    const unknownRoom = await create(classes['A']!, lesson({ roomId: NIL_ID }));
    expect(unknownRoom.status).toBe(404);
    expect(unknownRoom.body).toMatchObject({ code: 'room_not_found', roomId: NIL_ID });
    for (const body of [
      lesson({ startsAt: '2026-11-10T10:00:00' }), // no offset
      lesson({ startsAt: '2026-11-10' }),
      lesson({ endsAt: 12 }),
      lesson({ title: { en: 'no arabic' } }),
      lesson({ title: 'plain' }),
      lesson({ meetingUrl: 'http://meet.example.com/a' }),
      lesson({ meetingUrl: 'https://meet example.com' }),
      lesson({ deliveryMode: 'telepathy' }),
      lesson({ roomId: 'not-a-uuid' }),
      lesson({ color: 'red' }),
      { startsAt: '2026-11-10T10:00:00Z', endsAt: '2026-11-10T11:00:00Z' }, // no title
    ]) {
      expect((await create(classes['A']!, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api().post(`${CLASSES}/not-a-uuid/lessons`).set(bearer('manager')).send(lesson())).status).toBe(400);
    expect((await create(NIL_ID, lesson())).status).toBe(404);
    expect(await eventsSince(m)).toEqual([]);

    // Valid extras: an explicit assistant teacher, a description, a past lesson (D-R33 (2)) and a 12-hour lesson.
    const full = await create(classes['A']!, lesson({ startsAt: '2026-01-05T08:00:00Z', endsAt: '2026-01-05T20:00:00Z', teacherUserId: id('teacher2'), description: { ar: 'وصف', en: 'Desc' }, deliveryMode: 'live_online', roomId: roomB }));
    expect(full.status, JSON.stringify(full.body)).toBe(201);
    expect(full.body).toMatchObject({ teacher: { userId: id('teacher2') }, description: { ar: 'وصف', en: 'Desc' }, deliveryMode: 'live_online', room: { id: roomB } });
    fx['pastLesson'] = full.body.id as string;
  });

  it('AC3 — status actions: complete only after the start time, cancel stores the reason, restore clears it; locked edits of completed and cancelled lessons', async () => {
    const future = await create(classes['A']!, lesson({ startsAt: '2027-03-01T10:00:00Z', endsAt: '2027-03-01T11:00:00Z' }));
    expect(future.status, JSON.stringify(future.body)).toBe(201);
    const futureId = future.body.id as string;
    const m = await mark();
    const early = await act(futureId, 'complete');
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'lesson_not_started', startsAt: '2027-03-01T10:00:00.000Z' });
    const badRestore = await act(futureId, 'restore');
    expect(badRestore.status).toBe(409);
    expect(badRestore.body).toMatchObject({ code: 'invalid_transition', from: 'scheduled', action: 'restore', allowed: ['complete', 'cancel'] });
    expect(await eventsSince(m)).toEqual([]);

    const completed = await act(id('pastLesson'), 'complete');
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.status).toBe('completed');
    const locked = await patch(id('pastLesson'), { startsAt: '2026-01-05T09:00:00Z', title: { ar: 'عنوان جديد' } });
    expect(locked.status).toBe(409);
    expect(locked.body).toMatchObject({ code: 'lesson_locked', status: 'completed', fields: ['startsAt'] });
    const retitled = await patch(id('pastLesson'), { title: { ar: 'عنوان جديد' } });
    expect(retitled.status, JSON.stringify(retitled.body)).toBe(200);
    expect(retitled.body.title).toEqual({ ar: 'عنوان جديد' });
    const cancelCompleted = await act(id('pastLesson'), 'cancel');
    expect(cancelCompleted.status).toBe(409);
    expect(cancelCompleted.body).toMatchObject({ code: 'invalid_transition', from: 'completed', allowed: [] });

    const cancelled = await act(futureId, 'cancel', 'المعلم مريض');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancellationReason: 'المعلم مريض' });
    const frozen = await patch(futureId, { title: { ar: 'x' } });
    expect(frozen.status).toBe(409);
    expect(frozen.body).toMatchObject({ code: 'lesson_locked', status: 'cancelled', fields: ['title'] });
    const restored = await act(futureId, 'restore');
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ status: 'scheduled', cancellationReason: null });
    const events = (await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata]);
    expect(events).toEqual([
      ['lessons.status.changed', id('pastLesson'), { classId: classes['A'], code: code('A'), action: 'complete', from: 'scheduled', to: 'completed' }],
      ['lessons.updated', id('pastLesson'), { classId: classes['A'], code: code('A'), fields: ['title'] }],
      ['lessons.status.changed', futureId, { classId: classes['A'], code: code('A'), action: 'cancel', from: 'scheduled', to: 'cancelled', reason: 'المعلم مريض' }],
      ['lessons.status.changed', futureId, { classId: classes['A'], code: code('A'), action: 'restore', from: 'cancelled', to: 'scheduled' }],
    ]);
    expect((await act(futureId, 'teleport')).status).toBe(400);
    // A lesson of a completed class is frozen for every action.
    const dLesson = await prisma.lesson.create({ data: { classId: classes['D']!, title: { ar: 'درس مجمَّد' }, startsAt: new Date('2026-01-01T10:00:00Z'), endsAt: new Date('2026-01-01T11:00:00Z') }, select: { id: true } });
    const frozenClass = await act(dLesson.id, 'cancel');
    expect(frozenClass.status).toBe(409);
    expect(frozenClass.body).toMatchObject({ code: 'class_closed', status: 'completed' });
    expect((await patch(dLesson.id, { title: { ar: 'x' } })).body.code).toBe('class_closed');
  });

  it('AC4 — a room or teacher double booking is 409 lesson_conflict naming the conflicting lesson; back-to-back is fine; cancel frees, restore re-checks, a move onto a conflict is refused', async () => {
    const held = await create(classes['A']!, lesson({ startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:30:00Z', roomId: roomA, teacherUserId: id('teacher2') }));
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const heldId = held.body.id as string;
    const m = await mark();
    const room = await create(classes['B']!, lesson({ startsAt: '2026-12-01T11:00:00Z', endsAt: '2026-12-01T12:00:00Z', roomId: roomA, teacherUserId: null }));
    expect(room.status).toBe(409);
    expect(room.body).toMatchObject({ code: 'lesson_conflict', resource: 'room', conflictingLessonId: heldId, conflictingClassId: classes['A'] });
    const teacher = await create(classes['B']!, lesson({ startsAt: '2026-12-01T11:00:00Z', endsAt: '2026-12-01T12:00:00Z', roomId: roomB, teacherUserId: id('teacher2') }));
    expect(teacher.status).toBe(409);
    expect(teacher.body).toMatchObject({ code: 'lesson_conflict', resource: 'teacher', conflictingLessonId: heldId, conflictingClassId: classes['A'] });
    expect(await eventsSince(m)).toEqual([]);

    const adjacent = await create(classes['B']!, lesson({ startsAt: '2026-12-01T11:30:00Z', endsAt: '2026-12-01T12:30:00Z', roomId: roomA, teacherUserId: id('teacher2') }));
    expect(adjacent.status, JSON.stringify(adjacent.body)).toBe(201);
    const moved = await patch(adjacent.body.id as string, { startsAt: '2026-12-01T11:00:00Z' });
    expect(moved.status).toBe(409);
    expect(moved.body).toMatchObject({ code: 'lesson_conflict', resource: 'room', conflictingLessonId: heldId });

    await act(heldId, 'cancel').expect(200);
    const freed = await create(classes['B']!, lesson({ startsAt: '2026-12-01T10:30:00Z', endsAt: '2026-12-01T11:00:00Z', roomId: roomA, teacherUserId: id('teacher2') }));
    expect(freed.status, JSON.stringify(freed.body)).toBe(201);
    const restore = await act(heldId, 'restore');
    expect(restore.status).toBe(409);
    expect(restore.body).toMatchObject({ code: 'lesson_conflict', conflictingLessonId: freed.body.id, conflictingClassId: classes['B'] });
    expect((await get(heldId).expect(200)).body.status).toBe('cancelled');
  });

  it('AC5 — only a scheduled lesson without attendance is deleted; the others are 409 lesson_not_deletable; deleting a planned class counts its lessons', async () => {
    const victim = await create(classes['A']!, lesson({ startsAt: '2026-11-15T10:00:00Z', endsAt: '2026-11-15T11:00:00Z' }));
    expect(victim.status).toBe(201);
    const victimId = victim.body.id as string;
    const m = await mark();
    await api().delete(`${LESSONS}/${victimId}`).set(bearer('teacher')).expect(204);
    expect((await get(victimId)).status).toBe(404);
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['lessons.deleted', victimId, { classId: classes['A'], code: code('A'), startsAt: '2026-11-15T10:00:00.000Z' }],
    ]);

    const withAttendance = await create(classes['A']!, lesson({ startsAt: '2026-11-16T10:00:00Z', endsAt: '2026-11-16T11:00:00Z' }));
    await prisma.attendanceRecord.create({ data: { lessonId: withAttendance.body.id as string, studentUserId: id('student'), status: 'present' } });
    const m2 = await mark();
    const refused = await api().delete(`${LESSONS}/${withAttendance.body.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'lesson_not_deletable', status: 'scheduled', attendanceCount: 1 });
    expect((await get(withAttendance.body.id as string).expect(200)).body.attendance).toEqual({ recorded: 1, present: 1, absent: 0, late: 0, excused: 0 });
    const completed = await api().delete(`${LESSONS}/${id('pastLesson')}`).set(bearer('manager'));
    expect(completed.status).toBe(409);
    expect(completed.body).toMatchObject({ code: 'lesson_not_deletable', status: 'completed', attendanceCount: 0 });
    expect((await api().delete(`${LESSONS}/${NIL_ID}`).set(bearer('manager'))).status).toBe(404);
    expect(await eventsSince(m2)).toEqual([]);

    // Deleting a planned class takes its lessons with it, and says so (API-055).
    await create(classes['C']!, lesson({ startsAt: '2026-11-17T10:00:00Z', endsAt: '2026-11-17T11:00:00Z' })).expect(201);
    await create(classes['C']!, lesson({ startsAt: '2026-11-18T10:00:00Z', endsAt: '2026-11-18T11:00:00Z' })).expect(201);
    const m3 = await mark();
    await api().delete(`${CLASSES}/${classes['C']}`).set(bearer('manager')).expect(204);
    const deleted = (await eventsSince(m3)).filter((event) => event.action === 'classes.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.metadata).toEqual({ code: code('C'), deletedLessons: 2 });
    expect(await prisma.lesson.count({ where: { classId: classes['C'] } })).toBe(0);
    delete classes['C'];
  });

  it('AC6 — PATCH writes the smallest diff with one event, an identical body writes nothing, null clears, {} is 400', async () => {
    const created = await create(classes['A']!, lesson({ startsAt: '2026-11-20T10:00:00Z', endsAt: '2026-11-20T11:00:00Z', description: { ar: 'وصف' }, meetingUrl: 'https://meet.example.com/p', roomId: roomB }));
    expect(created.status).toBe(201);
    const lessonId = created.body.id as string;
    const m = await mark();
    const same = await patch(lessonId, { title: { ar: 'درس' }, startsAt: '2026-11-20T13:00:00+03:00', roomId: roomB, description: { ar: 'وصف' } });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body).toEqual(created.body);
    expect(await eventsSince(m)).toEqual([]);

    const changed = await patch(lessonId, { endsAt: '2026-11-20T11:30:00Z', description: null, meetingUrl: null, roomId: null, syllabusItemId: itemA2, deliveryMode: 'hybrid' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).toMatchObject({ endsAt: '2026-11-20T11:30:00.000Z', description: null, meetingUrl: null, room: null, syllabusItem: { id: itemA2, sortOrder: 2 }, deliveryMode: 'hybrid' });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([
      ['lessons.updated', { classId: classes['A'], code: code('A'), fields: ['description', 'deliveryMode', 'endsAt', 'roomId', 'syllabusItemId', 'meetingUrl'] }],
    ]);

    const m2 = await mark();
    expect((await patch(lessonId, {})).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await patch(lessonId, { startsAt: '2026-11-20T12:00:00Z' })).body).toMatchObject({ code: 'time_range_invalid' });
    expect((await patch(lessonId, { teacherUserId: id('teacher2') })).status).toBe(200); // the assistant of A (the lead was the default)
    const m3 = await mark();
    const badTeacher = await patch(lessonId, { teacherUserId: NIL_ID });
    expect(badTeacher.status).toBe(422);
    expect(badTeacher.body.code).toBe('teacher_not_assigned');
    expect((await patch(lessonId, { syllabusItemId: itemOther })).body.code).toBe('syllabus_item_mismatch');
    expect((await patch(lessonId, { roomId: roomInactive })).body.code).toBe('room_inactive');
    for (const body of [{ title: null }, { startsAt: null }, { deliveryMode: null }, { endsAt: '2026-11-20' }, { meetingUrl: 'ftp://x' }, { color: 'red' }, { status: 'completed' }]) {
      expect((await patch(lessonId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await eventsSince(m3)).toEqual([]);
    expect((await eventsSince(m2)).map((event) => event.action)).toEqual(['lessons.updated']);
  });

  it('AC7 — the list filters by class, teacher, status and instants, and pages by start time then id', async () => {
    const a = classes['A']!;
    const all = ours((await list({ classId: a }).expect(200)).body.items);
    expect(all.length).toBeGreaterThanOrEqual(6);
    const starts = all.map((entry) => entry.startsAt);
    expect([...starts].sort()).toEqual(starts);
    expect(ours((await list({ classId: a, status: 'completed' }).expect(200)).body.items).map((entry) => entry.id)).toEqual([id('pastLesson')]);
    expect(ours((await list({ classId: a, teacherId: id('teacher2') }).expect(200)).body.items).every((entry) => entry.teacher?.userId === id('teacher2'))).toBe(true);
    const window = ours((await list({ classId: a, from: '2026-11-10T00:00:00Z', to: '2026-11-11T23:59:59Z' }).expect(200)).body.items);
    expect(window.map((entry) => entry.startsAt)).toEqual(['2026-11-10T10:00:00.000Z', '2026-11-11T10:00:00.000Z']);
    expect(ours((await list({ classId: a, order: 'desc', limit: '1' }).expect(200)).body.items)[0]!.startsAt).toBe(starts.at(-1));

    // Keyset: pages of 2 reproduce the full order and stop with a null cursor.
    const paged: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await list({ classId: a, limit: '2', ...(cursor ? { cursor } : {}) }).expect(200);
      paged.push(...(res.body.items as LessonBody[]).map((entry) => entry.id));
      cursor = res.body.nextCursor as string | null;
      if (cursor === null) break;
    }
    expect(paged).toEqual(all.map((entry) => entry.id));
    expect((await list({ cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
    const badQueries: Record<string, string>[] = [{ from: '2026-11-10' }, { status: 'done' }, { limit: '0' }, { order: 'sideways' }, { classId: 'x' }, { weekday: '1' }];
    for (const query of badQueries) {
      expect((await list(query)).status, JSON.stringify(query)).toBe(400);
    }
    expect(ours((await list({ classId: otherCourseId }).expect(200)).body.items)).toEqual([]);
  });

  it('D-R41 — timeZone is the room’s branch zone, else the academy’s, on create, read and list', async () => {
    const inBranch = await create(classes['A']!, lesson({ roomId: roomBranch, startsAt: '2026-11-20T10:00:00Z', endsAt: '2026-11-20T11:00:00Z' }));
    expect(inBranch.status, JSON.stringify(inBranch.body)).toBe(201);
    expect((inBranch.body as LessonBody).timeZone).toBe('Europe/Berlin');
    const noRoom = await create(classes['A']!, lesson({ startsAt: '2026-11-20T12:00:00Z', endsAt: '2026-11-20T13:00:00Z' }));
    expect(noRoom.status, JSON.stringify(noRoom.body)).toBe(201);
    expect((noRoom.body as LessonBody).timeZone).toBe(academyTimeZone);
    expect(((await get(inBranch.body.id).expect(200)).body as LessonBody).timeZone).toBe('Europe/Berlin');
    const listed = ours((await list({ classId: classes['A']!, from: '2026-11-20T00:00:00Z' }).expect(200)).body.items);
    const zones = new Map(listed.map((entry) => [entry.id, entry.timeZone]));
    expect([zones.get(inBranch.body.id), zones.get(noRoom.body.id)]).toEqual(['Europe/Berlin', academyTimeZone]);
    expect((await api().get('/api/docs-json').expect(200)).body.components.schemas.LessonDto.properties.timeZone).toMatchObject({ type: 'string' });
  }, 20_000);

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/lessons'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/lessons']).sort()).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/lessons/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(docs.body.paths['/api/lessons/{id}/status'])).toEqual(['post']);
      for (const schema of ['LessonDto', 'LessonListDto', 'CreateLessonDto', 'UpdateLessonDto', 'ChangeLessonStatusDto', 'AttendanceCountsDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
      expect(docs.body.components.schemas.LessonDto.properties.cancellationReason).toMatchObject({ type: 'string', nullable: true });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
