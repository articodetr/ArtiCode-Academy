// TEST-167 — MOD-13-T01 attendance reports (API-156/157; roadmap §4k, D-R66..D-R73)
// against the live development database. Skipped when no database is reachable.
// The suite builds its own course, two classes, students, lessons and attendance
// records straight through Prisma (codes carry a unique tag), reads the reports
// filtered by its own course so other rows of the shared dev DB never count, and
// deletes everything at the end. Fixture users/roles carry a unique suffix (their
// audit rows stay — KI-032); the reads must record no audit event at all.
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
import type { AttendanceStatus, LessonStatus } from '../src/generated/prisma/client.js';
import { addDays, zonedInstant } from '../src/schedule/lesson-generation.plan.js';
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAG = `RPA-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-167 supertest';
const CLASSES = '/api/reports/attendance/classes';
const STUDENTS = '/api/reports/attendance/students';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const FROM = '2025-03-01';
const TO = '2025-03-31';

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

describe.skipIf(!available)('MOD-13 attendance reports (e2e, TEST-167)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let zone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let courseId: string;
  let classA: string;
  let classB: string;

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const at = (date: string, time: string) => zonedInstant(date, time, zone);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[] = [], withPassword = true): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Report ${name} ${RUN}`,
        passwordHash: withPassword ? await passwords.hash(PASSWORD) : null,
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

  async function lesson(classId: string, date: string, time: string, status: LessonStatus, records: Record<string, AttendanceStatus> = {}, taken = Object.keys(records).length > 0): Promise<string> {
    const startsAt = at(date, time);
    const row = await prisma.lesson.create({
      data: {
        classId,
        title: { ar: `درس ${date} ${time}` },
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60_000),
        status,
        cancellationReason: status === 'cancelled' ? 'اختبار' : null,
        attendanceTakenAt: taken ? startsAt : null,
      },
      select: { id: true },
    });
    const entries = Object.entries(records);
    if (entries.length > 0) {
      await prisma.attendanceRecord.createMany({
        data: entries.map(([student, recordStatus]) => ({ lessonId: row.id, studentUserId: fx[student]!, status: recordStatus, minutesLate: recordStatus === 'late' ? 5 : null })),
      });
    }
    return row.id;
  }

  /** Id of the newest event (UUIDv7 = insertion order). */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    zone = (await prisma.academy.findFirst({ select: { timezone: true } }))?.timezone ?? 'UTC';

    await createUser('reporter', [await createRole('reporter', ['reports.attendance.view'])]);
    await createUser('outsider', [await createRole('outsider', ['courses.read'])]);
    for (const name of ['reporter', 'outsider']) tokens[name] = await login(email(name));
    for (const name of ['s1', 's2', 's3']) await createUser(name, [], false);

    courseId = (await prisma.course.create({ data: { code: TAG, name: { ar: `دورة ${TAG}` }, status: 'published' }, select: { id: true } })).id;
    classA = (await prisma.class.create({ data: { courseId, code: `${TAG}-A`, name: { ar: 'فصل أ' }, capacity: 20, status: 'running' }, select: { id: true } })).id;
    classB = (await prisma.class.create({ data: { courseId, code: `${TAG}-B`, name: { ar: 'فصل ب' }, capacity: 20, status: 'open' }, select: { id: true } })).id;
    await prisma.enrollment.createMany({
      data: [
        { classId: classA, studentUserId: fx['s1']!, status: 'active' },
        { classId: classA, studentUserId: fx['s2']!, status: 'active' },
        { classId: classA, studentUserId: fx['s3']!, status: 'withdrawn', withdrawnAt: new Date() },
        { classId: classB, studentUserId: fx['s1']!, status: 'active' },
      ],
    });

    // Class A — outside, on the first local minutes, completed without a sheet, cancelled, the last local hour, outside again.
    await lesson(classA, addDays(FROM, -1), '23:30', 'completed', { s1: 'absent' });
    await lesson(classA, FROM, '00:30', 'completed', { s1: 'present', s2: 'late', s3: 'absent' });
    await lesson(classA, '2025-03-10', '10:00', 'completed');
    await lesson(classA, '2025-03-15', '10:00', 'cancelled', { s1: 'absent' });
    await lesson(classA, TO, '23:00', 'scheduled', { s1: 'excused', s2: 'absent' });
    await lesson(classA, addDays(TO, 1), '00:10', 'scheduled', { s2: 'absent' });
    // Class B — one completed lesson with one absence.
    await lesson(classB, '2025-03-05', '10:00', 'completed', { s1: 'absent' });
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Enrollments hold their class (Restrict); a class takes its lessons and their records with it.
        await prisma.enrollment.deleteMany({ where: { class: { courseId } } });
        await prisma.class.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  const counts = (present: number, late: number, absent: number, excused: number) => ({ recorded: present + late + absent + excused, present, absent, late, excused });

  it('AC1 — only reports.attendance.view reads; 401 anonymously; nothing is audited', async () => {
    const m = await mark();
    await api().get(CLASSES).expect(401);
    for (const path of [CLASSES, STUDENTS]) {
      const denied = await api().get(`${path}?courseId=${courseId}`).set(bearer('outsider')).expect(403);
      expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['reports.attendance.view'] });
    }
    await api().get(`${CLASSES}?courseId=${courseId}&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    await api().get(`${STUDENTS}?courseId=${courseId}&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    const events = await prisma.auditLog.findMany({ where: { id: { gt: m }, actorUserId: { in: Object.values(fx) } } });
    expect(events.filter((event) => !event.action.startsWith('auth.'))).toEqual([]);
  });

  it('AC2 — by class: lessons, completed, recorded, completed without a sheet, records and the rate (excused and cancelled left out, the window in the academy’s days)', async () => {
    const res = await api().get(`${CLASSES}?courseId=${courseId}&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    expect(res.body).toMatchObject({ period: { from: FROM, to: TO }, timeZone: zone, truncated: false });
    expect(Number.isNaN(Date.parse(res.body.generatedAt))).toBe(false);
    expect(res.body.rows).toEqual([
      {
        class: { id: classA, code: `${TAG}-A`, name: { ar: 'فصل أ' }, status: 'running' },
        course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } },
        lessons: 3,
        completedLessons: 2,
        recordedLessons: 2,
        completedWithoutAttendance: 1,
        records: counts(1, 1, 2, 1),
        attendanceRate: 50,
      },
      {
        class: { id: classB, code: `${TAG}-B`, name: { ar: 'فصل ب' }, status: 'open' },
        course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } },
        lessons: 1,
        completedLessons: 1,
        recordedLessons: 1,
        completedWithoutAttendance: 0,
        records: counts(0, 0, 1, 0),
        attendanceRate: 0,
      },
    ]);
    expect(res.body.totals).toEqual({ classes: 2, lessons: 4, completedLessons: 3, recordedLessons: 3, completedWithoutAttendance: 1, records: counts(1, 1, 3, 1), attendanceRate: 40 });

    const onlyB = await api().get(`${CLASSES}?classId=${classB}&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    expect(onlyB.body.rows.map((row: { class: { id: string } }) => row.class.id)).toEqual([classB]);
    const running = await api().get(`${CLASSES}?courseId=${courseId}&classStatus=running&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    expect(running.body.rows.map((row: { class: { id: string } }) => row.class.id)).toEqual([classA]);
    // The first local day alone holds the 00:30 lesson and not the 23:30 lesson of the day before.
    const firstDay = await api().get(`${CLASSES}?courseId=${courseId}&from=${FROM}&to=${FROM}`).set(bearer('reporter')).expect(200);
    expect(firstDay.body.totals).toMatchObject({ lessons: 1, records: counts(1, 1, 1, 0) });
  });

  it('AC3 — by student × class: identity only, the enrollment now, both rates, most absences first; the two thresholds', async () => {
    const res = await api().get(`${STUDENTS}?courseId=${courseId}&from=${FROM}&to=${TO}`).set(bearer('reporter')).expect(200);
    const brief = (rows: { student: { id: string }; class: { id: string } }[]) => rows.map((row) => [row.student.id, row.class.id]);
    expect(brief(res.body.rows)).toEqual([
      [fx['s1'], classB],
      [fx['s3'], classA],
      [fx['s2'], classA],
      [fx['s1'], classA],
    ]);
    expect(res.body.rows[0]).toEqual({
      student: { id: fx['s1'], fullName: `Report s1 ${RUN}`, displayName: null },
      class: { id: classB, code: `${TAG}-B`, name: { ar: 'فصل ب' }, status: 'open' },
      course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } },
      enrollmentStatus: 'active',
      records: counts(0, 0, 1, 0),
      attendanceRate: 0,
      absenceRate: 100,
    });
    expect(res.body.rows[1]).toMatchObject({ enrollmentStatus: 'withdrawn', records: counts(0, 0, 1, 0), absenceRate: 100 });
    expect(res.body.rows[2]).toMatchObject({ records: counts(0, 1, 1, 0), attendanceRate: 50, absenceRate: 50 });
    expect(res.body.rows[3]).toMatchObject({ records: counts(1, 0, 0, 1), attendanceRate: 100, absenceRate: 0 });
    expect(res.body.totals).toEqual({ rows: 4, students: 3, records: counts(1, 1, 3, 1), attendanceRate: 40, absenceRate: 60 });
    for (const row of res.body.rows) expect(Object.keys(row.student).sort()).toEqual(['displayName', 'fullName', 'id']);

    const repeated = await api().get(`${STUDENTS}?courseId=${courseId}&from=${FROM}&to=${TO}&minAbsences=1`).set(bearer('reporter')).expect(200);
    expect(brief(repeated.body.rows)).toEqual([
      [fx['s1'], classB],
      [fx['s3'], classA],
      [fx['s2'], classA],
    ]);
    expect(repeated.body.totals).toMatchObject({ rows: 3, students: 3 });
    const high = await api().get(`${STUDENTS}?courseId=${courseId}&from=${FROM}&to=${TO}&minAbsenceRate=60`).set(bearer('reporter')).expect(200);
    expect(brief(high.body.rows)).toEqual([
      [fx['s1'], classB],
      [fx['s3'], classA],
    ]);
    expect(high.body.totals).toMatchObject({ rows: 2, students: 2, records: counts(0, 0, 2, 0) });
  });

  it('AC4 — the default period is the last 30 days in the academy’s zone; a reversed or too long period is report_range_invalid; bad parameters are 400', async () => {
    const today = calendarDateIn(zone);
    const defaults = await api().get(`${CLASSES}?courseId=${courseId}`).set(bearer('reporter')).expect(200);
    expect(defaults.body.period).toEqual({ from: addDays(today, -29), to: today });
    expect(defaults.body.rows).toEqual([]);

    for (const query of [`from=2025-03-10&to=${FROM}`, `from=2024-01-01&to=${FROM}`]) {
      const res = await api().get(`${CLASSES}?${query}`).set(bearer('reporter')).expect(400);
      expect(res.body, query).toMatchObject({ code: 'report_range_invalid', maxDays: 366 });
    }
    for (const query of ['from=2025-02-30', 'to=2025-3-1', 'courseId=nope', 'classStatus=closed', 'extra=1']) {
      expect((await api().get(`${CLASSES}?${query}`).set(bearer('reporter'))).status, query).toBe(400);
    }
    for (const query of ['minAbsences=0', 'minAbsences=1.5', 'minAbsenceRate=101', 'minAbsenceRate=12.345', 'minAbsenceRate=1e-7']) {
      expect((await api().get(`${STUDENTS}?${query}`).set(bearer('reporter'))).status, query).toBe(400);
    }
  });

  it(
    'documents both routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths[CLASSES])).toEqual(['get']);
      expect(Object.keys(docs.body.paths[STUDENTS])).toEqual(['get']);
      expect(docs.body.components.schemas).toHaveProperty('AttendanceClassesReportDto');
      expect(docs.body.components.schemas).toHaveProperty('AttendanceStudentsReportDto');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
