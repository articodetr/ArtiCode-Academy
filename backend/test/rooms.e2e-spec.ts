// TEST-071 — MOD-07-T02 rooms API (O9; API-084..API-087) against the live
// development database. Skipped when no database is reachable. The suite
// creates its own branches, rooms, course, class and slots (codes carry a
// unique tag) and deletes them at the end. Fixture users/roles carry a unique
// suffix and are deleted at the end (their audit rows stay — KI-032); audit
// events are counted by fixture actor above an id watermark, as in TEST-030,
// so other clients never pollute the counts.
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
/** Code prefix of this run's rooms and branches: short enough for the 16-character code. */
const TAG = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-071 supertest';
const ROOMS = '/api/rooms';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = ['branch', 'branchId', 'capacity', 'code', 'createdAt', 'id', 'isActive', 'kind', 'name', 'timeZone', 'updatedAt'];

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

describe.skipIf(!available)('MOD-07 rooms API (e2e, TEST-071)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let activeBranchId: string;
  let inactiveBranchId: string;

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

  /** A room written straight through Prisma (no event), for the read and refusal cases. */
  async function seedRoom(suffix: string, data: { branchId?: string | null; isActive?: boolean; kind?: 'classroom' | 'lab' | 'hall' | 'virtual' } = {}): Promise<string> {
    const row = await prisma.room.create({
      data: { code: code(suffix), name: { ar: `قاعة ${suffix}` }, branchId: data.branchId ?? null, isActive: data.isActive ?? true, kind: data.kind ?? 'classroom' },
      select: { id: true },
    });
    return row.id;
  }

  /** A published course with one planned class, so a weekly slot can point at a room (T01 tables). */
  async function seedClass(suffix: string): Promise<string> {
    const course = await prisma.course.create({ data: { code: code(suffix), name: { ar: `دورة ${suffix}` }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({ data: { courseId: course.id, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 20 }, select: { id: true } });
    return klass.id;
  }

  async function seedSlot(classId: string, roomId: string): Promise<string> {
    const slot = await prisma.classSchedule.create({
      data: {
        classId,
        weekday: 0,
        startTime: new Date('1970-01-01T10:00:00.000Z'),
        endTime: new Date('1970-01-01T11:00:00.000Z'),
        roomId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    return slot.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const scheduler = await createRole('scheduler', ['schedule.manage']);
    const reader = await createRole('reader', ['courses.read']);
    await createUser('scheduler', [scheduler]);
    await createUser('reader', [reader]);
    for (const name of ['scheduler', 'reader']) tokens[name] = await login(email(name));

    activeBranchId = (await prisma.branch.create({ data: { code: code('BA'), name: { ar: 'فرع نشط' } }, select: { id: true } })).id;
    inactiveBranchId = (await prisma.branch.create({ data: { code: code('BI'), name: { ar: 'فرع موقوف' }, isActive: false }, select: { id: true } })).id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        // Classes cascade to their slots; rooms and branches go after the slots (Restrict).
        await prisma.class.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — every signed-in user reads the active rooms, site first then by branch and code; schedule.manage also sees inactive ones; filters; 401 anonymously', async () => {
    await api().get(ROOMS).expect(401);
    const site = await seedRoom('R2');
    const siteFirst = await seedRoom('R1', { kind: 'lab' });
    const inBranch = await seedRoom('R0', { branchId: activeBranchId });
    const inactive = await seedRoom('R3', { isActive: false });

    const asReader = await api().get(ROOMS).set(bearer('reader')).expect(200);
    type RoomItem = { id: string; code: string; isActive: boolean; branchId: string | null };
    const mine = (items: RoomItem[]): RoomItem[] => items.filter((item) => item.code.startsWith(`${TAG}-`));
    const readerRows = mine(asReader.body.items);
    expect(readerRows.map((item: { id: string }) => item.id)).toEqual([siteFirst, site, inBranch]);
    expect(readerRows.every((item: { isActive: boolean }) => item.isActive)).toBe(true);
    expect(Object.keys(readerRows[0]!).sort()).toEqual(DTO_KEYS);
    expect(readerRows[2]).toMatchObject({ branchId: activeBranchId, branch: { id: activeBranchId, code: code('BA'), name: { ar: 'فرع نشط' } } });
    expect(readerRows[0]).toMatchObject({ branchId: null, branch: null, kind: 'lab', capacity: null, name: { ar: 'قاعة R1' } });

    const asManager = await api().get(ROOMS).set(bearer('scheduler')).expect(200);
    expect(mine(asManager.body.items).map((item: { id: string }) => item.id)).toEqual([siteFirst, site, inactive, inBranch]);

    const onlySite = await api().get(`${ROOMS}?branchId=none`).set(bearer('scheduler')).expect(200);
    expect(mine(onlySite.body.items).map((item: { id: string }) => item.id)).toEqual([siteFirst, site, inactive]);
    const onlyBranch = await api().get(`${ROOMS}?branchId=${activeBranchId}&kind=classroom`).set(bearer('reader')).expect(200);
    expect(onlyBranch.body.items.map((item: { id: string }) => item.id)).toEqual([inBranch]);
    const labs = await api().get(`${ROOMS}?kind=lab`).set(bearer('reader')).expect(200);
    expect(mine(labs.body.items).map((item: { id: string }) => item.id)).toEqual([siteFirst]);

    for (const query of ['branchId=not-a-uuid', 'kind=garage', 'capacity=3']) {
      const res = await api().get(`${ROOMS}?${query}`).set(bearer('reader'));
      expect(res.status, query).toBe(400);
    }
  });

  it('AC2 — writing without schedule.manage is 403 permission_denied with the missing key, nothing written and no event', async () => {
    const target = await seedRoom('D1');
    const m = await mark();
    const refused = [
      await api().post(ROOMS).set(bearer('reader')).send({ code: code('D2') }),
      await api().patch(`${ROOMS}/${target}`).set(bearer('reader')).send({ isActive: false }),
      await api().delete(`${ROOMS}/${target}`).set(bearer('reader')),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('permission_denied');
      expect(res.body.missing).toEqual(['schedule.manage']);
    }
    expect(await prisma.room.findUnique({ where: { id: target }, select: { isActive: true } })).toEqual({ isActive: true });
    expect(await prisma.room.count({ where: { code: code('D2') } })).toBe(0);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — create normalises the code and records one rooms.created; the code is unique inside the branch (and among the site rooms), free in another branch; unknown branch 404, inactive 422', async () => {
    const m = await mark();
    const res = await api()
      .post(ROOMS)
      .set(bearer('scheduler'))
      .send({ code: `  ${code('c1').toLowerCase()} `, name: { ar: 'مختبر', en: 'Lab' }, capacity: 24, kind: 'lab', branchId: activeBranchId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      code: code('C1'),
      name: { ar: 'مختبر', en: 'Lab' },
      capacity: 24,
      kind: 'lab',
      branchId: activeBranchId,
      branch: { id: activeBranchId, code: code('BA') },
      isActive: true,
    });
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);

    const takenInBranch = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('C1').toLowerCase(), branchId: activeBranchId });
    expect(takenInBranch.status).toBe(409);
    expect(takenInBranch.body).toMatchObject({ code: 'room_code_taken', roomCode: code('C1'), branchId: activeBranchId });

    // The same code without a branch is another namespace (the academy's own site) — and that namespace is unique too.
    const atSite = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('C1') });
    expect(atSite.status, JSON.stringify(atSite.body)).toBe(201);
    expect(atSite.body).toMatchObject({ code: code('C1'), branchId: null, branch: null, name: null, capacity: null, kind: 'classroom' });
    const takenAtSite = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('C1') });
    expect(takenAtSite.status).toBe(409);
    expect(takenAtSite.body).toMatchObject({ code: 'room_code_taken', roomCode: code('C1'), branchId: null });

    const unknownBranch = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('C2'), branchId: NIL_ID });
    expect(unknownBranch.status).toBe(404);
    expect(unknownBranch.body).toMatchObject({ code: 'branch_not_found', branchId: NIL_ID });
    const inactiveBranch = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('C2'), branchId: inactiveBranchId });
    expect(inactiveBranch.status).toBe(422);
    expect(inactiveBranch.body).toMatchObject({ code: 'branch_inactive', branchId: inactiveBranchId });
    expect(await prisma.room.count({ where: { code: code('C2') } })).toBe(0);

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['rooms.created', 'rooms', res.body.id, { code: code('C1'), branchId: activeBranchId, kind: 'lab' }],
      ['rooms.created', 'rooms', atSite.body.id, { code: code('C1'), branchId: null, kind: 'classroom' }],
    ]);
  });

  it('AC4 — a room with a weekly slot is 409 room_in_use { slotCount } without an event; a free room is deleted with one rooms.deleted, then 404', async () => {
    const roomId = await seedRoom('U1', { branchId: activeBranchId });
    const classId = await seedClass('U1');
    const slotId = await seedSlot(classId, roomId);
    const m = await mark();

    const inUse = await api().delete(`${ROOMS}/${roomId}`).set(bearer('scheduler'));
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: 'room_in_use', slotCount: 1 });
    expect(await prisma.room.count({ where: { id: roomId } })).toBe(1);
    expect(await eventsSince(m)).toEqual([]);

    await prisma.classSchedule.delete({ where: { id: slotId } });
    await api().delete(`${ROOMS}/${roomId}`).set(bearer('scheduler')).expect(204);
    const gone = await api().delete(`${ROOMS}/${roomId}`).set(bearer('scheduler'));
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('room_not_found');

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['rooms.deleted', 'rooms', roomId, { code: code('U1'), branchId: activeBranchId }],
    ]);
  });

  it('AC6 — a PATCH without a difference writes nothing and records nothing; {} is 400 nothing_to_update; null clears and moves to the site; a move checks the branch and the code', async () => {
    const id = await seedRoom('P1');
    const m = await mark();
    const same = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ code: code('p1'), name: { ar: 'قاعة P1' }, kind: 'classroom', isActive: true, branchId: null });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body.code).toBe(code('P1'));
    const empty = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('nothing_to_update');
    expect(await eventsSince(m)).toEqual([]);

    const moved = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ capacity: 30, kind: 'hall', branchId: activeBranchId, isActive: false });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ capacity: 30, kind: 'hall', branchId: activeBranchId, branch: { code: code('BA') }, isActive: false });
    const cleared = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ name: null, capacity: null, branchId: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body).toMatchObject({ name: null, capacity: null, branchId: null, branch: null });

    // A move must land on an existing, active branch, with a code that is free there.
    const toInactive = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ branchId: inactiveBranchId });
    expect(toInactive.status).toBe(422);
    expect(toInactive.body.code).toBe('branch_inactive');
    const toUnknown = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ branchId: NIL_ID });
    expect(toUnknown.status).toBe(404);
    expect(toUnknown.body.code).toBe('branch_not_found');
    await seedRoom('P2', { branchId: activeBranchId });
    const ontoTaken = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send({ code: code('P2'), branchId: activeBranchId });
    expect(ontoTaken.status).toBe(409);
    expect(ontoTaken.body).toMatchObject({ code: 'room_code_taken', roomCode: code('P2'), branchId: activeBranchId });
    const missing = await api().patch(`${ROOMS}/${NIL_ID}`).set(bearer('scheduler')).send({ isActive: false });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('room_not_found');

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.metadata])).toEqual([
      ['rooms.updated', { code: code('P1'), fields: ['capacity', 'kind', 'branchId', 'isActive'], branchId: activeBranchId }],
      ['rooms.updated', { code: code('P1'), fields: ['name', 'capacity', 'branchId'], branchId: null }],
    ]);
  });

  it('AC7 — validation: bad code, name without ar, capacity not a positive integer, unknown kind, bad branch id, non-boolean flag, unknown fields are 400 without any write', async () => {
    const id = await seedRoom('V1');
    const m = await mark();
    const createBodies: Record<string, unknown>[] = [
      {},
      { code: 'bad code!' },
      { code: `${TAG}-TOOLONGCODE123` },
      { code: code('V2'), name: { en: 'No Arabic' } },
      { code: code('V2'), name: 'hall' },
      { code: code('V2'), capacity: 0 },
      { code: code('V2'), capacity: '24' },
      { code: code('V2'), capacity: 2.5 },
      { code: code('V2'), capacity: 40000 },
      { code: code('V2'), kind: 'garage' },
      { code: code('V2'), branchId: 'not-a-uuid' },
      { code: code('V2'), isActive: 'yes' },
      { code: code('V2'), slotCount: 3 },
    ];
    for (const body of createBodies) {
      const res = await api().post(ROOMS).set(bearer('scheduler')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const patchBodies: Record<string, unknown>[] = [{ code: null }, { kind: null }, { isActive: null }, { isActive: 'false' }, { capacity: '30' }, { name: 'x' }, { branchId: 'x' }];
    for (const body of patchBodies) {
      const res = await api().patch(`${ROOMS}/${id}`).set(bearer('scheduler')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await api().patch(`${ROOMS}/not-a-uuid`).set(bearer('scheduler')).send({ isActive: false }).then((res) => res.status)).toBe(400);
    expect(await prisma.room.count({ where: { code: code('V2') } })).toBe(0);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC8 — every room carries the zone its times are shown in (D-R41): its branch’s timezone, else the academy’s — on list, create and update (CH-0189)', async () => {
    const academy = await prisma.academy.findFirst({ select: { timezone: true } });
    const academyZone = academy?.timezone ?? 'UTC';
    // A zone that differs from the academy's, so the branch rule is visible whatever the dev row holds.
    const branchZone = academyZone === 'Pacific/Kiritimati' ? 'Europe/Berlin' : 'Pacific/Kiritimati';
    const zonedBranchId = (await prisma.branch.create({ data: { code: code('BZ'), name: { ar: 'فرع بمنطقته' }, timezone: branchZone }, select: { id: true } })).id;
    const inZoned = await seedRoom('Z1', { branchId: zonedBranchId });
    const inPlain = await seedRoom('Z2', { branchId: activeBranchId });
    const atSite = await seedRoom('Z3');

    const list = await api().get(ROOMS).set(bearer('reader')).expect(200);
    const zoneOf = (id: string) => (list.body.items as { id: string; timeZone: string }[]).find((item) => item.id === id)?.timeZone;
    expect(zoneOf(inZoned)).toBe(branchZone);
    expect(zoneOf(inPlain)).toBe(academyZone); // a branch without its own timezone shows the academy's
    expect(zoneOf(atSite)).toBe(academyZone);

    const created = await api().post(ROOMS).set(bearer('scheduler')).send({ code: code('Z4'), branchId: zonedBranchId }).expect(201);
    expect(created.body).toMatchObject({ branchId: zonedBranchId, timeZone: branchZone });
    const moved = await api().patch(`${ROOMS}/${created.body.id}`).set(bearer('scheduler')).send({ branchId: null }).expect(200);
    expect(moved.body).toMatchObject({ branchId: null, timeZone: academyZone });
    // The no-difference fast path answers with the same field.
    const unchanged = await api().patch(`${ROOMS}/${created.body.id}`).set(bearer('scheduler')).send({ branchId: null }).expect(200);
    expect(unchanged.body.timeZone).toBe(academyZone);
  });

  it(
    'documents the four routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/rooms']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/rooms/{id}']).sort()).toEqual(['delete', 'patch']);
      expect(docs.body.components.schemas).toHaveProperty('RoomDto');
      expect(docs.body.components.schemas).toHaveProperty('CreateRoomDto');
      expect(docs.body.components.schemas).toHaveProperty('UpdateRoomDto');
      // Nullable scalars carry an explicit type (the KI-051 pattern avoided here).
      expect(docs.body.components.schemas.RoomDto.properties.capacity).toMatchObject({ type: 'number', nullable: true });
      expect(docs.body.components.schemas.RoomDto.required).toContain('timeZone');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
