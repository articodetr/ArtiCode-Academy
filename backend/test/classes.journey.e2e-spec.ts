// TEST-052 — the MOD-05 module gate (MOD-05-T06, task C3, CH-0057): WF-03
// "assign a teacher to a class" and WF-04 "enroll a student in a class" (the
// MOD-05 part, without payment) through the API against the live development
// database. A manager creates a class for a published course, assigns a lead
// teacher, opens the class and enrolls two students; the teacher (the seeded
// `teacher` system role) then sees the class and its roster, each student (the
// seeded `student` role) sees it in GET /api/me/classes, and so does the
// guardian (the seeded `guardian` role) of one of them. The manager reads the
// journey's events in GET /api/audit-logs. Skipped when no database is
// reachable. Fixtures carry a unique prefix and are deleted at the end (their
// audit rows stay — KI-032). The browser journey waits for MOD-05-T07.
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
/** Prefix of the course and class codes. */
const PREFIX = `J${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-052 supertest';

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

describe.skipIf(!available)('WF-03/WF-04 class journey — the MOD-05 gate (e2e, TEST-052)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    // The manager holds the academy_admin keys the journey needs, without the
    // role itself (so TEST-026's last-admin test never touches it); everyone
    // else holds the real system role.
    const manager = await prisma.role.create({
      data: {
        key: `test_wf04_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-03/WF-04' },
        permissions: {
          create: [
            'classes.read',
            'classes.manage',
            'classes.teachers.assign',
            'enrollments.read',
            'enrollments.manage',
            'users.read_contact',
            'audit.read',
          ].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    await createUser('teacher', [await systemRole('teacher')]);
    const student = await systemRole('student');
    await createUser('student1', [student]);
    await createUser('student2', [student]);
    await createUser('guardian', [await systemRole('guardian')]);
    for (const name of ['manager', 'teacher', 'student1', 'student2', 'guardian']) tokens[name] = await login(email(name));

    // Preconditions from other journeys: a published course (WF-05) and the guardian link of student1 (MOD-03-T09).
    courseId = (
      await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: { ar: 'دورة رحلة الفصول' }, status: 'published' }, select: { id: true } })
    ).id;
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['guardian']!, studentUserId: fx['student1']!, relationship: 'father', isPrimary: true } });
  });

  afterAll(async () => {
    try {
      // Enrollments first (Restrict on the class); the class takes its teachers (Cascade); then the course (Restrict on classes).
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('a manager creates a class, assigns a lead teacher, opens it and enrolls two students; the teacher, both students and a guardian see it; the events are in the audit log', async () => {
    // Before the journey nobody has a class.
    expect((await api().get('/api/me/classes').set(bearer('student1')).expect(200)).body.items).toEqual([]);
    expect((await api().get('/api/me/classes').set(bearer('guardian')).expect(200)).body.items).toEqual([]);

    // 1. WF-03 — the manager creates a planned class for the published course (the code is upper-cased).
    const created = await api()
      .post('/api/classes')
      .set(bearer('manager'))
      .send({
        courseId,
        code: `${PREFIX.toLowerCase()}-a`,
        name: { ar: 'فصل الرحلة', en: 'Journey class' },
        capacity: 2,
        startsOn: '2026-11-10',
        endsOn: '2026-12-20',
      })
      .expect(201);
    const classId = created.body.id as string;
    expect(created.body).toMatchObject({
      code: `${PREFIX}-A`,
      status: 'planned',
      capacity: 2,
      teachers: [],
      enrolledCount: 0,
      course: { id: courseId, code: `${PREFIX}-CRS`, status: 'published' },
    });
    // Not assigned yet: the class does not exist for the teacher (D-R16).
    expect((await api().get(`/api/classes/${classId}`).set(bearer('teacher')).expect(404)).body.code).toBe('class_not_found');

    // 2. WF-03 — the manager assigns the lead teacher; the teacher sees the class at once.
    const assigned = await api()
      .put(`/api/classes/${classId}/teachers`)
      .set(bearer('manager'))
      .send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] })
      .expect(200);
    expect(assigned.body.teachers).toMatchObject([{ userId: fx['teacher'], fullName: 'Test teacher', role: 'lead' }]);
    const visible = await api().get('/api/classes').query({ q: PREFIX }).set(bearer('teacher')).expect(200);
    expect(visible.body.items.map((item: { id: string }) => item.id)).toEqual([classId]);

    // 3. WF-04 — a planned class takes no enrollment; the manager opens it.
    const early = await api().post(`/api/classes/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx['student1'] }).expect(409);
    expect(early.body).toMatchObject({ code: 'class_not_enrollable', status: 'planned' });
    const opened = await api().post(`/api/classes/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    expect(opened.body.status).toBe('open');

    // 4. WF-04 — the manager enrolls two students, straight to active; the class is now full.
    const first = await api().post(`/api/classes/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx['student1'] }).expect(201);
    const second = await api().post(`/api/classes/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx['student2'] }).expect(201);
    for (const res of [first, second]) expect(res.body).toMatchObject({ classId, status: 'active', source: 'admin' });
    expect(first.body.student).toMatchObject({ id: fx['student1'], email: email('student1') });
    expect((await api().get(`/api/classes/${classId}`).set(bearer('manager')).expect(200)).body.enrolledCount).toBe(2);

    // 5. The teacher: the class with its lead, and the roster in enrollment order without contact fields; no writes.
    const detail = await api().get(`/api/classes/${classId}`).set(bearer('teacher')).expect(200);
    expect(detail.body).toMatchObject({ status: 'open', enrolledCount: 2, teachers: [{ userId: fx['teacher'], role: 'lead' }] });
    const roster = await api().get(`/api/classes/${classId}/enrollments`).set(bearer('teacher')).expect(200);
    expect(roster.body.items.map((item: { student: { id: string } }) => item.student.id)).toEqual([fx['student1'], fx['student2']]);
    for (const item of roster.body.items as { status: string; student: { email: string | null; phone: string | null } }[]) {
      expect(item).toMatchObject({ status: 'active', student: { email: null, phone: null } });
    }
    await api().post(`/api/classes/${classId}/enrollments`).set(bearer('teacher')).send({ studentId: fx['guardian'] }).expect(403);

    // 6. Each student sees the class in "my classes" with the course and the lead teacher by name.
    const expectedClass = {
      id: classId,
      code: `${PREFIX}-A`,
      status: 'open',
      startsOn: '2026-11-10',
      endsOn: '2026-12-20',
      course: { id: courseId, code: `${PREFIX}-CRS` },
      leadTeacher: { fullName: 'Test teacher', displayName: null },
    };
    for (const [name, enrollment] of [
      ['student1', first],
      ['student2', second],
    ] as const) {
      const mine = await api().get('/api/me/classes').set(bearer(name)).expect(200);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0]).toMatchObject({
        enrollmentId: enrollment.body.id,
        enrollmentStatus: 'active',
        relation: 'self',
        student: { id: fx[name] },
        class: expectedClass,
      });
    }

    // 7. The guardian of student1 sees the same class, named for the child — and nothing of student2.
    const child = await api().get('/api/me/classes').set(bearer('guardian')).expect(200);
    expect(child.body.items).toHaveLength(1);
    expect(child.body.items[0]).toMatchObject({
      enrollmentId: first.body.id,
      relation: 'child',
      student: { id: fx['student1'], fullName: 'Test student1' },
      class: expectedClass,
    });

    // Students and guardians read only their own: no class list, no roster.
    for (const name of ['student1', 'guardian']) {
      await api().get('/api/classes').set(bearer(name)).expect(403);
      await api().get(`/api/classes/${classId}/enrollments`).set(bearer(name)).expect(403);
    }

    // 8. The audit log holds the journey's events (newest first) and nothing for the refused enrollment.
    const log = await api().get('/api/audit-logs').query({ actorUserId: fx['manager'], limit: 50 }).set(bearer('manager')).expect(200);
    const journey = (log.body.items as { action: string; entityId: string | null }[]).filter((item) => !item.action.startsWith('auth.'));
    expect(journey.map((item) => [item.action, item.entityId])).toEqual([
      ['enrollments.created', second.body.id],
      ['enrollments.created', first.body.id],
      ['classes.status.changed', classId],
      ['classes.teachers.changed', classId],
      ['classes.created', classId],
    ]);
    await api().get('/api/audit-logs').set(bearer('teacher')).expect(403);
  });
});
