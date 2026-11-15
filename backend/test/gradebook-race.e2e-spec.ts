// TEST-219 — KI-076: a finalization (API-127 `POST /api/classes/:id/final-grades`)
// and the grade-scheme writers (API-124 promotion, API-125 delete) serialise on
// the advisory lock `articode.grade_schemes.default`, against the live
// development database. Skipped when no database is reachable.
//
// Each race is made deterministic by a holder transaction of this suite (a raw
// `pg` connection, always rolled back):
//  - either it keeps the `final_grades` slot of the class's only enrollment
//    with an uncommitted placeholder row, so the finalization stops between its
//    scheme read and its insert — the KI-076 window — while the scheme writer
//    runs;
//  - or it holds the advisory lock itself, so a delete queues before the
//    finalization.
// The waiting requests are found through `pg_blocking_pids()`, never by a
// sleep. Fixtures (a manager with a custom role, students, a published course,
// three running classes with one enrollment and one published weighted exam
// each, fixture schemes) carry a unique prefix and are deleted at the end. The
// promotion test makes a fixture scheme — a copy of the academy's default with
// the same bands — the default for a moment and gives the default back at once,
// under the same advisory lock: never point this suite at a non-dev database.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import request from 'supertest';
import type { Response } from 'supertest';
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
const PREFIX = `GR${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-219 supertest';
const CLASSES = '/api/classes';
const SCHEMES = '/api/grade-schemes';
const SCHEME_LOCK = 'articode.grade_schemes.default';
/** One published exam of weight 100 with a score of 7 / 10: every student's final grade is 70 %. */
const PERCENT = 70;

interface Band {
  minPercent: number;
  label: { ar: string };
  letter: string | null;
  isPass: boolean;
}

interface FinalBody {
  students: { student: { id: string }; final: { percent: number; schemeId: string; label: { ar: string }; letter: string | null; isPass: boolean } | null }[];
  defaultScheme: { id: string } | null;
}

async function canConnect(url: string): Promise<boolean> {
  const probe = new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

/** The band a percentage falls in: the band with the greatest minimum at or below it. */
function bandFor(bands: readonly Band[], percent: number): Band {
  return [...bands].sort((a, b) => b.minPercent - a.minPercent).find((band) => band.minPercent <= percent)!;
}

async function until(condition: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe.skipIf(!available)('KI-076 — finalization vs grade-scheme writers (e2e, TEST-219)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let pool: Pool;
  let courseId: string;
  let defaultId: string;
  let ownDefault = false;
  let defaultBands: Band[] = [];
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const schemeIds: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const students: Record<string, string> = {};
  let token: string;

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = () => ({ Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT });
  /** Sends the request now (supertest is lazy) and resolves with the response. */
  const send = (test: PromiseLike<Response>): Promise<Response> => new Promise((resolve, reject) => test.then(resolve, reject));
  const finalize = (suffix: string, body: object) => api().post(`${CLASSES}/${classes[suffix]}/final-grades`).set(bearer()).send(body);
  const deleteScheme = (key: string) => api().delete(`${SCHEMES}/${schemeIds[key]}`).set(bearer());
  const patchScheme = (id: string, body: object) => api().patch(`${SCHEMES}/${id}`).set(bearer()).send(body);

  /** The sessions waiting on a lock held — or queued ahead of them — by `pid`. */
  async function blockedBy(pid: number): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY (pg_blocking_pids(pid))`;
    return rows.map((row) => row.pid);
  }

  /** A transaction of this suite that keeps its locks until `release()` rolls it back. */
  async function hold(lock: (client: PoolClient) => Promise<void>): Promise<{ pid: number; release: () => Promise<void> }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await lock(client);
      return {
        pid,
        release: async () => {
          try {
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw error;
    }
  }

  /** Keeps the final_grades slot of the enrollment with an uncommitted placeholder on the `hold` scheme: a finalization of that class waits in its insert. */
  const holdFinalGradeSlot = (enrollmentKey: string) =>
    hold(async (client) => {
      await client.query(
        `INSERT INTO final_grades (enrollment_id, percent, scheme_id, band_label, band_letter, is_pass, breakdown)
         VALUES ($1::uuid, 1, $2::uuid, '{"ar":"مؤقت"}'::jsonb, NULL, false, '[]'::jsonb)`,
        [enrollments[enrollmentKey], schemeIds['hold']],
      );
    });

  /** Holds the advisory lock of the grade-scheme writers, as a scheme write in progress would. */
  const holdSchemeLock = () =>
    hold(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SCHEME_LOCK]);
    });

  /** Settles a pending request and records that it did. */
  function tracked(pending: Promise<Response>): { done: () => boolean; response: Promise<Response> } {
    let settled = false;
    const response = pending.finally(() => (settled = true));
    return { done: () => settled, response };
  }

  async function createScheme(key: string, bands: readonly Band[]): Promise<void> {
    const row = await prisma.gradeScheme.create({
      data: { name: { ar: `${PREFIX} ${key}` }, bands: { create: bands.map((band) => ({ minPercent: band.minPercent, label: band.label, letter: band.letter, isPass: band.isPass })) } },
      select: { id: true },
    });
    schemeIds[key] = row.id;
  }

  async function storedBands(schemeId: string): Promise<Band[]> {
    const rows = await prisma.gradeSchemeBand.findMany({ where: { schemeId }, orderBy: { minPercent: 'asc' }, select: { minPercent: true, label: true, letter: true, isPass: true } });
    return rows.map((row) => ({ minPercent: Number(row.minPercent), label: row.label as { ar: string }, letter: row.letter, isPass: row.isPass }));
  }

  /** A running class with one active student and one published exam of weight 100 scored 7 / 10 — ready to finalize. */
  async function createClass(suffix: string): Promise<void> {
    const klass = await prisma.class.create({ data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 5, status: 'running' }, select: { id: true } });
    classes[suffix] = klass.id;
    const enrollment = await prisma.enrollment.create({ data: { classId: klass.id, studentUserId: students[suffix]!, status: 'active', activatedAt: new Date() }, select: { id: true } });
    enrollments[suffix] = enrollment.id;
    await prisma.exam.create({
      data: {
        classId: klass.id,
        title: { ar: 'الاختبار' },
        type: 'final',
        status: 'published',
        publishedAt: new Date(),
        maxScore: 10,
        weight: 100,
        results: { create: [{ studentUserId: students[suffix]!, status: 'scored', score: 7 }] },
      },
      select: { id: true },
    });
  }

  /** Gives the academy its default back if a fixture scheme holds it — under the writers' lock, so no other write is undone. */
  async function restoreDefault(): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SCHEME_LOCK}))`;
      const current = await tx.gradeScheme.findFirst({ where: { isDefault: true }, select: { id: true } });
      if (!current || current.id === defaultId || !Object.values(schemeIds).includes(current.id)) return;
      await tx.gradeScheme.update({ where: { id: current.id }, data: { isDefault: false } });
      await tx.gradeScheme.update({ where: { id: defaultId }, data: { isDefault: true, isActive: true } });
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

    const passwordHash = await new PasswordService().hash(PASSWORD);
    const role = await prisma.role.create({
      data: {
        key: `test_grrace_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار السباق' },
        permissions: { create: ['classes.read', 'classes.manage', 'grades.read_all', 'grades.manage', 'academy.settings.read', 'academy.settings.manage'].map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    const manager = await prisma.user.create({ data: { email: email('manager'), fullName: 'Test manager', passwordHash, status: 'active', roles: { create: [{ roleId: role.id }] } }, select: { id: true } });
    createdUserIds.push(manager.id);
    token = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email('manager'), password: PASSWORD }).expect(200)).body.accessToken as string;
    const studentRole = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    for (const suffix of ['A', 'B', 'C']) {
      const user = await prisma.user.create({ data: { email: email(`s${suffix}`), fullName: `Test student ${suffix}`, passwordHash, status: 'active', roles: { create: [{ roleId: studentRole }] } }, select: { id: true } });
      createdUserIds.push(user.id);
      students[suffix] = user.id;
    }

    const passFail: Band[] = [
      { minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false },
      { minPercent: 50, label: { ar: 'ناجح' }, letter: 'P', isPass: true },
    ];
    const current = await prisma.gradeScheme.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (current) {
      defaultId = current.id;
    } else {
      // A database without a default (no seed run): a fixture default, deleted at the end.
      await createScheme('default', passFail);
      defaultId = schemeIds['default']!;
      await prisma.gradeScheme.update({ where: { id: defaultId }, data: { isDefault: true } });
      ownDefault = true;
    }
    defaultBands = await storedBands(defaultId);
    await createScheme('hold', passFail); // the placeholder rows of the holder
    await createScheme('deleteLate', passFail); // deleted while a finalization waits with it
    await createScheme('deleteFirst', passFail); // deleted before a queued finalization
    await createScheme('promoted', defaultBands); // promoted while a finalization uses the default — the same bands, so nothing else in the shared DB grades differently

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة السباق' }, status: 'published' }, select: { id: true } })).id;
    for (const suffix of ['A', 'B', 'C']) await createClass(suffix);
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await restoreDefault().catch(() => undefined);
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: Object.values(classes) } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        const fixtureSchemes = Object.entries(schemeIds)
          .filter(([key]) => key !== 'default' || ownDefault)
          .map(([, id]) => id);
        await prisma.gradeScheme.deleteMany({ where: { id: { in: fixtureSchemes }, finalGrades: { none: {} } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); // their notifications go with them (Cascade)
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await pool?.end();
      await app?.close();
    }
  });

  it('a delete of the chosen scheme while the finalization waits between its scheme read and its insert: the delete waits, the finalization keeps the scheme (200), the delete is 409 grade_scheme_in_use — never a 500', async () => {
    const holder = await holdFinalGradeSlot('A');
    let finalizing: ReturnType<typeof tracked> | undefined;
    let deleting: ReturnType<typeof tracked> | undefined;
    try {
      finalizing = tracked(send(finalize('A', { schemeId: schemeIds['deleteLate'] })));
      let finalizePid = 0;
      expect(
        await until(async () => {
          finalizePid = (await blockedBy(holder.pid))[0] ?? 0;
          return finalizePid > 0;
        }),
        'the finalization waits on the held final_grades slot',
      ).toBe(true);
      deleting = tracked(send(deleteScheme('deleteLate')));
      // Fixed: the delete queues behind the finalization's lock. Before the fix it committed at once.
      await until(async () => deleting!.done() || (await blockedBy(finalizePid)).length > 0);
    } finally {
      await holder.release();
    }
    const [finalized, deleted] = await Promise.all([finalizing!.response, deleting!.response]);
    expect([finalized.status, deleted.status], JSON.stringify({ finalize: finalized.body, delete: deleted.body })).not.toContain(500);
    expect([finalized.status, deleted.status]).toEqual([200, 409]);
    expect(deleted.body).toMatchObject({ code: 'grade_scheme_in_use', finalGradeCount: 1 });
    const final = (finalized.body as FinalBody).students[0]!.final!;
    expect(final).toMatchObject({ percent: PERCENT, schemeId: schemeIds['deleteLate'], letter: 'P', isPass: true });
    const stored = await prisma.finalGrade.findUniqueOrThrow({ where: { enrollmentId: enrollments['A']! } });
    expect(stored.schemeId).toBe(schemeIds['deleteLate']);
    expect(await prisma.gradeScheme.count({ where: { id: schemeIds['deleteLate']! } })).toBe(1);
  });

  it('a delete that holds the writers’ lock first: the finalization queues behind it and answers 404 grade_scheme_not_found, the delete 204 — nothing is written', async () => {
    const holder = await holdSchemeLock();
    let deleting: ReturnType<typeof tracked> | undefined;
    let finalizing: ReturnType<typeof tracked> | undefined;
    try {
      deleting = tracked(send(deleteScheme('deleteFirst')));
      expect(await until(async () => (await blockedBy(holder.pid)).length >= 1), 'the delete waits on the held lock').toBe(true);
      finalizing = tracked(send(finalize('B', { schemeId: schemeIds['deleteFirst'] })));
      // Fixed: the finalization queues on the same lock, behind the delete. Before the fix it never waited.
      await until(async () => finalizing!.done() || (await blockedBy(holder.pid)).length >= 2);
    } finally {
      await holder.release();
    }
    const [deleted, finalized] = await Promise.all([deleting!.response, finalizing!.response]);
    expect([finalized.status, deleted.status], JSON.stringify({ finalize: finalized.body, delete: deleted.body })).not.toContain(500);
    expect([finalized.status, deleted.status]).toEqual([404, 204]);
    expect(finalized.body).toMatchObject({ code: 'grade_scheme_not_found', schemeId: schemeIds['deleteFirst'] });
    expect(await prisma.finalGrade.count({ where: { enrollmentId: enrollments['B']! } })).toBe(0);
    expect(await prisma.gradeScheme.count({ where: { id: schemeIds['deleteFirst']! } })).toBe(0);
  });

  it('a promotion while a finalization with the default waits: the promotion waits, the grades carry the default’s id and band, and the answer names that scheme as the default', async () => {
    const holder = await holdFinalGradeSlot('C');
    let finalizing: ReturnType<typeof tracked> | undefined;
    let promoting: ReturnType<typeof tracked> | undefined;
    try {
      try {
        finalizing = tracked(send(finalize('C', {})));
        let finalizePid = 0;
        expect(
          await until(async () => {
            finalizePid = (await blockedBy(holder.pid))[0] ?? 0;
            return finalizePid > 0;
          }),
          'the finalization waits on the held final_grades slot',
        ).toBe(true);
        promoting = tracked(send(patchScheme(schemeIds['promoted']!, { isDefault: true })));
        // Fixed: the promotion queues behind the finalization. Before the fix it committed at once.
        await until(async () => promoting!.done() || (await blockedBy(finalizePid)).length > 0);
      } finally {
        await holder.release();
      }
      const [finalized, promoted] = await Promise.all([finalizing!.response, promoting!.response]);
      expect([finalized.status, promoted.status], JSON.stringify({ finalize: finalized.body, promote: promoted.body })).toEqual([200, 200]);
      expect(promoted.body).toMatchObject({ isDefault: true });
      const body = finalized.body as FinalBody;
      const final = body.students[0]!.final!;
      expect(final.schemeId).toBe(defaultId);
      expect(body.defaultScheme?.id, 'the scheme the grades were fixed with was still the default when they were').toBe(defaultId);
      const stored = await prisma.finalGrade.findUniqueOrThrow({ where: { enrollmentId: enrollments['C']! } });
      expect(stored.schemeId).toBe(defaultId);
      const band = bandFor(await storedBands(stored.schemeId), PERCENT);
      expect({ label: stored.bandLabel, letter: stored.bandLetter, isPass: stored.isPass }).toEqual({ label: band.label, letter: band.letter, isPass: band.isPass });
      expect({ label: final.label, letter: final.letter, isPass: final.isPass }).toEqual({ label: band.label, letter: band.letter, isPass: band.isPass });
    } finally {
      await restoreDefault();
    }
    expect((await prisma.gradeScheme.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } })).id).toBe(defaultId);
  });
});
