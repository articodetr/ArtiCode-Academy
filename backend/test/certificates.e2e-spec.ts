// TEST-135 — MOD-10-T02 issuing certificates and the class preview (API-132,
// API-136) and the MOD-09 grades lock (D-R54) against the live development
// database. Skipped when no database is reachable. Fixture users (a manager
// with a custom role, a teacher with the system `teacher` role, an issuer with
// `certificates.issue` alone, a reader with `certificates.read_all` alone, a
// user without any certificates key, students), roles, a published course,
// classes, enrollments, exams with results (through the API) and a
// non-default grade scheme (through Prisma) carry a unique prefix and are
// deleted at the end — certificates first (they restrict everything they
// name). The tests advance the development database's `certificate` serial
// counter of the year (gaps there are expected). Audit events are counted by
// fixture actor above an id watermark.
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
const PREFIX = `Z${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-135 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

interface CertificateBody {
  id: string;
  serial: string;
  verificationCode: string;
  status: string;
  enrollmentId: string;
  student: { id: string; fullName: string };
  grade: { percent: number; label: { ar: string }; letter: string | null };
  snapshot: Record<string, unknown>;
  issuedBy: { fullName: string } | null;
}
interface IssueBody {
  issued: CertificateBody[];
  skipped: { enrollmentId: string; studentId: string; reason: string }[];
}
interface PreviewBody {
  class: { id: string; status: string };
  issuable: number;
  items: { enrollmentId: string; student: { id: string; email: string | null }; final: { percent: number; isPass: boolean; stale: boolean } | null; certificate: { serial: string } | null; reason: string | null }[];
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

describe.skipIf(!available)('MOD-10 issuing certificates (e2e, TEST-135)', () => {
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
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const preview = (suffix: string, as = 'issuer') => api().get(`${CLASSES}/${classes[suffix] ?? suffix}/certificates`).set(bearer(as));
  const issue = (suffix: string, body: object = {}, as = 'issuer') => api().post(`${CLASSES}/${classes[suffix] ?? suffix}/certificates`).set(bearer(as)).send(body);
  const reasons = (body: IssueBody | PreviewBody) =>
    ('skipped' in body ? body.skipped.map((entry) => [entry.studentId, entry.reason]) : body.items.map((entry) => [entry.student.id, entry.reason])).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const serialNumber = (serial: string) => Number(serial.split('-').pop());

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
    actors.push(user.id);
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

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

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الشهادات' }, status: 'published' }, select: { id: true } })).id;
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
    await createUser('manager', [await createRole('zmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'users.read_contact'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('issuer', [await createRole('zissuer', ['certificates.issue'])]);
    await createUser('reader', [await createRole('zreader', ['certificates.read_all'])]);
    await createUser('nokeys', [await createRole('znokeys', ['classes.read', 'classes.manage'])]);
    const studentRole = await systemRole('student');
    for (const student of ['s1', 's2', 's3', 's4', 's5', 's6']) await createUser(student, [studentRole]);

    // Class A: s1 passes (80), s2 fails (30), s3's only weighted exam is excused (no final grade).
    await gradedClass('A', { s1: 80, s2: 30, s3: 'excused' });
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

  it('AC1 — the preview opens with certificates.read_all or certificates.issue; a running class issues nothing (class_not_completed) and every enrollment is not_completed', async () => {
    const m = await mark();
    const res = await preview('A');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as PreviewBody;
    expect(body).toMatchObject({ class: { id: classes['A'], status: 'running' }, issuable: 0 });
    expect(reasons(body)).toEqual([[id('s1'), 'not_completed'], [id('s2'), 'not_completed'], [id('s3'), 'not_completed']].sort((a, b) => a[0]!.localeCompare(b[0]!)));
    const s1 = body.items.find((item) => item.student.id === id('s1'))!;
    expect(s1).toMatchObject({ final: { percent: 80, isPass: true, stale: false }, certificate: null });
    expect(s1.student.email).toBeNull(); // the issuer holds no users.read_contact (D-R07)
    expect(body.items.find((item) => item.student.id === id('s3'))!.final).toBeNull();
    expect((await preview('A', 'reader')).status).toBe(200);
    const denied = await preview('A', 'nokeys');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['certificates.read_all', 'certificates.issue'] });
    expect((await preview(NIL_ID)).body).toMatchObject({ code: 'class_not_found' });

    expect((await issue('A')).body).toMatchObject({ code: 'class_not_completed', status: 'running' });
    expect((await issue('A', {}, 'reader')).status).toBe(403);
    expect((await issue(NIL_ID)).body).toMatchObject({ code: 'class_not_found' });
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC2 — once the class is completed, one certificate for the passing enrollment with its serial, code and snapshot; the others are skipped with their reason; one event; a repeat issues nothing', async () => {
    await classAction('A', 'complete');
    const before = (await preview('A')).body as PreviewBody;
    expect(before.issuable).toBe(1);
    expect(reasons(before)).toEqual([[id('s1'), null], [id('s2'), 'not_passed'], [id('s3'), 'no_final_grade']].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

    // Validation before anything else: enrollments of another class or named twice, an empty list, a malformed id.
    expect((await issue('A', { enrollmentIds: [NIL_ID] })).body).toMatchObject({ code: 'certificate_request_invalid', unknown: [NIL_ID], duplicates: [] });
    const twice = enrollments['A:s1']!;
    expect((await issue('A', { enrollmentIds: [twice, twice] })).body).toMatchObject({ code: 'certificate_request_invalid', unknown: [], duplicates: [twice] });
    expect((await issue('A', { enrollmentIds: [] })).status).toBe(400);
    expect((await issue('A', { enrollmentIds: ['x'] })).status).toBe(400);

    const m = await mark();
    const res = await issue('A');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as IssueBody;
    expect(body.issued).toHaveLength(1);
    const cert = body.issued[0]!;
    // PREFIX-YYYY-NNNNN: the prefix is the academy's setting or CERT (academy.e2e-spec.ts may change the setting meanwhile in a parallel run).
    expect(cert.serial).toMatch(/^[A-Z0-9]{2,10}-\d{4}-\d{5,}$/);
    expect(cert.verificationCode).toMatch(/^[A-Z2-7]{20}$/);
    expect(cert).toMatchObject({
      status: 'issued',
      enrollmentId: enrollments['A:s1'],
      class: { id: classes['A'], code: code('A') },
      course: { id: courseId, code: code('CRS') },
      student: { id: id('s1'), fullName: 'Test s1', fullNameLatin: 'Test s1 Latin', displayName: null },
      grade: { percent: 80, label: { ar: 'ناجح' }, letter: 'P' },
      issuedBy: { fullName: 'Test issuer' },
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    });
    expect(cert.snapshot).toMatchObject({
      student: { fullName: 'Test s1', fullNameLatin: 'Test s1 Latin', displayName: null },
      course: { code: code('CRS'), name: { ar: 'دورة الشهادات' } },
      class: { code: code('A'), name: { ar: 'فصل A' } },
      grade: { percent: 80, label: { ar: 'ناجح' }, letter: 'P' },
      issuedAt: expect.any(String),
    });
    expect(typeof (cert.snapshot['completedAt'] as string)).toBe('string');
    expect(reasons(body)).toEqual([[id('s2'), 'not_passed'], [id('s3'), 'no_final_grade']].sort((a, b) => a[0]!.localeCompare(b[0]!)));

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['certificates.issued', 'classes', classes['A'], id('issuer')]]);
    expect(events[0]!.metadata).toEqual({ code: code('A'), count: 1, certificateIds: [cert.id], skipped: 2 });

    const m2 = await mark();
    const again = (await issue('A').expect(200)).body as IssueBody;
    expect(again.issued).toEqual([]);
    expect(reasons(again)[0]).toBeDefined();
    expect(again.skipped.find((entry) => entry.studentId === id('s1'))!.reason).toBe('already_issued');
    expect(await eventsSince(m2)).toEqual([]);
    const after = (await preview('A')).body as PreviewBody;
    expect(after.issuable).toBe(0);
    expect(after.items.find((item) => item.student.id === id('s1'))!.certificate).toMatchObject({ serial: cert.serial });
  });

  it('AC3 — the class’s final grades are locked while it has an issued certificate (grades_certified), with no event', async () => {
    const m = await mark();
    const refinalize = await api().post(`${CLASSES}/${classes['A']}/final-grades`).set(bearer('teacher')).send({ schemeId });
    expect(refinalize.status).toBe(409);
    expect(refinalize.body).toMatchObject({ code: 'grades_certified', classId: classes['A'], certificateCount: 1 });
    expect((await api().delete(`${CLASSES}/${classes['A']}/final-grades`).set(bearer('teacher'))).body).toMatchObject({ code: 'grades_certified', certificateCount: 1 });
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC4 — a stale final grade is skipped; named enrollments only; concurrent requests issue each certificate once with consecutive serials', async () => {
    const examId = await gradedClass('B', { s4: 90, s5: 70, s6: 60 });
    await classAction('B', 'complete');
    // A correction after the finalization makes s6's final grade stale.
    await api().put(`${EXAMS}/${examId}/results`).set(bearer('teacher')).send({ results: [{ studentId: id('s6'), status: 'scored', score: 65 }] }).expect(200);
    expect(reasons((await preview('B')).body as PreviewBody)).toEqual([[id('s4'), null], [id('s5'), null], [id('s6'), 'stale']].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

    // Only s4, by name.
    const named = (await issue('B', { enrollmentIds: [enrollments['B:s4']] }).expect(200)).body as IssueBody;
    expect(named.issued.map((cert) => cert.student.id)).toEqual([id('s4')]);
    expect(named.skipped).toEqual([]);

    // Two requests at once: s5 is issued exactly once.
    const [first, second] = await Promise.all([issue('B'), issue('B')]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const all = [...(first.body as IssueBody).issued, ...(second.body as IssueBody).issued];
    expect(all.map((cert) => cert.student.id)).toEqual([id('s5')]);
    expect(await prisma.certificate.count({ where: { classId: classes['B'], status: 'issued' } })).toBe(2);
    expect(serialNumber(all[0]!.serial)).toBeGreaterThan(serialNumber(named.issued[0]!.serial));
    const both = await prisma.certificate.findMany({ where: { classId: { in: [classes['A']!, classes['B']!] } }, select: { serial: true, verificationCode: true } });
    expect(new Set(both.map((row) => row.verificationCode)).size).toBe(3);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/certificates']).sort()).toEqual(['get', 'post']);
      for (const schema of ['IssueCertificatesDto', 'IssueCertificatesResultDto', 'CertificateDto', 'CertificateSnapshotDto', 'ClassCertificatesDto', 'CertificatesSettingsDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
