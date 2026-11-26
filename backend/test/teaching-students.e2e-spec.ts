// TEST-330 — «طلابي» for a teacher (CH-0370, API-301/302) against the live
// development database. Skipped when no database is reachable. Fixtures carry a
// unique prefix and are deleted at the end. A teacher sees only the students of
// the classes they teach, with contact fields, guardians, the attendance of
// each started lesson and the student's row of the class gradebook (the same
// numbers as API-126); another student is 404; reading records no audit event.
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
const PREFIX = `TS${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-330 supertest';
const STUDENTS = '/api/teaching/students';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const HOUR = 3_600_000;

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

interface ListItem {
  student: { id: string; fullName: string; email: string | null; phone: string | null };
  classes: { enrollmentStatus: string; class: { id: string; code: string } }[];
  attendance: { present: number; late: number; absent: number; excused: number; rate: number | null } | null;
}

describe.skipIf(!available)('«طلابي» — a teacher’s students (e2e, TEST-330)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  let courseId: string;

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const list = (query: Record<string, string> = {}, as = 'teacher') => api().get(STUDENTS).query(query).set(bearer(as));
  const ours = (items: ListItem[]) => items.filter((item) => createdUserIds.includes(item.student.id));

  async function createUser(name: string, roleKeys: string[], extraRoleIds: string[] = [], login = false, phone: string | null = null): Promise<void> {
    const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true } });
    const user = await prisma.user.create({
      data: {
        email: email(name),
        phone,
        fullName: `${PREFIX} ${name}`,
        passwordHash: login ? await passwords.hash(PASSWORD) : null,
        status: 'active',
        roles: { create: [...roles.map((role) => role.id), ...extraRoleIds].map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    if (login) {
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
    }
  }

  async function createClass(suffix: string, teachers: [string, 'lead' | 'assistant'][], students: [string, 'active' | 'completed' | 'withdrawn'][]): Promise<void> {
    const klass = await prisma.class.create({ data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10, status: 'running' }, select: { id: true } });
    classes[suffix] = klass.id;
    for (const [teacher, role] of teachers) await prisma.classTeacher.create({ data: { classId: klass.id, teacherUserId: id(teacher), role }, select: { classId: true } });
    for (const [student, status] of students) await prisma.enrollment.create({ data: { classId: klass.id, studentUserId: id(student), status }, select: { id: true } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة طلابي' }, status: 'published' }, select: { id: true } })).id;
    const outsiderRole = await prisma.role.create({ data: { key: `test_ts_out_${RUN.toLowerCase()}`, label: { ar: 'دور بلا تسجيلات' }, permissions: { create: [{ permissionKey: 'courses.read' }] } }, select: { id: true } });
    createdRoleIds.push(outsiderRole.id);

    await createUser('teacher', ['teacher'], [], true);
    await createUser('other', ['teacher'], [], true);
    await createUser('outsider', [], [outsiderRole.id], true);
    await createUser('ahmed', ['student'], [], false, '+90 555 000 1111');
    await createUser('mona', ['student']);
    await createUser('omar', ['student']);
    await createUser('father', ['guardian'], [], false, '+90 555 000 2222');
    await prisma.guardianStudent.create({ data: { guardianUserId: id('father'), studentUserId: id('ahmed'), relationship: 'father', isPrimary: true } });

    // A: taught by «teacher» (lead) — ahmed active, mona withdrawn. B: «teacher» assists — ahmed active. C: another teacher's — omar.
    await createClass('A', [['teacher', 'lead']], [['ahmed', 'active'], ['mona', 'withdrawn']]);
    await createClass('B', [['other', 'lead'], ['teacher', 'assistant']], [['ahmed', 'active']]);
    await createClass('C', [['other', 'lead']], [['omar', 'active']]);

    // Three started lessons of A (present, late, absent for ahmed), one cancelled and one in the future (both left out).
    const now = Date.now();
    const lessonOf = async (hoursAgo: number, status: 'scheduled' | 'cancelled' = 'scheduled') =>
      (
        await prisma.lesson.create({
          data: { classId: classes['A']!, title: { ar: `درس ${hoursAgo}` }, startsAt: new Date(now - hoursAgo * HOUR), endsAt: new Date(now - hoursAgo * HOUR + HOUR), status },
          select: { id: true },
        })
      ).id;
    const l1 = await lessonOf(72);
    const l2 = await lessonOf(48);
    const l3 = await lessonOf(24);
    await lessonOf(30, 'cancelled');
    await lessonOf(-24);
    await prisma.attendanceRecord.createMany({
      data: [
        { lessonId: l1, studentUserId: id('ahmed'), status: 'present' },
        { lessonId: l2, studentUserId: id('ahmed'), status: 'late', minutesLate: 10 },
        { lessonId: l3, studentUserId: id('ahmed'), status: 'absent' },
        { lessonId: l1, studentUserId: id('mona'), status: 'present' },
      ],
    });
    // One published exam of A, ahmed 15 / 20.
    const exam = await prisma.exam.create({
      data: { classId: classes['A']!, title: { ar: 'اختبار' }, type: 'quiz', status: 'published', publishedAt: new Date(), maxScore: 20, weight: 100 },
      select: { id: true },
    });
    await prisma.examResult.create({ data: { examId: exam.id, studentUserId: id('ahmed'), status: 'scored', score: 15 } });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.exam.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.attendanceRecord.deleteMany({ where: { lesson: { class: { code: { startsWith: PREFIX } } } } });
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
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

  it('lists only the students of the classes the teacher teaches, with contact fields, their classes and the attendance across them', async () => {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    const res = await list({ q: PREFIX }).expect(200);
    const items = ours(res.body.items as ListItem[]);
    expect(res.body.truncated).toBe(false);
    // Active only by default: mona (withdrawn) and omar (another teacher's class) are not there.
    expect(items.map((item) => item.student.id)).toEqual([id('ahmed')]);
    const ahmed = items[0]!;
    expect(ahmed.student).toMatchObject({ email: email('ahmed'), phone: '+90 555 000 1111' });
    expect(ahmed.classes.map((entry) => [entry.class.code, entry.enrollmentStatus]).sort()).toEqual([
      [code('A'), 'active'],
      [code('B'), 'active'],
    ]);
    // 1 present + 1 late of 3 counted → 67 %.
    expect(ahmed.attendance).toEqual({ present: 1, late: 1, absent: 1, excused: 0, rate: 67 });

    const all = ours((await list({ q: PREFIX, status: 'all' }).expect(200)).body.items as ListItem[]);
    expect(all.map((item) => item.student.fullName)).toEqual([`${PREFIX} ahmed`, `${PREFIX} mona`]);
    const withdrawn = ours((await list({ q: PREFIX, status: 'withdrawn' }).expect(200)).body.items as ListItem[]);
    expect(withdrawn.map((item) => item.student.id)).toEqual([id('mona')]);
    expect(ours((await list({ q: 'ahm', classId: classes['B']! }).expect(200)).body.items as ListItem[]).map((item) => item.student.id)).toEqual([id('ahmed')]);
    // A class the teacher does not teach matches nothing; a phone number searches too.
    expect(ours((await list({ classId: classes['C']!, status: 'all' }).expect(200)).body.items as ListItem[])).toEqual([]);
    expect(ours((await list({ q: '555 000 1111' }).expect(200)).body.items as ListItem[]).map((item) => item.student.id)).toEqual([id('ahmed')]);
    // The other teacher sees omar and ahmed (class B), never mona's withdrawn class A.
    expect(ours((await list({ q: PREFIX, status: 'all' }, 'other').expect(200)).body.items as ListItem[]).map((item) => item.student.id).sort()).toEqual([id('ahmed'), id('omar')].sort());

    expect(await prisma.auditLog.count({ where: { id: { gt: latest?.id ?? NIL_ID }, actorUserId: { in: createdUserIds }, action: { not: { startsWith: 'auth.' } } } })).toBe(0);
  });

  it('opens a student with guardians, the attendance of each started lesson and the gradebook’s own numbers', async () => {
    const res = await api().get(`${STUDENTS}/${id('ahmed')}`).set(bearer('teacher')).expect(200);
    expect(res.body.student).toMatchObject({ id: id('ahmed'), email: email('ahmed'), phone: '+90 555 000 1111' });
    expect(res.body.guardians).toEqual([
      { id: id('father'), fullName: `${PREFIX} father`, displayName: null, relationship: 'father', isPrimary: true, email: email('father'), phone: '+90 555 000 2222' },
    ]);
    const byCode = Object.fromEntries((res.body.classes as { class: { code: string } }[]).map((entry) => [entry.class.code, entry])) as Record<string, any>;
    expect(Object.keys(byCode).sort()).toEqual([code('A'), code('B')]);
    const a = byCode[code('A')];
    expect(a.attendance).toMatchObject({ present: 1, late: 1, absent: 1, excused: 0, rate: 67 });
    // Started, not cancelled lessons only, newest first; the future and cancelled lessons are left out.
    expect(a.attendance.lessons.map((lesson: { status: string | null; minutesLate: number | null }) => [lesson.status, lesson.minutesLate])).toEqual([
      ['absent', null],
      ['late', 10],
      ['present', null],
    ]);
    // The marks are the class gradebook's row (API-126): 15 / 20 on a weight-100 exam → 75.
    const book = await api().get(`/api/classes/${classes['A']}/gradebook`).set(bearer('teacher')).expect(200);
    const row = (book.body.students as { student: { id: string }; current: number | null; projected: number | null; cells: unknown[] }[]).find((entry) => entry.student.id === id('ahmed'))!;
    expect(a.grades).toMatchObject({ current: row.current, projected: row.projected, cells: row.cells, components: book.body.components });
    expect(a.grades.current).toBe(75);
    expect(byCode[code('B')].attendance).toMatchObject({ present: 0, late: 0, absent: 0, rate: null, lessons: [] });
  });

  it('answers 404 for a student the teacher does not teach, 403 without enrollments.read, 401 without a session', async () => {
    const omar = await api().get(`${STUDENTS}/${id('omar')}`).set(bearer('teacher'));
    expect(omar.status).toBe(404);
    expect(omar.body).toMatchObject({ code: 'student_not_found', studentId: id('omar') });
    // A withdrawn student of the teacher's own class still opens (the teacher taught them).
    await api().get(`${STUDENTS}/${id('mona')}`).set(bearer('teacher')).expect(200);
    expect((await api().get(`${STUDENTS}/${NIL_ID}`).set(bearer('teacher'))).status).toBe(404);
    expect((await api().get(`${STUDENTS}/not-a-uuid`).set(bearer('teacher'))).status).toBe(400);
    const denied = await list({}, 'outsider');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['enrollments.read'] });
    await api().get(STUDENTS).expect(401);
    expect((await list({ status: 'pending' })).status).toBe(400);
  });
});
