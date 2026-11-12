// TEST-030 — MOD-03-T10 audit coverage of every writer route of T02..T09 and
// the filters of GET /api/audit-logs (API-011) against the live development
// database; since CH-0051 (MOD-04-T07 backend half, task C2) also every writer
// route of MOD-04 T02..T04 (levels, courses, syllabus); since CH-0104
// (MOD-06-T05) also every writer route of MOD-06 T02/T03 (lessons,
// attendance); since CH-0109 (the Stage 3 gate, task C5) also every writer
// route of MOD-05 T02..T04 (classes, class teachers, enrollments) and of
// MOD-07 T02/T03/T05 (rooms, the weekly schedule, lesson generation); since
// CH-0179 (the Stage 4 gate, MOD-10-T05) also every writer route of MOD-08
// (assignments, submissions and reviews), MOD-09 (grade schemes, exams, their
// results, final grades) and MOD-10 (issuing and revoking certificates); since
// CH-0196 (MOD-13-T05, Stage 5) also every writer route of MOD-11 (fee plans,
// invoices, the class batch, payments and reversals) and the proof that the
// MOD-13 reports record nothing; since CH-0206 (MOD-12-T06, the closure of the
// notifications module) also its one recording writer — a manual announcement —
// and the proof that nothing else of MOD-12 records an event: an automatic
// notification, reading announcements, «my notifications», the unread
// counter, the read marks and the e-mail preferences (D-R86).
// Skipped when no database is reachable. Fixtures carry a unique suffix and are deleted at the
// end (their audit rows stay with a NULL actor — the log is append-only by
// design, KI-032).
//
// Counting strategy: events are read back by actor. Every actor here is a
// fixture of this run, so events written meanwhile by other clients of the
// shared development database (another session's dev server, another e2e
// file) never land in the counts.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readSettings } from '../src/academy/academy.settings.js';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { assertNoSecrets } from '../src/audit/audit.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { AnnouncementsService } from '../src/notifications/announcements.service.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const INVITE_PASSWORD = 'Invited-Horse-Battery-7';
const RESET_PASSWORD = 'Reset-Horse-Battery-8';
const USER_AGENT = 'TEST-030 supertest';
const USERS = '/api/users';
const AUDIT = '/api/audit-logs';
const LEVELS = '/api/levels';
const COURSES = '/api/courses';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const ROOMS = '/api/rooms';
const ANNOUNCEMENTS = '/api/announcements';
const INBOX = '/api/me/notifications';
const PREFERENCES = '/api/me/notification-preferences';
/** MOD-04 fixture codes (upper case, within LEVEL_CODE_PATTERN / COURSE_CODE_PATTERN). */
const LEVEL_PREFIX = `T${RUN.toUpperCase()}`;
const COURSE_PREFIX = `C${RUN.toUpperCase()}`;
/** Class codes: the MOD-06 fixture class `-A` (created with Prisma) and the MOD-05/MOD-07 classes `-B`/`-C` created through the API (CH-0109). */
const CLASS_PREFIX = `L${RUN.toUpperCase()}`;
/** MOD-07 fixture room codes (ROOM_CODE_PATTERN = LEVEL_CODE_PATTERN: 16 characters at most). */
const ROOM_PREFIX = `R${RUN.toUpperCase()}`;
/** A past calendar week (Sunday to Saturday): every weekday occurs once, so one weekly slot generates exactly one lesson. */
const GENERATION_FROM = '2026-02-01';
const GENERATION_TO = '2026-02-07';
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

