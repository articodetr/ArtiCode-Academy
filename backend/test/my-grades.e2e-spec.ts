// TEST-132 — MOD-09-T06 «my grades» (API-129) against the live development
// database. Skipped when no database is reachable. Fixture users (a manager, a
// teacher, students with the system role, a guardian with the system role
// linked to two of them, a linked user without the role, an enrolled learner
// whose custom role holds no grades key), roles, a published course, classes,
// enrollments, assignments with a review, exams with results (through the API)
// and a non-default grade scheme (through Prisma) carry a unique prefix and are
// deleted at the end.
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
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `Q${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-132 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const EXAMS = '/api/exams';
const MY_GRADES = '/api/me/grades';
const ITEM_KEYS = ['class', 'components', 'enrollmentId', 'enrollmentStatus', 'final', 'relation', 'student'];

interface ItemBody {
  relation: string;
  student: { id: string };
  class: { id: string };
  components: { kind: string; id: string; weight: number | null; status: string; score: number | null; effectiveScore: number | null }[];
  final: { percent: number; label: { ar: string }; letter: string | null; isPass: boolean } | null;
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

describe.skipIf(!available)('MOD-09 «my grades» (e2e, TEST-132)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let schemeId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const items: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MY_GRADES).query(query).set(bearer(as));
  const itemOf = (list: ItemBody[], student: string, klass: string) => list.find((entry) => entry.student.id === id(student) && entry.class.id === classes[klass]);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function classAction(suffix: string, action: string): Promise<void> {
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  async function createClass(suffix: string): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api().put(`${CLASSES}/${classes[suffix]}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await classAction(suffix, 'open');
  }

  async function enroll(suffix: string, student: string): Promise<void> {
    await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status: 'active', activatedAt: new Date() }, select: { id: true } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة درجاتي' }, status: 'published' }, select: { id: true } })).id;
    schemeId = (
      await prisma.gradeScheme.create({
        data: { name: { ar: `${PREFIX} سلّم` }, bands: { create: [{ minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false }, { minPercent: 60, label: { ar: 'ناجح' }, letter: 'P', isPass: true }, { minPercent: 85, label: { ar: 'ممتاز' }, letter: 'A', isPass: true }] } },
        select: { id: true },
      })
    ).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    await createUser('manager', [await createRole('qmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'grades.read_all', 'grades.manage'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    for (const student of ['s1', 's2']) await createUser(student, [await systemRole('student')]);
    await createUser('guardian', [await systemRole('guardian')]);
    const noGrades = await createRole('qnogrades', ['courses.read', 'assignments.read', 'assignments.submit']);
    await createUser('linkedNoRole', [noGrades]);
    await createUser('learnerNoKey', [noGrades]);
    for (const [guardian, student] of [['guardian', 's1'], ['guardian', 's2'], ['linkedNoRole', 's1']] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'father' }, select: { studentUserId: true } });
    }

    await createClass('A');
    await createClass('B');
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('A', 'learnerNoKey');
    await enroll('B', 's1');
    const teacher = bearer('teacher');
    items['H'] = (await api().post(`${CLASSES}/${classes['A']}/assignments`).set(teacher).send({ title: { ar: 'واجب' }, maxScore: 20, weight: 40 }).expect(201)).body.id as string;
    await api().post(`${ASSIGNMENTS}/${items['H']}/status`).set(teacher).send({ action: 'publish' }).expect(200);
    items['D'] = (await api().post(`${CLASSES}/${classes['A']}/assignments`).set(teacher).send({ title: { ar: 'مسودة' }, maxScore: 10, weight: 10 }).expect(201)).body.id as string; // draft — never shown
    const submission = await api().post(`${ASSIGNMENTS}/${items['H']}/submissions`).set(bearer('s1')).send({ textAnswer: 'حل' }).expect(201);
    await api().post(`/api/submissions/${submission.body.id}/review`).set(teacher).send({ action: 'grade', score: 16 }).expect(200);
    items['E'] = (await api().post(`${CLASSES}/${classes['A']}/exams`).set(teacher).send({ title: { ar: 'النهائي' }, type: 'final', maxScore: 50, weight: 60 }).expect(201)).body.id as string;
    items['U'] = (await api().post(`${CLASSES}/${classes['A']}/exams`).set(teacher).send({ title: { ar: 'قصير' }, type: 'quiz', maxScore: 10 }).expect(201)).body.id as string; // unweighted, never published
    for (const exam of ['E', 'U']) await api().post(`${EXAMS}/${items[exam]}/status`).set(teacher).send({ action: 'schedule' }).expect(200);
    await api().put(`${EXAMS}/${items['E']}/results`).set(teacher).send({ results: [{ studentId: id('s1'), status: 'scored', score: 45 }, { studentId: id('s2'), status: 'absent' }] }).expect(200);
    await api().put(`${EXAMS}/${items['U']}/results`).set(teacher).send({ results: [{ studentId: id('s1'), status: 'scored', score: 3 }] }).expect(200);
    await api().post(`${EXAMS}/${items['E']}/status`).set(teacher).send({ action: 'publish' }).expect(200);
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: Object.values(classes) } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a student sees each of their enrollments with the non-draft assignments and published exams, their weights and scores, and no final grade before the finalization', async () => {
    const res = await mine('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = res.body.items as ItemBody[];
    expect(list.map((entry) => [entry.class.id, entry.relation])).toEqual([
      [classes['A'], 'self'],
      [classes['B'], 'self'],
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(ITEM_KEYS);
    const a = itemOf(list, 's1', 'A')!;
    expect(a.components.map((component) => [component.id, component.weight, component.status, component.score])).toEqual([
      [items['H'], 40, 'graded', 16],
      [items['E'], 60, 'scored', 45],
    ]); // the draft assignment and the unpublished exam are not shown
    expect(a.final).toBeNull();
    expect(itemOf(list, 's1', 'B')).toMatchObject({ components: [], final: null });
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ['current', 'projected', 'breakdown', 'finalizedBy', 'gradedBy', 'recordedBy']) expect(serialized).not.toContain(forbidden);
  });

  it('AC2 — after the finalization each student sees their final grade with its band; a guardian with the role sees the children’s (filters by student and class)', async () => {
    await api().post(`${ASSIGNMENTS}/${items['H']}/status`).set(bearer('teacher')).send({ action: 'close' }).expect(200);
    await classAction('A', 'start');
    await api().post(`${CLASSES}/${classes['A']}/final-grades`).set(bearer('teacher')).send({ schemeId }).expect(200);
    // s1: 40 × 16/20 + 60 × 45/50 = 32 + 54 = 86 → ممتاز; s2: the assignment missing and the exam absent = 0 → راسب.
    expect(itemOf((await mine('s1').expect(200)).body.items as ItemBody[], 's1', 'A')!.final).toMatchObject({ percent: 86, label: { ar: 'ممتاز' }, letter: 'A', isPass: true });
    const children = (await mine('guardian').expect(200)).body.items as ItemBody[];
    expect(children.every((entry) => entry.relation === 'child')).toBe(true);
    expect(children.map((entry) => `${entry.student.id === id('s1') ? 's1' : 's2'}:${entry.class.id === classes['A'] ? 'A' : 'B'}`).sort()).toEqual(['s1:A', 's1:B', 's2:A']);
    const s2 = itemOf(children, 's2', 'A')!;
    expect(s2.final).toMatchObject({ percent: 0, label: { ar: 'راسب' }, isPass: false });
    expect(s2.components.map((component) => [component.status, component.effectiveScore])).toEqual([
      ['missing', null],
      ['absent', 0],
    ]);
    expect(((await mine('guardian', { studentId: id('s2') }).expect(200)).body.items as ItemBody[]).map((entry) => entry.student.id)).toEqual([id('s2')]);
    expect(((await mine('guardian', { classId: classes['B']! }).expect(200)).body.items as ItemBody[]).map((entry) => entry.student.id)).toEqual([id('s1')]);
    expect((await mine('s1', { studentId: id('s2') }).expect(200)).body.items).toEqual([]); // not s1’s child
  });

  it('AC3 — a caller without grades.read_own or grades.read_linked is refused, enrolled or linked; a teacher too; no token is 401; invalid queries are 400', async () => {
    for (const refused of ['linkedNoRole', 'learnerNoKey', 'teacher', 'manager']) {
      const res = await mine(refused);
      expect(res.status, refused).toBe(403);
      expect(res.body, refused).toMatchObject({ code: 'permission_denied', missing: ['grades.read_own', 'grades.read_linked'] });
    }
    expect((await api().get(MY_GRADES)).status).toBe(401);
    expect((await mine('s1', { classId: 'x' })).status).toBe(400);
    expect((await mine('s1', { order: 'asc' })).status).toBe(400); // no such filter
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/grades'])).toEqual(['get']);
      for (const schema of ['MyGradeListDto', 'MyGradeItemDto', 'MyGradeComponentDto', 'MyFinalGradeDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
