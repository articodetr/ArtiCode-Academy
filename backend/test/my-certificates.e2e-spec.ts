// TEST-137 — MOD-10-T04 «my certificates» (API-135; D-R57) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a manager, a teacher, an issuer who may also revoke, two students, a
// guardian with the role and a linked user without it), roles, a course, a
// class whose certificates are issued through the API and a non-default grade
// scheme carry a unique prefix and are deleted at the end — certificates first.
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
const PREFIX = `X${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-137 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

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

describe.skipIf(!available)('MOD-10 «my certificates» (e2e, TEST-137)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let schemeId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const enrollments: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const issue = (suffix: string, body: object = {}, as = 'issuer') => api().post(`${CLASSES}/${classes[suffix] ?? suffix}/certificates`).set(bearer(as)).send(body);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, fullNameLatin: `Test ${name} Latin`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }


  async function classAction(suffix: string, action: string): Promise<void> {
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  /** A running class whose single weighted exam (max 100) is published with these results, then finalized with the test scheme. */
  async function gradedClass(suffix: string, results: Record<string, number | 'excused'>): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api().put(`${CLASSES}/${classes[suffix]}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await classAction(suffix, 'open');
    for (const student of Object.keys(results)) {
      const row = await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status: 'active', activatedAt: new Date() }, select: { id: true } });
      enrollments[`${suffix}:${student}`] = row.id;
    }
    const examId = (await api().post(`${CLASSES}/${classes[suffix]}/exams`).set(bearer('teacher')).send({ title: { ar: `اختبار ${suffix}` }, type: 'final', maxScore: 100, weight: 100 }).expect(201)).body.id as string;
    await api().post(`${EXAMS}/${examId}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    await api()
      .put(`${EXAMS}/${examId}/results`)
      .set(bearer('teacher'))
      .send({ results: Object.entries(results).map(([student, score]) => (score === 'excused' ? { studentId: id(student), status: 'excused' } : { studentId: id(student), status: 'scored', score })) })
      .expect(200);
    await api().post(`${EXAMS}/${examId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    await classAction(suffix, 'start');
    await api().post(`${CLASSES}/${classes[suffix]}/final-grades`).set(bearer('teacher')).send({ schemeId }).expect(200);
    return examId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة شهاداتي' }, status: 'published' }, select: { id: true } })).id;
    schemeId = (
      await prisma.gradeScheme.create({
        data: {
          name: { ar: `${PREFIX} سلّم` },
          bands: { create: [{ minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false }, { minPercent: 50, label: { ar: 'ناجح' }, letter: 'P', isPass: true }] },
        },
        select: { id: true },
      })
    ).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    await createUser('manager', [await createRole('xmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('issuer', [await createRole('xissuer', ['certificates.issue', 'certificates.revoke'])]);
    const studentRole = await systemRole('student');
    for (const student of ['s1', 's2']) await createUser(student, [studentRole]);
    await createUser('guardian', [await systemRole('guardian')]);
    // Holds certificates.read_linked without the guardian role: links alone grant nothing.
    await createUser('linked', [await createRole('xlinked', ['certificates.read_linked'])]);
    for (const linked of ['guardian', 'linked']) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(linked), studentUserId: id('s1'), relationship: 'father' }, select: { studentUserId: true } });
    }

    await gradedClass('A', { s1: 80, s2: 70 });
    await classAction('A', 'complete');
    await issue('A').expect(200);
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const classIds = Object.values(classes);
        await prisma.certificate.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: classIds } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: classIds } } });
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

  interface MyItem {
    id: string;
    serial: string;
    verificationCode: string;
    status: string;
    relation: string;
    student: { id: string };
    class: { id: string };
    snapshot: { student: { fullName: string } };
    revokedAt: string | null;
  }
  const mine = (as: string, query: Record<string, string> = {}) => api().get('/api/me/certificates').query(query).set(bearer(as));

  it('AC1 — a student sees their own certificate with what prints it, never the issuer, revoker or reason; filters narrow', async () => {
    const res = await mine('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as MyItem[];
    expect(items.map((item) => [item.student.id, item.relation, item.status, item.class.id])).toEqual([[id('s1'), 'self', 'issued', classes['A']]]);
    expect(items[0]!.serial).toMatch(/^[A-Z0-9]{2,10}-\d{4}-\d{5,}$/);
    expect(items[0]!.verificationCode).toMatch(/^[A-Z2-7]{20}$/);
    expect(items[0]!.snapshot.student.fullName).toBe('Test s1');
    for (const key of ['issuedBy', 'revokedBy', 'revokeReason']) expect(items[0]).not.toHaveProperty(key);
    expect(((await mine('s2')).body.items as MyItem[]).map((item) => item.student.id)).toEqual([id('s2')]);
    expect((await mine('s1', { classId: NIL_ID })).body.items).toEqual([]);
    expect((await mine('s1', { studentId: id('s2') })).body.items).toEqual([]);
    expect((await mine('s1', { classId: 'x' })).status).toBe(400);
  });

  it('AC2 — a guardian sees the linked child’s certificate (child); a link without the guardian role grants nothing; neither key is a 403', async () => {
    const child = (await mine('guardian').expect(200)).body.items as MyItem[];
    expect(child.map((item) => [item.student.id, item.relation])).toEqual([[id('s1'), 'child']]);
    expect((await mine('guardian', { studentId: id('s2') })).body.items).toEqual([]);
    expect((await mine('linked').expect(200)).body.items).toEqual([]);
    const denied = await mine('teacher');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['certificates.read_own', 'certificates.read_linked'] });
    expect((await api().get('/api/me/certificates')).status).toBe(401);
  });

  it('AC3 — a revoked certificate stays in the list as revoked, without the reason', async () => {
    const certificateId = ((await mine('s1')).body.items as MyItem[])[0]!.id;
    await api().post(`/api/certificates/${certificateId}/revoke`).set(bearer('issuer')).send({ reason: 'سبب داخلي' }).expect(200);
    const after = await mine('s1').expect(200);
    expect((after.body.items as MyItem[]).map((item) => [item.id, item.status, typeof item.revokedAt])).toEqual([[certificateId, 'revoked', 'string']]);
    expect(JSON.stringify(after.body)).not.toContain('سبب داخلي');
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/certificates'])).toEqual(['get']);
      for (const schema of ['MyCertificateListDto', 'MyCertificateItemDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
