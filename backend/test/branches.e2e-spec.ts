// TEST-069 — MOD-02-T06 branches API (O8; API-080..API-083) against the live
// development database. Skipped when no database is reachable. The suite
// creates its own branches (codes carry a unique tag) and deletes them at the
// end; if the shared database held a main branch before the run, it is made
// main again in afterAll (finally) — promotions in the suite demote it.
// Fixture users/roles carry a unique suffix and are deleted at the end (their
// audit rows stay — KI-032); audit events are counted by fixture actor above an
// id watermark, as in TEST-030, so other clients never pollute the counts.
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
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Code prefix of this run's branches: short enough for the 16-character code. */
const TAG = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-069 supertest';
const BRANCHES = '/api/branches';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = ['address', 'code', 'createdAt', 'id', 'isActive', 'isMain', 'name', 'phone', 'timezone', 'updatedAt'];

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

describe.skipIf(!available)('MOD-02 branches API (e2e, TEST-069)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let originalMainId: string | null = null;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const code = (suffix: string) => `${TAG}-${suffix}`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
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

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  /** Id of the newest event (UUIDv7 = insertion order); events of a step are those above it. */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  /** A branch written straight through Prisma (no event), for the read and refusal cases. */
  async function seedBranch(suffix: string, data: { isActive?: boolean; isMain?: boolean } = {}): Promise<string> {
    const row = await prisma.branch.create({
      data: { code: code(suffix), name: { ar: `فرع ${suffix}` }, isActive: data.isActive ?? true, isMain: data.isMain ?? false },
      select: { id: true },
    });
    return row.id;
  }

  const mainBranches = () => prisma.branch.findMany({ where: { isMain: true }, select: { id: true } });

  /** Sessions of this database waiting on a lock (the API and this client share the app role, so they are visible). */
  async function lockWaiters(): Promise<number> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Runs `requests` while another transaction holds `FOR UPDATE` on a branch
   * row, and releases it once `waiters` sessions wait on a lock (or after 3 s),
   * so the requests' transactions are in flight together — HTTP requests rarely
   * overlap on their own (the T04 last-seat pattern).
   */
  async function withBranchRowHeld<T>(branchId: string, waiters: number, requests: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const lockTaken = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId}::uuid FOR UPDATE`;
        held();
        await released;
      },
      { timeout: 10_000 },
    );
    await lockTaken;
    const pending = requests();
    const deadline = Date.now() + 3000;
    while ((await lockWaiters()) < waiters && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    await holder;
    return pending;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    originalMainId = (await prisma.branch.findFirst({ where: { isMain: true }, select: { id: true } }))?.id ?? null;

    const manager = await createRole('manager', ['branches.manage']);
    const reader = await createRole('reader', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    for (const name of ['manager', 'reader']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      if (prisma) {
        // Rooms point to branches (Restrict — MOD-07-T02): the suite's rooms go first.
        await prisma.room.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
        if (originalMainId) await prisma.branch.updateMany({ where: { id: originalMainId }, data: { isMain: true, isActive: true } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — every signed-in user reads the active branches; branches.manage also sees inactive ones; 401 anonymously', async () => {
    await api().get(BRANCHES).expect(401);
    const active = await seedBranch('R1');
    const inactive = await seedBranch('R2', { isActive: false });

    const asReader = await api().get(BRANCHES).set(bearer('reader')).expect(200);
    const readerIds = asReader.body.items.map((item: { id: string }) => item.id);
    expect(readerIds).toContain(active);
    expect(readerIds).not.toContain(inactive);
    expect(asReader.body.items.every((item: { isActive: boolean }) => item.isActive)).toBe(true);
    expect(Object.keys(asReader.body.items.find((item: { id: string }) => item.id === active)).sort()).toEqual(DTO_KEYS);

    const asManager = await api().get(BRANCHES).set(bearer('manager')).expect(200);
    const managerIds = asManager.body.items.map((item: { id: string }) => item.id);
    expect(managerIds).toEqual(expect.arrayContaining([active, inactive]));
    // The main branch (if any) first, then by code.
    const codes = asManager.body.items.filter((item: { isMain: boolean }) => !item.isMain).map((item: { code: string }) => item.code);
    expect(codes).toEqual([...codes].sort());
    expect(asManager.body.items.findIndex((item: { isMain: boolean }) => item.isMain)).toBeLessThanOrEqual(0);
  });

  it('AC2 — writing without branches.manage is 403 permission_denied with the missing key, nothing written and no event', async () => {
    const target = await seedBranch('D1');
    const m = await mark();
    const refused = [
      await api().post(BRANCHES).set(bearer('reader')).send({ code: code('D2'), name: { ar: 'فرع' } }),
      await api().patch(`${BRANCHES}/${target}`).set(bearer('reader')).send({ isActive: false }),
      await api().delete(`${BRANCHES}/${target}`).set(bearer('reader')),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('permission_denied');
      expect(res.body.missing).toEqual(['branches.manage']);
    }
    expect(await prisma.branch.findUnique({ where: { id: target }, select: { isActive: true } })).toEqual({ isActive: true });
    expect(await prisma.branch.count({ where: { code: code('D2') } })).toBe(0);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — create normalises the code, returns the branch with one branches.created; a taken code is 409 branch_code_taken', async () => {
    const m = await mark();
    const res = await api()
      .post(BRANCHES)
      .set(bearer('manager'))
      .send({
        code: `  ${code('c1').toLowerCase()} `,
        name: { ar: 'فرع الإنشاء', en: 'Created branch' },
        address: { ar: 'شارع الاختبار' },
        phone: '+966500000001',
        timezone: 'Europe/Istanbul',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      code: code('C1'),
      name: { ar: 'فرع الإنشاء', en: 'Created branch' },
      address: { ar: 'شارع الاختبار' },
      phone: '+966500000001',
      timezone: 'Europe/Istanbul',
      isMain: false,
      isActive: true,
    });
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);

    const taken = await api().post(BRANCHES).set(bearer('manager')).send({ code: code('C1').toLowerCase(), name: { ar: 'آخر' } });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('branch_code_taken');
    expect(taken.body.branchCode).toBe(code('C1'));

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['branches.created', 'branches', res.body.id, { code: code('C1'), isMain: false }],
    ]);
  });

  it('AC4 — a promotion demotes the previous main branch in the same transaction with one event carrying demotedBranchId; concurrent promotions leave one main', async () => {
    const m = await mark();
    const first = await api().post(BRANCHES).set(bearer('manager')).send({ code: code('M1'), name: { ar: 'رئيسي أول' }, isMain: true }).expect(201);
    expect(first.body.isMain).toBe(true);
    const second = await seedBranch('M2');
    const promoted = await api().patch(`${BRANCHES}/${second}`).set(bearer('manager')).send({ isMain: true });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(promoted.body.isMain).toBe(true);
    expect(await mainBranches()).toEqual([{ id: second }]);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['branches.created', 'branches.updated']);
    expect(events[0]!.metadata).toEqual({ code: code('M1'), isMain: true, ...(originalMainId ? { demotedBranchId: originalMainId } : {}) });
    expect(events[1]!.metadata).toEqual({ code: code('M2'), fields: ['isMain'], demotedBranchId: first.body.id });

    // Two promotions at once, held together on the current main row: both succeed one
    // after the other and exactly one branch stays main. Without the advisory lock both
    // demote the same row and the second write hits uq_branches_main (500).
    const [c, d] = [await seedBranch('M3'), await seedBranch('M4')];
    const results = await withBranchRowHeld(second, 2, () =>
      Promise.all([
        api().patch(`${BRANCHES}/${c}`).set(bearer('manager')).send({ isMain: true }),
        api().patch(`${BRANCHES}/${d}`).set(bearer('manager')).send({ isMain: true }),
      ]),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const mains = await mainBranches();
    expect(mains).toHaveLength(1);
    expect([c, d]).toContain(mains[0]!.id);
  });

  it('AC5 — a main branch must be active: deactivating or deleting it is 409 branch_is_main, promoting an inactive one too; leaving the main role first works', async () => {
    const main = await api().post(BRANCHES).set(bearer('manager')).send({ code: code('X1'), name: { ar: 'رئيسي' }, isMain: true }).expect(201);
    const inactive = await seedBranch('X2', { isActive: false });
    const m = await mark();

    const deactivate = await api().patch(`${BRANCHES}/${main.body.id}`).set(bearer('manager')).send({ isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body).toMatchObject({ code: 'branch_is_main', action: 'deactivate', branchId: main.body.id });
    const remove = await api().delete(`${BRANCHES}/${main.body.id}`).set(bearer('manager'));
    expect(remove.status).toBe(409);
    expect(remove.body).toMatchObject({ code: 'branch_is_main', action: 'delete' });
    const promote = await api().patch(`${BRANCHES}/${inactive}`).set(bearer('manager')).send({ isMain: true });
    expect(promote.status).toBe(409);
    expect(promote.body).toMatchObject({ code: 'branch_is_main', action: 'promote_inactive' });
    const create = await api().post(BRANCHES).set(bearer('manager')).send({ code: code('X3'), name: { ar: 'موقوف' }, isMain: true, isActive: false });
    expect(create.status).toBe(409);
    expect(create.body).toMatchObject({ code: 'branch_is_main', action: 'promote_inactive' });
    expect(await eventsSince(m)).toEqual([]);

    const stepDown = await api().patch(`${BRANCHES}/${main.body.id}`).set(bearer('manager')).send({ isMain: false, isActive: false }).expect(200);
    expect(stepDown.body).toMatchObject({ isMain: false, isActive: false });
    const events = await eventsSince(m);
    expect(events.map((event) => event.metadata)).toEqual([{ code: code('X1'), fields: ['isMain', 'isActive'] }]);
  });

  it('AC5-rooms (MOD-07-T02) — a branch that still has rooms is 409 branch_in_use { roomCount } without a write or an event; once the room is gone the delete succeeds', async () => {
    const branchId = await seedBranch('U1');
    const room = await prisma.room.create({ data: { code: code('U1'), name: { ar: 'قاعة' }, branchId }, select: { id: true } });
    const m = await mark();

    const inUse = await api().delete(`${BRANCHES}/${branchId}`).set(bearer('manager'));
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: 'branch_in_use', roomCount: 1 });
    expect(await prisma.branch.count({ where: { id: branchId } })).toBe(1);
    expect(await eventsSince(m)).toEqual([]);

    await prisma.room.delete({ where: { id: room.id } });
    await api().delete(`${BRANCHES}/${branchId}`).set(bearer('manager')).expect(204);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([['branches.deleted', { code: code('U1') }]]);
  });

  it('AC6 — a PATCH without a difference writes nothing and records nothing; {} is 400 nothing_to_update; null clears; delete records one event', async () => {
    const id = await seedBranch('P1');
    const m = await mark();
    const same = await api().patch(`${BRANCHES}/${id}`).set(bearer('manager')).send({ code: code('p1'), name: { ar: 'فرع P1' }, isActive: true }).expect(200);
    expect(same.body.code).toBe(code('P1'));
    const empty = await api().patch(`${BRANCHES}/${id}`).set(bearer('manager')).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('nothing_to_update');
    expect(await eventsSince(m)).toEqual([]);

    await api().patch(`${BRANCHES}/${id}`).set(bearer('manager')).send({ phone: '+966500000002', timezone: 'UTC', address: { ar: 'عنوان' } }).expect(200);
    const cleared = await api().patch(`${BRANCHES}/${id}`).set(bearer('manager')).send({ phone: null, timezone: null, address: null }).expect(200);
    expect(cleared.body).toMatchObject({ phone: null, timezone: null, address: null });

    await api().delete(`${BRANCHES}/${id}`).set(bearer('manager')).expect(204);
    const gone = await api().delete(`${BRANCHES}/${id}`).set(bearer('manager'));
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('branch_not_found');
    const missing = await api().patch(`${BRANCHES}/${NIL_ID}`).set(bearer('manager')).send({ isActive: false });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('branch_not_found');

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([
      ['branches.updated', { code: code('P1'), fields: ['address', 'phone', 'timezone'] }],
      ['branches.updated', { code: code('P1'), fields: ['address', 'phone', 'timezone'] }],
      ['branches.deleted', { code: code('P1') }],
    ]);
  });

  it('AC7 — validation: bad code, name or address without ar, phone not E.164, unknown time zone, non-boolean flags, unknown fields are 400 without any write', async () => {
    const id = await seedBranch('V1');
    const m = await mark();
    const createBodies: Record<string, unknown>[] = [
      { name: { ar: 'بلا رمز' } },
      { code: 'bad code!', name: { ar: 'x' } },
      { code: `${TAG}-TOOLONGCODE123`, name: { ar: 'x' } },
      { code: code('V2') },
      { code: code('V2'), name: { en: 'No Arabic' } },
      { code: code('V2'), name: { ar: 'x' }, address: { en: 'street' } },
      { code: code('V2'), name: { ar: 'x' }, phone: '0555123456' },
      { code: code('V2'), name: { ar: 'x' }, timezone: 'Mars/Olympus' },
      { code: code('V2'), name: { ar: 'x' }, isMain: 'yes' },
      { code: code('V2'), name: { ar: 'x' }, isActive: 1 },
      { code: code('V2'), name: { ar: 'x' }, roomCount: 3 },
    ];
    for (const body of createBodies) {
      const res = await api().post(BRANCHES).set(bearer('manager')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const patchBodies: Record<string, unknown>[] = [
      { code: null },
      { name: null },
      { isMain: null },
      { isActive: 'false' },
      { timezone: 'asia/riyadh' },
      { phone: 12345 },
      { address: 'street' },
    ];
    for (const body of patchBodies) {
      const res = await api().patch(`${BRANCHES}/${id}`).set(bearer('manager')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await api().patch(`${BRANCHES}/not-a-uuid`).set(bearer('manager')).send({ isActive: false }).then((res) => res.status)).toBe(400);
    expect(await prisma.branch.count({ where: { code: code('V2') } })).toBe(0);
    expect(await eventsSince(m)).toEqual([]);
  });

  it(
    'documents the four routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/branches']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/branches/{id}']).sort()).toEqual(['delete', 'patch']);
      expect(docs.body.components.schemas).toHaveProperty('BranchDto');
      expect(docs.body.components.schemas).toHaveProperty('CreateBranchDto');
      expect(docs.body.components.schemas).toHaveProperty('UpdateBranchDto');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
