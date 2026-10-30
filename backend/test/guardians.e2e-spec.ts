// TEST-027 — MOD-03-T09 (GET /api/users/:studentId/guardians, GET
// /api/users/:guardianId/students, POST /api/users/:studentId/guardians,
// PATCH/DELETE /api/users/:studentId/guardians/:guardianId) against the live
// development database. Skipped when no database is reachable. Fixtures carry
// a unique suffix and are deleted at the end (cascade removes their roles and
// links; their audit rows stay — KI-032).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USERS = '/api/users';
const SENSITIVE_KEY = /hash|password/i;
const ITEM_KEYS = ['createdAt', 'isPrimary', 'relationship', 'user'];
/** Fields hidden from callers without `users.read_contact` (D-R07). */
const CONTACT_FIELDS = ['email', 'username', 'phone', 'emailVerifiedAt', 'lastLoginAt', 'lockedUntil'] as const;
const UNKNOWN_ID = '018f0000-0000-7000-8000-000000000000';

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

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out.add(key);
      collectKeys(nested, out);
    }
  }
  return out;
}

interface LinkItem {
  user: {
    id: string;
    fullName: string;
    roles: string[];
    email: string | null;
    username: string | null;
    phone: string | null;
    emailVerifiedAt: string | null;
    lastLoginAt: string | null;
    lockedUntil: string | null;
  };
  relationship: string;
  isPrimary: boolean;
  createdAt: string;
}

