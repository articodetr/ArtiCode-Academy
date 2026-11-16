// TEST-222 — KI-079: a long announcement (API-173) holds a key-share lock on
// the `users` row of every recipient and of its sender until it commits (the
// foreign keys of the inserted rows). The writers that lock a `users` row —
// a guardian link (`lockStudent()` of guardians.service.ts) and the admin scan
// of a status or role change (`lockActiveAdmins()` of users.service.ts) — take
// `FOR NO KEY UPDATE`, which does not conflict with `FOR KEY SHARE`, so they no
// longer wait for that commit. With `FOR UPDATE` each of these requests waited
// for the announcement and failed past Prisma's 5 s transaction timeout.
//
// The suite holds a real «announcement in flight» on its own fixture rows only:
// a second connection opens a transaction, inserts an announcement whose
// sender is the fixture admin and one notification per fixture recipient, and
// keeps it open (then rolls it back — nothing it wrote is ever committed). While
// it is held, the API must answer quickly. Skipped when no database is
// reachable. Fixture users carry a unique suffix and are deleted at the end
// (cascade removes their roles, links and tokens; their audit rows stay — the
// log is append-only). The admin scan of the shared dev DB is only read and
// row-locked by the API itself, never by this suite.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { ACADEMY_ADMIN_ROLE_KEY } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USERS = '/api/users';
/**
 * A request that does not wait for the held transaction answers well inside
 * this — below Prisma's 5 s transaction timeout, the limit KI-079 broke. The
 * sharper check is `stillHeld()`: a request that waited could only answer
 * after the release.
 */
const FAST_MS = 4_000;
/** Safety net: the held transaction is released after this even if a request waits for it (the old lock mode). */
const SAFETY_RELEASE_MS = 10_000;
/** Prisma's limit for the holder; above the safety net, so the holder never expires on its own. */
const HOLD_TIMEOUT_MS = 20_000;
const ROLLBACK = 'TEST-222: roll the announcement in flight back';
/** PostgreSQL `lock_not_available`, raised by NOWAIT. */
const LOCK_NOT_AVAILABLE = /55P03|could not obtain lock/i;

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

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const meta = (error as { meta?: unknown }).meta;
  return `${error.message} ${meta === undefined ? '' : JSON.stringify(meta)}`;
}

