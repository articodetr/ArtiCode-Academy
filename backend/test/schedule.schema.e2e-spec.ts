// TEST-070 — MOD-07-T01 schema (O9, migration 20261104144352_mod07_rooms_class_schedules):
// the `rooms` and `class_schedules` tables, their hand-written CHECKs, the
// NULLS NOT DISTINCT room code index, the two EXCLUDE constraints (room and
// teacher double-booking — D-R25) and the `btree_gist` extension behind them.
// Runs against the local development database as the APPLICATION role and is
// skipped when no database is reachable (like TEST-007/TEST-047/TEST-067).
// Every data test runs inside a transaction that is rolled back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261104144352_mod07_rooms_class_schedules';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** ON DELETE RESTRICT is checked immediately and reports restrict_violation. */
const RESTRICT_VIOLATION = '23001';
const EXCLUSION_VIOLATION = '23P01';

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

describe.skipIf(!available)('database schema — MOD-07 rooms and class schedules (e2e, TEST-070)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  /** Runs `fn` in a transaction that is always rolled back. */
  async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /**
   * Asserts that `sql` fails with the given SQLSTATE (and, when given, names
   * the given constraint) without aborting the transaction.
   */
  async function expectSqlError(client: PoolClient, sql: string, params: unknown[], code: string, constraint?: string): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string; constraint?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; constraint?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql}`).toBeDefined();
    expect(caught?.code).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  // Unique values per run so a parallel e2e file never collides with this one.
  const tag = `S${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const ROOM_SQL = `INSERT INTO rooms (branch_id, code, name, capacity) VALUES ($1, $2, $3::jsonb, $4) RETURNING id`;
  const SLOT_SQL = `INSERT INTO class_schedules (class_id, weekday, start_time, end_time, room_id, teacher_user_id, effective_from, effective_to)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
  const NAME = '{"ar":"قاعة"}';

  async function branch(client: PoolClient, suffix: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO branches (code, name) VALUES ($1, '{"ar":"فرع"}') RETURNING id`, [`${tag}-${suffix}`]);
    return rows[0]!.id;
  }
  async function room(client: PoolClient, suffix: string, branchId: string | null = null): Promise<string> {
    return (await client.query<{ id: string }>(ROOM_SQL, [branchId, `${tag}-${suffix}`, NAME, null])).rows[0]!.id;
  }
  async function klass(client: PoolClient, suffix: string): Promise<string> {
    const course = await client.query<{ id: string }>(
      `INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`,
      [`${tag}-${suffix}`],
    );
    const created = await client.query<{ id: string }>(
      `INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`,
      [course.rows[0]!.id, `${tag}-${suffix}`],
    );
    return created.rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [
      name,
      `${tag.toLowerCase()}-${name}@example.com`,
    ]);
    return rows[0]!.id;
  }
  /** A slot with defaults: Sunday 10:00–11:00 from 2026-01-01, open-ended. */
  async function slot(
    client: PoolClient,
    classId: string,
    over: Partial<{ weekday: number; start: string; end: string; roomId: string | null; teacherId: string | null; from: string; to: string | null }> = {},
  ): Promise<string> {
    const s = { weekday: 0, start: '10:00', end: '11:00', roomId: null, teacherId: null, from: '2026-01-01', to: null, ...over };
    return (await client.query<{ id: string }>(SLOT_SQL, [classId, s.weekday, s.start, s.end, s.roomId, s.teacherId, s.from, s.to])).rows[0]!.id;
  }
  function slotParams(classId: string, over: Partial<{ weekday: number; start: string; end: string; roomId: string | null; teacherId: string | null; from: string; to: string | null }>): unknown[] {
    const s = { weekday: 0, start: '10:00', end: '11:00', roomId: null, teacherId: null, from: '2026-01-01', to: null, ...over };
    return [classId, s.weekday, s.start, s.end, s.roomId, s.teacherId, s.from, s.to];
  }

  it('is applied after the branches migration, with the room_kind enum and the table defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf('20261104092731_mod02_branches'));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const kinds = await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::room_kind))::text AS v`);
    expect(kinds.rows.map((row) => row.v)).toEqual(['classroom', 'lab', 'hall', 'virtual']);

    await inRollback(async (client) => {
      const created = await client.query<{ kind: string; is_active: boolean; name: unknown; branch_id: string | null }>(
        `INSERT INTO rooms (code) VALUES ($1) RETURNING kind, is_active, name, branch_id`,
        [`${tag}-D`],
      );
      expect(created.rows[0]).toEqual({ kind: 'classroom', is_active: true, name: null, branch_id: null });
    });
  });

  it('has btree_gist installed by the database owner, and the application role cannot create extensions', async () => {
    const extension = await pool.query<{ owner: string; db_owner: string }>(
      `SELECT pg_get_userbyid(e.extowner) AS owner,
              (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS db_owner
         FROM pg_extension e WHERE e.extname = 'btree_gist'`,
    );
    expect(extension.rows).toHaveLength(1);
    expect(extension.rows[0]!.owner).toBe(extension.rows[0]!.db_owner);

    const app = await pool.query<{ role: string; can_create: boolean }>(
      `SELECT current_user AS role, has_database_privilege(current_user, current_database(), 'CREATE') AS can_create`,
    );
    expect(app.rows[0]!.role).not.toBe(extension.rows[0]!.owner);
    expect(app.rows[0]!.can_create).toBe(false);

    for (const table of ['rooms', 'class_schedules']) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
  });

  it('enforces the rooms CHECKs (trimmed code, localized name when set, positive capacity)', async () => {
    await inRollback(async (client) => {
      await expectSqlError(client, ROOM_SQL, [null, ` ${tag}-1`, NAME, null], CHECK_VIOLATION, 'ck_rooms_code_trimmed');
      await expectSqlError(client, ROOM_SQL, [null, '', NAME, null], CHECK_VIOLATION, 'ck_rooms_code_trimmed');
      await expectSqlError(client, ROOM_SQL, [null, `${tag}-2`, '{"en":"no arabic"}', null], CHECK_VIOLATION, 'ck_rooms_name_localized');
      await expectSqlError(client, ROOM_SQL, [null, `${tag}-3`, '"plain text"', null], CHECK_VIOLATION, 'ck_rooms_name_localized');
      await expectSqlError(client, ROOM_SQL, [null, `${tag}-4`, NAME, 0], CHECK_VIOLATION, 'ck_rooms_capacity_positive');
      await expectSqlError(client, ROOM_SQL, [null, `${tag}-5`, NAME, -2], CHECK_VIOLATION, 'ck_rooms_capacity_positive');
      await client.query(ROOM_SQL, [null, `${tag}-6`, null, null]);
      await client.query(ROOM_SQL, [null, `${tag}-7`, '{"ar":"مختبر","en":"Lab"}', 24]);
    });
  });

  it('keeps a room code unique inside its branch, and rooms without a branch share one namespace', async () => {
    await inRollback(async (client) => {
      const north = await branch(client, 'N');
      const south = await branch(client, 'SO');
      await room(client, 'R1', north);
      await expectSqlError(client, ROOM_SQL, [north, `${tag}-R1`, NAME, null], UNIQUE_VIOLATION, 'uq_rooms_branch_code');
      await room(client, 'R1', south);
      await room(client, 'R1');
      await expectSqlError(client, ROOM_SQL, [null, `${tag}-R1`, NAME, null], UNIQUE_VIOLATION, 'uq_rooms_branch_code');
    });
  });

  it('enforces the class_schedules CHECKs (weekday 0–6, end after start, effective range)', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'C');
      await expectSqlError(client, SLOT_SQL, slotParams(classId, { weekday: 7 }), CHECK_VIOLATION, 'ck_class_schedules_weekday');
      await expectSqlError(client, SLOT_SQL, slotParams(classId, { weekday: -1 }), CHECK_VIOLATION, 'ck_class_schedules_weekday');
      await expectSqlError(client, SLOT_SQL, slotParams(classId, { start: '11:00', end: '11:00' }), CHECK_VIOLATION, 'ck_class_schedules_times');
      await expectSqlError(client, SLOT_SQL, slotParams(classId, { start: '12:00', end: '11:00' }), CHECK_VIOLATION, 'ck_class_schedules_times');
      await expectSqlError(client, SLOT_SQL, slotParams(classId, { from: '2026-02-01', to: '2026-01-31' }), CHECK_VIOLATION, 'ck_class_schedules_effective');
      // A one-day slot (effective_to = effective_from) and every weekday are fine.
      await slot(client, classId, { weekday: 6, from: '2026-03-07', to: '2026-03-07' });
      await slot(client, classId, { weekday: 0 });
    });
  });

  it('refuses two overlapping slots in one room (AC3) and accepts adjacent, other-day, non-overlapping and room-less slots', async () => {
    await inRollback(async (client) => {
      const a = await klass(client, 'A');
      const b = await klass(client, 'B');
      const r = await room(client, 'X');
      await slot(client, a, { roomId: r, start: '10:00', end: '11:00' });

      // Same room, same weekday, overlapping times, open-ended dates: refused — even for another class.
      await expectSqlError(client, SLOT_SQL, slotParams(b, { roomId: r, start: '10:30', end: '11:30' }), EXCLUSION_VIOLATION, 'ex_class_schedules_room');
      await expectSqlError(client, SLOT_SQL, slotParams(b, { roomId: r, start: '09:00', end: '12:00' }), EXCLUSION_VIOLATION, 'ex_class_schedules_room');
      await expectSqlError(client, SLOT_SQL, slotParams(a, { roomId: r, start: '10:00', end: '11:00', from: '2027-06-01' }), EXCLUSION_VIOLATION, 'ex_class_schedules_room');

      // Adjacent slots share the boundary only: [10:00, 11:00) and [11:00, 12:00).
      await slot(client, b, { roomId: r, start: '11:00', end: '12:00' });
      await slot(client, b, { roomId: r, start: '09:00', end: '10:00' });
      // Another weekday.
      await slot(client, b, { roomId: r, weekday: 1, start: '10:00', end: '11:00' });
      // No room: never a room conflict.
      await slot(client, b, { roomId: null, start: '10:00', end: '11:00' });
    });
  });

  it('compares effective date ranges inclusively, with a NULL end as unbounded', async () => {
    await inRollback(async (client) => {
      const a = await klass(client, 'E');
      const b = await klass(client, 'F');
      const r = await room(client, 'Y');
      await slot(client, a, { roomId: r, weekday: 2, from: '2026-01-01', to: '2026-01-31' });
      // Starts the day after the first range ends: no overlap.
      await slot(client, b, { roomId: r, weekday: 2, from: '2026-02-01', to: null });
      // Starts on the last day of the first range: the ranges share that day.
      await expectSqlError(client, SLOT_SQL, slotParams(b, { roomId: r, weekday: 2, from: '2026-01-31', to: '2026-01-31' }), EXCLUSION_VIOLATION, 'ex_class_schedules_room');
      // Anything later than 2026-02-01 meets the open-ended slot.
      await expectSqlError(client, SLOT_SQL, slotParams(a, { roomId: r, weekday: 2, from: '2030-01-01', to: '2030-01-01' }), EXCLUSION_VIOLATION, 'ex_class_schedules_room');
    });
  });

  it('refuses a teacher in two overlapping slots (AC3), in different rooms too, and accepts a slot without a teacher', async () => {
    await inRollback(async (client) => {
      const a = await klass(client, 'TA');
      const b = await klass(client, 'TB');
      const teacher = await user(client, 'teacher');
      const other = await user(client, 'other');
      const r1 = await room(client, 'T1');
      const r2 = await room(client, 'T2');
      await slot(client, a, { roomId: r1, teacherId: teacher, weekday: 3, start: '08:00', end: '09:30' });

      await expectSqlError(client, SLOT_SQL, slotParams(b, { roomId: r2, teacherId: teacher, weekday: 3, start: '09:00', end: '10:00' }), EXCLUSION_VIOLATION, 'ex_class_schedules_teacher');
      await expectSqlError(client, SLOT_SQL, slotParams(b, { roomId: null, teacherId: teacher, weekday: 3, start: '08:00', end: '09:30' }), EXCLUSION_VIOLATION, 'ex_class_schedules_teacher');

      await slot(client, b, { roomId: r2, teacherId: teacher, weekday: 3, start: '09:30', end: '10:30' });
      await slot(client, b, { roomId: r2, teacherId: other, weekday: 3, start: '08:00', end: '09:00' });
      await slot(client, b, { roomId: null, teacherId: null, weekday: 3, start: '08:00', end: '09:30' });
      await slot(client, b, { roomId: null, teacherId: teacher, weekday: 3, start: '08:00', end: '09:30', from: '2025-01-01', to: '2025-12-31' });
    });
  });

  it('restricts deleting a branch with rooms, a room or a teacher with slots, and cascades a deleted class to its slots (AC2)', async () => {
    await inRollback(async (client) => {
      const b = await branch(client, 'DL');
      const r = await room(client, 'DL', b);
      const teacher = await user(client, 'restrict');
      const classId = await klass(client, 'DL');
      const id = await slot(client, classId, { roomId: r, teacherId: teacher });

      await expectSqlError(client, `DELETE FROM branches WHERE id = $1`, [b], RESTRICT_VIOLATION, 'rooms_branch_id_fkey');
      await expectSqlError(client, `DELETE FROM rooms WHERE id = $1`, [r], RESTRICT_VIOLATION, 'class_schedules_room_id_fkey');
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [teacher], RESTRICT_VIOLATION, 'class_schedules_teacher_user_id_fkey');

      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      const left = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM class_schedules WHERE id = $1`, [id]);
      expect(left.rows[0]!.n).toBe(0);
      // With its slots gone the room can go, and then the branch.
      await client.query(`DELETE FROM rooms WHERE id = $1`, [r]);
      await client.query(`DELETE FROM branches WHERE id = $1`, [b]);
    });
  });

  it('clears created_by when the creating user row goes (SET NULL)', async () => {
    await inRollback(async (client) => {
      const creator = await user(client, 'creator');
      const classId = await klass(client, 'CB');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO class_schedules (class_id, weekday, start_time, end_time, effective_from, created_by)
         VALUES ($1, 4, '14:00', '15:00', '2026-01-01', $2) RETURNING id`,
        [classId, creator],
      );
      await client.query(`DELETE FROM users WHERE id = $1`, [creator]);
      const after = await client.query<{ created_by: string | null }>(`SELECT created_by FROM class_schedules WHERE id = $1`, [rows[0]!.id]);
      expect(after.rows[0]!.created_by).toBeNull();
    });
  });

  it('names the CHECKs, the EXCLUDE constraints and the NULLS NOT DISTINCT index as the migration does', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint WHERE conrelid IN ('rooms'::regclass, 'class_schedules'::regclass) AND contype IN ('c', 'x')
        ORDER BY 1, 2`,
    );
    expect(constraints.rows).toEqual([
      { table_name: 'class_schedules', conname: 'ck_class_schedules_effective', contype: 'c' },
      { table_name: 'class_schedules', conname: 'ck_class_schedules_times', contype: 'c' },
      { table_name: 'class_schedules', conname: 'ck_class_schedules_weekday', contype: 'c' },
      { table_name: 'class_schedules', conname: 'ex_class_schedules_room', contype: 'x' },
      { table_name: 'class_schedules', conname: 'ex_class_schedules_teacher', contype: 'x' },
      { table_name: 'rooms', conname: 'ck_rooms_capacity_positive', contype: 'c' },
      { table_name: 'rooms', conname: 'ck_rooms_code_trimmed', contype: 'c' },
      { table_name: 'rooms', conname: 'ck_rooms_name_localized', contype: 'c' },
    ]);
    const index = await pool.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_rooms_branch_code'`);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toMatch(/UNIQUE INDEX uq_rooms_branch_code ON public\.rooms USING btree \(branch_id, code\) NULLS NOT DISTINCT/);
    const exclusion = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ex_class_schedules_room'`,
    );
    expect(exclusion.rows[0]!.def).toMatch(/^EXCLUDE USING gist \(room_id WITH =, weekday WITH =, tsrange\(.*\) WITH &&, daterange\(effective_from, effective_to, '\[\]'::text\) WITH &&\) WHERE \(\(room_id IS NOT NULL\)\)$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' } });
        const created = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 10 } });
        const roomRow = await tx.room.create({ data: { code: `${tag}-P`, name: { ar: 'قاعة', en: 'Room' }, capacity: 12, kind: 'lab' } });
        expect(roomRow).toMatchObject({ branchId: null, kind: 'lab', isActive: true, capacity: 12 });

        const slotRow = await tx.classSchedule.create({
          data: {
            classId: created.id,
            weekday: 5,
            startTime: new Date('1970-01-01T16:30:00Z'),
            endTime: new Date('1970-01-01T18:00:00Z'),
            roomId: roomRow.id,
            effectiveFrom: new Date('2026-09-01T00:00:00Z'),
          },
        });
        expect(slotRow.startTime.toISOString()).toBe('1970-01-01T16:30:00.000Z');
        expect(slotRow.endTime.toISOString()).toBe('1970-01-01T18:00:00.000Z');
        expect(slotRow.effectiveFrom.toISOString().slice(0, 10)).toBe('2026-09-01');
        expect(slotRow.effectiveTo).toBeNull();

        const read = await tx.class.findUniqueOrThrow({ where: { id: created.id }, include: { schedules: { include: { room: true } } } });
        expect(read.schedules).toHaveLength(1);
        expect(read.schedules[0]!.room?.code).toBe(`${tag}-P`);
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.room.count({ where: { code: `${tag}-P` } })).toBe(0);
  });
});
