// TEST-170 — MOD-13-T04 the dashboard overview (API-164; roadmap §4k, D-R67)
// against the live development database. Skipped when no database is reachable.
// The overview is academy-wide, so the suite checks the sections each key opens
// and that every number equals the detailed report it comes from (read at the
// same moment) or a direct count of the shared dev DB; it writes no rows of its
// own besides the fixture users/roles (unique suffix; their audit rows stay — KI-032).
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
import { addDays, zonedInstant } from '../src/schedule/lesson-generation.plan.js';
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-170 supertest';
const OVERVIEW = '/api/reports/overview';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const ALL_KEYS = ['reports.attendance.view', 'reports.academic.view', 'reports.financial.view'];

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

describe.skipIf(!available)('MOD-13 dashboard overview (e2e, TEST-170)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let zone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });

  async function createUserWithKeys(name: string, permissionKeys: readonly string[]): Promise<void> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Overview ${name} ${RUN}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId: role.id }] } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
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
    zone = (await prisma.academy.findFirst({ select: { timezone: true } }))?.timezone ?? 'UTC';
    await createUserWithKeys('director', ALL_KEYS);
    await createUserWithKeys('office', ['reports.attendance.view', 'reports.financial.view']);
    await createUserWithKeys('academic', ['reports.academic.view']);
    await createUserWithKeys('teacher', ['courses.read', 'classes.read']);
  }, 30_000);

  afterAll(async () => {
    try {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    } finally {
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — any report key opens it; none is a 403 naming the three; 401 anonymously; nothing is audited', async () => {
    const latest = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
    await api().get(OVERVIEW).expect(401);
    const denied = await api().get(OVERVIEW).set(bearer('teacher')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ALL_KEYS });
    for (const who of ['director', 'office', 'academic']) await api().get(OVERVIEW).set(bearer(who)).expect(200);
    expect(await prisma.auditLog.count({ where: { id: { gt: latest }, actorUserId: { in: createdUserIds } } })).toBe(0);
  });

  it('AC2 — each section follows its key: the office sees general, attendance and financial; the academic reader general and academic', async () => {
    const office = await api().get(OVERVIEW).set(bearer('office')).expect(200);
    expect(office.body.general).not.toBeNull();
    expect(office.body.attendance).not.toBeNull();
    expect(office.body.financial).not.toBeNull();
    expect(office.body.academic).toBeNull();
    const academic = await api().get(OVERVIEW).set(bearer('academic')).expect(200);
    expect(academic.body.academic).not.toBeNull();
    expect([academic.body.attendance, academic.body.financial]).toEqual([null, null]);
    const director = await api().get(OVERVIEW).set(bearer('director')).expect(200);
    expect(Object.keys(director.body).sort()).toEqual(['academic', 'asOf', 'attendance', 'financial', 'general', 'generatedAt', 'timeZone']);
    expect(Object.values(director.body).every((value) => value !== null)).toBe(true);
  });

  it('AC3 — every number equals its detailed report (the same period) or a direct count', async () => {
    const today = calendarDateIn(zone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [overview, attendance, academic, collections, receivables] = await Promise.all([
      api().get(OVERVIEW).set(bearer('director')).expect(200),
      api().get('/api/reports/attendance/classes').set(bearer('director')).expect(200),
      api().get('/api/reports/academic/classes').set(bearer('director')).expect(200),
      api().get(`/api/reports/financial/collections?from=${monthStart}&to=${today}`).set(bearer('director')).expect(200),
      api().get('/api/reports/financial/receivables').set(bearer('director')).expect(200),
    ]);
    const body = overview.body;
    expect(body).toMatchObject({ asOf: today, timeZone: zone });
    expect(body.attendance).toEqual({ period: { from: addDays(today, -29), to: today }, records: attendance.body.totals.records, attendanceRate: attendance.body.totals.attendanceRate });
    expect(body.academic).toMatchObject({
      period: academic.body.period,
      finalGrades: academic.body.totals.finalGrades,
      averagePercent: academic.body.totals.averagePercent,
      passRate: academic.body.totals.passRate,
    });
    expect(Number.isInteger(body.academic.awaitingReview)).toBe(true);
    expect(body.financial.period).toEqual({ from: monthStart, to: today });
    expect(body.financial.collected).toEqual(collections.body.totals.map(({ currency, payments, amount }: { currency: string; payments: number; amount: number }) => ({ currency, payments, amount })));
    expect(body.financial.outstanding.map(({ currency, balance, overdue }: { currency: string; balance: number; overdue: number }) => ({ currency, balance, overdue }))).toEqual(
      receivables.body.totals.map(({ currency, balance, overdue }: { currency: string; balance: number; overdue: number }) => ({ currency, balance, overdue })),
    );

    const start = zonedInstant(today, '00:00', zone);
    const end = zonedInstant(addDays(today, 1), '00:00', zone);
    const [activeStudents, openClasses, runningClasses, lessonsToday] = await Promise.all([
      prisma.enrollment.findMany({ where: { status: 'active' }, distinct: ['studentUserId'], select: { studentUserId: true } }).then((rows) => rows.length),
      prisma.class.count({ where: { status: 'open' } }),
      prisma.class.count({ where: { status: 'running' } }),
      prisma.lesson.count({ where: { status: { not: 'cancelled' }, startsAt: { gte: start, lt: end } } }),
    ]);
    expect(body.general).toEqual({ activeStudents, openClasses, runningClasses, lessonsToday });
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths[OVERVIEW])).toEqual(['get']);
      expect(docs.body.components.schemas).toHaveProperty('ReportsOverviewDto');
    },
    20_000,
  );
});
