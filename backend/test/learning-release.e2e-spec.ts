// TEST-262 — MOD-20 «My School», a level that opens by date (roadmap §4q,
// LRN-T06, D-R145) against the live development database. Skipped when no
// database is reachable. A level with `releaseAfterDays` N opens for a learner
// on their class's `starts_on` + N days in the academy's time zone; before
// that its lessons are listed (`available: false`) but API-231..234 answer
// `403 level_not_open { itemId, opensOn }` (after lesson_not_found and
// not_enrolled), the resume point never lands on them, and a locked required
// lesson still counts in `progress.required`. A class without `starts_on`
// opens everything. The class that decides is the one the workspace chooses
// (an active enrollment first, then the newest).
//
// Fixtures (a published course with three levels — no delay / 5 days / 30
// days — and a lesson outside every level; a class that started ten days ago
// and a class without a start date; three students) carry a unique prefix and
// are deleted at the end: learning progress first (Restrict), then
// enrollments, classes, the course (levels and lessons cascade), users and
// nothing else.
import { randomUUID } from 'node:crypto';
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
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `R${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-262 supertest';
const BASE = '/api/me/learning';
const DAY_MS = 86_400_000;

interface Counts {
  total: number;
  required: number;
  completed: number;
  completedRequired: number;
  percent: number | null;
  isComplete: boolean;
}
interface WorkspaceBody {
  enrollment: { id: string; class: { id: string } };
  sections: { id: string | null; items: { id: string; available: boolean }[]; progress: Counts; isOpen: boolean; opensOn: string | null }[];
  progress: Counts;
  resume: { itemId: string; reason: string } | null;
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

/** `YYYY-MM-DD` plus `days` (UTC calendar arithmetic, as the server's). */
function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-20 level release by date (e2e, TEST-262)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let startsOn: string;
  const createdUserIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sections: Record<string, string> = {};
  const items: Record<string, string> = {};
  const classes: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN}@example.test`.toLowerCase();
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const learning = (as: string) => api().get(BASE).set(bearer(as));
  const workspace = (as: string) => api().get(`${BASE}/courses/${courseId}`).set(bearer(as));
  const lesson = (as: string, item: string) => api().get(`${BASE}/items/${items[item]}`).set(bearer(as));
  const visit = (as: string, item: string) => api().post(`${BASE}/items/${items[item]}/visit`).set(bearer(as)).send({});
  const complete = (as: string, item: string) => api().post(`${BASE}/items/${items[item]}/complete`).set(bearer(as)).send({});
  const playback = (as: string, item: string) => api().put(`${BASE}/items/${items[item]}/playback`).set(bearer(as)).send({ positionSeconds: 0, ranges: [] });
  const progressRows = (student: string) => prisma.learningProgress.findMany({ where: { studentUserId: id(student) }, select: { syllabusItemId: true } });
  const nameOf = (itemId: string) => Object.entries(items).find(([, value]) => value === itemId)?.[0] ?? itemId;

  async function createUser(name: string): Promise<void> {
    const roleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId }] } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function createItem(name: string, data: Record<string, unknown>): Promise<void> {
    const row = await prisma.courseSyllabusItem.create({ data: { courseId, title: { ar: `درس ${name}` }, kind: 'text', ...data } as never, select: { id: true } });
    items[name] = row.id;
  }

  async function enroll(suffix: string, student: string, status: 'active' | 'completed', enrolledAt: string): Promise<void> {
    const at = new Date(enrolledAt);
    await prisma.enrollment.create({
      data: { classId: classes[suffix]!, studentUserId: id(student), status, enrolledAt: at, activatedAt: at, completedAt: status === 'completed' ? new Date(at.getTime() + 3600_000) : null, source: 'admin' },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true } });
    startsOn = plusDays(calendarDateIn(academy.timezone), -10); // the class started ten days ago in the academy's zone

    for (const name of ['s1', 's2', 'sN']) await createUser(name);
    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الفتح بموعد' }, status: 'published' }, select: { id: true } })).id;
    sections['S1'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 0, title: { ar: 'مفتوح دائمًا' } }, select: { id: true } })).id;
    sections['S2'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 1, releaseAfterDays: 5 }, select: { id: true } })).id;
    sections['S3'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 2, releaseAfterDays: 30 }, select: { id: true } })).id;
    await createItem('T1', { sectionId: sections['S1'], sortOrder: 0 });
    await createItem('T2', { sectionId: sections['S2'], sortOrder: 1 });
    await createItem('T3', { sectionId: sections['S3'], sortOrder: 2 });
    await createItem('V3', { sectionId: sections['S3'], sortOrder: 3, kind: 'video', content: { provider: 'file', url: 'https://cdn.example.org/locked.mp4', durationSeconds: 100, captions: [] } });
    await createItem('LOOSE', { sectionId: null, sortOrder: 4 });

    classes['R'] = (await prisma.class.create({ data: { courseId, code: code('R'), name: { ar: 'فصل بدأ' }, capacity: 10, status: 'running', startsOn: new Date(`${startsOn}T00:00:00.000Z`) }, select: { id: true } })).id;
    classes['N'] = (await prisma.class.create({ data: { courseId, code: code('N'), name: { ar: 'فصل بلا موعد' }, capacity: 10, status: 'open' }, select: { id: true } })).id;
    // s1: active in R and a NEWER completed enrollment in N — the active one decides (the workspace's choice).
    await enroll('R', 's1', 'active', '2026-01-01T09:00:00Z');
    await enroll('N', 's1', 'completed', '2026-03-01T09:00:00Z');
    await enroll('N', 's2', 'active', '2026-01-01T09:00:00Z');
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdUserIds.length > 0) await prisma.certificate.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        if (createdUserIds.length > 0) await prisma.learningProgress.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        if (Object.keys(classes).length > 0) await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — the workspace of a class that started ten days ago: no delay and 5 days are open, 30 days is closed until starts_on + 30; its lessons are listed but not available', async () => {
    const res = await workspace('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as WorkspaceBody;
    expect(body.enrollment.class.id).toBe(classes['R']); // the active enrollment, not the newer completed one
    expect(body.sections.map((section) => [section.id, section.isOpen, section.opensOn, section.items.map((entry) => [nameOf(entry.id), entry.available])])).toEqual([
      [sections['S1'], true, null, [['T1', true]]],
      [sections['S2'], true, plusDays(startsOn, 5), [['T2', true]]],
      [
        sections['S3'],
        false,
        plusDays(startsOn, 30),
        [
          ['T3', false],
          ['V3', false],
        ],
      ],
      [null, true, null, [['LOOSE', true]]],
    ]);
    // The closed level's required lessons still count (D-R145).
    expect(body.sections[2]!.progress).toMatchObject({ total: 2, required: 2, completedRequired: 0, percent: 0, isComplete: false });
    expect(body.progress).toMatchObject({ total: 5, required: 5, completed: 0, percent: 0, isComplete: false });
    expect(body.resume).toEqual({ itemId: items['T1'], reason: 'first', positionSeconds: null });

    const card = ((await learning('s1').expect(200)).body.items as { class: { id: string }; progress: Counts }[]).find((entry) => entry.class.id === classes['R'])!;
    expect(card.progress).toMatchObject({ total: 5, required: 5 });
  });

  it('AC2 — a lesson of the closed level: API-231/232/233/234 answer 403 level_not_open { itemId, opensOn } and write nothing; neighbors carry `available`', async () => {
    const opensOn = plusDays(startsOn, 30);
    for (const [call, item] of [
      [lesson, 'T3'],
      [visit, 'T3'],
      [playback, 'V3'],
      [complete, 'T3'],
      [lesson, 'V3'],
      [visit, 'V3'],
      [complete, 'V3'], // before completion_by_playback
      [playback, 'T3'], // before playback_not_tracked
    ] as const) {
      const res = await call('s1', item);
      expect(res.status, `${item}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body).toMatchObject({ statusCode: 403, code: 'level_not_open', itemId: items[item], opensOn });
    }
    expect(await progressRows('s1')).toEqual([]);

    // The order of the checks: an unknown lesson is 404 and a caller without an enrollment is not_enrolled first.
    expect((await api().get(`${BASE}/items/${randomUUID()}`).set(bearer('s1')).expect(404)).body.code).toBe('lesson_not_found');
    expect((await lesson('sN', 'T3').expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'not_enrolled' });
    expect((await complete('sN', 'T3').expect(403)).body.code).toBe('not_enrolled');

    // Open lessons next to the closed level say which neighbor is available.
    const t2 = await lesson('s1', 'T2');
    expect(t2.status, JSON.stringify(t2.body)).toBe(200);
    expect(t2.body.neighbors).toEqual({
      previous: { id: items['T1'], title: { ar: 'درس T1' }, available: true },
      next: { id: items['T3'], title: { ar: 'درس T3' }, available: false },
    });
    expect((await lesson('s1', 'LOOSE').expect(200)).body.neighbors).toEqual({ previous: { id: items['V3'], title: { ar: 'درس V3' }, available: false }, next: null });
  });

  it('AC3 — a class without starts_on opens every level: no date, every lesson available and usable', async () => {
    const body = (await workspace('s2').expect(200)).body as WorkspaceBody;
    expect(body.enrollment.class.id).toBe(classes['N']);
    expect(body.sections.map((section) => [section.isOpen, section.opensOn])).toEqual([
      [true, null],
      [true, null],
      [true, null],
      [true, null],
    ]);
    expect(body.sections.flatMap((section) => section.items).every((entry) => entry.available)).toBe(true);
    expect((await lesson('s2', 'T3').expect(200)).body.neighbors).toMatchObject({ previous: { id: items['T2'], available: true }, next: { id: items['V3'], available: true } });
    expect((await visit('s2', 'T3').expect(200)).body.progress.state).toBe('in_progress');
    expect((await complete('s2', 'T3').expect(200)).body).toMatchObject({ completedNow: true, section: { total: 2, completedRequired: 1 } });
    expect((await playback('s2', 'V3').expect(200)).body).toMatchObject({ completedNow: false });
    expect((await workspace('s2').expect(200)).body.resume).toMatchObject({ itemId: items['V3'], reason: 'last' });
  });

  it('AC4 — the resume never lands on a closed lesson, and the course is not complete while a closed required lesson is not done', async () => {
    await complete('s1', 'T1').expect(200);
    await complete('s1', 'T2').expect(200);
    // s1 had opened T3 before its level was closed (e.g. the delay was raised afterwards): the last opening, newer than the completions.
    const now = new Date();
    await prisma.learningProgress.create({
      data: { studentUserId: id('s1'), syllabusItemId: items['T3']!, courseId, status: 'in_progress', firstOpenedAt: now, lastOpenedAt: new Date(now.getTime() + 1000) },
      select: { studentUserId: true },
    });
    let body = (await workspace('s1').expect(200)).body as WorkspaceBody;
    expect(body.resume).toEqual({ itemId: items['LOOSE'], reason: 'replaced', positionSeconds: null }); // the first available lesson after it not completed
    expect(body.progress).toMatchObject({ total: 5, required: 5, completedRequired: 2, percent: 40, isComplete: false });

    // Every available lesson done (LOOSE completed earlier than the T3 opening): the first available lesson, never T3 or V3.
    const earlier = new Date(now.getTime() - 3600_000);
    await prisma.learningProgress.create({
      data: {
        studentUserId: id('s1'),
        syllabusItemId: items['LOOSE']!,
        courseId,
        status: 'completed',
        completionSource: 'manual',
        firstOpenedAt: earlier,
        lastOpenedAt: earlier,
        completedAt: earlier,
      },
      select: { studentUserId: true },
    });
    body = (await workspace('s1').expect(200)).body as WorkspaceBody;
    expect(body.resume).toEqual({ itemId: items['T1'], reason: 'replaced', positionSeconds: null });
    expect(body.progress).toMatchObject({ completedRequired: 3, percent: 60, isComplete: false }); // T3 and V3 are locked but required
    const card = ((await learning('s1').expect(200)).body.items as { class: { id: string }; progress: Counts; action: string }[]).find((entry) => entry.class.id === classes['R'])!;
    expect(card).toMatchObject({ action: 'continue', progress: { required: 5, completedRequired: 3, isComplete: false } });
  });
});
