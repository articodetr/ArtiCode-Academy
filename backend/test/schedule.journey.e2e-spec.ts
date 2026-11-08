// TEST-075 — the MOD-07 module gate (MOD-07-T06, CH-0099): WF-06 "schedule a
// lesson" end to end through the API against the live development database —
// rooms (API-085), the weekly schedule of a class with its conflict rule
// (API-089), the timetable readings (API-088, API-090, API-091), the lessons
// generated from the slots (API-092) and, through MOD-06, the generated
// lessons read by the teacher and the student and one attendance sheet. A
// manager prepares the class (WF-03/WF-04 preconditions), the teacher (the
// seeded `teacher` role) and the student (the seeded `student` role) read
// their own schedule and lessons, the manager reads the journey's events in
// GET /api/audit-logs. Skipped when no database is reachable. Fixtures carry a
// unique prefix and are deleted at the end (their audit rows stay — KI-032).
// The browser journey waits for the MOD-07 screens (J-F06..J-F08).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSettings } from '../src/academy/academy.settings.js';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { addDays, datesBetween, weekdayOf, zonedInstant } from '../src/schedule/lesson-generation.plan.js';
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
/** Prefix of the course, class, room and branch codes. */
const PREFIX = `H${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-075 supertest';
const CLASSES = '/api/classes';
const ROOMS = '/api/rooms';
const LESSONS = '/api/lessons';
const AUDIT = '/api/audit-logs';
/** The branch zone of the first room: daylight-saving time, so the generated instants prove the zone conversion. */
const BRANCH_ZONE = 'Europe/Berlin';

interface SlotBody {
  id: string;
  weekday: number;
  startTime: string;
  room: { id: string; branch: { id: string } | null } | null;
  teacher: { userId: string; fullName: string } | null;
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

describe.skipIf(!available)('WF-06 scheduling journey — the MOD-07 gate (e2e, TEST-075)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let branchId: string;
  let academyTimeZone: string;
  /** The two weekdays the journey schedules on — the first two working days of the academy, else Sunday and Tuesday. */
  let weekdayA: number;
  let weekdayB: number;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const nonAuth = (log: { body: { items: { action: string; entityType: string | null; entityId: string | null }[] } }) =>
    log.body.items.filter((item) => !item.action.startsWith('auth.')).map((item) => [item.action, item.entityType, item.entityId]);

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, settings: true } });
    academyTimeZone = academy.timezone;
    const allowed = readSettings(academy.settings).scheduling.workingDays ?? [0, 1, 2, 3, 4, 5, 6];
    weekdayA = allowed.includes(0) && allowed.includes(2) ? 0 : allowed[0]!;
    weekdayB = allowed.includes(0) && allowed.includes(2) ? 2 : (allowed[1] ?? allowed[0]!);

    // The manager holds the keys the journey needs without the academy_admin
    // role itself (TEST-026's last-admin test never touches it); the teacher
    // and the student hold the real system roles (schedule.read, lessons.read,
    // attendance.* by seed).
    const manager = await prisma.role.create({
      data: {
        key: `test_wf06_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-06' },
        permissions: {
          create: [
            'classes.read',
            'classes.manage',
            'classes.teachers.assign',
            'enrollments.read',
            'enrollments.manage',
            'schedule.read',
            'schedule.manage',
            'lessons.read',
            'attendance.read',
            'audit.read',
          ].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    const teacherRole = await systemRole('teacher');
    await createUser('teacher', [teacherRole]);
    await createUser('teacher2', [teacherRole]);
    await createUser('student', [await systemRole('student')]);
    for (const name of ['manager', 'teacher', 'teacher2', 'student']) tokens[name] = await login(email(name));

    // Preconditions from other modules: a published course (WF-05) and a branch in another zone (MOD-02).
    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة رحلة الجدولة' }, status: 'published' }, select: { id: true } })).id;
    branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع برلين' }, timezone: BRANCH_ZONE }, select: { id: true } })).id;
  });

  afterAll(async () => {
    try {
      // Enrollments first (Restrict on the class); classes take their teachers, slots, lessons and attendance (Cascade); then the course, the rooms (Restrict from slots/lessons) and the branch (Restrict from rooms).
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.branch.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('a manager creates rooms and a class, writes its weekly schedule (a double booking of another class is refused), everyone reads their timetable, lessons are generated from the slots and the teacher records attendance on one; the events are in the audit log', async () => {
    // Before the journey nobody has a slot or a lesson.
    for (const name of ['teacher', 'student']) {
      expect((await api().get('/api/me/schedule').set(bearer(name)).expect(200)).body.items).toEqual([]);
      expect((await api().get('/api/me/lessons').set(bearer(name)).expect(200)).body.items).toEqual([]);
    }

    // 1. Rooms (API-085): one in the Berlin branch, one at the academy's own site.
    const roomBranch = await api().post(ROOMS).set(bearer('manager')).send({ code: code('RB'), name: { ar: 'قاعة برلين' }, branchId, capacity: 20 }).expect(201);
    const roomSite = await api().post(ROOMS).set(bearer('manager')).send({ code: code('RS'), name: { ar: 'قاعة المقر' } }).expect(201);
    expect(roomBranch.body).toMatchObject({ code: code('RB'), branch: { id: branchId }, isActive: true });
    expect(roomSite.body).toMatchObject({ code: code('RS'), branch: null });
    const rooms = await api().get(ROOMS).set(bearer('teacher')).expect(200);
    expect((rooms.body.items as { id: string }[]).map((room) => room.id)).toEqual(expect.arrayContaining([roomBranch.body.id, roomSite.body.id]));

    // 2. Preconditions (WF-03/WF-04): class A for the published course, its lead teacher, open, one student enrolled.
    const created = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code('A'), name: { ar: 'فصل الجدولة', en: 'Scheduling class' }, capacity: 5 }).expect(201);
    const classId = created.body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx['student'] }).expect(201);

    // 3. WF-06 (A) — the weekly schedule (API-089): a slot in the Berlin room with the teacher, a slot at the site without a teacher (the lead at generation).
    const saved = await api()
      .put(`${CLASSES}/${classId}/schedule`)
      .set(bearer('manager'))
      .send({
        slots: [
          { weekday: weekdayA, startTime: '10:00', endTime: '11:00', roomId: roomBranch.body.id, teacherUserId: fx['teacher'], effectiveFrom: '2026-01-01' },
          { weekday: weekdayB, startTime: '12:00', endTime: '13:00', roomId: roomSite.body.id, effectiveFrom: '2026-01-01' },
        ],
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const slots = saved.body.slots as SlotBody[];
    expect(slots).toHaveLength(2);
    const slotA = slots.find((slot) => slot.startTime === '10:00')!;
    const slotB = slots.find((slot) => slot.startTime === '12:00')!;
    expect(slotA).toMatchObject({ weekday: weekdayA, room: { id: roomBranch.body.id, branch: { id: branchId } }, teacher: { userId: fx['teacher'], fullName: 'Test teacher' } });
    expect(slotB).toMatchObject({ weekday: weekdayB, room: { id: roomSite.body.id, branch: null }, teacher: null });
    // The assigned teacher reads the schedule (API-088); the student has no classes.read.
    expect((await api().get(`${CLASSES}/${classId}/schedule`).set(bearer('teacher')).expect(200)).body.slots).toHaveLength(2);
    await api().get(`${CLASSES}/${classId}/schedule`).set(bearer('student')).expect(403);

    // 3b. Another class cannot book the Berlin room at an overlapping time (the EXCLUDE constraint names the slot); an adjacent slot is fine.
    const other = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code('B'), name: { ar: 'فصل آخر' }, capacity: 5 }).expect(201);
    const otherId = other.body.id as string;
    await api().put(`${CLASSES}/${otherId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher2'], role: 'lead' }] }).expect(200);
    const clash = await api()
      .put(`${CLASSES}/${otherId}/schedule`)
      .set(bearer('manager'))
      .send({ slots: [{ weekday: weekdayA, startTime: '10:30', endTime: '11:30', roomId: roomBranch.body.id, effectiveFrom: '2026-01-01' }] });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'schedule_conflict', kind: 'room', conflictingSlotId: slotA.id, conflictingClassId: classId, slot: { index: 0 } });
    const adjacent = await api()
      .put(`${CLASSES}/${otherId}/schedule`)
      .set(bearer('manager'))
      .send({ slots: [{ weekday: weekdayA, startTime: '11:00', endTime: '12:00', roomId: roomBranch.body.id, effectiveFrom: '2026-01-01' }] });
    expect(adjacent.status, JSON.stringify(adjacent.body)).toBe(200);

    // 4. Readings: the academy timetable of class A (API-090) with the display zone of each slot; "my schedule" of the student and the teacher (API-091).
    const timetable = await api().get('/api/schedule').query({ classId }).set(bearer('manager')).expect(200);
    const ttSlots = timetable.body.slots as { id: string; timeZone: string; class: { id: string } }[];
    expect(ttSlots.map((slot) => [slot.id, slot.timeZone])).toEqual(
      expect.arrayContaining([
        [slotA.id, BRANCH_ZONE],
        [slotB.id, academyTimeZone],
      ]),
    );
    expect(ttSlots.every((slot) => slot.class.id === classId)).toBe(true);
    const mineStudent = await api().get('/api/me/schedule').set(bearer('student')).expect(200);
    expect((mineStudent.body.items as { id: string; relation: string; student: { id: string } | null }[]).map((item) => [item.id, item.relation, item.student?.id])).toEqual(
      expect.arrayContaining([
        [slotA.id, 'self', fx['student']],
        [slotB.id, 'self', fx['student']],
      ]),
    );
    expect(mineStudent.body.items).toHaveLength(2);
    const mineTeacher = await api().get('/api/me/schedule').set(bearer('teacher')).expect(200);
    expect((mineTeacher.body.items as { id: string; relation: string; student: unknown }[]).map((item) => [item.id, item.relation, item.student])).toEqual(
      expect.arrayContaining([
        [slotA.id, 'teacher', null],
        [slotB.id, 'teacher', null],
      ]),
    );
    expect(mineTeacher.body.items).toHaveLength(2);
    await api().get('/api/schedule').set(bearer('teacher')).expect(403);

    // 5. WF-06 (B) — lessons generated from the slots (API-092) for the last two weeks: two occurrences of each slot, all already started.
    const today = calendarDateIn(academyTimeZone);
    const from = addDays(today, -14);
    const to = addDays(today, -1);
    const expectedStarts = datesBetween(from, to)
      .flatMap((date) => {
        const starts: string[] = [];
        if (weekdayOf(date) === weekdayA) starts.push(zonedInstant(date, '10:00', BRANCH_ZONE).toISOString());
        if (weekdayOf(date) === weekdayB) starts.push(zonedInstant(date, '12:00', academyTimeZone).toISOString());
        return starts;
      })
      .sort();
    const generated = await api().post(`${CLASSES}/${classId}/schedule/generate`).set(bearer('manager')).send({ from, to });
    expect(generated.status, JSON.stringify(generated.body).slice(0, 400)).toBe(200);
    expect(generated.body).toMatchObject({ classId, from, to, slots: 2, occurrences: expectedStarts.length, created: expectedStarts.length, existing: 0, offDays: 0 });
    const lessons = generated.body.lessons as { id: string; startsAt: string; scheduleId: string | null; teacher: { userId: string } | null; room: { id: string } | null; title: Record<string, string> }[];
    expect(lessons.map((lesson) => lesson.startsAt)).toEqual(expectedStarts);
    for (const lesson of lessons) {
      expect(lesson.teacher).toMatchObject({ userId: fx['teacher'] }); // the slot's teacher, or the lead teacher by default
      expect(lesson.title).toEqual({ ar: 'فصل الجدولة', en: 'Scheduling class' });
      expect([slotA.id, slotB.id]).toContain(lesson.scheduleId);
    }
    // The same range again: nothing new, nothing recorded (checked in the log below).
    expect((await api().post(`${CLASSES}/${classId}/schedule/generate`).set(bearer('manager')).send({ from, to }).expect(200)).body).toMatchObject({ created: 0, existing: expectedStarts.length, lessons: [] });

    // 6. The teacher sees the generated lessons of their class (API-093); the student sees them in "my lessons" (API-101).
    const forTeacher = await api().get(LESSONS).query({ classId }).set(bearer('teacher')).expect(200);
    expect((forTeacher.body.items as { id: string }[]).map((lesson) => lesson.id).sort()).toEqual(lessons.map((lesson) => lesson.id).sort());
    const forStudent = await api().get('/api/me/lessons').query({ classId }).set(bearer('student')).expect(200);
    expect(forStudent.body.items).toHaveLength(lessons.length);
    expect((forStudent.body.items as { relation: string; attendance: unknown }[]).every((item) => item.relation === 'self' && item.attendance === null)).toBe(true);

    // 7. WF-12 on a generated lesson: the earliest one has started — the teacher records the student present; the student sees it.
    const first = lessons[0]!;
    const sheet = await api().get(`${LESSONS}/${first.id}/attendance`).set(bearer('teacher')).expect(200);
    expect(sheet.body).toMatchObject({ recordable: true, closedReason: null, counts: { recorded: 0 } });
    const recorded = await api().put(`${LESSONS}/${first.id}/attendance`).set(bearer('teacher')).send({ records: [{ studentId: fx['student'], status: 'present' }] }).expect(200);
    expect(recorded.body.counts).toMatchObject({ recorded: 1, present: 1 });
    const seen = await api().get('/api/me/lessons').query({ classId }).set(bearer('student')).expect(200);
    expect((seen.body.items as { id: string; attendance: { status: string } | null }[]).find((item) => item.id === first.id)?.attendance).toMatchObject({ status: 'present' });

    // 8. The audit log — the manager's events newest first (nothing for the refused double booking and the repeated generation), and the teacher's single event.
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['manager'], limit: 50 }).set(bearer('manager')).expect(200))).toEqual([
      ['lessons.created', 'classes', classId],
      ['classes.schedule.changed', 'classes', otherId],
      ['classes.teachers.changed', 'classes', otherId],
      ['classes.created', 'classes', otherId],
      ['classes.schedule.changed', 'classes', classId],
      ['enrollments.created', 'enrollments', expect.any(String)],
      ['classes.status.changed', 'classes', classId],
      ['classes.teachers.changed', 'classes', classId],
      ['classes.created', 'classes', classId],
      ['rooms.created', 'rooms', roomSite.body.id],
      ['rooms.created', 'rooms', roomBranch.body.id],
    ]);
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['teacher'], limit: 50 }).set(bearer('manager')).expect(200))).toEqual([['attendance.recorded', 'lessons', first.id]]);
    await api().get(AUDIT).set(bearer('teacher')).expect(403);
  });
});
