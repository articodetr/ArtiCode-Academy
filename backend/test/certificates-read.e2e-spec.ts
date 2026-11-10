// TEST-136 — MOD-10-T03 reading, revoking and verifying certificates
// (API-130, API-131, API-133, API-134; D-R55..D-R57) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a manager, a teacher with the system role, an issuer with
// `certificates.issue` alone, a reader with `certificates.read_all` alone, a
// revoker with `certificates.revoke` alone, a user without the reading keys,
// students), roles, a course, two classes whose certificates are issued
// through the API in `beforeAll` and a non-default grade scheme carry a
// unique prefix and are deleted at the end — certificates first. Advances the
// development database's serial counter like TEST-135.
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
const PREFIX = `Y${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-136 supertest';
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

describe.skipIf(!available)('MOD-10 reading, revoking and verifying certificates (e2e, TEST-136)', () => {
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
  const issue = (suffix: string, body: object = {}, as = 'issuer') => api().post(`${CLASSES}/${classes[suffix] ?? suffix}/certificates`).set(bearer(as)).send(body);
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

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة التحقق' }, status: 'published' }, select: { id: true } })).id;
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
    await createUser('manager', [await createRole('ymanager', ['classes.read', 'classes.manage', 'classes.teachers.assign'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('issuer', [await createRole('yissuer', ['certificates.issue'])]);
    await createUser('reader', [await createRole('yreader', ['certificates.read_all'])]);
    await createUser('revoker', [await createRole('yrevoker', ['certificates.revoke'])]);
    await createUser('nokeys', [await createRole('ynokeys', ['classes.read', 'classes.manage', 'certificates.read_own'])]);
    const studentRole = await systemRole('student');
    for (const student of ['s1', 's2', 's3']) await createUser(student, [studentRole]);

    await gradedClass('A', { s1: 80, s2: 70 });
    await classAction('A', 'complete');
    await issue('A').expect(200);
    await gradedClass('B', { s3: 90 });
    await classAction('B', 'complete');
    await issue('B').expect(200);
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

  const list = (query: Record<string, string>, as = 'reader') => api().get('/api/certificates').query(query).set(bearer(as));
  const certOf = async (student: string): Promise<CertificateBody & { class: { id: string } }> => {
    const res = await list({ studentId: id(student), status: 'issued' });
    return (res.body.items as (CertificateBody & { class: { id: string } })[])[0]!;
  };
  const verify = (value: string) => api().get(`/api/certificates/verify/${encodeURIComponent(value)}`).set({ 'User-Agent': USER_AGENT });

  it('AC1 — the list (filters, newest first, keyset pages) and the detail open with certificates.read_all or certificates.issue', async () => {
    const all = await list({ courseId });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const items = all.body.items as (CertificateBody & { class: { id: string } })[];
    expect(items.map((item) => item.student.id)).toEqual([id('s3'), id('s2'), id('s1')]); // newest first
    expect(all.body.nextCursor).toBeNull();
    expect((await list({ courseId }, 'issuer')).status).toBe(200);
    const denied = await list({ courseId }, 'nokeys');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['certificates.read_all', 'certificates.issue'] });

    expect(((await list({ classId: classes['A']! })).body.items as CertificateBody[]).map((item) => item.student.id).sort()).toEqual([id('s1'), id('s2')].sort());
    expect(((await list({ studentId: id('s3') })).body.items as (CertificateBody & { class: { id: string } })[]).map((item) => item.class.id)).toEqual([classes['B']]);
    const serial = items[0]!.serial;
    expect(((await list({ courseId, q: serial.slice(-6).toLowerCase() })).body.items as CertificateBody[]).map((item) => item.serial)).toContain(serial);
    expect((await list({ courseId, q: '%' })).body.items).toEqual([]); // literal
    expect((await list({ courseId, status: 'revoked' })).body.items).toEqual([]);

    const first = await list({ courseId, limit: '2' });
    expect((first.body.items as CertificateBody[]).map((item) => item.student.id)).toEqual([id('s3'), id('s2')]);
    const second = await list({ courseId, limit: '2', cursor: first.body.nextCursor as string });
    expect((second.body.items as CertificateBody[]).map((item) => item.student.id)).toEqual([id('s1')]);
    expect(second.body.nextCursor).toBeNull();
    expect((await list({ cursor: 'nope' })).body).toMatchObject({ code: 'cursor_invalid' });
    expect((await list({ limit: '101' })).status).toBe(400);

    const detail = await api().get(`/api/certificates/${items[2]!.id}`).set(bearer('issuer')).expect(200);
    expect(detail.body).toMatchObject({ id: items[2]!.id, status: 'issued', student: { id: id('s1') }, grade: { percent: 80, letter: 'P' }, revokeReason: null });
    expect((await api().get(`/api/certificates/${NIL_ID}`).set(bearer('reader'))).body).toMatchObject({ code: 'certificate_not_found' });
    expect((await api().get(`/api/certificates/${items[2]!.id}`).set(bearer('nokeys'))).status).toBe(403);
  });

  it('AC2 — the public verification shows the status, serial, name, course, grade and academy from the snapshot, without a token; a malformed or unknown code is the same 404', async () => {
    const cert = await certOf('s1');
    const typed = `${cert.verificationCode.slice(0, 5).toLowerCase()}-${cert.verificationCode.slice(5, 10)} ${cert.verificationCode.slice(10)}`;
    const res = await verify(typed);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      serial: cert.serial,
      status: 'issued',
      issuedAt: expect.any(String),
      revokedAt: null,
      student: { fullName: 'Test s1', fullNameLatin: 'Test s1 Latin' },
      course: { code: code('CRS'), name: { ar: 'دورة التحقق' } },
      grade: { percent: 80, label: { ar: 'ناجح' }, letter: 'P' },
      academy: { name: expect.objectContaining({ ar: expect.any(String) }) },
    });
    const malformed = await verify('abc');
    const unknown = await verify('A'.repeat(20));
    expect([malformed.status, unknown.status]).toEqual([404, 404]);
    expect(malformed.body.code).toBe('certificate_not_found');
    expect(unknown.body).toEqual(malformed.body);
  });

  it('AC3 — revoking is final, needs certificates.revoke and a reason, records one event, shows in the verification without the reason, unlocks the grades and lets the enrollment get a new serial', async () => {
    const cert = await certOf('s2');
    const m = await mark();
    expect((await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('issuer')).send({ reason: 'x' })).status).toBe(403);
    expect((await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('revoker')).send({})).status).toBe(400);
    expect((await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('revoker')).send({ reason: '   ' })).status).toBe(400);
    expect((await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('revoker')).send({ reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await api().post(`/api/certificates/${NIL_ID}/revoke`).set(bearer('revoker')).send({ reason: 'خطأ' })).body).toMatchObject({ code: 'certificate_not_found' });
    expect(await eventsSince(m)).toEqual([]);

    const revoked = await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('revoker')).send({ reason: '  خطأ في اسم الطالب  ' });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(revoked.body).toMatchObject({ id: cert.id, status: 'revoked', revokedBy: { fullName: 'Test revoker' }, revokeReason: 'خطأ في اسم الطالب' });
    expect(typeof revoked.body.revokedAt).toBe('string');
    const again = await api().post(`/api/certificates/${cert.id}/revoke`).set(bearer('revoker')).send({ reason: 'مرة ثانية' });
    expect(again.body).toMatchObject({ code: 'certificate_revoked', certificateId: cert.id, revokedAt: revoked.body.revokedAt });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['certificates.revoked', 'certificates', cert.id, id('revoker')]]);
    expect(events[0]!.metadata).toEqual({ serial: cert.serial, classId: classes['A'], reason: 'خطأ في اسم الطالب' });

    const shown = await verify(cert.verificationCode).expect(200);
    expect(shown.body).toMatchObject({ serial: cert.serial, status: 'revoked', revokedAt: revoked.body.revokedAt });
    expect(JSON.stringify(shown.body)).not.toContain('خطأ');

    // Class A still has s1's issued certificate: its grades stay locked; once that one is revoked too, they unlock.
    expect((await api().post(`${CLASSES}/${classes['A']}/final-grades`).set(bearer('teacher')).send({ schemeId })).body).toMatchObject({ code: 'grades_certified', certificateCount: 1 });
    const s1 = await certOf('s1');
    await api().post(`/api/certificates/${s1.id}/revoke`).set(bearer('revoker')).send({ reason: 'إعادة الإصدار' }).expect(200);
    await api().post(`${CLASSES}/${classes['A']}/final-grades`).set(bearer('teacher')).send({ schemeId }).expect(200);
    const reissued = (await issue('A').expect(200)).body as IssueBody;
    expect(reissued.issued.map((row) => row.student.id).sort()).toEqual([id('s1'), id('s2')].sort());
    const fresh = reissued.issued.find((row) => row.student.id === id('s2'))!;
    expect(fresh.serial).not.toBe(cert.serial);
    expect(serialNumber(fresh.serial)).toBeGreaterThan(serialNumber(cert.serial));
    expect((await list({ classId: classes['A']!, status: 'revoked' })).body.items).toHaveLength(2);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/certificates'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/certificates/{id}'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/certificates/{id}/revoke'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/certificates/verify/{code}'])).toEqual(['get']);
      for (const schema of ['CertificateListDto', 'RevokeCertificateDto', 'CertificateVerificationDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );

  it('AC4 — the public verification is rate limited per IP (60 per minute)', async () => {
    let limited: request.Response | undefined;
    for (let i = 0; i < 70 && !limited; i += 1) {
      const res = await verify('B'.repeat(20));
      if (res.status === 429) limited = res;
    }
    expect(limited?.body).toMatchObject({ code: 'rate_limited' });
  });
});