describe.skipIf(!available)('KI-079 user-row locks vs an announcement in flight (e2e, TEST-222)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const fx: Record<string, string> = {};
  let callerToken = '';

  // E-mail addresses are stored lower-case (CHECK ck_users_email_lowercase).
  const email = (name: string) => `lock-${name.toLowerCase()}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const id = (name: string): string => {
    const value = fx[name];
    if (value === undefined) throw new Error(`unknown fixture ${name}`);
    return value;
  };

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Lock ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  /** Every recipient of the announcement in flight; the sender is the calling admin. */
  const recipients = (): string[] => ['student', 'guardian', 'targetAdmin', 'rolesAdmin'].map(id);

  /** `FOR UPDATE NOWAIT` is refused on each row: the key-share lock of the holder is really there. */
  async function expectKeyShareLocked(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) {
      let failure: unknown = null;
      try {
        await prisma.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE NOWAIT`;
      } catch (error) {
        failure = error;
      }
      expect(failure, `FOR UPDATE NOWAIT on ${userId}`).not.toBeNull();
      expect(errorText(failure)).toMatch(LOCK_NOT_AVAILABLE);
    }
  }

  /**
   * Runs `work` while a second connection holds an open transaction that has
   * inserted an announcement (sender = the calling admin) and one
   * notification per fixture recipient — exactly the locks API-173 holds
   * while it writes. The transaction is rolled back afterwards; `work` gets a
   * probe telling whether it is still open.
   */
  async function withAnnouncementInFlight(work: (stillHeld: () => boolean) => Promise<void>): Promise<void> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let settled = false;
    const holder = prisma
      .$transaction(
        async (tx) => {
          const to = recipients();
          const announcement = await tx.announcement.create({
            data: {
              senderUserId: id('caller'),
              audience: { kind: 'academy', roleKeys: ['student', 'guardian', 'staff'] },
              title: 'TEST-222 announcement in flight',
              body: 'Held open while the API writes.',
              recipientCount: to.length,
            },
            select: { id: true },
          });
          await tx.notification.createMany({
            data: to.map((recipientUserId) => ({
              recipientUserId,
              eventKey: 'announcement',
              category: 'announcements' as const,
              title: 'TEST-222 announcement in flight',
              body: 'Held open while the API writes.',
              data: { link: '/notifications', announcementId: announcement.id },
              announcementId: announcement.id,
            })),
          });
          markHeld();
          await released;
          throw new Error(ROLLBACK);
        },
        { timeout: HOLD_TIMEOUT_MS, maxWait: 5_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
      })
      .finally(() => {
        settled = true;
      });
    const safety = setTimeout(release, SAFETY_RELEASE_MS);
    try {
      await Promise.race([
        held,
        holder.then(() => {
          throw new Error('the announcement in flight ended before it was held');
        }),
      ]);
      await expectKeyShareLocked([id('caller'), ...recipients()]);
      await work(() => !settled);
    } finally {
      clearTimeout(safety);
      release();
      await holder;
    }
    // Nothing the holder wrote survives the rollback.
    expect(await prisma.announcement.count({ where: { senderUserId: id('caller') } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientUserId: { in: recipients() } } })).toBe(0);
  }

  /** Sends a request and measures how long the API took to answer it. */
  async function timed<T>(send: () => Promise<T>): Promise<{ res: T; ms: number }> {
    const started = performance.now();
    const res = await send();
    return { res, ms: performance.now() - started };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const systemRoles = await prisma.role.findMany({
      where: { key: { in: [ACADEMY_ADMIN_ROLE_KEY, 'student', 'guardian'] } },
      select: { id: true, key: true },
    });
    const role = (key: string): string => {
      const found = systemRoles.find((row) => row.key === key);
      if (!found) throw new Error(`system role ${key} is not seeded`);
      return found.id;
    };

    // The caller and two more fixture admins: the targets are never the last
    // active admin, and the suite never touches anyone else's admin account.
    await createUser('caller', [role(ACADEMY_ADMIN_ROLE_KEY)]);
    await createUser('targetAdmin', [role(ACADEMY_ADMIN_ROLE_KEY)]);
    await createUser('rolesAdmin', [role(ACADEMY_ADMIN_ROLE_KEY)]);
    await createUser('student', [role('student')]);
    await createUser('guardian', [role('guardian')]);
    const login = await api().post('/api/auth/login').send({ identifier: email('caller'), password: PASSWORD }).expect(200);
    callerToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma?.$disconnect();
    await app?.close();
  });

  it('links a guardian to a student whose row an announcement holds key-share locked, without waiting (lockStudent)', async () => {
    await withAnnouncementInFlight(async (stillHeld) => {
      // The student's row still takes a no-key update while the announcement is open.
      await prisma.$queryRaw`SELECT id FROM users WHERE id = ${id('student')}::uuid FOR NO KEY UPDATE NOWAIT`;

      const { res, ms } = await timed(() =>
        api()
          .post(`${USERS}/${id('student')}/guardians`)
          .set({ Authorization: `Bearer ${callerToken}` })
          .send({ guardianId: id('guardian'), relationship: 'mother' }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(ms).toBeLessThan(FAST_MS);
      expect(stillHeld()).toBe(true);
    });
    const link = await prisma.guardianStudent.findUnique({
      where: { guardianUserId_studentUserId: { guardianUserId: id('guardian'), studentUserId: id('student') } },
      select: { relationship: true },
    });
    expect(link).toEqual({ relationship: 'mother' });
  }, 60_000);

  it('suspends an academy admin whose row (and the caller’s) an announcement holds key-share locked, without waiting (lockActiveAdmins)', async () => {
    await withAnnouncementInFlight(async (stillHeld) => {
      const { res, ms } = await timed(() =>
        api()
          .post(`${USERS}/${id('targetAdmin')}/status`)
          .set({ Authorization: `Bearer ${callerToken}` })
          .send({ action: 'suspend' }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('suspended');
      expect(ms).toBeLessThan(FAST_MS);
      expect(stillHeld()).toBe(true);
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: id('targetAdmin') }, select: { status: true } })).status).toBe('suspended');
  }, 60_000);

  it('changes the roles of an academy admin whose row an announcement holds key-share locked, without waiting (lockActiveAdmins)', async () => {
    await withAnnouncementInFlight(async (stillHeld) => {
      const { res, ms } = await timed(() =>
        api()
          .put(`${USERS}/${id('rolesAdmin')}/roles`)
          .set({ Authorization: `Bearer ${callerToken}` })
          .send({ roleKeys: [ACADEMY_ADMIN_ROLE_KEY, 'guardian'] }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(ms).toBeLessThan(FAST_MS);
      expect(stillHeld()).toBe(true);
    });
    const keys = await prisma.userRole.findMany({ where: { userId: id('rolesAdmin') }, select: { role: { select: { key: true } } } });
    expect(keys.map((grant) => grant.role.key).sort()).toEqual([ACADEMY_ADMIN_ROLE_KEY, 'guardian']);
  }, 60_000);
});