interface Item {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ExpectedEvent {
  action: string;
  actorUserId: string;
  entityType?: string;
  /** null for events about a whole collection (levels.reordered). */
  entityId: string | null;
  metadata?: Record<string, unknown>;
}

describe.skipIf(!available)('MOD-03-T10 audit coverage and audit-log filters (e2e, TEST-030)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** One-time tokens handed over by the API — must never appear in the log. */
  const secrets: string[] = [PASSWORD, INVITE_PASSWORD, RESET_PASSWORD];
  let customRoleId = '';
  /** MOD-04 fixtures created through the API by the admin. */
  const mod04 = { levelA: '', levelB: '', courseA: '', courseB: '' };
  /** MOD-06 fixtures: the class (Prisma, on courseA) and the lessons created through the API by the admin. */
  const mod06 = { classId: '', classCode: '', lesson1: '', lesson2: '' };
  /** MOD-05 fixtures created through the API by the admin (CH-0109): the class `-B` on courseA and the enrollment of `enrolled` in it. */
  const mod05 = { classId: '', enrollmentId: '' };
  /** MOD-07 fixtures created through the API by the admin (CH-0109): the room, the weekly slot of class `-B`, the lesson generated from it, and the slot's weekday (the academy's first working day). */
  const mod07 = { roomId: '', slotId: '', lessonId: '', weekday: 0 };
  /** Stage 4 (MOD-08..MOD-10, MOD-10-T05): the class, its assignment, the graded attempt, the exam, the grade schemes and the certificate. */
  const stage4 = { classId: '', assignmentId: '', submissionId: '', examId: '', certificateId: '', schemeIds: [] as string[] };
  const stage5 = { classId: '', feePlanId: '', invoiceId: '', paymentId: '' };
  /** MOD-12 (MOD-12-T06): the class `-N` (lead = instructor, the learner enrolled), the announcement the admin sent to it, and the instructor's copy of it — a notification nobody marks. */
  const mod12 = { classId: '', announcementId: '', unreadNotificationId: '' };

  // E-mail addresses are stored lower-case (CHECK ck_users_email_lowercase).
  const email = (name: string) => `${name.toLowerCase()}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const anonymous = () => ({ 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string, password = PASSWORD): Promise<string> {
    const res = await api().post('/api/auth/login').set(anonymous()).send({ identifier, password }).expect(200);
    return res.body.accessToken as string;
  }

  /** Id of the newest event (UUIDv7 = insertion order); events of a step are those above it. */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const since = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  /** The step wrote exactly the expected events (in order) by the fixture actors — and nothing else. */
  async function expectEvents(markId: string, expected: ExpectedEvent[]): Promise<void> {
    const rows = await since(markId);
    expect(rows.map((row) => row.action)).toEqual(expected.map((event) => event.action));
    rows.forEach((row, index) => {
      const want = expected[index]!;
      expect(row.actorUserId).toBe(want.actorUserId);
      expect(row.entityType).toBe(want.entityType ?? 'users');
      expect(row.entityId).toBe(want.entityId);
      if (want.metadata) expect(row.metadata).toMatchObject(want.metadata);
      // requestContext() reached the event: the loopback peer and the agent header sent by this suite.
      expect(row.ipAddress).toMatch(/127\.0\.0\.1|::1/);
      expect(row.userAgent).toBe(USER_AGENT);
    });
  }

  const listAs = (caller: string, query: string) => api().get(`${AUDIT}?${query}`).set(bearer(caller));
  const items = async (caller: string, query: string): Promise<{ items: Item[]; nextCursor: string | null }> =>
    (await listAs(caller, query).expect(200)).body;
  const dbIds = async (where: Record<string, unknown>) =>
    (await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, select: { id: true } })).map((row) => row.id);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const superuser = await createRole('superuser', PERMISSION_KEYS);
    const auditor = await createRole('auditor', ['audit.read']);
    await createUser('admin', [superuser]);
    await createUser('auditor', [auditor]);
    await createUser('plain');
    // Enrolled in the MOD-06 class and in the MOD-05 class; holds the seeded student role and acts only as the learner — the submissions of Stage 4, «my notifications» of MOD-12 (the name "student" belongs to the T02 block).
    await createUser('enrolled', [(await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id]);
    // Lead teacher of the MOD-05 class; holds the seeded teacher role and acts only in the MOD-12 refusals — a sender with `notifications.send` and without `classes.manage` (the T02 "teacher" is suspended by the T06 block).
    await createUser('instructor', [(await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id]);
    for (const name of ['admin', 'auditor', 'plain']) tokens[name] = await login(email(name));
    const academy = await prisma.academy.findFirstOrThrow({ select: { settings: true } });
    mod07.weekday = (readSettings(academy.settings).scheduling.workingDays ?? [0])[0]!;
  });

  afterAll(async () => {
    try {
      // MOD-12: an announcement outlives its sender and its class (both SET NULL), so it is found — and deleted — while they still exist; its notifications go with it (Cascade).
      await prisma.announcement.deleteMany({ where: { OR: [{ senderUserId: { in: createdUserIds } }, { class: { code: { startsWith: CLASS_PREFIX } } }] } });
      // MOD-05/MOD-06 first: the enrollments (Restrict on the class), then the classes (their teachers, slots, lessons and attendance cascade) — a course is Restrict on classes, a room on slots and lessons.
      // Stage 5: payments hold their invoice and invoices their student (Restrict) — both go first; fee plans go with their class.
      const fixtureInvoices = await prisma.invoice.findMany({ where: { studentUserId: { in: createdUserIds } }, select: { id: true } });
      if (fixtureInvoices.length > 0) {
        await prisma.payment.deleteMany({ where: { invoiceId: { in: fixtureInvoices.map((row) => row.id) } } });
        await prisma.invoice.deleteMany({ where: { id: { in: fixtureInvoices.map((row) => row.id) } } });
      }
      // Stage 4: certificates first (they restrict the enrollment and the class); the final grades go with the enrollments, the schemes after them.
      await prisma.certificate.deleteMany({ where: { class: { code: { startsWith: CLASS_PREFIX } } } });
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: CLASS_PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: CLASS_PREFIX } } });
      await prisma.room.deleteMany({ where: { code: { startsWith: ROOM_PREFIX } } });
      if (stage4.schemeIds.length > 0) await prisma.gradeScheme.deleteMany({ where: { id: { in: stage4.schemeIds } } });
      // Courses next: their level is Restrict.
      await prisma.course.deleteMany({ where: { code: { startsWith: COURSE_PREFIX } } });
      await prisma.level.deleteMany({ where: { code: { startsWith: LEVEL_PREFIX } } });
    } finally {
      // The run's users and roles go even when the MOD-04 cleanup throws.
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('T02 — POST /api/users records exactly one users.created per account, inside its transaction', async () => {
    for (const [name, kind] of [
      ['teacher', 'teacher'],
      ['student', 'student'],
      ['guardian', 'guardian'],
    ] as const) {
      const m = await mark();
      const res = await api().post(USERS).set(bearer('admin')).send({ kind, email: email(name), fullName: `T10 ${name}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      fx[name] = res.body.id;
      createdUserIds.push(res.body.id);
      await expectEvents(m, [
        {
          action: 'users.created',
          actorUserId: fx['admin']!,
          entityId: res.body.id,
          metadata: { kind, roles: [kind], profile: kind === 'guardian' ? null : kind === 'student' ? 'student' : 'employee' },
        },
      ]);
    }
  });

  it('T03 — the invitation is issued (one event by the issuer) and accepted (acceptance + session by the invitee)', async () => {
    const issued = await mark();
    const invitation = await api().post(`${USERS}/${fx['teacher']}/invitations`).set(bearer('admin')).expect(201);
    secrets.push(invitation.body.token, invitation.body.link);
    await expectEvents(issued, [
      {
        action: 'users.invitation.issued',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { roles: ['teacher'], superseded: 0 },
      },
    ]);

    const accepted = await mark();
    await api()
      .post(`/api/account/invitations/${invitation.body.token}/accept`)
      .set(anonymous())
      .send({ password: INVITE_PASSWORD })
      .expect(200);
    await expectEvents(accepted, [
      { action: 'users.invitation.accepted', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { roles: ['teacher'] } },
      { action: 'auth.login.succeeded', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { via: 'invitation' } },
    ]);
  });

  it('T04 — PATCH /api/users/:id records one users.updated carrying field names only', async () => {
    const m = await mark();
    await api().patch(`${USERS}/${fx['teacher']}`).set(bearer('admin')).send({ displayName: 'Audited Teacher' }).expect(200);
    await expectEvents(m, [
      { action: 'users.updated', actorUserId: fx['admin']!, entityId: fx['teacher']!, metadata: { fields: ['displayName'] } },
    ]);
  });

  it('T05 — the reset is issued (one event by the issuer) and confirmed (reset + session by the account holder)', async () => {
    const issued = await mark();
    const reset = await api().post(`${USERS}/${fx['teacher']}/password-reset`).set(bearer('admin')).expect(201);
    secrets.push(reset.body.token, reset.body.link);
    await expectEvents(issued, [
      {
        action: 'users.password_reset.issued',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { via: 'admin', superseded: 0 },
      },
    ]);

    const confirmed = await mark();
    await api()
      .post(`/api/account/password-reset/${reset.body.token}/confirm`)
      .set(anonymous())
      .send({ newPassword: RESET_PASSWORD })
      .expect(200);
    await expectEvents(confirmed, [
      { action: 'auth.password.reset', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { revokedSessions: 1 } },
      { action: 'auth.login.succeeded', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { via: 'password_reset' } },
    ]);
  });

  it('T08 — role create, label update, permission replacement and delete record one event each', async () => {
    const key = `test_t10_${RUN}`;
    let m = await mark();
    const created = await api()
      .post('/api/roles')
      .set(bearer('admin'))
      .send({ key, label: { ar: 'دور T10' }, permissions: ['courses.read'] })
      .expect(201);
    customRoleId = created.body.id;
    createdRoleIds.push(customRoleId);
    await expectEvents(m, [
      { action: 'roles.created', actorUserId: fx['admin']!, entityType: 'roles', entityId: customRoleId, metadata: { key, permissions: ['courses.read'] } },
    ]);

    m = await mark();
    await api().patch(`/api/roles/${customRoleId}`).set(bearer('admin')).send({ label: { ar: 'دور T10 معدَّل' } }).expect(200);
    await expectEvents(m, [
      { action: 'roles.updated', actorUserId: fx['admin']!, entityType: 'roles', entityId: customRoleId, metadata: { key, fields: ['label'] } },
    ]);

    m = await mark();
    await api().patch(`/api/roles/${customRoleId}`).set(bearer('admin')).send({ permissions: ['courses.read', 'users.read'] }).expect(200);
    await expectEvents(m, [
      {
        action: 'roles.permissions.changed',
        actorUserId: fx['admin']!,
        entityType: 'roles',
        entityId: customRoleId,
        metadata: { key, added: ['users.read'], removed: [], fields: [] },
      },
    ]);

    m = await mark();
    await api().delete(`/api/roles/${customRoleId}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      {
        action: 'roles.deleted',
        actorUserId: fx['admin']!,
        entityType: 'roles',
        entityId: customRoleId,
        metadata: { key, permissions: ['courses.read', 'users.read'] },
      },
    ]);
  });

  it('rejected and invalid requests record nothing — validation, constraint, permission, business-rule failures', async () => {
    const m = await mark();
    await api().post(USERS).set(bearer('admin')).send({ kind: 'teacher' }).expect(400);
    expect((await api().post(USERS).set(bearer('admin')).send({ kind: 'guardian', email: email('teacher'), fullName: 'Dup' }).expect(409)).body.code).toBe(
      'email_in_use',
    );
    expect((await api().patch(`${USERS}/${fx['teacher']}`).set(bearer('admin')).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await api().post('/api/roles').set(bearer('plain')).send({ key: `test_denied_${RUN}`, label: { ar: 'x' }, permissions: [] }).expect(403)).body.code).toBe(
      'permission_denied',
    );
    expect(
      (await api().post(`${USERS}/${fx['student']}/guardians`).set(bearer('admin')).send({ guardianId: fx['plain'], relationship: 'other' }).expect(422)).body
        .code,
    ).toBe('not_a_guardian');
    expect((await api().post(`${USERS}/${fx['teacher']}/status`).set(bearer('admin')).send({ action: 'activate' }).expect(409)).body.code).toBe(
      'invalid_transition',
    );
    await api().put(`${USERS}/${fx['teacher']}/roles`).set(bearer('admin')).send({ roleKeys: ['no_such_role'] }).expect(400);
    await listAs('admin', 'limit=5').expect(200);
    expect(await since(m)).toEqual([]);
  });

  it('T07 — PUT /api/users/:id/roles records one users.roles.changed with the diff', async () => {
    const m = await mark();
    await api().put(`${USERS}/${fx['teacher']}/roles`).set(bearer('admin')).send({ roleKeys: ['teacher', 'guardian'] }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.roles.changed',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { added: ['guardian'], removed: [], roles: ['guardian', 'teacher'] },
      },
    ]);
  });

  it('T09 — guardian link, update and unlink record one event each on the student', async () => {
    let m = await mark();
    await api()
      .post(`${USERS}/${fx['student']}/guardians`)
      .set(bearer('admin'))
      .send({ guardianId: fx['guardian'], relationship: 'father', isPrimary: true })
      .expect(201);
    await expectEvents(m, [
      {
        action: 'guardians.linked',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], studentUserId: fx['student'], relationship: 'father', isPrimary: true },
      },
    ]);

    m = await mark();
    await api().patch(`${USERS}/${fx['student']}/guardians/${fx['guardian']}`).set(bearer('admin')).send({ relationship: 'mother' }).expect(200);
    await expectEvents(m, [
      {
        action: 'guardians.updated',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], relationship: 'mother', isPrimary: true, fields: ['relationship'] },
      },
    ]);

    m = await mark();
    await api().delete(`${USERS}/${fx['student']}/guardians/${fx['guardian']}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      {
        action: 'guardians.unlinked',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], relationship: 'mother', isPrimary: true },
      },
    ]);
  });

  it('T06 — suspend records one users.status.changed, soft delete one users.deleted', async () => {
    let m = await mark();
    await api().post(`${USERS}/${fx['teacher']}/status`).set(bearer('admin')).send({ action: 'suspend', reason: 'T10 coverage' }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.status.changed',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { action: 'suspend', from: 'active', to: 'suspended', reason: 'T10 coverage', revokedSessions: 1 },
      },
    ]);

    m = await mark();
    await api().delete(`${USERS}/${fx['guardian']}`).set(bearer('admin')).send({ reason: 'T10 coverage' }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.deleted',
        actorUserId: fx['admin']!,
        entityId: fx['guardian']!,
        metadata: { action: 'delete', from: 'invited', to: 'archived', reason: 'T10 coverage' },
      },
    ]);
  });

  // MOD-04 (CH-0051 — MOD-04-T07 backend half, task C2): every writer route of T02..T04 once.

  it('MOD-04-T02 — level create, update, reorder and delete record one levels.* event each', async () => {
    const admin = fx['admin']!;
    const levelEvent = (action: string, entityId: string | null, metadata: Record<string, unknown>): ExpectedEvent => ({
      action,
      actorUserId: admin,
      entityType: 'levels',
      entityId,
      metadata,
    });

    let m = await mark();
    const a = await api().post(LEVELS).set(bearer('admin')).send({ code: `${LEVEL_PREFIX}A`, name: { ar: 'مستوى T07 أ' } }).expect(201);
    mod04.levelA = a.body.id;
    await expectEvents(m, [levelEvent('levels.created', mod04.levelA, { code: `${LEVEL_PREFIX}A` })]);

    m = await mark();
    const b = await api().post(LEVELS).set(bearer('admin')).send({ code: `${LEVEL_PREFIX}B`, name: { ar: 'مستوى T07 ب' } }).expect(201);
    mod04.levelB = b.body.id;
    await expectEvents(m, [levelEvent('levels.created', mod04.levelB, { code: `${LEVEL_PREFIX}B` })]);

    m = await mark();
    await api().patch(`${LEVELS}/${mod04.levelA}`).set(bearer('admin')).send({ name: { ar: 'مستوى T07 أ معدَّل' } }).expect(200);
    await expectEvents(m, [levelEvent('levels.updated', mod04.levelA, { code: `${LEVEL_PREFIX}A`, fields: ['name'] })]);

    // Swap the two fixture levels (appended at the end); every other level keeps its place.
    const current = (await prisma.level.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);
    const swapped = current.map((id) => (id === mod04.levelA ? mod04.levelB : id === mod04.levelB ? mod04.levelA : id));
    m = await mark();
    await api().put(`${LEVELS}/order`).set(bearer('admin')).send({ levelIds: swapped }).expect(200);
    await expectEvents(m, [levelEvent('levels.reordered', null, { levelIds: swapped })]);

    m = await mark();
    await api().delete(`${LEVELS}/${mod04.levelB}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [levelEvent('levels.deleted', mod04.levelB, { code: `${LEVEL_PREFIX}B` })]);
  });

  it('MOD-04-T03/T04 — course create, update, syllabus replacement, publish and draft delete record one event each', async () => {
    const admin = fx['admin']!;
    const courseEvent = (action: string, entityId: string, metadata: Record<string, unknown>): ExpectedEvent => ({
      action,
      actorUserId: admin,
      entityType: 'courses',
      entityId,
      metadata,
    });
    const codeA = `${COURSE_PREFIX}-A`;
    const codeB = `${COURSE_PREFIX}-B`;

    let m = await mark();
    const a = await api().post(COURSES).set(bearer('admin')).send({ code: codeA, name: { ar: 'دورة T07 أ' }, levelId: mod04.levelA }).expect(201);
    mod04.courseA = a.body.id;
    await expectEvents(m, [courseEvent('courses.created', mod04.courseA, { code: codeA, status: 'draft' })]);

    m = await mark();
    await api().patch(`${COURSES}/${mod04.courseA}`).set(bearer('admin')).send({ summary: { ar: 'ملخص T07' } }).expect(200);
    await expectEvents(m, [courseEvent('courses.updated', mod04.courseA, { code: codeA, fields: ['summary'] })]);

    m = await mark();
    await api()
      .put(`${COURSES}/${mod04.courseA}/syllabus`)
      .set(bearer('admin'))
      .send({ items: [{ title: { ar: 'مقدمة' } }, { title: { ar: 'تطبيق' }, estimatedMinutes: 45 }, { title: { ar: 'مراجعة' } }] })
      .expect(200);
    await expectEvents(m, [courseEvent('courses.syllabus.changed', mod04.courseA, { code: codeA, added: 3, updated: 0, removed: 0, reordered: false, items: 3 })]);

    m = await mark();
    await api().post(`${COURSES}/${mod04.courseA}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(200);
    await expectEvents(m, [courseEvent('courses.status.changed', mod04.courseA, { code: codeA, action: 'publish', from: 'draft', to: 'published' })]);

    m = await mark();
    const b = await api().post(COURSES).set(bearer('admin')).send({ code: codeB, name: { ar: 'دورة T07 ب' } }).expect(201);
    mod04.courseB = b.body.id;
    await expectEvents(m, [courseEvent('courses.created', mod04.courseB, { code: codeB, status: 'draft' })]);

    m = await mark();
    await api().delete(`${COURSES}/${mod04.courseB}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [courseEvent('courses.deleted', mod04.courseB, { code: codeB })]);
  });

  it('MOD-04 — rejected requests and writes without a difference record nothing', async () => {
    const codeA = `${COURSE_PREFIX}-A`;
    const course = `${COURSES}/${mod04.courseA}`;
    const syllabus = await api().get(`${course}/syllabus`).set(bearer('admin')).expect(200);
    const sameItems = (syllabus.body.items as { id: string; title: unknown; estimatedMinutes: number | null }[]).map((item) => ({
      id: item.id,
      title: item.title,
      estimatedMinutes: item.estimatedMinutes,
    }));
    const order = (await prisma.level.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);

    const m = await mark();
    // Validation, constraint, permission and business-rule refusals.
    await api().post(LEVELS).set(bearer('admin')).send({ name: { ar: 'بلا رمز' } }).expect(400);
    expect((await api().post(LEVELS).set(bearer('admin')).send({ code: `${LEVEL_PREFIX}A`, name: { ar: 'مكرر' } }).expect(409)).body.code).toBe('level_code_taken');
    expect((await api().delete(`${LEVELS}/${mod04.levelA}`).set(bearer('admin')).expect(409)).body.code).toBe('level_in_use');
    // A duplicate is refused whatever other levels the database holds ([levelA] alone is a full order on a fresh CI database).
    expect((await api().put(`${LEVELS}/order`).set(bearer('admin')).send({ levelIds: [...order, mod04.levelA] }).expect(400)).body.code).toBe('level_order_invalid');
    expect((await api().post(COURSES).set(bearer('plain')).send({ code: `${COURSE_PREFIX}-X`, name: { ar: 'م' } }).expect(403)).body.code).toBe('permission_denied');
    expect((await api().post(COURSES).set(bearer('admin')).send({ code: codeA, name: { ar: 'مكرر' } }).expect(409)).body.code).toBe('course_code_taken');
    expect((await api().patch(course).set(bearer('admin')).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await api().post(`${course}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(409)).body.code).toBe('invalid_transition');
    expect((await api().delete(course).set(bearer('admin')).expect(409)).body.code).toBe('course_not_deletable');
    expect((await api().put(`${course}/syllabus`).set(bearer('admin')).send({ items: [{ id: NIL_ID, title: { ar: 'غريب' } }] }).expect(400)).body.code).toBe(
      'syllabus_invalid',
    );
    await api().put(`${course}/syllabus`).set(bearer('plain')).send({ items: [] }).expect(403);
    // Writes identical to the stored state: 200, nothing written, nothing recorded.
    await api().patch(`${LEVELS}/${mod04.levelA}`).set(bearer('admin')).send({ name: { ar: 'مستوى T07 أ معدَّل' } }).expect(200);
    await api().put(`${LEVELS}/order`).set(bearer('admin')).send({ levelIds: order }).expect(200);
    await api().patch(course).set(bearer('admin')).send({ summary: { ar: 'ملخص T07' } }).expect(200);
    await api().put(`${course}/syllabus`).set(bearer('admin')).send({ items: sameItems }).expect(200);
    expect(await since(m)).toEqual([]);
  });

  it('MOD-06-T02/T03 — lesson create, update, attendance, complete, cancel and delete record one event each', async () => {
    const admin = fx['admin']!;
    const lessonEvent = (action: string, entityType: 'classes' | 'lessons', entityId: string, metadata: Record<string, unknown>): ExpectedEvent => ({
      action,
      actorUserId: admin,
      entityType,
      entityId,
      metadata,
    });
    // The class (open, on the published courseA) and one active enrollment are fixtures, not steps of this suite.
    const klass = await prisma.class.create({
      data: { courseId: mod04.courseA, code: `${CLASS_PREFIX}-A`, name: { ar: 'فصل T05' }, capacity: 5, status: 'open' },
      select: { id: true, code: true },
    });
    mod06.classId = klass.id;
    mod06.classCode = klass.code;
    await prisma.enrollment.create({ data: { classId: klass.id, studentUserId: fx['enrolled']!, status: 'active' }, select: { id: true } });
    const item = await prisma.courseSyllabusItem.findFirstOrThrow({ where: { courseId: mod04.courseA }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
    const base = { classId: klass.id, code: klass.code };
    const newLesson = (title: string, day: string) =>
      api()
        .post(`${CLASSES}/${klass.id}/lessons`)
        .set(bearer('admin'))
        .send({ title: { ar: title }, startsAt: `${day}T08:00:00Z`, endsAt: `${day}T09:00:00Z` });

    let m = await mark();
    const l1 = await api()
      .post(`${CLASSES}/${klass.id}/lessons`)
      .set(bearer('admin'))
      .send({ title: { ar: 'درس T05 أ' }, startsAt: '2026-01-05T08:00:00Z', endsAt: '2026-01-05T09:00:00Z', syllabusItemId: item.id })
      .expect(201);
    mod06.lesson1 = l1.body.id;
    await expectEvents(m, [lessonEvent('lessons.created', 'classes', klass.id, { ...base, count: 1, lessonIds: [mod06.lesson1] })]);

    m = await mark();
    await api().patch(`${LESSONS}/${mod06.lesson1}`).set(bearer('admin')).send({ title: { ar: 'درس T05 أ معدَّل' } }).expect(200);
    await expectEvents(m, [lessonEvent('lessons.updated', 'lessons', mod06.lesson1, { ...base, fields: ['title'] })]);

    m = await mark();
    await api()
      .put(`${LESSONS}/${mod06.lesson1}/attendance`)
      .set(bearer('admin'))
      .send({ records: [{ studentId: fx['enrolled'], status: 'late', minutesLate: 5 }] })
      .expect(200);
    await expectEvents(m, [
      lessonEvent('attendance.recorded', 'lessons', mod06.lesson1, { ...base, created: 1, updated: 0, counts: { recorded: 1, present: 0, absent: 0, late: 1, excused: 0 } }),
    ]);

    m = await mark();
    await api().post(`${LESSONS}/${mod06.lesson1}/status`).set(bearer('admin')).send({ action: 'complete' }).expect(200);
    await expectEvents(m, [lessonEvent('lessons.status.changed', 'lessons', mod06.lesson1, { ...base, action: 'complete', from: 'scheduled', to: 'completed' })]);

    m = await mark();
    const l2 = await newLesson('درس T05 ب', '2027-01-05').expect(201);
    mod06.lesson2 = l2.body.id;
    await api().post(`${LESSONS}/${mod06.lesson2}/status`).set(bearer('admin')).send({ action: 'cancel', reason: 'عطلة' }).expect(200);
    await expectEvents(m, [
      lessonEvent('lessons.created', 'classes', klass.id, { ...base, count: 1, lessonIds: [mod06.lesson2] }),
      lessonEvent('lessons.status.changed', 'lessons', mod06.lesson2, { ...base, action: 'cancel', from: 'scheduled', to: 'cancelled', reason: 'عطلة' }),
    ]);

    m = await mark();
    const l3 = await newLesson('درس T05 ج', '2027-02-05').expect(201);
    await api().delete(`${LESSONS}/${l3.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      lessonEvent('lessons.created', 'classes', klass.id, { ...base, count: 1, lessonIds: [l3.body.id] }),
      lessonEvent('lessons.deleted', 'lessons', l3.body.id, { ...base, startsAt: '2027-02-05T08:00:00.000Z' }),
    ]);
  });

  it('MOD-06 — rejected requests and writes without a difference record nothing', async () => {
    const lesson1 = `${LESSONS}/${mod06.lesson1}`;
    const lessons = `${CLASSES}/${mod06.classId}/lessons`;
    const valid = { title: { ar: 'درس' }, startsAt: '2027-03-01T10:00:00Z', endsAt: '2027-03-01T11:00:00Z' };

    const m = await mark();
    // Validation, permission and business-rule refusals.
    expect((await api().post(lessons).set(bearer('admin')).send({ ...valid, endsAt: '2027-03-01T09:00:00Z' }).expect(400)).body.code).toBe('time_range_invalid');
    expect((await api().post(lessons).set(bearer('plain')).send(valid).expect(403)).body.code).toBe('permission_denied');
    expect((await api().patch(lesson1).set(bearer('admin')).send({ startsAt: '2026-01-05T07:00:00Z' }).expect(409)).body.code).toBe('lesson_locked');
    expect((await api().delete(lesson1).set(bearer('admin')).expect(409)).body.code).toBe('lesson_not_deletable');
    expect((await api().post(`${lesson1}/status`).set(bearer('admin')).send({ action: 'cancel' }).expect(409)).body.code).toBe('invalid_transition');
    expect(
      (await api().put(`${LESSONS}/${mod06.lesson2}/attendance`).set(bearer('admin')).send({ records: [{ studentId: fx['enrolled'], status: 'present' }] }).expect(409)).body.code,
    ).toBe('attendance_closed');
    expect((await api().put(`${lesson1}/attendance`).set(bearer('admin')).send({ records: [{ studentId: fx['plain'], status: 'present' }] }).expect(422)).body.code).toBe('not_enrolled');
    await api().put(`${lesson1}/attendance`).set(bearer('admin')).send({ records: [{ studentId: fx['enrolled'], status: 'present', minutesLate: 3 }] }).expect(400);
    await api().put(`${lesson1}/attendance`).set(bearer('plain')).send({ records: [{ studentId: fx['enrolled'], status: 'present' }] }).expect(403);
    // Writes identical to the stored state: 200, nothing written, nothing recorded.
    await api().patch(lesson1).set(bearer('admin')).send({ title: { ar: 'درس T05 أ معدَّل' } }).expect(200);
    await api().put(`${lesson1}/attendance`).set(bearer('admin')).send({ records: [{ studentId: fx['enrolled'], status: 'late', minutesLate: 5 }] }).expect(200);
    expect(await since(m)).toEqual([]);
  });

  // MOD-05 and MOD-07 (CH-0109 — the Stage 3 gate, task C5): every writer route of MOD-05 T02..T04 and MOD-07 T02/T03/T05 once.

  it('MOD-05-T02/T03/T04 — class create, update, teachers, open, enrollment, withdrawal and planned-class delete record one event each', async () => {
    const admin = fx['admin']!;
    const classEvent = (action: string, entityType: 'classes' | 'enrollments', entityId: string, metadata: Record<string, unknown>): ExpectedEvent => ({
      action,
      actorUserId: admin,
      entityType,
      entityId,
      metadata,
    });
    const codeB = `${CLASS_PREFIX}-B`;
    const codeC = `${CLASS_PREFIX}-C`;

    let m = await mark();
    const b = await api().post(CLASSES).set(bearer('admin')).send({ courseId: mod04.courseA, code: codeB, name: { ar: 'فصل C5 ب' }, capacity: 3 }).expect(201);
    mod05.classId = b.body.id;
    await expectEvents(m, [classEvent('classes.created', 'classes', mod05.classId, { code: codeB, courseId: mod04.courseA, status: 'planned' })]);

    m = await mark();
    await api().patch(`${CLASSES}/${mod05.classId}`).set(bearer('admin')).send({ capacity: 4 }).expect(200);
    await expectEvents(m, [classEvent('classes.updated', 'classes', mod05.classId, { code: codeB, fields: ['capacity'] })]);

    m = await mark();
    await api().put(`${CLASSES}/${mod05.classId}/teachers`).set(bearer('admin')).send({ teachers: [{ userId: fx['instructor'], role: 'lead' }] }).expect(200);
    await expectEvents(m, [
      classEvent('classes.teachers.changed', 'classes', mod05.classId, { code: codeB, added: [{ userId: fx['instructor'], role: 'lead' }], removed: [], roleChanged: [] }),
    ]);

    m = await mark();
    await api().post(`${CLASSES}/${mod05.classId}/status`).set(bearer('admin')).send({ action: 'open' }).expect(200);
    await expectEvents(m, [classEvent('classes.status.changed', 'classes', mod05.classId, { code: codeB, action: 'open', from: 'planned', to: 'open' })]);

    m = await mark();
    const enrolled = await api().post(`${CLASSES}/${mod05.classId}/enrollments`).set(bearer('admin')).send({ studentId: fx['enrolled'] }).expect(201);
    mod05.enrollmentId = enrolled.body.id;
    await expectEvents(m, [
      classEvent('enrollments.created', 'enrollments', mod05.enrollmentId, {
        classId: mod05.classId,
        classCode: codeB,
        studentUserId: fx['enrolled'],
        status: 'active',
        source: 'admin',
      }),
    ]);

    m = await mark();
    await api().post(`/api/enrollments/${mod05.enrollmentId}/status`).set(bearer('admin')).send({ action: 'withdraw', reason: 'C5 coverage' }).expect(200);
    await expectEvents(m, [
      classEvent('enrollments.status.changed', 'enrollments', mod05.enrollmentId, {
        classId: mod05.classId,
        classCode: codeB,
        studentUserId: fx['enrolled'],
        action: 'withdraw',
        from: 'active',
        to: 'withdrawn',
        reason: 'C5 coverage',
      }),
    ]);

    // A planned class without enrollments is the only deletable one: created and deleted in one step, two events.
    m = await mark();
    const c = await api().post(CLASSES).set(bearer('admin')).send({ courseId: mod04.courseA, code: codeC, name: { ar: 'فصل C5 ج' }, capacity: 1 }).expect(201);
    await api().delete(`${CLASSES}/${c.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      classEvent('classes.created', 'classes', c.body.id, { code: codeC, courseId: mod04.courseA, status: 'planned' }),
      classEvent('classes.deleted', 'classes', c.body.id, { code: codeC }),
    ]);
  });

  it('MOD-07-T02/T03/T05 — room create and update, weekly schedule, lesson generation and room delete record one event each', async () => {
    const admin = fx['admin']!;
    const scheduleEvent = (action: string, entityType: 'rooms' | 'classes', entityId: string, metadata: Record<string, unknown>): ExpectedEvent => ({
      action,
      actorUserId: admin,
      entityType,
      entityId,
      metadata,
    });
    const codeB = `${CLASS_PREFIX}-B`;
    const codeR1 = `${ROOM_PREFIX}-1`;
    const codeR2 = `${ROOM_PREFIX}-2`;

    let m = await mark();
    const r1 = await api().post(ROOMS).set(bearer('admin')).send({ code: codeR1, name: { ar: 'قاعة C5' }, capacity: 10 }).expect(201);
    mod07.roomId = r1.body.id;
    await expectEvents(m, [scheduleEvent('rooms.created', 'rooms', mod07.roomId, { code: codeR1, branchId: null, kind: 'classroom' })]);

    m = await mark();
    await api().patch(`${ROOMS}/${mod07.roomId}`).set(bearer('admin')).send({ capacity: 12 }).expect(200);
    await expectEvents(m, [scheduleEvent('rooms.updated', 'rooms', mod07.roomId, { code: codeR1, fields: ['capacity'] })]);

    // One weekly slot of the MOD-05 class (open, lead = instructor) in the room on the academy's first working day; no slot teacher = the lead at generation.
    m = await mark();
    const saved = await api()
      .put(`${CLASSES}/${mod05.classId}/schedule`)
      .set(bearer('admin'))
      .send({ slots: [{ weekday: mod07.weekday, startTime: '09:00', endTime: '10:00', roomId: mod07.roomId, effectiveFrom: '2026-01-01' }] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    mod07.slotId = saved.body.slots[0].id;
    await expectEvents(m, [scheduleEvent('classes.schedule.changed', 'classes', mod05.classId, { code: codeB, added: 1, updated: 0, removed: 0, slots: 1 })]);

    // The generation of a past week: the slot occurs once, so one lesson in one lessons.created batch (API-092 shares the MOD-06 event).
    m = await mark();
    const generated = await api().post(`${CLASSES}/${mod05.classId}/schedule/generate`).set(bearer('admin')).send({ from: GENERATION_FROM, to: GENERATION_TO });
    expect(generated.status, JSON.stringify(generated.body).slice(0, 400)).toBe(200);
    expect(generated.body).toMatchObject({ slots: 1, occurrences: 1, created: 1, existing: 0 });
    mod07.lessonId = generated.body.lessons[0].id;
    await expectEvents(m, [
      scheduleEvent('lessons.created', 'classes', mod05.classId, { code: codeB, classId: mod05.classId, count: 1, lessonIds: [mod07.lessonId] }),
    ]);

    // A room without slots or lessons is the only deletable one: created and deleted in one step, two events.
    m = await mark();
    const r2 = await api().post(ROOMS).set(bearer('admin')).send({ code: codeR2 }).expect(201);
    await api().delete(`${ROOMS}/${r2.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      scheduleEvent('rooms.created', 'rooms', r2.body.id, { code: codeR2, branchId: null, kind: 'classroom' }),
      scheduleEvent('rooms.deleted', 'rooms', r2.body.id, { code: codeR2, branchId: null }),
    ]);
  });

  it('MOD-05/MOD-07 — rejected requests and writes without a difference record nothing', async () => {
    const klass = `${CLASSES}/${mod05.classId}`;
    const codeB = `${CLASS_PREFIX}-B`;
    const lead = { userId: fx['instructor'], role: 'lead' };
    const slot = { id: mod07.slotId, weekday: mod07.weekday, startTime: '09:00', endTime: '10:00', roomId: mod07.roomId, effectiveFrom: '2026-01-01' };
    const newClass = { courseId: mod04.courseA, name: { ar: 'فصل مرفوض' }, capacity: 1 };

    const m = await mark();
    // MOD-05 — validation, constraint, permission and business-rule refusals.
    expect((await api().post(CLASSES).set(bearer('admin')).send({ ...newClass, code: codeB }).expect(409)).body.code).toBe('class_code_taken');
    expect((await api().post(CLASSES).set(bearer('admin')).send({ ...newClass, code: `${CLASS_PREFIX}-X`, startsOn: '2026-12-01', endsOn: '2026-11-01' }).expect(400)).body.code).toBe(
      'date_range_invalid',
    );
    expect((await api().post(CLASSES).set(bearer('plain')).send({ ...newClass, code: `${CLASS_PREFIX}-X` }).expect(403)).body.code).toBe('permission_denied');
    expect((await api().patch(klass).set(bearer('admin')).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await api().post(`${klass}/status`).set(bearer('admin')).send({ action: 'open' }).expect(409)).body.code).toBe('invalid_transition');
    expect((await api().delete(klass).set(bearer('admin')).expect(409)).body.code).toBe('class_not_deletable');
    expect((await api().put(`${klass}/teachers`).set(bearer('admin')).send({ teachers: [lead, { userId: fx['plain'], role: 'lead' }] }).expect(400)).body.code).toBe('teachers_invalid');
    expect((await api().put(`${klass}/teachers`).set(bearer('admin')).send({ teachers: [lead, { userId: fx['plain'], role: 'assistant' }] }).expect(422)).body.code).toBe('not_a_teacher');
    expect((await api().post(`${klass}/enrollments`).set(bearer('admin')).send({ studentId: fx['plain'] }).expect(422)).body.code).toBe('not_a_student');
    expect((await api().post(`${klass}/enrollments`).set(bearer('admin')).send({ studentId: fx['enrolled'] }).expect(409)).body.code).toBe('already_enrolled');
    expect((await api().post(`/api/enrollments/${mod05.enrollmentId}/status`).set(bearer('admin')).send({ action: 'withdraw' }).expect(409)).body.code).toBe('invalid_transition');
    await api().post(`${klass}/enrollments`).set(bearer('plain')).send({ studentId: fx['enrolled'] }).expect(403);
    // MOD-07 — the same four kinds.
    expect((await api().post(ROOMS).set(bearer('admin')).send({ code: `${ROOM_PREFIX}-1` }).expect(409)).body.code).toBe('room_code_taken');
    expect((await api().delete(`${ROOMS}/${mod07.roomId}`).set(bearer('admin')).expect(409)).body.code).toBe('room_in_use');
    expect((await api().put(`${klass}/schedule`).set(bearer('admin')).send({ slots: [{ ...slot, id: NIL_ID }] }).expect(400)).body.code).toBe('schedule_invalid');
    expect((await api().put(`${klass}/schedule`).set(bearer('admin')).send({ slots: [slot, { ...slot, id: undefined, startTime: '09:30', endTime: '10:30' }] }).expect(409)).body.code).toBe(
      'schedule_conflict',
    );
    expect((await api().put(`${klass}/schedule`).set(bearer('admin')).send({ slots: [{ ...slot, roomId: NIL_ID }] }).expect(404)).body.code).toBe('room_not_found');
    expect((await api().put(`${klass}/schedule`).set(bearer('admin')).send({ slots: [{ ...slot, teacherUserId: fx['plain'] }] }).expect(422)).body.code).toBe('teacher_not_assigned');
    await api().put(`${klass}/schedule`).set(bearer('plain')).send({ slots: [] }).expect(403);
    await api().post(`${klass}/schedule/generate`).set(bearer('admin')).send({ from: GENERATION_TO, to: GENERATION_FROM }).expect(400);
    await api().post(`${klass}/schedule/generate`).set(bearer('plain')).send({ from: GENERATION_FROM, to: GENERATION_TO }).expect(403);
    // Writes identical to the stored state: 200, nothing written, nothing recorded.
    await api().patch(klass).set(bearer('admin')).send({ capacity: 4 }).expect(200);
    await api().put(`${klass}/teachers`).set(bearer('admin')).send({ teachers: [lead] }).expect(200);
    await api().patch(`${ROOMS}/${mod07.roomId}`).set(bearer('admin')).send({ capacity: 12 }).expect(200);
    await api().put(`${klass}/schedule`).set(bearer('admin')).send({ slots: [slot] }).expect(200);
    expect((await api().post(`${klass}/schedule/generate`).set(bearer('admin')).send({ from: GENERATION_FROM, to: GENERATION_TO }).expect(200)).body).toMatchObject({ created: 0, existing: 1 });
    expect(await since(m)).toEqual([]);
  });

  it('Stage 4 (MOD-10-T05) — MOD-08 assignments and submissions, MOD-09 schemes, exams, results and final grades, MOD-10 certificates record one event each', async () => {
    const admin = fx['admin']!;
    const learner = fx['enrolled']!;
    tokens['enrolled'] = await login(email('enrolled'));
    const ev = (action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>, actorUserId = admin): ExpectedEvent => ({
      action,
      actorUserId,
      entityType,
      entityId,
      ...(metadata ? { metadata } : {}),
    });
    const code = `${CLASS_PREFIX}-S`;
    const bands = [
      { minPercent: 0, label: { ar: 'راسب' }, isPass: false },
      { minPercent: 50, label: { ar: 'ناجح' }, isPass: true },
    ];
    // Preparation (MOD-05 events, covered above): a class with its lead teacher, open, the learner enrolled.
    const klass = await api().post(CLASSES).set(bearer('admin')).send({ courseId: mod04.courseA, code, name: { ar: 'فصل بوابة Stage 4' }, capacity: 3 }).expect(201);
    stage4.classId = klass.body.id as string;
    await api().put(`${CLASSES}/${stage4.classId}/teachers`).set(bearer('admin')).send({ teachers: [{ userId: fx['instructor'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${stage4.classId}/status`).set(bearer('admin')).send({ action: 'open' }).expect(200);
    await api().post(`${CLASSES}/${stage4.classId}/enrollments`).set(bearer('admin')).send({ studentId: learner }).expect(201);

    // MOD-08 — an assignment through its life, a returned and a graded attempt (the learner submits), a draft deleted.
    let m = await mark();
    const a = await api().post(`${CLASSES}/${stage4.classId}/assignments`).set(bearer('admin')).send({ title: { ar: 'واجب البوابة' }, maxScore: 20, weight: 40 }).expect(201);
    stage4.assignmentId = a.body.id as string;
    await api().patch(`/api/assignments/${a.body.id}`).set(bearer('admin')).send({ instructions: { ar: 'حل التمارين' } }).expect(200);
    await api().post(`/api/assignments/${a.body.id}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(200);
    const first = await api().post(`/api/assignments/${a.body.id}/submissions`).set(bearer('enrolled')).send({ textAnswer: 'محاولة' }).expect(201);
    await api().post(`/api/submissions/${first.body.id}/review`).set(bearer('admin')).send({ action: 'return', feedback: 'أكمل' }).expect(200);
    const second = await api().post(`/api/assignments/${a.body.id}/submissions`).set(bearer('enrolled')).send({ textAnswer: 'محاولة ثانية' }).expect(201);
    stage4.submissionId = second.body.id as string;
    await api().post(`/api/submissions/${second.body.id}/review`).set(bearer('admin')).send({ action: 'grade', score: 18 }).expect(200);
    await api().post(`/api/assignments/${a.body.id}/status`).set(bearer('admin')).send({ action: 'close' }).expect(200);
    const draft = await api().post(`${CLASSES}/${stage4.classId}/assignments`).set(bearer('admin')).send({ title: { ar: 'مسودة' }, maxScore: 5 }).expect(201);
    await api().delete(`/api/assignments/${draft.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      ev('assignments.created', 'assignments', a.body.id, { classId: stage4.classId, code }),
      ev('assignments.updated', 'assignments', a.body.id, { fields: ['instructions'] }),
      ev('assignments.status.changed', 'assignments', a.body.id, { action: 'publish', from: 'draft', to: 'open' }),
      ev('assignments.submitted', 'assignment_submissions', first.body.id, { assignmentId: a.body.id, attemptNo: 1, isLate: false }, learner),
      ev('assignments.returned', 'assignment_submissions', first.body.id),
      ev('assignments.submitted', 'assignment_submissions', second.body.id, { assignmentId: a.body.id, attemptNo: 2 }, learner),
      ev('assignments.graded', 'assignment_submissions', second.body.id),
      ev('assignments.status.changed', 'assignments', a.body.id, { action: 'close', from: 'open', to: 'closed' }),
      ev('assignments.created', 'assignments', draft.body.id),
      ev('assignments.deleted', 'assignments', draft.body.id),
    ]);

    // MOD-09 — grade schemes: create, rename, and an unused spare created and deleted.
    m = await mark();
    const scheme = await api().post('/api/grade-schemes').set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} سلّم` }, bands }).expect(201);
    stage4.schemeIds.push(scheme.body.id as string);
    await api().patch(`/api/grade-schemes/${scheme.body.id}`).set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} سلّم البوابة` } }).expect(200);
    const spare = await api().post('/api/grade-schemes').set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} احتياط` }, bands }).expect(201);
    stage4.schemeIds.push(spare.body.id as string);
    await api().delete(`/api/grade-schemes/${spare.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      ev('grade_schemes.created', 'grade_schemes', scheme.body.id, { bandCount: 2 }),
      ev('grade_schemes.updated', 'grade_schemes', scheme.body.id, { fields: ['name'] }),
      ev('grade_schemes.created', 'grade_schemes', spare.body.id, { bandCount: 2 }),
      ev('grade_schemes.deleted', 'grade_schemes', spare.body.id),
    ]);

    // MOD-09 — an exam through its life with its results sheet, and a draft deleted.
    m = await mark();
    const exam = await api().post(`${CLASSES}/${stage4.classId}/exams`).set(bearer('admin')).send({ title: { ar: 'اختبار البوابة' }, type: 'final', maxScore: 50, weight: 60 }).expect(201);
    stage4.examId = exam.body.id as string;
    await api().patch(`/api/exams/${exam.body.id}`).set(bearer('admin')).send({ durationMinutes: 60 }).expect(200);
    await api().post(`/api/exams/${exam.body.id}/status`).set(bearer('admin')).send({ action: 'schedule' }).expect(200);
    await api().put(`/api/exams/${exam.body.id}/results`).set(bearer('admin')).send({ results: [{ studentId: learner, status: 'scored', score: 42 }] }).expect(200);
    await api().post(`/api/exams/${exam.body.id}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(200);
    const spareExam = await api().post(`${CLASSES}/${stage4.classId}/exams`).set(bearer('admin')).send({ title: { ar: 'مسودة' }, type: 'quiz', maxScore: 10 }).expect(201);
    await api().delete(`/api/exams/${spareExam.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      ev('exams.created', 'exams', exam.body.id, { classId: stage4.classId, code, type: 'final' }),
      ev('exams.updated', 'exams', exam.body.id, { fields: ['durationMinutes'] }),
      ev('exams.status.changed', 'exams', exam.body.id, { action: 'schedule', from: 'draft', to: 'scheduled' }),
      ev('exams.results.recorded', 'exams', exam.body.id, { classId: stage4.classId, code, created: 1, updated: 0 }),
      ev('exams.status.changed', 'exams', exam.body.id, { action: 'publish', from: 'scheduled', to: 'published' }),
      ev('exams.created', 'exams', spareExam.body.id, { type: 'quiz' }),
      ev('exams.deleted', 'exams', spareExam.body.id),
    ]);

    // MOD-09 — final grades: fixed, withdrawn, fixed again (86.4 — a pass).
    await api().post(`${CLASSES}/${stage4.classId}/status`).set(bearer('admin')).send({ action: 'start' }).expect(200);
    m = await mark();
    await api().post(`${CLASSES}/${stage4.classId}/final-grades`).set(bearer('admin')).send({ schemeId: scheme.body.id }).expect(200);
    await api().delete(`${CLASSES}/${stage4.classId}/final-grades`).set(bearer('admin')).expect(200);
    await api().post(`${CLASSES}/${stage4.classId}/final-grades`).set(bearer('admin')).send({ schemeId: scheme.body.id }).expect(200);
    await expectEvents(m, [
      ev('grades.finalized', 'classes', stage4.classId, { code, schemeId: scheme.body.id, created: 1, updated: 0 }),
      ev('grades.withdrawn', 'classes', stage4.classId, { code, count: 1 }),
      ev('grades.finalized', 'classes', stage4.classId, { code, schemeId: scheme.body.id, created: 1, updated: 0 }),
    ]);

    // MOD-10 — the completed class's certificate issued, then revoked.
    await api().post(`${CLASSES}/${stage4.classId}/status`).set(bearer('admin')).send({ action: 'complete' }).expect(200);
    m = await mark();
    const issued = await api().post(`${CLASSES}/${stage4.classId}/certificates`).set(bearer('admin')).send({}).expect(200);
    const certificate = issued.body.issued[0] as { id: string; serial: string };
    stage4.certificateId = certificate.id;
    await api().post(`/api/certificates/${certificate.id}/revoke`).set(bearer('admin')).send({ reason: 'تغطية TEST-030' }).expect(200);
    await expectEvents(m, [
      ev('certificates.issued', 'classes', stage4.classId, { code, count: 1, certificateIds: [certificate.id] }),
      ev('certificates.revoked', 'certificates', certificate.id, { serial: certificate.serial, classId: stage4.classId, reason: 'تغطية TEST-030' }),
    ]);
  });

  it('Stage 4 — rejected requests and writes without a difference record nothing', async () => {
    const m = await mark();
    // MOD-08: no submission once the enrollment is completed (the class is); a score above the maximum; the same review again; a closed assignment is not deleted.
    expect((await api().post(`/api/assignments/${stage4.assignmentId}/submissions`).set(bearer('enrolled')).send({ textAnswer: 'متأخر جداً' })).body.code).toBe('not_enrolled');
    expect((await api().post(`/api/submissions/${stage4.submissionId}/review`).set(bearer('admin')).send({ action: 'grade', score: 25 })).status).toBe(400);
    await api().post(`/api/submissions/${stage4.submissionId}/review`).set(bearer('admin')).send({ action: 'grade', score: 18 }).expect(200);
    expect((await api().delete(`/api/assignments/${stage4.assignmentId}`).set(bearer('admin'))).status).toBe(409);
    // MOD-09: the same scheme name, an identical results batch, a score above the maximum, a published exam is not deleted, an identical finalization.
    await api().patch(`/api/grade-schemes/${stage4.schemeIds[0]}`).set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} سلّم البوابة` } }).expect(200);
    await api().put(`/api/exams/${stage4.examId}/results`).set(bearer('admin')).send({ results: [{ studentId: fx['enrolled'], status: 'scored', score: 42 }] }).expect(200);
    expect((await api().put(`/api/exams/${stage4.examId}/results`).set(bearer('admin')).send({ results: [{ studentId: fx['enrolled'], status: 'scored', score: 60 }] })).status).toBe(400);
    expect((await api().delete(`/api/exams/${stage4.examId}`).set(bearer('admin'))).status).toBe(409);
    await api().post(`${CLASSES}/${stage4.classId}/final-grades`).set(bearer('admin')).send({ schemeId: stage4.schemeIds[0] }).expect(200);
    // MOD-10: an unknown class, a revoked certificate revoked again, a missing reason.
    expect((await api().post(`${CLASSES}/${NIL_ID}/certificates`).set(bearer('admin')).send({})).status).toBe(404);
    expect((await api().post(`/api/certificates/${stage4.certificateId}/revoke`).set(bearer('admin')).send({ reason: 'مرة ثانية' })).status).toBe(409);
    expect((await api().post(`/api/certificates/${stage4.certificateId}/revoke`).set(bearer('admin')).send({})).status).toBe(400);
    await expectEvents(m, []);
  });

  it('Stage 5 (MOD-13-T05) — MOD-11 fee plans, invoices and payments record one event each; the MOD-13 reports record nothing', async () => {
    const admin = fx['admin']!;
    const learner = fx['enrolled']!;
    const ev = (action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>, actorUserId = admin): ExpectedEvent => ({
      action,
      actorUserId,
      entityType,
      entityId,
      ...(metadata ? { metadata } : {}),
    });
    const code = `${CLASS_PREFIX}-F`;
    const lines = [{ description: { ar: 'رسوم الدورة' }, amount: 1000 }];
    // Preparation (MOD-05 events, covered above): a class, open, the learner enrolled.
    const klass = await api().post(CLASSES).set(bearer('admin')).send({ courseId: mod04.courseA, code, name: { ar: 'فصل بوابة Stage 5' }, capacity: 3 }).expect(201);
    stage5.classId = klass.body.id as string;
    await api().post(`${CLASSES}/${stage5.classId}/status`).set(bearer('admin')).send({ action: 'open' }).expect(200);
    await api().post(`${CLASSES}/${stage5.classId}/enrollments`).set(bearer('admin')).send({ studentId: learner }).expect(201);

    // MOD-11 — fee plans: one for the class, renamed; an unused spare created and deleted.
    let m = await mark();
    const plan = await api().post('/api/fee-plans').set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} خطة` }, classId: stage5.classId, lines, installments: [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 30 }] }).expect(201);
    stage5.feePlanId = plan.body.id as string;
    await api().patch(`/api/fee-plans/${plan.body.id}`).set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} خطة الفصل` } }).expect(200);
    const spare = await api().post('/api/fee-plans').set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} احتياط` }, lines, installments: [{ percent: 100, dueOffsetDays: 0 }] }).expect(201);
    await api().delete(`/api/fee-plans/${spare.body.id}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      ev('fee_plans.created', 'fee_plans', plan.body.id, { classId: stage5.classId, total: 1000, installments: 2 }),
      ev('fee_plans.updated', 'fee_plans', plan.body.id, { fields: ['name'] }),
      ev('fee_plans.created', 'fee_plans', spare.body.id, { classId: null, installments: 1 }),
      ev('fee_plans.deleted', 'fee_plans', spare.body.id),
    ]);

    // MOD-11 — invoices: the class batch (a draft), its note edited, issued; a manual draft deleted; another issued then cancelled.
    m = await mark();
    const batch = await api().post(`${CLASSES}/${stage5.classId}/invoices`).set(bearer('admin')).send({ feePlanId: plan.body.id }).expect(200);
    const invoice = batch.body.created[0] as { id: string };
    stage5.invoiceId = invoice.id;
    await api().patch(`/api/invoices/${invoice.id}`).set(bearer('admin')).send({ notes: 'ملاحظة داخلية' }).expect(200);
    await api().post(`/api/invoices/${invoice.id}/status`).set(bearer('admin')).send({ action: 'issue' }).expect(200);
    const dueOn = new Date().toISOString().slice(0, 10);
    const manual = await api().post('/api/invoices').set(bearer('admin')).send({ studentId: learner, lines: [{ description: { ar: 'كتب' }, amount: 50 }], installments: [{ amount: 50, dueOn }] }).expect(201);
    await api().delete(`/api/invoices/${manual.body.id}`).set(bearer('admin')).expect(204);
    const other = await api().post('/api/invoices').set(bearer('admin')).send({ studentId: learner, lines: [{ description: { ar: 'زي' }, amount: 80 }], installments: [{ amount: 80, dueOn }] }).expect(201);
    await api().post(`/api/invoices/${other.body.id}/status`).set(bearer('admin')).send({ action: 'issue' }).expect(200);
    await api().post(`/api/invoices/${other.body.id}/status`).set(bearer('admin')).send({ action: 'cancel', reason: 'تغطية TEST-030' }).expect(200);
    await expectEvents(m, [
      ev('invoices.batch_created', 'classes', stage5.classId, { code, feePlanId: plan.body.id, issued: false, count: 1, invoiceIds: [invoice.id] }),
      ev('invoices.updated', 'invoices', invoice.id, { fields: ['notes'] }),
      ev('invoices.issued', 'invoices', invoice.id, { studentId: learner, installments: 2 }),
      ev('invoices.created', 'invoices', manual.body.id, { studentId: learner, feePlanId: null, total: 50 }),
      ev('invoices.deleted', 'invoices', manual.body.id),
      ev('invoices.created', 'invoices', other.body.id, { total: 80 }),
      ev('invoices.issued', 'invoices', other.body.id),
      ev('invoices.cancelled', 'invoices', other.body.id, { studentId: learner, reason: 'تغطية TEST-030' }),
    ]);

    // MOD-11 — a payment recorded, then reversed.
    m = await mark();
    const payment = await api().post(`/api/invoices/${invoice.id}/payments`).set(bearer('admin')).send({ amount: 300, method: 'cash' }).expect(201);
    stage5.paymentId = payment.body.id as string;
    await api().post(`/api/payments/${payment.body.id}/reverse`).set(bearer('admin')).send({ reason: 'خطأ إدخال' }).expect(200);
    await expectEvents(m, [
      ev('payments.recorded', 'payments', payment.body.id, { invoiceId: invoice.id, amount: 300, method: 'cash' }),
      ev('payments.reversed', 'payments', payment.body.id, { invoiceId: invoice.id, reason: 'خطأ إدخال' }),
    ]);

    // MOD-13 — every report and the overview read and record nothing.
    m = await mark();
    for (const path of [
      'attendance/classes',
      'attendance/students',
      'academic/classes',
      'academic/assignments',
      'academic/exams',
      'financial/collections',
      'financial/receivables',
      'financial/revenue',
      'overview',
    ]) {
      await api().get(`/api/reports/${path}`).set(bearer('admin')).expect(200);
    }
    await expectEvents(m, []);
  });

  it('Stage 5 — rejected requests and writes without a difference record nothing', async () => {
    const m = await mark();
    // Fee plans: the same name again; a plan an invoice was made from is not deleted.
    await api().patch(`/api/fee-plans/${stage5.feePlanId}`).set(bearer('admin')).send({ name: { ar: `${CLASS_PREFIX} خطة الفصل` } }).expect(200);
    expect((await api().delete(`/api/fee-plans/${stage5.feePlanId}`).set(bearer('admin'))).body.code).toBe('fee_plan_in_use');
    // Invoices: an issued invoice is not edited; the batch again creates nothing (already invoiced).
    expect((await api().patch(`/api/invoices/${stage5.invoiceId}`).set(bearer('admin')).send({ notes: 'تعديل' })).body.code).toBe('invoice_not_draft');
    const again = await api().post(`${CLASSES}/${stage5.classId}/invoices`).set(bearer('admin')).send({ feePlanId: stage5.feePlanId }).expect(200);
    expect(again.body.created).toEqual([]);
    // Payments: above the balance; a reversed payment reversed again; a reversal without a reason.
    expect((await api().post(`/api/invoices/${stage5.invoiceId}/payments`).set(bearer('admin')).send({ amount: 999999, method: 'cash' })).body.code).toBe('payment_exceeds_balance');
    expect((await api().post(`/api/payments/${stage5.paymentId}/reverse`).set(bearer('admin')).send({ reason: 'مرة ثانية' })).body.code).toBe('payment_reversed');
    expect((await api().post(`/api/payments/${stage5.paymentId}/reverse`).set(bearer('admin')).send({})).status).toBe(400);
    // Reports: a reversed period.
    expect((await api().get('/api/reports/financial/revenue?from=2026-03-10&to=2026-03-01').set(bearer('admin'))).body.code).toBe('report_range_invalid');
    await expectEvents(m, []);
  });

  // MOD-12 (MOD-12-T06 — the closure of the notifications module): the module has ONE recording writer, the manual announcement (API-173), and records
  // nothing else by design (D-R86) — not the automatic notifications of the earlier writers, not a read of an announcement, nothing of «my notifications»
  // or of the e-mail preferences. Every announcement here goes to a class of this suite: an academy audience would reach real accounts of the shared database.

  it('MOD-12 (T06) — an announcement records one event; «my notifications», marks and e-mail preferences record nothing', async () => {
    const admin = fx['admin']!;
    const learner = fx['enrolled']!;
    const instructor = fx['instructor']!;
    const ev = (action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>, actorUserId = admin): ExpectedEvent => ({
      action,
      actorUserId,
      entityType,
      entityId,
      ...(metadata ? { metadata } : {}),
    });
    const code = `${CLASS_PREFIX}-N`;
    // The sender's words, recognisable: they reach every recipient as typed and belong in no audit event.
    const titleMark = `TITLE-${RUN}`;
    const bodyMark = `BODY-${RUN}`;
    const title = `${titleMark} إعلان الفصل`;
    const body = `${bodyMark} نص يقرؤه المستلمون وحدهم`;
    const readAtOf = async (notificationId: string) => (await prisma.notification.findUniqueOrThrow({ where: { id: notificationId }, select: { readAt: true } })).readAt;
    // Preparation (MOD-05 and MOD-08 events, covered above): a class with its lead teacher, open, the learner enrolled — and a draft assignment.
    const klass = await api().post(CLASSES).set(bearer('admin')).send({ courseId: mod04.courseA, code, name: { ar: 'فصل إشعارات MOD-12' }, capacity: 3 }).expect(201);
    mod12.classId = klass.body.id as string;
    await api().put(`${CLASSES}/${mod12.classId}/teachers`).set(bearer('admin')).send({ teachers: [{ userId: instructor, role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${mod12.classId}/status`).set(bearer('admin')).send({ action: 'open' }).expect(200);
    await api().post(`${CLASSES}/${mod12.classId}/enrollments`).set(bearer('admin')).send({ studentId: learner }).expect(201);
    const assignment = await api().post(`${CLASSES}/${mod12.classId}/assignments`).set(bearer('admin')).send({ title: { ar: 'واجب الإشعار' }, maxScore: 10 }).expect(201);
    const assignmentId = assignment.body.id as string;

    // An automatic notification costs nothing in the audit trail: publishing the assignment — a Stage 4 writer that notifies the class since MOD-12-T03 —
    // still records its one event, and the learner's notification is there (nobody else's: no guardian is linked to the learner, a teacher is never notified).
    const aboutAssignment = () => prisma.notification.findMany({ where: { eventKey: 'assignment.published', data: { path: ['assignmentId'], equals: assignmentId } } });
    expect(await aboutAssignment()).toEqual([]);
    let m = await mark();
    await api().post(`/api/assignments/${assignmentId}/status`).set(bearer('admin')).send({ action: 'publish' }).expect(200);
    await expectEvents(m, [ev('assignments.status.changed', 'assignments', assignmentId, { classId: mod12.classId, code, action: 'publish', from: 'draft', to: 'open' })]);
    const automatic = await aboutAssignment();
    expect(automatic).toHaveLength(1);
    expect(automatic[0]).toMatchObject({ recipientUserId: learner, studentUserId: learner, category: 'assignments', announcementId: null, readAt: null });

    // The one recording writer of MOD-12: an announcement to the students and the teachers of the class (the admin holds `classes.manage` — any class).
    m = await mark();
    const sent = await api().post(ANNOUNCEMENTS).set(bearer('admin')).send({ audience: { kind: 'class', classId: mod12.classId, students: true, teachers: true }, title, body });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    mod12.announcementId = sent.body.id as string;
    // Exactly one event, on the announcement: the audience as it was normalised (the three groups spelled out) and the number of recipients — nothing else.
    const audience = { kind: 'class', classId: mod12.classId, students: true, guardians: false, teachers: true };
    await expectEvents(m, [ev('notifications.announcement.sent', 'announcements', mod12.announcementId)]);
    const recorded = await since(m);
    expect(recorded[0]!.metadata).toEqual({ audience, recipients: 2 });
    // The same event as API-011 serves it; the sender's words are in neither form of it.
    const logged = await items('auditor', `entityType=announcements&entityId=${mod12.announcementId}`);
    expect(logged.items.map((item) => [item.action, item.actorUserId, item.metadata])).toEqual([['notifications.announcement.sent', admin, { audience, recipients: 2 }]]);
    for (const event of [JSON.stringify(recorded), JSON.stringify(logged.items)]) {
      for (const words of [titleMark, bodyMark, 'إعلان الفصل', 'نص يقرؤه']) expect(event).not.toContain(words);
    }
    // The words went where they belong: one notification per recipient — the learner and the lead teacher, never the sender — and no e-mail copy is due (none was asked for).
    const copies = await prisma.notification.findMany({ where: { announcementId: mod12.announcementId } });
    expect(copies.map((copy) => copy.recipientUserId).sort()).toEqual([learner, instructor].sort());
    for (const copy of copies) expect(copy).toMatchObject({ eventKey: 'announcement', category: 'announcements', title, body, studentUserId: null, readAt: null, emailStatus: 'none' });
    const mine = copies.find((copy) => copy.recipientUserId === learner)!;
    mod12.unreadNotificationId = copies.find((copy) => copy.recipientUserId === instructor)!.id;

    // Everything else of the module records nothing (D-R86) — route by route, counted for every fixture actor: the sender, the learner and the instructor are all among them.
    m = await mark();
    const silent = async (route: string): Promise<void> => expect((await since(m)).map((row) => row.action), route).toEqual([]);
    // The sender reads: the announcements sent to the class (API-174) and the announcement with what became of it (API-175).
    const listed = await api().get(`${ANNOUNCEMENTS}?classId=${mod12.classId}`).set(bearer('admin')).expect(200);
    expect((listed.body.items as { id: string }[]).map((item) => item.id)).toEqual([mod12.announcementId]);
    await silent('GET /api/announcements');
    const detail = await api().get(`${ANNOUNCEMENTS}/${mod12.announcementId}`).set(bearer('admin')).expect(200);
    expect(detail.body).toMatchObject({ id: mod12.announcementId, title, body, recipientCount: 2, readCount: 0 });
    await silent('GET /api/announcements/:id');
    // A recipient: the inbox (API-167), the counter (API-168), one mark (API-169) and all of them (API-170) — both marks are real writes.
    const inbox = await api().get(`${INBOX}?category=announcements`).set(bearer('enrolled')).expect(200);
    expect((inbox.body.items as { id: string }[]).map((item) => item.id)).toContain(mine.id);
    await silent('GET /api/me/notifications');
    const counter = await api().get(`${INBOX}/unread-count`).set(bearer('enrolled')).expect(200);
    // At least the two of this test: the published assignment and the announcement.
    expect(counter.body.unread).toBeGreaterThanOrEqual(2);
    await silent('GET /api/me/notifications/unread-count');
    const marked = await api().post(`${INBOX}/${mine.id}/read`).set(bearer('enrolled')).expect(200);
    expect(marked.body).toMatchObject({ id: mine.id, announcementId: mod12.announcementId });
    expect(await readAtOf(mine.id)).toBeInstanceOf(Date);
    expect(await readAtOf(automatic[0]!.id)).toBeNull();
    await silent('POST /api/me/notifications/:id/read');
    const all = await api().post(`${INBOX}/read-all`).set(bearer('enrolled')).expect(200);
    expect(all.body.updated).toBeGreaterThanOrEqual(1);
    expect(await readAtOf(automatic[0]!.id)).toBeInstanceOf(Date);
    // Nobody else's notification moved: the instructor's copy stays unread.
    expect(await readAtOf(mod12.unreadNotificationId)).toBeNull();
    await silent('POST /api/me/notifications/read-all');
    // The learner's e-mail switches: read (API-171), changed (API-172 — a real write) and sent again unchanged.
    const preferences = await api().get(PREFERENCES).set(bearer('enrolled')).expect(200);
    expect(preferences.body.categories).toContainEqual({ category: 'announcements', emailEnabled: true });
    await silent('GET /api/me/notification-preferences');
    const switchOff = { categories: [{ category: 'announcements', emailEnabled: false }] };
    const changed = await api().put(PREFERENCES).set(bearer('enrolled')).send(switchOff).expect(200);
    expect(changed.body.categories).toContainEqual({ category: 'announcements', emailEnabled: false });
    expect(await prisma.notificationPreference.findMany({ where: { userId: learner }, select: { category: true, emailEnabled: true } })).toEqual([{ category: 'announcements', emailEnabled: false }]);
    await silent('PUT /api/me/notification-preferences');
    expect((await api().put(PREFERENCES).set(bearer('enrolled')).send(switchOff).expect(200)).body).toEqual(changed.body);
    await silent('PUT /api/me/notification-preferences — the same body again');
  });

  it('MOD-12 — refused announcements record nothing', async () => {
    const klass = mod12.classId;
    // The sender these refusals need is the instructor, who signs in here for the first time: the seeded teacher role holds `notifications.send` and not `classes.manage`.
    const teacherKeys = (
      await prisma.rolePermission.findMany({ where: { role: { key: 'teacher' }, permissionKey: { in: ['notifications.send', 'classes.manage'] } }, select: { permissionKey: true } })
    ).map((row) => row.permissionKey);
    expect(teacherKeys, 'the seeded `teacher` role must hold notifications.send and not classes.manage').toEqual(['notifications.send']);
    tokens['instructor'] = await login(email('instructor'));
    const announce = (as: string, audience: Record<string, unknown>, title = 'إعلان مرفوض') => api().post(ANNOUNCEMENTS).set(bearer(as)).send({ audience, title, body: 'لا يُكتب ولا يُسجَّل' });
    // What the fixture actors have sent so far: the announcement of the previous test and its two notifications — whoever received them.
    const sentByFixtures = async () => (await prisma.announcement.findMany({ where: { senderUserId: { in: actors() } }, orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id);
    const copiesOfFixtures = () => prisma.notification.count({ where: { announcement: { senderUserId: { in: actors() } } } });
    expect(await sentByFixtures()).toEqual([mod12.announcementId]);
    expect(await copiesOfFixtures()).toBe(2);

    const m = await mark();
    // 400 — the shape of the audience (no recipient group; role keys on a class audience) and a blank title.
    expect((await announce('admin', { kind: 'class', classId: klass }).expect(400)).body).toMatchObject({ code: 'audience_invalid', problems: ['recipient_group_required'] });
    expect((await announce('instructor', { kind: 'class', classId: klass, students: true, roleKeys: ['student'] }).expect(400)).body).toMatchObject({
      code: 'audience_invalid',
      problems: ['role_keys_not_allowed'],
    });
    await announce('admin', { kind: 'class', classId: klass, students: true }, '   ').expect(400);
    // 404 — a class the sender neither teaches nor manages (the instructor leads class `-N`, not the MOD-06 class), and an unknown class for a holder of `classes.manage`.
    expect((await announce('instructor', { kind: 'class', classId: mod06.classId, students: true }).expect(404)).body).toMatchObject({ code: 'class_not_found', classId: mod06.classId });
    expect((await announce('admin', { kind: 'class', classId: NIL_ID, students: true }).expect(404)).body).toMatchObject({ code: 'class_not_found', classId: NIL_ID });
    // 403 — without `notifications.send` (no key at all; the seeded student role) the three routes are closed: sending to one's own class, listing, reading.
    for (const as of ['plain', 'enrolled']) {
      expect((await announce(as, { kind: 'class', classId: klass, students: true }).expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['notifications.send'] });
      await api().get(ANNOUNCEMENTS).set(bearer(as)).expect(403);
      await api().get(`${ANNOUNCEMENTS}/${mod12.announcementId}`).set(bearer(as)).expect(403);
    }
    // 422 — an audience that resolves to nobody but the sender: the teachers of a class whose only teacher announces.
    expect((await announce('instructor', { kind: 'class', classId: klass, teachers: true }).expect(422)).body).toMatchObject({ code: 'audience_empty' });
    // 403 — an academy audience needs `classes.manage` on top of `notifications.send`, and is refused before the audience is read. A VALID academy
    // announcement would reach real accounts of the shared development database, so for this one request — the last announcement request of this file —
    // the audience resolves to nobody: should the check ever let the request through, the answer is 422 and still nothing is written into anybody's inbox.
    const members = vi.spyOn(app.get(AnnouncementsService), 'audienceMembers').mockResolvedValue([]);
    try {
      expect((await announce('instructor', { kind: 'academy', roleKeys: ['guardian'] }).expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['classes.manage'] });
      expect(members).not.toHaveBeenCalled();
    } finally {
      members.mockRestore();
    }
    // «My notifications»: somebody else's notification answers 404 like an unknown one and stays unread; a preferences body that names no category is refused.
    for (const notificationId of [mod12.unreadNotificationId, NIL_ID]) {
      expect((await api().post(`${INBOX}/${notificationId}/read`).set(bearer('enrolled')).expect(404)).body).toMatchObject({ code: 'notification_not_found', notificationId });
    }
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mod12.unreadNotificationId }, select: { readAt: true } })).readAt).toBeNull();
    expect((await api().put(PREFERENCES).set(bearer('enrolled')).send({ categories: [] }).expect(400)).body.code).toBe('nothing_to_update');
    await expectEvents(m, []);
    // No announcement and no notification either: the announcement of the previous test is still the only one a fixture sender has, with its two copies.
    expect(await sentByFixtures()).toEqual([mod12.announcementId]);
    expect(await copiesOfFixtures()).toBe(2);
  });

  it('filters by actor, action prefix (literal, `_` is no wildcard) and entity — audit.read alone suffices', async () => {
    const admin = fx['admin']!;
    const byActor = await items('auditor', `actorUserId=${admin}&limit=200`);
    expect(byActor.items.length).toBeGreaterThanOrEqual(17);
    expect(byActor.items.map((item) => item.id)).toEqual(await dbIds({ actorUserId: admin }));
    expect(byActor.items.every((item) => item.actorUserId === admin)).toBe(true);
    expect(byActor.nextCursor).toBeNull();

    const usersEvents = await items('auditor', `actorUserId=${admin}&action=users.`);
    expect(usersEvents.items.length).toBeGreaterThan(0);
    expect(usersEvents.items.every((item) => item.action.startsWith('users.'))).toBe(true);
    expect(usersEvents.items.map((item) => item.id)).toEqual(await dbIds({ actorUserId: admin, action: { startsWith: 'users.' } }));

    const exact = await items('auditor', `actorUserId=${admin}&action=users.status.changed`);
    expect(exact.items.map((item) => item.action)).toEqual(['users.status.changed']);

    // Unescaped, `users_` would be the LIKE pattern `users_%` and match every `users.` event (KI-034).
    expect((await items('auditor', `actorUserId=${admin}&action=users_`)).items).toEqual([]);

    const teacher = await items('auditor', `entityType=users&entityId=${fx['teacher']}`);
    expect(teacher.items.map((item) => item.id)).toEqual(await dbIds({ entityType: 'users', entityId: fx['teacher'] }));
    expect(new Set(teacher.items.map((item) => item.actorUserId))).toEqual(new Set([admin, fx['teacher']]));
    expect(teacher.items.map((item) => item.action)).toEqual(
      expect.arrayContaining(['users.created', 'users.invitation.issued', 'users.invitation.accepted', 'auth.login.succeeded', 'users.status.changed']),
    );

    const roles = await items('auditor', `entityType=roles&entityId=${customRoleId}&action=roles.`);
    expect(roles.items.map((item) => item.action)).toEqual(['roles.deleted', 'roles.permissions.changed', 'roles.updated', 'roles.created']);

    expect((await items('auditor', `entityType=roles&entityId=${fx['teacher']}`)).items).toEqual([]);
  });

  it('paginates exactly with the keyset cursor — no duplicate and no gap even for events written in the same millisecond (KI-042)', async () => {
    const admin = fx['admin']!;
    const expected = await dbIds({ actorUserId: admin });

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: Item[]; nextCursor: string | null } = await items('auditor', `actorUserId=${admin}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items).toHaveLength(1);
      collected.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages <= expected.length + 1);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(expected.length);

    const first = await items('auditor', `actorUserId=${admin}&action=roles.&limit=3`);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBe(first.items[2]!.id);
    const second = await items('auditor', `actorUserId=${admin}&action=roles.&limit=3&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.action)).toEqual(['roles.created']);
    expect(second.nextCursor).toBeNull();

    // The full page gives no cursor when nothing older exists.
    const all = await items('auditor', `actorUserId=${admin}&action=roles.&limit=4`);
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBeNull();

    // `before` stays a plain time bound.
    expect((await items('auditor', `actorUserId=${admin}&before=1970-01-02T00:00:00.000Z`)).items).toEqual([]);
    const future = new Date(Date.now() + 60_000).toISOString();
    // limit=200: the admin writes more than the default page of 50 events per run since the Stage 4 blocks (CH-0179).
    expect((await items('auditor', `actorUserId=${admin}&before=${future}&limit=200`)).items.map((item) => item.id)).toEqual(expected);
  });

  it('rejects malformed filters, unknown parameters and entityId without entityType with 400; 403 without audit.read', async () => {
    for (const query of [
      'actorUserId=not-a-uuid',
      'action=Users.',
      'action=users%25',
      'action=.users',
      'entityType=Users',
      `entityId=${fx['teacher']}`,
      'cursor=garbage',
      'limit=0',
      'limit=201',
      'limit=abc',
      'before=yesterday',
      'unknown=1',
    ]) {
      const res = await listAs('auditor', query);
      expect(res.status, query).toBe(400);
    }
    const pairing = await listAs('auditor', `entityId=${fx['teacher']}`).expect(400);
    expect(JSON.stringify(pairing.body.message)).toContain('entityType is required when entityId is given');

    // Blank filters count as absent.
    await listAs('auditor', 'action=&actorUserId=&entityType=&entityId=&cursor=&limit=1').expect(200);

    expect((await listAs('plain', 'limit=1').expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['audit.read'] });
    await api().get(AUDIT).set(anonymous()).expect(401);
  });

  it('exposes no secret, token, link, password or contact data in any event of this run (assertNoSecrets + raw values)', async () => {
    const everything = [
      ...(await items('auditor', `actorUserId=${fx['admin']}&limit=200`)).items,
      ...(await items('auditor', `actorUserId=${fx['teacher']}&limit=200`)).items,
    ];
    expect(everything.length).toBeGreaterThanOrEqual(21);
    for (const item of everything) {
      expect(() => assertNoSecrets(item.metadata)).not.toThrow();
    }
    const serialized = JSON.stringify(everything);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/\$argon2|example\.test|Audited Teacher|T10 teacher/);
    expect(serialized).not.toContain(`@`);
  });

  it(
    'documents the filters in OpenAPI',
    async () => {
      const res = await api().get('/api/docs-json').expect(200);
      const operation = res.body.paths[AUDIT]?.get;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([{ bearer: [] }]);
      const names = (operation.parameters as { name: string }[]).map((parameter) => parameter.name).sort();
      expect(names).toEqual(['action', 'actorUserId', 'before', 'cursor', 'entityId', 'entityType', 'limit']);
    },
    20_000,
  );
});
