// TEST-078 — MOD-06-T03 attendance (API-099 GET and API-100 PUT
// /api/lessons/:id/attendance) against the live development database.
// Skipped when no database is reachable. Fixture users (two holding the
// system `teacher` role, five holding `student`), roles, a published course,
// classes, enrollments and lessons carry a unique prefix and are deleted at
// the end — classes first (lessons and attendance cascade; enrollments are
// deleted explicitly because their class relation is Restrict), then the
// course. Audit events are counted by fixture actor above an id watermark.
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
const PREFIX = `T${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-078 supertest';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SHEET_KEYS = ['attendanceTakenAt', 'classId', 'closedReason', 'counts', 'endsAt', 'items', 'lessonId', 'lessonStatus', 'recordable', 'startsAt'];
const ZERO = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 };

interface RecordBody {
  status: string;
  minutesLate: number | null;
  note: string | null;
  recordedBy: { userId: string; fullName: string } | null;
  recordedAt: string;
  updatedAt: string;
}

interface ItemBody {
  student: { id: string; fullName: string; email: string | null; username: string | null; phone: string | null; deletedAt: string | null };
  enrollmentStatus: string | null;
  record: RecordBody | null;
}

interface SheetBody {
  lessonId: string;
  classId: string;
  lessonStatus: string;
  startsAt: string;
  endsAt: string;
  attendanceTakenAt: string | null;
  recordable: boolean;
  closedReason: string | null;
  counts: typeof ZERO;
  items: ItemBody[];
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

describe.skipIf(!available)('MOD-06 attendance (e2e, TEST-078)', () => {
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
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const sheet = (lesson: string, as = 'manager') => api().get(`${LESSONS}/${lessons[lesson] ?? lesson}/attendance`).set(bearer(as));
  const put = (lesson: string, records: unknown, as = 'teacher') => api().put(`${LESSONS}/${lessons[lesson] ?? lesson}/attendance`).set(bearer(as)).send({ records });
  const rec = (student: string, status: string, extra: Record<string, unknown> = {}) => ({ studentId: id(student), status, ...extra });
  const itemOf = (body: SheetBody, student: string) => body.items.find((item) => item.student.id === id(student));

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

  async function enroll(suffix: string, student: string): Promise<void> {
    const res = await api().post(`${CLASSES}/${classes[suffix]}/enrollments`).set(bearer('manager')).send({ studentId: id(student) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    enrollments[`${suffix}:${student}`] = res.body.id as string;
  }

  async function createLesson(name: string, suffix: string, day: string): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes[suffix]}/lessons`)
      .set(bearer('manager'))
      .send({ title: { ar: `درس ${name}` }, startsAt: `${day}T10:00:00Z`, endsAt: `${day}T11:30:00Z` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    lessons[name] = res.body.id as string;
  }

  /** Sessions of this database waiting on a lock (the API and this client share the app role, so they are visible). */
  async function lockWaiters(): Promise<number> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return rows[0]?.n ?? 0;
  }

  /** Runs `requests` while another transaction holds `FOR UPDATE` on the lesson row, released once `waiters` sessions wait (or after 3 s). */
  async function withLessonRowHeld<T>(lessonId: string, waiters: number, requests: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const lockTaken = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${lessonId}::uuid FOR UPDATE`;
        held();
        await released;
      },
      { timeout: 10_000 },
    );
    await lockTaken;
    const pending = requests();
    const deadline = Date.now() + 3000;
    while ((await lockWaiters()) < waiters && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    await holder;
    return pending;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الحضور' }, status: 'published' }, select: { id: true } })).id;
    const teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;
    const studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    const manager = await createRole('amanager', [
      'classes.read',
      'classes.manage',
      'classes.teachers.assign',
      'lessons.read',
      'lessons.manage',
      'enrollments.manage',
      'attendance.read',
      'attendance.record',
      'users.read_contact',
    ]);
    const teaching = await createRole('ateacher', ['classes.read', 'lessons.read', 'lessons.manage', 'attendance.read', 'attendance.record']);
    const staff = await createRole('astaff', ['classes.read', 'classes.manage', 'lessons.read', 'attendance.read']);
    const watcher = await createRole('awatcher', ['attendance.read', 'attendance.record']);
    const nokey = await createRole('anokey', ['classes.read', 'lessons.read', 'lessons.manage']);
    await createUser('manager', [manager]);
    await createUser('teacher', [teaching, teacherRoleId]);
    await createUser('teacher2', [teaching, teacherRoleId]);
    await createUser('staff', [staff]);
    await createUser('watcher', [watcher]);
    await createUser('nokey', [nokey]);
    for (const student of ['s1', 's2', 's3', 's4', 's5']) await createUser(student, [studentRoleId], false);

    await createClass('A', [id('teacher'), id('teacher2')], ['open']);
    await createClass('B', [id('teacher2')], ['open']);
    await createClass('D', [id('teacher')], ['open', 'start']);
    await createClass('X', [id('teacher')], ['open']);
    for (const student of ['s1', 's2', 's3']) await enroll('A', student);
    await enroll('B', 's5');
    await enroll('D', 's1');
    await createLesson('L1', 'A', '2026-01-10'); // started
    await createLesson('L2', 'A', '2027-06-01'); // in the future
    await createLesson('L3', 'A', '2026-01-11'); // cancelled below
    await createLesson('L4', 'A', '2026-01-12'); // the race
    await createLesson('LB', 'B', '2026-01-10');
    await createLesson('LD', 'D', '2026-01-13'); // class completed below
    await createLesson('LX', 'X', '2026-01-14'); // class cancelled below
    await api().post(`${LESSONS}/${lessons['L3']}/status`).set(bearer('manager')).send({ action: 'cancel', reason: 'عطلة' }).expect(200);
    await api().post(`${CLASSES}/${classes['D']}/status`).set(bearer('manager')).send({ action: 'complete' }).expect(200);
    await api().post(`${CLASSES}/${classes['X']}/status`).set(bearer('manager')).send({ action: 'cancel' }).expect(200);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const classIds = Object.values(classes);
        await prisma.enrollment.deleteMany({ where: { classId: { in: classIds } } });
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

  it('AC1 — the sheet lists the enrolled students in enrollment order with the caller’s projection; assigned teachers and classes.manage see it, others are 404, no key is 403, staff cannot write, anonymous 401', async () => {
    const res = await sheet('L1', 'teacher2');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as SheetBody;
    expect(Object.keys(body).sort()).toEqual(SHEET_KEYS);
    expect(body).toMatchObject({
      lessonId: lessons['L1'],
      classId: classes['A'],
      lessonStatus: 'scheduled',
      startsAt: '2026-01-10T10:00:00.000Z',
      endsAt: '2026-01-10T11:30:00.000Z',
      attendanceTakenAt: null,
      recordable: true,
      closedReason: null,
      counts: ZERO,
    });
    expect(body.items.map((item) => item.student.id)).toEqual([id('s1'), id('s2'), id('s3')]);
    expect(body.items[0]).toEqual({
      student: { id: id('s1'), fullName: 'Test s1', fullNameLatin: null, displayName: null, avatarUrl: null, status: 'active', email: null, username: null, phone: null, deletedAt: null },
      enrollmentStatus: 'active',
      record: null,
    });
    expect(keysDeep(body).some((key) => /hash|password/i.test(key))).toBe(false);
    // The manager holds users.read_contact: the full projection.
    const full = (await sheet('L1', 'manager').expect(200)).body as SheetBody;
    expect(full.items[0]!.student.email).toBe(email('s1'));
    expect((await sheet('LB', 'teacher2').expect(200)).body.items.map((item: ItemBody) => item.student.id)).toEqual([id('s5')]);
    expect((await sheet('L1', 'staff')).status).toBe(200);
    expect((await put('L1', [rec('s1', 'present')], 'staff')).status).toBe(403);
    expect((await sheet('L1', 'nokey')).status).toBe(403);
    expect((await put('L1', [rec('s1', 'present')], 'nokey')).status).toBe(403);
    // attendance keys without an assignment or classes.manage: the lesson is invisible (404, not 403) — the seeded guardian is in this position.
    const invisible = await sheet('L1', 'watcher');
    expect(invisible.status).toBe(404);
    expect(invisible.body).toMatchObject({ code: 'lesson_not_found', lessonId: lessons['L1'] });
    expect((await put('L1', [rec('s1', 'present')], 'watcher')).status).toBe(404);
    expect((await sheet('LB', 'teacher')).status).toBe(404); // not assigned to B
    expect((await put('LB', [rec('s5', 'present')], 'teacher')).status).toBe(404);
    await api().get(`${LESSONS}/${lessons['L1']}/attendance`).expect(401);
    await api().put(`${LESSONS}/${lessons['L1']}/attendance`).send({ records: [rec('s1', 'present')] }).expect(401);
    expect((await sheet(NIL_ID)).status).toBe(404);
    expect((await api().get(`${LESSONS}/not-a-uuid/attendance`).set(bearer('manager'))).status).toBe(400);
  });

  it('AC2 — a lesson not yet started or cancelled is 409 attendance_closed with its reason, a cancelled class is 409 class_closed, a completed class stays open for corrections; the sheet says why', async () => {
    const m = await mark();
    const early = await put('L2', [rec('s1', 'present')]);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'attendance_closed', reason: 'not_started', startsAt: '2027-06-01T10:00:00.000Z' });
    expect((await sheet('L2', 'teacher').expect(200)).body).toMatchObject({ recordable: false, closedReason: 'not_started', lessonStatus: 'scheduled' });
    const cancelled = await put('L3', [rec('s1', 'present')]);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toMatchObject({ code: 'attendance_closed', reason: 'cancelled', startsAt: '2026-01-11T10:00:00.000Z' });
    expect((await sheet('L3', 'teacher').expect(200)).body).toMatchObject({ recordable: false, closedReason: 'cancelled', lessonStatus: 'cancelled' });
    const frozen = await put('LX', [rec('s1', 'present')]);
    expect(frozen.status).toBe(409);
    expect(frozen.body).toMatchObject({ code: 'class_closed', classId: classes['X'], status: 'cancelled' });
    expect((await sheet('LX', 'teacher').expect(200)).body).toMatchObject({ recordable: false, closedReason: 'class_cancelled', items: [] });
    expect(await eventsSince(m)).toEqual([]);

    // D is completed: its lesson accepts attendance (D-R33 (1) — corrections after the last session), and completing
    // the class completed s1's enrollment (MOD-05), which stays recordable (D-R33 (6)).
    const correction = await put('LD', [rec('s1', 'excused', { note: 'عذر طبي' })]);
    expect(correction.status, JSON.stringify(correction.body)).toBe(200);
    expect(correction.body).toMatchObject({ recordable: true, closedReason: null, counts: { ...ZERO, recorded: 1, excused: 1 } });
    expect(itemOf(correction.body as SheetBody, 's1')).toMatchObject({ enrollmentStatus: 'completed', record: { status: 'excused', minutesLate: null, note: 'عذر طبي' } });
    expect((await eventsSince(m)).map((event) => [event.action, event.entityType, event.entityId])).toEqual([['attendance.recorded', 'lessons', lessons['LD']]]);
  });

  it('AC3 — a student without an active or completed enrollment refuses the whole batch (422 not_enrolled, nothing written); repeated students, minutes outside late, bad bodies are 400; nothing is recorded', async () => {
    const m = await mark();
    const foreign = await put('L1', [rec('s1', 'present'), rec('s4', 'absent'), rec('s5', 'present')]);
    expect(foreign.status).toBe(422);
    expect(foreign.body).toMatchObject({ code: 'not_enrolled', studentIds: [id('s4'), id('s5')] });
    expect(await prisma.attendanceRecord.count({ where: { lessonId: lessons['L1'] } })).toBe(0);
    const bad: unknown[] = [
      [rec('s1', 'present'), rec('s1', 'absent')], // repeated
      [],
      [rec('s1', 'present', { minutesLate: 5 })], // minutes without late
      [rec('s1', 'late', { minutesLate: 0 })],
      [rec('s1', 'late', { minutesLate: 721 })],
      [rec('s1', 'late', { minutesLate: '5' })],
      [rec('s1', 'late', { minutesLate: 5.5 })],
      [rec('s1', 'present', { note: 'ن'.repeat(501) })],
      [rec('s1', 'present', { color: 'red' })],
      [rec('s1', 'here')],
      [{ studentId: 'not-a-uuid', status: 'present' }],
      [{ status: 'present' }],
      'present',
      Array.from({ length: 501 }, (_, index) => ({ studentId: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, status: 'present' })),
    ];
    for (const records of bad) {
      expect((await put('L1', records)).status, JSON.stringify(records).slice(0, 80)).toBe(400);
    }
    expect((await api().put(`${LESSONS}/${lessons['L1']}/attendance`).set(bearer('teacher')).send({})).status).toBe(400);
    expect((await api().put(`${LESSONS}/${lessons['L1']}/attendance`).set(bearer('teacher')).send({ records: [rec('s1', 'present')], extra: 1 })).status).toBe(400);
    expect((await put(NIL_ID, [rec('s1', 'present')])).status).toBe(404);
    expect(await eventsSince(m)).toEqual([]);
    expect(await prisma.attendanceRecord.count({ where: { lessonId: lessons['L1'] } })).toBe(0);
  });

  it('AC4 — the first batch creates the records, stamps attendanceTakenAt and records one event; an identical batch writes nothing; a correction updates the whole record and names its writer', async () => {
    const m = await mark();
    const first = await put('L1', [rec('s1', 'present', { note: '   ' }), rec('s2', 'late', { minutesLate: 7, note: 'تأخر بسبب المواصلات' }), rec('s3', 'absent')]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const body = first.body as SheetBody;
    expect(body.attendanceTakenAt).not.toBeNull();
    expect(body.counts).toEqual({ recorded: 3, present: 1, absent: 1, late: 1, excused: 0 });
    expect(itemOf(body, 's1')!.record).toMatchObject({ status: 'present', minutesLate: null, note: null, recordedBy: { userId: id('teacher'), fullName: 'Test teacher' } });
    expect(itemOf(body, 's2')!.record).toMatchObject({ status: 'late', minutesLate: 7, note: 'تأخر بسبب المواصلات', recordedBy: { userId: id('teacher') } });
    expect(itemOf(body, 's3')!.record).toMatchObject({ status: 'absent', minutesLate: null, note: null });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['attendance.recorded', 'lessons', lessons['L1'], { classId: classes['A'], code: code('A'), created: 3, updated: 0, counts: { recorded: 3, present: 1, absent: 1, late: 1, excused: 0 } }],
    ]);
    // The lesson itself shows the counts and the stamp (API-094).
    const lesson = (await api().get(`${LESSONS}/${lessons['L1']}`).set(bearer('teacher')).expect(200)).body;
    expect(lesson).toMatchObject({ attendanceTakenAt: body.attendanceTakenAt, attendance: { recorded: 3, present: 1, absent: 1, late: 1, excused: 0 } });

    // The same values again — by another writer, with surrounding spaces — write nothing.
    const m2 = await mark();
    const same = await put('L1', [rec('s2', 'late', { minutesLate: 7, note: '  تأخر بسبب المواصلات ' }), rec('s1', 'present'), rec('s3', 'absent', { note: null, minutesLate: null })], 'teacher2');
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body).toEqual(body);
    expect(await eventsSince(m2)).toEqual([]);

    // A correction: s2 becomes present — the whole record is replaced (minutes and note cleared), the others stay, the writer is the corrector.
    const before = itemOf(body, 's2')!.record!;
    const corrected = await put('L1', [rec('s2', 'present')], 'teacher2');
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    const after = corrected.body as SheetBody;
    expect(after.attendanceTakenAt).toBe(body.attendanceTakenAt);
    expect(after.counts).toEqual({ recorded: 3, present: 2, absent: 1, late: 0, excused: 0 });
    expect(itemOf(after, 's2')!.record).toMatchObject({ status: 'present', minutesLate: null, note: null, recordedBy: { userId: id('teacher2'), fullName: 'Test teacher2' }, recordedAt: before.recordedAt });
    expect(Date.parse(itemOf(after, 's2')!.record!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
    expect(itemOf(after, 's1')!.record).toEqual(itemOf(body, 's1')!.record);
    expect(itemOf(after, 's3')!.record).toEqual(itemOf(body, 's3')!.record);
    expect((await eventsSince(m2)).map((event) => event.metadata)).toEqual([
      { classId: classes['A'], code: code('A'), created: 0, updated: 1, counts: { recorded: 3, present: 2, absent: 1, late: 0, excused: 0 } },
    ]);
  });

  it('AC5 — two concurrent batches for one lesson serialise on the lesson row: no duplicate row, none lost, one event each', async () => {
    const m = await mark();
    const batchA = [rec('s1', 'present'), rec('s2', 'absent')];
    const batchB = [rec('s1', 'late', { minutesLate: 3 }), rec('s2', 'present')];
    const [resA, resB] = await withLessonRowHeld(lessons['L4']!, 2, () => Promise.all([put('L4', batchA, 'teacher'), put('L4', batchB, 'teacher2')]));
    expect(resA.status, JSON.stringify(resA.body)).toBe(200);
    expect(resB.status, JSON.stringify(resB.body)).toBe(200);
    const rows = await prisma.attendanceRecord.findMany({ where: { lessonId: lessons['L4'] }, orderBy: { studentUserId: 'asc' }, select: { studentUserId: true, status: true, minutesLate: true } });
    expect(rows).toHaveLength(2);
    const state = Object.fromEntries(rows.map((row) => [row.studentUserId, `${row.status}:${row.minutesLate}`]));
    const asA = { [id('s1')]: 'present:null', [id('s2')]: 'absent:null' };
    const asB = { [id('s1')]: 'late:3', [id('s2')]: 'present:null' };
    expect([asA, asB]).toContainEqual(state); // one batch wholly after the other, never interleaved
    const events = (await eventsSince(m)).filter((event) => event.entityId === lessons['L4']);
    const counts = (event: { metadata: unknown }) => {
      const metadata = event.metadata as Record<string, unknown>;
      return [metadata['created'], metadata['updated']];
    };
    expect(events.map(counts).sort()).toEqual([
      [0, 2],
      [2, 0],
    ]);
    expect((await sheet('L4', 'teacher').expect(200)).body.counts.recorded).toBe(2);
  });

  it('AC6 — a student withdrawn after the lesson keeps their record on the sheet, can no longer be recorded, and is not listed on lessons where they have no record', async () => {
    await api().post(`/api/enrollments/${enrollments['A:s3']}/status`).set(bearer('manager')).send({ action: 'withdraw', reason: 'انتقال' }).expect(200);
    const body = (await sheet('L1', 'teacher').expect(200)).body as SheetBody;
    expect(itemOf(body, 's3')).toMatchObject({ enrollmentStatus: 'withdrawn', record: { status: 'absent' } });
    expect(body.items.map((item) => item.student.id)).toEqual([id('s1'), id('s2'), id('s3')]);
    expect(body.counts.recorded).toBe(3);
    const m = await mark();
    const refused = await put('L1', [rec('s3', 'present')]);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'not_enrolled', studentIds: [id('s3')] });
    expect(await eventsSince(m)).toEqual([]);
    expect((await sheet('L2', 'teacher').expect(200)).body.items.map((item: ItemBody) => item.student.id)).toEqual([id('s1'), id('s2')]);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/lessons/{id}/attendance']).sort()).toEqual(['get', 'put']);
      for (const schema of ['AttendanceSheetDto', 'AttendanceItemDto', 'AttendanceRecordDto', 'RecordAttendanceDto', 'AttendanceRecordInputDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
      expect(docs.body.components.schemas.AttendanceRecordInputDto.properties.minutesLate).toMatchObject({ type: 'number', nullable: true, minimum: 1, maximum: 720 });
      expect(docs.body.components.schemas.AttendanceSheetDto.properties.closedReason).toMatchObject({ nullable: true, enum: ['class_cancelled', 'cancelled', 'not_started'] });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
