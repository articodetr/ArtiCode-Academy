// TEST-138 — the MOD-10 module gate and the Stage 4 gate (MOD-10-T05,
// CH-0179): WF-09 "issue a certificate" from real grades through the API
// against the live development database. A manager prepares the class
// (WF-03/WF-04); the teacher (the seeded `teacher` role) sets a weighted
// assignment and a weighted exam and grades both students (WF-13, WF-07);
// the class runs and the teacher fixes the final grades (WF-08); the class is
// completed; a member of staff (the seeded `staff` role — it holds
// `certificates.issue`) previews and issues the certificates: the passing
// student gets one, the failing one is skipped; anyone verifies it without
// signing in; the student and the guardian (the seeded roles) see it in «my
// certificates»; the teacher can no longer fix the grades again; an
// administrator revokes it with a reason; the verification shows it revoked;
// the grades unlock; a new certificate is issued with a new serial; the
// journey's events are in the audit log. Skipped when no database is
// reachable. Fixtures carry a unique prefix and are deleted at the end —
// certificates first (their audit rows stay — KI-032).
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
const PREFIX = `V${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-138 supertest';
const CLASSES = '/api/classes';
const AUDIT = '/api/audit-logs';

interface CertificateBody {
  id: string;
  serial: string;
  verificationCode: string;
  status: string;
  student: { id: string };
}

interface AuditItem {
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
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

describe.skipIf(!available)('WF-09 certificate journey — the MOD-10 and Stage 4 gate (e2e, TEST-138)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let schemeId: string;
  let classId = '';
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const verify = (code: string) => api().get(`/api/certificates/verify/${encodeURIComponent(code)}`).set({ 'User-Agent': USER_AGENT });
  const mine = (name: string) => api().get('/api/me/certificates').set(bearer(name));
  const events = async (actor: string): Promise<AuditItem[]> =>
    ((await api().get(AUDIT).query({ actorUserId: fx[actor]!, limit: 50 }).set(bearer('manager')).expect(200)).body.items as AuditItem[]).filter((item) => !item.action.startsWith('auth.'));

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

  async function createRole(name: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    // The manager prepares and reads the log without academy_admin; the revoker holds the two administrator keys MOD-10 needs.
    await createUser('manager', [await createRole('wf09mgr', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'enrollments.read', 'enrollments.manage', 'audit.read'])]);
    await createUser('revoker', [await createRole('wf09rev', ['certificates.read_all', 'certificates.revoke'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('staff', [await systemRole('staff')]);
    const student = await systemRole('student');
    await createUser('student1', [student]);
    await createUser('student2', [student]);
    await createUser('guardian', [await systemRole('guardian')]);

    // Preconditions: a published course (WF-05), the guardian link of student1 (MOD-03-T09) and a grade scheme (D-R46; non-default, so the academy's default stays untouched).
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: { ar: 'دورة رحلة الشهادة' }, status: 'published' }, select: { id: true } })).id;
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['guardian']!, studentUserId: fx['student1']!, relationship: 'mother', isPrimary: true } });
    schemeId = (
      await prisma.gradeScheme.create({
        data: {
          name: { ar: `${PREFIX} سلّم` },
          bands: { create: [{ minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false }, { minPercent: 60, label: { ar: 'جيد جداً' }, letter: 'B', isPass: true }] },
        },
        select: { id: true },
      })
    ).id;
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.certificate.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('issues a certificate from real grades: preview, issue, public verification, «my certificates», the grades lock, revocation and a new serial; the events are in the audit log', async () => {
    // 0. WF-03/WF-04: the class with its lead teacher, open, two students enrolled.
    const code = `${PREFIX}-A`;
    classId = (await api().post(CLASSES).set(bearer('manager')).send({ courseId, code, name: { ar: 'فصل رحلة الشهادة' }, capacity: 5 }).expect(201)).body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    for (const name of ['student1', 'student2']) await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx[name] }).expect(201);

    // 1. WF-13: a weighted assignment (max 20, weight 40), both students submit, the teacher grades 18 and 6, then closes it.
    const assignmentId = (await api().post(`${CLASSES}/${classId}/assignments`).set(bearer('teacher')).send({ title: { ar: 'واجب الرحلة' }, maxScore: 20, weight: 40 }).expect(201)).body.id as string;
    await api().post(`/api/assignments/${assignmentId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    for (const [name, score] of [
      ['student1', 18],
      ['student2', 6],
    ] as const) {
      const submission = (await api().post(`/api/assignments/${assignmentId}/submissions`).set(bearer(name)).send({ textAnswer: `حل ${name}` }).expect(201)).body.id as string;
      await api().post(`/api/submissions/${submission}/review`).set(bearer('teacher')).send({ action: 'grade', score }).expect(200);
    }
    await api().post(`/api/assignments/${assignmentId}/status`).set(bearer('teacher')).send({ action: 'close' }).expect(200);

    // 2. WF-07: a weighted exam (max 50, weight 60), results 42 and 10, published.
    const examId = (await api().post(`${CLASSES}/${classId}/exams`).set(bearer('teacher')).send({ title: { ar: 'اختبار الرحلة' }, type: 'final', maxScore: 50, weight: 60 }).expect(201)).body.id as string;
    await api().post(`/api/exams/${examId}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    await api()
      .put(`/api/exams/${examId}/results`)
      .set(bearer('teacher'))
      .send({ results: [{ studentId: fx['student1'], status: 'scored', score: 42 }, { studentId: fx['student2'], status: 'scored', score: 10 }] })
      .expect(200);
    await api().post(`/api/exams/${examId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);

    // 3. WF-08: the class runs and the teacher fixes the final grades — 86.4 (pass) and 24 (fail).
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'start' }).expect(200);
    const fixed = await api().post(`${CLASSES}/${classId}/final-grades`).set(bearer('teacher')).send({ schemeId }).expect(200);
    expect((fixed.body.students as { student: { id: string }; final: { percent: number; isPass: boolean } }[]).map((row) => [row.student.id, row.final.percent, row.final.isPass])).toEqual(
      [
        [fx['student1'], 86.4, true],
        [fx['student2'], 24, false],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    // 4. WF-09: no certificate while the class runs; once completed, the staff preview shows who is eligible and the issue gives the passing student one.
    expect((await api().post(`${CLASSES}/${classId}/certificates`).set(bearer('staff')).send({})).body).toMatchObject({ code: 'class_not_completed', status: 'running' });
    expect((await api().post(`${CLASSES}/${classId}/certificates`).set(bearer('teacher')).send({})).status).toBe(403); // the teacher fixes grades, staff issues certificates
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'complete' }).expect(200);
    const preview = (await api().get(`${CLASSES}/${classId}/certificates`).set(bearer('staff')).expect(200)).body as { issuable: number; items: { student: { id: string }; reason: string | null }[] };
    expect(preview.issuable).toBe(1);
    expect(Object.fromEntries(preview.items.map((item) => [item.student.id, item.reason]))).toEqual({ [fx['student1']!]: null, [fx['student2']!]: 'not_passed' });
    const issued = (await api().post(`${CLASSES}/${classId}/certificates`).set(bearer('staff')).send({}).expect(200)).body as { issued: CertificateBody[]; skipped: { studentId: string; reason: string }[] };
    expect(issued.issued.map((row) => [row.student.id, row.status])).toEqual([[fx['student1'], 'issued']]);
    expect(issued.skipped.map((row) => [row.studentId, row.reason])).toEqual([[fx['student2'], 'not_passed']]);
    const certificate = issued.issued[0]!;

    // 5. Anyone verifies it without signing in (D-R56).
    const verified = await verify(certificate.verificationCode.toLowerCase()).expect(200);
    expect(verified.body).toMatchObject({ serial: certificate.serial, status: 'issued', revokedAt: null, student: { fullName: 'Test student1' }, course: { code: `${PREFIX}-CRS` }, grade: { percent: 86.4, letter: 'B' } });

    // 6. «My certificates»: the student and the guardian see it; the other student none; the teacher holds neither key.
    expect(((await mine('student1').expect(200)).body.items as (CertificateBody & { relation: string })[]).map((row) => [row.id, row.relation])).toEqual([[certificate.id, 'self']]);
    expect(((await mine('guardian').expect(200)).body.items as (CertificateBody & { relation: string })[]).map((row) => [row.id, row.relation])).toEqual([[certificate.id, 'child']]);
    expect((await mine('student2').expect(200)).body.items).toEqual([]);
    expect((await mine('teacher')).status).toBe(403);

    // 7. D-R54: the certified class's grades are locked.
    expect((await api().post(`${CLASSES}/${classId}/final-grades`).set(bearer('teacher')).send({ schemeId })).body).toMatchObject({ code: 'grades_certified', certificateCount: 1 });

    // 8. D-R55: the administrator revokes it with a reason; the verification shows it revoked, without the reason.
    const revoked = await api().post(`/api/certificates/${certificate.id}/revoke`).set(bearer('revoker')).send({ reason: 'تصحيح اسم الطالب' }).expect(200);
    expect(revoked.body).toMatchObject({ status: 'revoked', revokeReason: 'تصحيح اسم الطالب' });
    const shown = await verify(certificate.verificationCode).expect(200);
    expect(shown.body).toMatchObject({ status: 'revoked', revokedAt: revoked.body.revokedAt });
    expect(JSON.stringify(shown.body)).not.toContain('تصحيح');

    // 9. The grades unlock (an identical finalization writes nothing) and a new certificate gets a new serial.
    await api().post(`${CLASSES}/${classId}/final-grades`).set(bearer('teacher')).send({ schemeId }).expect(200);
    const again = (await api().post(`${CLASSES}/${classId}/certificates`).set(bearer('staff')).send({}).expect(200)).body as { issued: CertificateBody[] };
    expect(again.issued.map((row) => row.student.id)).toEqual([fx['student1']]);
    expect(again.issued[0]!.serial).not.toBe(certificate.serial);
    expect(Number(again.issued[0]!.serial.split('-').pop())).toBeGreaterThan(Number(certificate.serial.split('-').pop()));
    expect(((await mine('student1').expect(200)).body.items as CertificateBody[]).map((row) => [row.serial, row.status])).toEqual([
      [again.issued[0]!.serial, 'issued'],
      [certificate.serial, 'revoked'],
    ]);

    // 10. The audit log: staff issued twice, the administrator revoked once, the teacher fixed the grades once (the identical run wrote nothing).
    expect((await events('staff')).map((item) => [item.action, item.entityType, item.entityId, item.metadata?.['count']])).toEqual([
      ['certificates.issued', 'classes', classId, 1],
      ['certificates.issued', 'classes', classId, 1],
    ]);
    expect((await events('staff'))[1]!.metadata).toEqual({ code, count: 1, certificateIds: [certificate.id], skipped: 1 });
    expect((await events('revoker')).map((item) => [item.action, item.entityType, item.entityId, item.metadata])).toEqual([
      ['certificates.revoked', 'certificates', certificate.id, { serial: certificate.serial, classId, reason: 'تصحيح اسم الطالب' }],
    ]);
    const teacherEvents = await events('teacher');
    expect(teacherEvents.filter((item) => item.action.startsWith('grades.')).map((item) => [item.action, item.metadata])).toEqual([['grades.finalized', { code, schemeId, created: 2, updated: 0 }]]);
    expect(teacherEvents.filter((item) => item.action.startsWith('certificates.'))).toEqual([]);
    expect((await events('student1')).map((item) => item.action)).toEqual(['assignments.submitted']);
    expect(await events('guardian')).toEqual([]);
  }, 60_000);
});
