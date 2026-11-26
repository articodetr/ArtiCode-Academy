// The seeded `teacher` role no longer manages assignments (migration
// 20261126141500_teacher_without_assignments; `src/authorization/system-roles.ts`)
// — enforced on the server by permissions, against the live development
// database. Skipped when no database is reachable.
//
// Fixture users (an `academy_admin`, a teacher holding ONLY the seeded
// `teacher` role, a teacher holding `teacher` plus a custom role with the three
// assignment keys, a student with the seeded `student` role), a custom role, a
// published course, a running class led by both teachers, the student's active
// enrollment, an assignment and a submission carry a unique prefix and are
// deleted at the end. Audit events are counted by fixture actor above an id
// watermark. The last test replays the migration's SQL inside a transaction
// that is rolled back, so it never changes the shared database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { SYSTEM_ROLES } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createAssignmentWriterRole, TEACHER_REVOKED_ASSIGNMENT_KEYS } from './assignment-writer.helpers.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `TA${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'teacher-assignments-access supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const MIGRATION_SQL = join(process.cwd(), 'prisma', 'migrations', '20261126141500_teacher_without_assignments', 'migration.sql');

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

/** Thrown to roll back the migration replay. */
class Rollback extends Error {}

describe.skipIf(!available)('the seeded teacher role without the assignment keys (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let classId = '';
  let assignmentId = '';
  let submissionId = '';
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const keysOf = async (roleKey: string) =>
    (await prisma.rolePermission.findMany({ where: { role: { key: roleKey }, permissionKey: { startsWith: 'assignments.' } }, select: { permissionKey: true }, orderBy: { permissionKey: 'asc' } })).map(
      (row) => row.permissionKey,
    );
  const latestAuditId = async () => (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const teacherRole = await systemRole('teacher');
    const writer = await createAssignmentWriterRole(prisma, `test_taw_${RUN.toLowerCase()}`);
    createdRoleIds.push(writer);
    await createUser('admin', [await systemRole('academy_admin')]);
    await createUser('teacher', [teacherRole]);
    await createUser('teacherplus', [teacherRole, writer]);
    await createUser('student', [await systemRole('student')]);

    const courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة صلاحيات الواجبات' }, status: 'published' }, select: { id: true } })).id;
    classId = (
      await prisma.class.create({
        data: {
          courseId,
          code: `${PREFIX}-A`,
          name: { ar: 'فصل صلاحيات الواجبات' },
          capacity: 10,
          status: 'running',
          teachers: { create: [{ teacherUserId: fx['teacher']!, role: 'lead' }, { teacherUserId: fx['teacherplus']!, role: 'assistant' }] },
        },
        select: { id: true },
      })
    ).id;
    await prisma.enrollment.create({ data: { classId, studentUserId: fx['student']!, status: 'active', activatedAt: new Date() }, select: { id: true } });
  }, 120_000); // four accounts are hashed and signed in with Argon2

  afterAll(async () => {
    try {
      if (prisma) {
        // Enrollments first (Restrict on the class); the class takes its teachers, assignments and submissions (Cascade); then the course.
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
  }, 60_000);

  it('the seeded teacher role holds none of the three keys — in the code defaults and in the database; the other system roles keep theirs', async () => {
    const teacherDefaults = SYSTEM_ROLES.find((role) => role.key === 'teacher')!.permissions;
    for (const key of TEACHER_REVOKED_ASSIGNMENT_KEYS) expect(teacherDefaults, key).not.toContain(key);
    expect(await keysOf('teacher')).toEqual([]);
    expect(await keysOf('academy_admin')).toEqual(['assignments.grade', 'assignments.manage', 'assignments.read', 'assignments.submit']);
    expect(await keysOf('student')).toEqual(['assignments.read', 'assignments.submit']);
    expect(await keysOf('guardian')).toEqual(['assignments.read']);
    // The teacher keeps the rest of their work: lessons, attendance, exams and grades.
    const teacherKeys = (await prisma.rolePermission.findMany({ where: { role: { key: 'teacher' } }, select: { permissionKey: true } })).map((row) => row.permissionKey);
    for (const key of ['lessons.manage', 'attendance.record', 'exams.manage', 'exams.grade', 'grades.read_all', 'grades.manage']) expect(teacherKeys, key).toContain(key);
  });

  it('an academy_admin still writes, reads and reviews assignments; the student sees it in «my assignments» and submits', async () => {
    const created = await api().post(`/api/classes/${classId}/assignments`).set(bearer('admin')).send({ title: { ar: 'واجب المدير' }, maxScore: 20, maxAttempts: 2 }).expect(201);
    assignmentId = created.body.id as string;
    expect(created.body).toMatchObject({ status: 'draft', class: { id: classId } });
    await api().patch(`/api/assignments/${assignmentId}`).set(bearer('admin')).send({ weight: 30 }).expect(200);
    await api().post(`/api/assignments/${assignmentId}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(200);
    const listed = await api().get('/api/assignments').query({ classId }).set(bearer('admin')).expect(200);
    expect((listed.body.items as Array<{ id: string }>).map((item) => item.id)).toEqual([assignmentId]);
    await api().get(`/api/assignments/${assignmentId}`).set(bearer('admin')).expect(200);

    // The student (seeded role) sees it in «my assignments» and submits.
    const mine = await api().get('/api/me/assignments').query({ classId }).set(bearer('student')).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ id: assignmentId, relation: 'self', submitBlocker: null });
    const submitted = await api().post(`/api/assignments/${assignmentId}/submissions`).set(bearer('student')).send({ textAnswer: 'إجابة الطالب', attemptNo: 1 }).expect(201);
    submissionId = submitted.body.id as string;

    const roster = await api().get(`/api/assignments/${assignmentId}/submissions`).set(bearer('admin')).expect(200);
    expect(JSON.stringify(roster.body)).toContain(fx['student']!);
    await api().get(`/api/submissions/${submissionId}`).set(bearer('admin')).expect(200);
    const graded = await api().post(`/api/submissions/${submissionId}/review`).set(bearer('admin')).send({ action: 'grade', score: 15 }).expect(200);
    expect(graded.body).toMatchObject({ status: 'graded', score: 15 });

    // The student reads their own review; a draft of the admin's is deleted.
    expect((await api().get(`/api/submissions/${submissionId}`).set(bearer('student')).expect(200)).body).toMatchObject({ status: 'graded', score: 15 });
    const draft = await api().post(`/api/classes/${classId}/assignments`).set(bearer('admin')).send({ title: { ar: 'مسودة' }, maxScore: 5 }).expect(201);
    await api().delete(`/api/assignments/${draft.body.id as string}`).set(bearer('admin')).expect(204);
  });

  it('a teacher holding only the seeded role — the lead teacher of the class — is refused every assignment route, and nothing is written', async () => {
    expect(assignmentId).not.toBe('');
    const markId = await latestAuditId();
    const before = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    // Each request is built only when it is sent: supertest starts one server per request (never build two at once).
    const refusals: Array<[string, () => request.Test, string[]]> = [
      ['API-102 list', () => api().get('/api/assignments').query({ classId }).set(bearer('teacher')), ['assignments.read']],
      ['API-103 read one', () => api().get(`/api/assignments/${assignmentId}`).set(bearer('teacher')), ['assignments.read']],
      ['API-104 create', () => api().post(`/api/classes/${classId}/assignments`).set(bearer('teacher')).send({ title: { ar: 'واجب المعلم' }, maxScore: 10 }), ['assignments.manage']],
      ['API-105 patch', () => api().patch(`/api/assignments/${assignmentId}`).set(bearer('teacher')).send({ maxScore: 99 }), ['assignments.manage']],
      ['API-106 status', () => api().post(`/api/assignments/${assignmentId}/status`).set(bearer('teacher')).send({ action: 'close' }), ['assignments.manage']],
      ['API-107 delete', () => api().delete(`/api/assignments/${assignmentId}`).set(bearer('teacher')), ['assignments.manage']],
      ['API-108 roster', () => api().get(`/api/assignments/${assignmentId}/submissions`).set(bearer('teacher')), ['assignments.read']],
      ['API-111 review', () => api().post(`/api/submissions/${submissionId}/review`).set(bearer('teacher')).send({ action: 'grade', score: 1 }), ['assignments.grade']],
    ];
    for (const [route, send, missing] of refusals) {
      const res = await send();
      expect(res.status, route).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'permission_denied', missing });
    }
    // API-110 has no key at the guard: a teacher without `assignments.read` is neither the student nor a guardian, so 404.
    const one = await api().get(`/api/submissions/${submissionId}`).set(bearer('teacher')).expect(404);
    expect(one.body).toMatchObject({ code: 'submission_not_found' });
    // «my assignments» is ownership: the teacher owns no enrollment, so an empty page — never another student's work.
    expect((await api().get('/api/me/assignments').set(bearer('teacher')).expect(200)).body.items).toEqual([]);

    // Nothing changed and nothing was recorded.
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).toEqual(before);
    expect(await prisma.assignment.count({ where: { classId } })).toBe(1);
    expect(await prisma.assignmentSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: { status: true, score: true } })).toMatchObject({ status: 'graded' });
    expect(await prisma.auditLog.count({ where: { id: { gt: markId }, actorUserId: fx['teacher']! } })).toBe(0);
  });

  it('a teacher who also holds a role granting the keys keeps them through that role', async () => {
    const listed = await api().get('/api/assignments').query({ classId }).set(bearer('teacherplus')).expect(200);
    expect((listed.body.items as Array<{ id: string }>).map((item) => item.id)).toEqual([assignmentId]);
    await api().get(`/api/assignments/${assignmentId}/submissions`).set(bearer('teacherplus')).expect(200);
    const created = await api().post(`/api/classes/${classId}/assignments`).set(bearer('teacherplus')).send({ title: { ar: 'واجب المعلم المساعد' }, maxScore: 10 }).expect(201);
    await api().delete(`/api/assignments/${created.body.id as string}`).set(bearer('teacherplus')).expect(204);
    const regraded = await api().post(`/api/submissions/${submissionId}/review`).set(bearer('teacherplus')).send({ action: 'grade', score: 16 }).expect(200);
    expect(regraded.body).toMatchObject({ status: 'graded', score: 16 });
  });

  it('the migration removes only the teacher grants: assignments, submissions, audit rows and every other grant survive (replayed and rolled back)', async () => {
    const sql = readFileSync(MIGRATION_SQL, 'utf8');
    const teacherRoleId = await systemRole('teacher');
    await expect(
      prisma.$transaction(async (tx) => {
        // Give the teacher back the three keys as an academy migrated before this change would hold them …
        await tx.rolePermission.createMany({ data: TEACHER_REVOKED_ASSIGNMENT_KEYS.map((permissionKey) => ({ roleId: teacherRoleId, permissionKey })), skipDuplicates: true });
        const counts = async () => ({
          assignments: await tx.assignment.count(),
          submissions: await tx.assignmentSubmission.count(),
          auditLogs: await tx.auditLog.count(),
          otherGrants: await tx.rolePermission.count({ where: { NOT: { roleId: teacherRoleId, permissionKey: { in: [...TEACHER_REVOKED_ASSIGNMENT_KEYS] } } } }),
          teacherAssignmentGrants: await tx.rolePermission.count({ where: { roleId: teacherRoleId, permissionKey: { in: [...TEACHER_REVOKED_ASSIGNMENT_KEYS] } } }),
        });
        const before = await counts();
        expect(before.teacherAssignmentGrants).toBe(3);
        const ours = await tx.assignmentSubmission.findUniqueOrThrow({ where: { id: submissionId } });

        // … then run the migration's own SQL.
        const removed = await tx.$executeRawUnsafe(sql);
        expect(removed).toBe(3);
        expect(await counts()).toEqual({ ...before, teacherAssignmentGrants: 0 });
        expect(await tx.assignmentSubmission.findUniqueOrThrow({ where: { id: submissionId } })).toEqual(ours);
        // A second run deletes nothing (a fresh database, or an academy already migrated).
        expect(await tx.$executeRawUnsafe(sql)).toBe(0);
        throw new Rollback('replay only');
      }, { timeout: 20_000 }),
    ).rejects.toBeInstanceOf(Rollback);
    // The rollback left the database as the real migration left it.
    expect(await keysOf('teacher')).toEqual([]);
  });
});