describe.skipIf(!available)('MOD-03 guardian ↔ student links (e2e, TEST-027)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  // E-mail addresses are stored lower-case (CHECK ck_users_email_lowercase).
  const email = (name: string) => `${name.toLowerCase()}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });
  const guardiansOf = (student: string) => `${USERS}/${fx[student]}/guardians`;
  const studentsOf = (guardian: string) => `${USERS}/${fx[guardian]}/students`;
  const linkOf = (student: string, guardian: string) => `${USERS}/${fx[student]}/guardians/${fx[guardian]}`;

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

  async function createUser(name: string, roleIds: string[] = [], extra: { deletedAt?: Date; phone?: string } = {}): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
        ...extra,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  const link = (caller: string, student: string, body: Record<string, unknown>) =>
    api().post(guardiansOf(student)).set(bearer(caller)).send(body);
  const patch = (caller: string, student: string, guardian: string, body: Record<string, unknown>) =>
    api().patch(linkOf(student, guardian)).set(bearer(caller)).send(body);
  const unlink = (caller: string, student: string, guardian: string) => api().delete(linkOf(student, guardian)).set(bearer(caller));

  const linkRows = (student: string) =>
    prisma.guardianStudent.findMany({ where: { studentUserId: fx[student] }, orderBy: { createdAt: 'asc' } });
  const primaryOf = async (student: string): Promise<string[]> =>
    (await prisma.guardianStudent.findMany({ where: { studentUserId: fx[student], isPrimary: true } })).map((row) => row.guardianUserId);
  const events = (action: string, student: string) =>
    prisma.auditLog.findMany({ where: { action, entityId: fx[student] }, orderBy: { createdAt: 'asc' } });
  const allEvents = (student: string) =>
    prisma.auditLog.findMany({ where: { action: { startsWith: 'guardians.' }, entityId: fx[student] } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const systemRoles = await prisma.role.findMany({
      where: { key: { in: ['student', 'guardian', 'teacher'] } },
      select: { id: true, key: true },
    });
    const systemRole = (key: string): string => systemRoles.find((role) => role.key === key)!.id;

    // Callers.
    const superuser = await createRole('superuser', PERMISSION_KEYS);
    const linker = await createRole('linker', ['users.read', 'guardians.link']);
    const reader = await createRole('reader', ['users.read']);
    const contact = await createRole('contact', ['users.read', 'users.read_contact']);
    // A guardian whose extra role confers a key the linker lacks (SEC-R-18).
    const elevated = await createRole('elevated', ['roles.manage']);

    await createUser('superuser', [superuser]);
    await createUser('linker', [linker]);
    await createUser('reader', [reader]);
    await createUser('contact', [contact]);
    await createUser('plain');
    for (const name of ['superuser', 'linker', 'reader', 'contact', 'plain']) tokens[name] = await login(email(name));

    // Parties.
    await createUser('student1', [systemRole('student')]);
    await createUser('student2', [systemRole('student')]);
    await createUser('guardian1', [systemRole('guardian')], { phone: '+905551112233' });
    await createUser('guardian2', [systemRole('guardian')]);
    await createUser('guardian3', [systemRole('guardian')]);
    await createUser('nobody');
    await createUser('teacherOnly', [systemRole('teacher')]);
    await createUser('privStudent', [systemRole('student'), systemRole('teacher')]);
    await createUser('privGuardian', [systemRole('guardian'), elevated]);
    await createUser('deletedGuardian', [systemRole('guardian')], { deletedAt: new Date() });
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  // ------------------------------------------------------------ guards

  it('requires a token, users.read for the reads and guardians.link for the writes', async () => {
    const body = { guardianId: fx['guardian1'], relationship: 'mother' };
    expect((await api().get(guardiansOf('student1')).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().get(studentsOf('guardian1')).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().post(guardiansOf('student1')).send(body).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().patch(linkOf('student1', 'guardian1')).send({ isPrimary: true }).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().delete(linkOf('student1', 'guardian1')).expect(401)).body.code).toBe('unauthenticated');

    for (const caller of ['plain']) {
      expect((await api().get(guardiansOf('student1')).set(bearer(caller)).expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });
      expect((await api().get(studentsOf('guardian1')).set(bearer(caller)).expect(403)).body.missing).toEqual(['users.read']);
    }
    for (const caller of ['reader', 'contact', 'plain']) {
      expect((await link(caller, 'student1', body)).body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['guardians.link'] });
      expect((await patch(caller, 'student1', 'guardian1', { isPrimary: true })).body.missing).toEqual(['guardians.link']);
      expect((await unlink(caller, 'student1', 'guardian1')).body.missing).toEqual(['guardians.link']);
    }
    expect(await linkRows('student1')).toEqual([]);
    expect(await allEvents('student1')).toHaveLength(0);
  });

  it('validates the path ids and the bodies (400) without touching the database', async () => {
    expect((await api().get(`${USERS}/not-a-uuid/guardians`).set(bearer('reader'))).status).toBe(400);
    expect((await api().get(`${USERS}/not-a-uuid/students`).set(bearer('reader'))).status).toBe(400);
    expect((await api().post(`${USERS}/not-a-uuid/guardians`).set(bearer('linker')).send({ guardianId: fx['guardian1'], relationship: 'mother' })).status).toBe(400);
    expect((await api().patch(`${USERS}/${fx['student1']}/guardians/not-a-uuid`).set(bearer('linker')).send({ isPrimary: true })).status).toBe(400);
    expect((await api().delete(`${USERS}/not-a-uuid/guardians/${fx['guardian1']}`).set(bearer('linker'))).status).toBe(400);

    const invalidBodies: Record<string, unknown>[] = [
      {},
      { relationship: 'mother' },
      { guardianId: 'not-a-uuid', relationship: 'mother' },
      { guardianId: fx['guardian1'] },
      { guardianId: fx['guardian1'], relationship: 'uncle' },
      { guardianId: fx['guardian1'], relationship: 'mother', isPrimary: 'yes' },
      { guardianId: fx['guardian1'], relationship: 'mother', studentId: fx['student2'] },
      { guardianId: fx['guardian1'], relationship: 'mother', passwordHash: 'x' },
    ];
    for (const body of invalidBodies) {
      const res = await link('linker', 'student1', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBeUndefined();
    }

    expect((await patch('linker', 'student1', 'guardian1', { relationship: 'cousin' })).status).toBe(400);
    expect((await patch('linker', 'student1', 'guardian1', { isPrimary: 1 })).status).toBe(400);
    expect((await patch('linker', 'student1', 'guardian1', { guardianId: fx['guardian2'] })).status).toBe(400);
    expect(await linkRows('student1')).toEqual([]);
    expect(await allEvents('student1')).toHaveLength(0);
  });

  // ------------------------------------------------------------ AC 1, AC 2, 404

  it('refuses a guardian without the guardian role and a student without the student role (AC 1)', async () => {
    const noRole = await link('linker', 'student1', { guardianId: fx['nobody'], relationship: 'father' });
    expect(noRole.status).toBe(422);
    expect(noRole.body).toMatchObject({ code: 'not_a_guardian', userId: fx['nobody'] });

    // A teacher role does not make a student: the `student` role row does. (The
    // superuser links here because the teacher's permissions exceed the linker's
    // — SEC-R-18 answers 403 before the role check, see below.)
    const teacher = await link('superuser', 'teacherOnly', { guardianId: fx['guardian1'], relationship: 'father' });
    expect(teacher.status).toBe(422);
    expect(teacher.body).toMatchObject({ code: 'not_a_student', userId: fx['teacherOnly'] });
    const nobody = await link('linker', 'nobody', { guardianId: fx['guardian1'], relationship: 'father' });
    expect(nobody.body).toMatchObject({ statusCode: 422, code: 'not_a_student' });

    // Both wrong: the guardian is checked first.
    const bothWrong = await link('superuser', 'nobody', { guardianId: fx['teacherOnly'], relationship: 'father' });
    expect(bothWrong.body.code).toBe('not_a_guardian');

    expect(await prisma.guardianStudent.count({ where: { studentUserId: { in: [fx['student1']!, fx['teacherOnly']!, fx['nobody']!] } } })).toBe(0);
    for (const student of ['student1', 'teacherOnly', 'nobody']) expect(await allEvents(student)).toHaveLength(0);
  });

  it('refuses linking a user to themself with 400 (AC 2)', async () => {
    const self = await link('linker', 'student1', { guardianId: fx['student1'], relationship: 'other' });
    expect(self.status).toBe(400);
    expect(self.body.code).toBeUndefined();
    expect(self.body.message).toEqual([expect.stringContaining('guardianId')]);
    // Checked before the roles: a guardian "linked to themself" is also 400, not 422.
    expect((await link('superuser', 'guardian1', { guardianId: fx['guardian1'], relationship: 'other' })).status).toBe(400);
    expect(await linkRows('student1')).toEqual([]);
    expect(await allEvents('student1')).toHaveLength(0);
  });

  it('answers 404 user_not_found for unknown or soft-deleted parties and for a missing link', async () => {
    const unknownStudent = await api().post(`${USERS}/${UNKNOWN_ID}/guardians`).set(bearer('linker')).send({ guardianId: fx['guardian1'], relationship: 'mother' });
    expect(unknownStudent.body).toMatchObject({ statusCode: 404, code: 'user_not_found', userId: UNKNOWN_ID, party: 'student' });
    const unknownGuardian = await link('linker', 'student1', { guardianId: UNKNOWN_ID, relationship: 'mother' });
    expect(unknownGuardian.body).toMatchObject({ statusCode: 404, code: 'user_not_found', userId: UNKNOWN_ID, party: 'guardian' });
    const deleted = await link('superuser', 'student1', { guardianId: fx['deletedGuardian'], relationship: 'mother' });
    expect(deleted.body).toMatchObject({ statusCode: 404, code: 'user_not_found', party: 'guardian' });

    expect((await api().get(`${USERS}/${UNKNOWN_ID}/guardians`).set(bearer('reader')).expect(404)).body.code).toBe('user_not_found');
    expect((await api().get(`${USERS}/${UNKNOWN_ID}/students`).set(bearer('reader')).expect(404)).body.code).toBe('user_not_found');
    expect((await api().get(studentsOf('deletedGuardian')).set(bearer('superuser')).expect(404)).body.code).toBe('user_not_found');

    // Existing, visible parties that are not linked.
    const notLinked = await patch('linker', 'student1', 'guardian1', { isPrimary: true });
    expect(notLinked.body).toMatchObject({ statusCode: 404, code: 'user_not_found', reason: 'not_linked', studentId: fx['student1'], guardianId: fx['guardian1'] });
    expect((await unlink('linker', 'student1', 'guardian1')).body).toMatchObject({ statusCode: 404, code: 'user_not_found', reason: 'not_linked' });
    expect(await allEvents('student1')).toHaveLength(0);
  });

  // ------------------------------------------------------------ AC 3..6

  it('links, keeps one primary guardian through any sequence, reads consistently from both sides and records one event per operation (AC 3–6)', async () => {
    // 1. First link, primary, by a linker without users.read_contact → reduced projection.
    const first = await link('linker', 'student1', { guardianId: fx['guardian1'], relationship: 'mother', isPrimary: true });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(ITEM_KEYS);
    expect(first.body).toMatchObject({ relationship: 'mother', isPrimary: true });
    expect(first.body.user).toMatchObject({ id: fx['guardian1'], fullName: 'Test guardian1', roles: ['guardian'], status: 'active' });
    for (const field of CONTACT_FIELDS) expect(first.body.user[field], field).toBeNull();
    expect(typeof first.body.createdAt).toBe('string');
    expect([...collectKeys(first.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

    // 2. Duplicate pair → 409, nothing recorded.
    const dup = await link('linker', 'student1', { guardianId: fx['guardian1'], relationship: 'father' });
    expect(dup.body).toMatchObject({ statusCode: 409, code: 'already_linked', studentId: fx['student1'], guardianId: fx['guardian1'] });
    expect(await events('guardians.linked', 'student1')).toHaveLength(1);

    // 3. Second guardian, non-primary by default.
    const second = await link('linker', 'student1', { guardianId: fx['guardian2'], relationship: 'father' });
    expect(second.status).toBe(201);
    expect(second.body.isPrimary).toBe(false);
    expect(await primaryOf('student1')).toEqual([fx['guardian1']]);

    // 4. Third guardian as primary → demotes guardian1 in the same transaction.
    const third = await link('superuser', 'student1', { guardianId: fx['guardian3'], relationship: 'legal_guardian', isPrimary: true });
    expect(third.status).toBe(201);
    expect(third.body.isPrimary).toBe(true);
    expect(await primaryOf('student1')).toEqual([fx['guardian3']]);
    const linked = await events('guardians.linked', 'student1');
    expect(linked).toHaveLength(3);
    expect(linked[0]!.metadata).toEqual({ guardianUserId: fx['guardian1'], studentUserId: fx['student1'], relationship: 'mother', isPrimary: true, demotedGuardianUserId: null });
    expect(linked[2]!.metadata).toEqual({ guardianUserId: fx['guardian3'], studentUserId: fx['student1'], relationship: 'legal_guardian', isPrimary: true, demotedGuardianUserId: fx['guardian1'] });
    expect(linked.map((event) => event.actorUserId)).toEqual([fx['linker'], fx['linker'], fx['superuser']]);
    expect(linked.every((event) => event.entityType === 'users')).toBe(true);

    // 5. PATCH isPrimary=true on guardian2 → demotes guardian3; one event naming the field.
    const promote = await patch('linker', 'student1', 'guardian2', { isPrimary: true });
    expect(promote.status, JSON.stringify(promote.body)).toBe(200);
    expect(promote.body).toMatchObject({ isPrimary: true, relationship: 'father', user: { id: fx['guardian2'] } });
    expect(await primaryOf('student1')).toEqual([fx['guardian2']]);
    let updated = await events('guardians.updated', 'student1');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.metadata).toEqual({
      guardianUserId: fx['guardian2'],
      studentUserId: fx['student1'],
      relationship: 'father',
      isPrimary: true,
      fields: ['isPrimary'],
      demotedGuardianUserId: fx['guardian3'],
    });

    // 6. Idempotent PATCH → 200, no write, no event; `{}` → 400 nothing_to_update.
    expect((await patch('linker', 'student1', 'guardian2', { isPrimary: true, relationship: 'father' })).status).toBe(200);
    expect(await events('guardians.updated', 'student1')).toHaveLength(1);
    expect((await patch('linker', 'student1', 'guardian2', {})).body).toMatchObject({ statusCode: 400, code: 'nothing_to_update' });

    // 7. PATCH both fields; then demote explicitly → no primary at all is allowed.
    const both = await patch('linker', 'student1', 'guardian1', { relationship: 'other', isPrimary: true });
    expect(both.body).toMatchObject({ relationship: 'other', isPrimary: true });
    expect(await primaryOf('student1')).toEqual([fx['guardian1']]);
    const demote = await patch('linker', 'student1', 'guardian1', { isPrimary: false });
    expect(demote.body.isPrimary).toBe(false);
    expect(await primaryOf('student1')).toEqual([]);
    updated = await events('guardians.updated', 'student1');
    expect(updated).toHaveLength(3);
    expect(updated[1]!.metadata).toMatchObject({ fields: ['relationship', 'isPrimary'], demotedGuardianUserId: fx['guardian2'] });
    expect(updated[2]!.metadata).toMatchObject({ fields: ['isPrimary'], isPrimary: false, demotedGuardianUserId: null });

    // 8. Reads from both sides, projection by caller, order (primary first, then creation).
    await patch('linker', 'student1', 'guardian3', { isPrimary: true });
    const asContact = await api().get(guardiansOf('student1')).set(bearer('contact')).expect(200);
    const items = asContact.body.items as LinkItem[];
    expect(items.map((item) => [item.user.id, item.relationship, item.isPrimary])).toEqual([
      [fx['guardian3'], 'legal_guardian', true],
      [fx['guardian1'], 'other', false],
      [fx['guardian2'], 'father', false],
    ]);
    expect(items[1]!.user).toMatchObject({ email: email('guardian1'), phone: '+905551112233', roles: ['guardian'] });
    expect([...collectKeys(asContact.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);
    const asReader = await api().get(guardiansOf('student1')).set(bearer('reader')).expect(200);
    for (const item of asReader.body.items as LinkItem[]) for (const field of CONTACT_FIELDS) expect(item.user[field], field).toBeNull();

    await link('linker', 'student2', { guardianId: fx['guardian1'], relationship: 'mother', isPrimary: true });
    const students = await api().get(studentsOf('guardian1')).set(bearer('contact')).expect(200);
    expect((students.body.items as LinkItem[]).map((item) => [item.user.id, item.relationship, item.isPrimary])).toEqual([
      [fx['student1'], 'other', false],
      [fx['student2'], 'mother', true],
    ]);
    expect((students.body.items as LinkItem[])[1]!.user).toMatchObject({ email: email('student2'), roles: ['student'] });
    // A user without links (or without the roles) reads as an empty list.
    expect((await api().get(guardiansOf('nobody')).set(bearer('reader')).expect(200)).body).toEqual({ items: [] });
    expect((await api().get(studentsOf('student1')).set(bearer('reader')).expect(200)).body).toEqual({ items: [] });

    // 9. Unlink → 204, both sides consistent, one event with the last state; again → 404.
    await unlink('linker', 'student1', 'guardian2').expect(204);
    expect((await api().get(guardiansOf('student1')).set(bearer('reader')).expect(200)).body.items.map((item: LinkItem) => item.user.id)).toEqual([fx['guardian3'], fx['guardian1']]);
    expect((await api().get(studentsOf('guardian2')).set(bearer('reader')).expect(200)).body).toEqual({ items: [] });
    const unlinked = await events('guardians.unlinked', 'student1');
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]!.metadata).toEqual({ guardianUserId: fx['guardian2'], studentUserId: fx['student1'], relationship: 'father', isPrimary: false });
    expect((await unlink('linker', 'student1', 'guardian2')).body).toMatchObject({ statusCode: 404, code: 'user_not_found', reason: 'not_linked' });

    // Exactly one event per successful write: 3 linked + 4 updated + 1 unlinked; no names or e-mails anywhere.
    const all = await allEvents('student1');
    expect(all).toHaveLength(8);
    for (const event of all) {
      expect(event.actorUserId).not.toBeNull();
      expect(JSON.stringify(event.metadata)).not.toMatch(/Test |example\.test|\+90/);
    }
  });

  it('hides links to soft-deleted users and refuses to write them', async () => {
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['deletedGuardian']!, studentUserId: fx['student2']!, relationship: 'other' } });
    const guardians = await api().get(guardiansOf('student2')).set(bearer('superuser')).expect(200);
    expect((guardians.body.items as LinkItem[]).map((item) => item.user.id)).toEqual([fx['guardian1']]);
    expect((await patch('superuser', 'student2', 'deletedGuardian', { isPrimary: false })).body).toMatchObject({ statusCode: 404, party: 'guardian' });
    expect((await unlink('superuser', 'student2', 'deletedGuardian')).body).toMatchObject({ statusCode: 404, party: 'guardian' });
    expect(await prisma.guardianStudent.count({ where: { guardianUserId: fx['deletedGuardian'] } })).toBe(1);
  });

  // ------------------------------------------------------------ SEC-R-18

  it('applies the no-exceeding rule to the roles of both parties (SEC-R-18)', async () => {
    // The student also holds `teacher`: the linker lacks e.g. lessons.manage.
    const student = await link('linker', 'privStudent', { guardianId: fx['guardian1'], relationship: 'mother' });
    expect(student.status).toBe(403);
    expect(student.body.code).toBe('permission_denied');
    expect(student.body.missing).toContain('lessons.manage');
    expect(student.body.missing).not.toContain('users.read');
    // The guardian holds a role with roles.manage.
    const guardian = await link('linker', 'student1', { guardianId: fx['privGuardian'], relationship: 'father' });
    expect(guardian.body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['roles.manage'] });
    expect(await prisma.guardianStudent.count({ where: { OR: [{ studentUserId: fx['privStudent'] }, { guardianUserId: fx['privGuardian'] }] } })).toBe(0);

    // The authorisation comes before the state: the linker cannot change or remove such links either.
    expect((await link('superuser', 'privStudent', { guardianId: fx['guardian1'], relationship: 'mother' })).status).toBe(201);
    expect((await link('superuser', 'student1', { guardianId: fx['privGuardian'], relationship: 'father' })).status).toBe(201);
    expect((await patch('linker', 'privStudent', 'guardian1', { isPrimary: true })).body.code).toBe('permission_denied');
    expect((await unlink('linker', 'student1', 'privGuardian')).body.missing).toEqual(['roles.manage']);
    expect((await api().get(guardiansOf('privStudent')).set(bearer('linker')).expect(200)).body.items).toHaveLength(1);
    expect(await events('guardians.linked', 'privStudent')).toHaveLength(1);
    expect(await events('guardians.updated', 'privStudent')).toHaveLength(0);
    await unlink('superuser', 'student1', 'privGuardian').expect(204);
  });

  // ------------------------------------------------------------ cross-cutting

  // The first request of the OpenAPI document can exceed the default 5 s when
  // the whole e2e suite runs in parallel on a loaded machine (KI-040).
  it('checks the Origin of writing requests and documents the five routes in OpenAPI', { timeout: 20_000 }, async () => {
    const evil = await api()
      .post(guardiansOf('student2'))
      .set(bearer('superuser'))
      .set('Origin', 'https://evil.example')
      .send({ guardianId: fx['guardian2'], relationship: 'father' });
    expect(evil.status).toBe(403);
    expect(evil.body.code).toBe('origin_forbidden');
    expect(await prisma.guardianStudent.findUnique({ where: { guardianUserId_studentUserId: { guardianUserId: fx['guardian2']!, studentUserId: fx['student2']! } } })).toBeNull();

    const docs = await api().get('/api/docs-json').expect(200);
    expect(Object.keys(docs.body.paths['/api/users/{studentId}/guardians']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(docs.body.paths['/api/users/{studentId}/guardians/{guardianId}']).sort()).toEqual(['delete', 'patch']);
    expect(Object.keys(docs.body.paths['/api/users/{guardianId}/students'])).toEqual(['get']);
    expect(docs.body.paths['/api/users/{studentId}/guardians'].post.responses).toHaveProperty('422');
    expect(docs.body.paths['/api/users/{studentId}/guardians'].post.responses).toHaveProperty('409');
    expect(docs.body.paths['/api/users/{studentId}/guardians/{guardianId}'].delete.responses).toHaveProperty('204');
    expect(docs.body.paths['/api/users/{guardianId}/students'].get.security).toEqual([{ bearer: [] }]);
  });
});
