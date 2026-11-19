// TEST-246 — MOD-20 «My School» course curriculum for authors (API-226..228;
// roadmap §4q, D-R130..D-R135) and the D-R135 guard of the flat syllabus PUT
// (API-049), against the live development database. Skipped when no database
// is reachable. A custom manager role (`courses.read` + `courses.manage`)
// writes; the seeded teacher role reads the curriculum of a course whose class
// it teaches; a student, an unrelated teacher and a role without
// `courses.read` cannot. Fixture users, roles, courses, classes and progress
// rows carry a unique prefix or belong to the fixture users and are deleted at
// the end (their audit rows stay — KI-032); audit events are counted by fixture
// actor above an id watermark, as in TEST-030.
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
const PREFIX = `V${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-246 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const YOUTUBE_ID = 'dQw4w9WgXcQ';
const ITEM_KEYS = [
  'completionMode',
  'content',
  'description',
  'durationSeconds',
  'estimatedMinutes',
  'id',
  'isPublished',
  'isRequired',
  'kind',
  'progressCount',
  'resources',
  'sortOrder',
  'title',
  'updatedAt',
];

interface Localized {
  ar: string;
  en?: string;
  tr?: string;
}
interface ItemView {
  id: string;
  sortOrder: number;
  title: Localized;
  description: Localized | null;
  estimatedMinutes: number | null;
  kind: string;
  content: Record<string, unknown> | null;
  resources: { title: Localized; url: string }[];
  isRequired: boolean;
  isPublished: boolean;
  completionMode: string;
  durationSeconds: number | null;
  progressCount: number;
  updatedAt: string;
}
interface SectionView {
  id: string;
  number: number;
  sortOrder: number;
  title: Localized | null;
  description: Localized | null;
  items: ItemView[];
}
interface CurriculumView {
  courseId: string;
  courseCode: string;
  canManage: boolean;
  sections: SectionView[];
  looseItems: ItemView[];
}

/** A new lesson of a PUT body (required flags spelled out — they are mandatory). */
const lesson = (ar: string, overrides: Record<string, unknown> = {}) => ({ title: { ar }, isRequired: true, isPublished: true, ...overrides });
/** The input of a kept lesson, as the editor sends it back. */
const keep = (item: ItemView, overrides: Record<string, unknown> = {}) => ({
  id: item.id,
  title: item.title,
  description: item.description,
  estimatedMinutes: item.estimatedMinutes,
  isRequired: item.isRequired,
  isPublished: item.isPublished,
  ...overrides,
});
/** The PUT body that states the curriculum exactly as read. */
const bodyOf = (view: CurriculumView) => ({
  sections: view.sections.map((section) => ({ id: section.id, title: section.title, description: section.description, items: section.items.map((item) => keep(item)) })),
  looseItems: view.looseItems.map((item) => keep(item)),
});

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

describe.skipIf(!available)('MOD-20 course curriculum (e2e, TEST-246)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);
  const path = (courseId: string) => `/api/courses/${courseId}/curriculum`;
  const contentPath = (courseId: string, itemId: string) => `${path(courseId)}/items/${itemId}/content`;
  const read = (as: string, courseId: string) => api().get(path(courseId)).set(bearer(as));
  const put = (as: string, courseId: string, body: unknown) => api().put(path(courseId)).set(bearer(as)).send(body as object);
  const putContent = (as: string, courseId: string, itemId: string, body: unknown) => api().put(contentPath(courseId, itemId)).set(bearer(as)).send(body as object);
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_v${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((id) => ({ roleId: id })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    tokens[name] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  /** A draft course through the API, and a class of it taught by the fixture teacher. */
  async function createCourse(suffix: string): Promise<string> {
    const res = await api().post('/api/courses').set(bearer('manager')).send({ code: `${PREFIX}-${suffix}`, name: { ar: `دورة ${suffix}` } }).expect(201);
    const courseId = res.body.id as string;
    const klass = await prisma.class.create({ data: { courseId, code: `${PREFIX}-${suffix}-K`, name: { ar: `فصل ${suffix}` }, capacity: 10 }, select: { id: true } });
    await prisma.classTeacher.create({ data: { classId: klass.id, teacherUserId: fx['teacher']!, role: 'lead' }, select: { classId: true } });
    return courseId;
  }

  async function addProgress(studentName: string, courseId: string, itemId: string): Promise<void> {
    const now = new Date();
    await prisma.learningProgress.create({
      data: { studentUserId: fx[studentName]!, syllabusItemId: itemId, courseId, status: 'in_progress', firstOpenedAt: now, lastOpenedAt: now },
      select: { syllabusItemId: true },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    await createUser('manager', [await createRole('manager', ['courses.read', 'courses.manage'])]);
    await createUser('outsider', [await createRole('outsider', ['audit.read'])]);
    const teacher = await roleId('teacher');
    await createUser('teacher', [teacher]);
    await createUser('otherTeacher', [teacher]);
    await createUser('student', [await roleId('student')]);
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdUserIds.length > 0) await prisma.learningProgress.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma?.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma?.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('D-R135 — the signed-in catalog (API-219/220) counts and lists published lessons only', async () => {
    const courseId = await createCourse('V');
    await put('manager', courseId, { sections: [{ items: [lesson('ظاهر'), lesson('مخفي', { isPublished: false })] }] }).expect(200);
    await api().post(`/api/courses/${courseId}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(200);

    const detail = await api().get(`/api/catalog/courses/${courseId}`).set(bearer('student')).expect(200);
    expect((detail.body.syllabus as { title: { ar: string } }[]).map((item) => item.title.ar)).toEqual(['ظاهر']);
    const list = await api().get('/api/catalog/courses').query({ q: `${PREFIX}-V` }).set(bearer('student')).expect(200);
    const card = (list.body.items as { id: string; syllabusCount: number }[]).find((item) => item.id === courseId);
    expect(card?.syllabusCount).toBe(1);
  });

  it('API-226 — reads every level (empty ones too) and the loose lessons for courses.manage and for a teacher of a class of the course; anyone else is 404', async () => {
    const courseId = await createCourse('A');
    const built = await put('manager', courseId, {
      sections: [{ title: { ar: 'أساسيات', en: 'Basics' }, description: { ar: 'البداية' }, items: [lesson('أ1', { estimatedMinutes: 20 }), lesson('أ2')] }, { items: [] }],
      looseItems: [lesson('حر')],
    }).expect(200);

    const res = await read('manager', courseId).expect(200);
    const view = res.body as CurriculumView;
    expect(view).toEqual(built.body);
    expect(Object.keys(view).sort()).toEqual(['canManage', 'courseCode', 'courseId', 'looseItems', 'sections']);
    expect(view).toMatchObject({ courseId, courseCode: `${PREFIX}-A`, canManage: true });
    expect(view.sections.map((section) => [section.number, section.sortOrder, section.items.length])).toEqual([
      [1, 0, 2],
      [2, 1, 0],
    ]);
    expect(view.sections[0]).toMatchObject({ title: { ar: 'أساسيات', en: 'Basics' }, description: { ar: 'البداية' } });
    expect(view.sections[1]).toMatchObject({ title: null, description: null, items: [] });
    expect(Object.keys(view.sections[0]!.items[0]!).sort()).toEqual(ITEM_KEYS);
    expect(view.sections[0]!.items[0]).toMatchObject({
      title: { ar: 'أ1' },
      description: null,
      estimatedMinutes: 20,
      kind: 'text',
      content: null,
      resources: [],
      isRequired: true,
      isPublished: true,
      completionMode: 'manual',
      durationSeconds: 1200,
      progressCount: 0,
    });
    expect(view.looseItems.map((item) => [item.title.ar, item.sortOrder])).toEqual([['حر', 2]]);

    const asTeacher = await read('teacher', courseId).expect(200);
    expect(asTeacher.body).toEqual({ ...view, canManage: false });

    for (const name of ['otherTeacher', 'student']) {
      const hidden = await read(name, courseId);
      expect(hidden.status, name).toBe(404);
      expect(hidden.body).toMatchObject({ code: 'course_not_found', courseId });
    }
    const denied = await read('outsider', courseId);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.read'] });
    await api().get(path(courseId)).expect(401);
    const unknown = await read('manager', NIL_ID);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'course_not_found', courseId: NIL_ID });
    await api().get(path('not-a-uuid')).set(bearer('manager')).expect(400);
  });

  it('API-227 — creates levels and moves lessons into them, swaps levels, edits and deletes, with one courses.curriculum.changed per effective write', async () => {
    const courseId = await createCourse('R');
    const flat = await api()
      .put(`/api/courses/${courseId}/syllabus`)
      .set(bearer('manager'))
      .send({ items: [{ title: { ar: 'مقدمة' }, estimatedMinutes: 30 }, { title: { ar: 'متغيرات' } }, { title: { ar: 'شروط' } }] })
      .expect(200);
    const flatIds = (flat.body.items as { id: string }[]).map((item) => item.id);
    const before = (await read('manager', courseId).expect(200)).body as CurriculumView;
    expect(before.sections).toEqual([]);
    expect(before.looseItems.map((item) => item.id)).toEqual(flatIds);
    const [i1, i2, i3] = before.looseItems as [ItemView, ItemView, ItemView];

    const m = await mark();
    const first = await put('manager', courseId, {
      sections: [
        { title: { ar: 'أساسيات', en: 'Basics' }, items: [keep(i1), keep(i2)] },
        { items: [lesson('حلقات', { isRequired: false })] },
        { title: { ar: 'فارغ' }, description: null, items: [] },
      ],
      looseItems: [keep(i3)],
    }).expect(200);
    const created = first.body as CurriculumView;
    expect(created.sections.map((section) => section.number)).toEqual([1, 2, 3]);
    expect(created.sections.map((section) => section.items.map((item) => item.title.ar))).toEqual([['مقدمة', 'متغيرات'], ['حلقات'], []]);
    expect(created.sections[0]!.items.map((item) => item.id)).toEqual([i1.id, i2.id]);
    expect(created.looseItems.map((item) => item.id)).toEqual([i3.id]);
    expect([...created.sections.flatMap((section) => section.items), ...created.looseItems].map((item) => item.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(created.sections[1]!.items[0]).toMatchObject({ kind: 'text', content: null, resources: [], isRequired: false, isPublished: true, description: null, estimatedMinutes: null });
    const [s1, s2, s3] = created.sections as [SectionView, SectionView, SectionView];
    const nulls = await prisma.$queryRaw<{ id: string; title_null: boolean; description_null: boolean }[]>`
      SELECT id, title IS NULL AS title_null, description IS NULL AS description_null FROM course_sections WHERE course_id = ${courseId}::uuid ORDER BY sort_order`;
    expect(nulls).toEqual([
      { id: s1.id, title_null: false, description_null: true },
      { id: s2.id, title_null: true, description_null: true },
      { id: s3.id, title_null: false, description_null: true },
    ]);

    // The curriculum as read, again: nothing written (same body, same updatedAt), nothing recorded.
    const same = await put('manager', courseId, bodyOf(created)).expect(200);
    expect(same.body).toEqual(created);

    // Swap the first two levels: the lessons follow their level.
    const swapBody = bodyOf(created);
    swapBody.sections = [swapBody.sections[1]!, swapBody.sections[0]!, swapBody.sections[2]!];
    const swapped = (await put('manager', courseId, swapBody).expect(200)).body as CurriculumView;
    expect(swapped.sections.map((section) => [section.id, section.number, section.sortOrder])).toEqual([
      [s2.id, 1, 0],
      [s1.id, 2, 1],
      [s3.id, 3, 2],
    ]);
    expect([...swapped.sections.flatMap((section) => section.items), ...swapped.looseItems].map((item) => item.title.ar)).toEqual(['حلقات', 'مقدمة', 'متغيرات', 'شروط']);

    // Name a level, unpublish a lesson, drop the empty level and the loose lesson.
    const edited = (
      await put('manager', courseId, {
        sections: [
          { id: s2.id, title: { ar: 'تطبيقات' }, items: swapped.sections[0]!.items.map((item) => keep(item)) },
          { id: s1.id, title: s1.title, items: [keep(swapped.sections[1]!.items[0]!, { isPublished: false }), keep(swapped.sections[1]!.items[1]!)] },
        ],
      }).expect(200)
    ).body as CurriculumView;
    expect(edited.sections.map((section) => [section.id, section.title])).toEqual([
      [s2.id, { ar: 'تطبيقات' }],
      [s1.id, { ar: 'أساسيات', en: 'Basics' }],
    ]);
    expect(edited.looseItems).toEqual([]);
    expect(edited.sections[1]!.items[0]).toMatchObject({ id: i1.id, isPublished: false });
    expect(await prisma.courseSection.count({ where: { id: s3.id } })).toBe(0);
    expect(await prisma.courseSyllabusItem.count({ where: { id: i3.id } })).toBe(0);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['courses.curriculum.changed', 'courses.curriculum.changed', 'courses.curriculum.changed']);
    expect(events.every((event) => event.entityType === 'courses' && event.entityId === courseId && event.actorUserId === fx['manager'])).toBe(true);
    expect(events.map((event) => event.metadata)).toEqual([
      {
        code: `${PREFIX}-R`,
        sections: { added: 3, updated: 0, removed: 0 },
        items: { added: 1, updated: 0, removed: 0, moved: 2 },
        reordered: false,
        totalSections: 3,
        totalItems: 4,
      },
      {
        code: `${PREFIX}-R`,
        sections: { added: 0, updated: 0, removed: 0 },
        items: { added: 0, updated: 0, removed: 0, moved: 0 },
        reordered: true,
        totalSections: 3,
        totalItems: 4,
      },
      {
        code: `${PREFIX}-R`,
        sections: { added: 0, updated: 1, removed: 1 },
        items: { added: 0, updated: 1, removed: 1, moved: 0 },
        reordered: false,
        totalSections: 2,
        totalItems: 3,
      },
    ]);
  });

  it('API-227 — refuses ids of another course, repeated ids and invalid bodies without writing or recording', async () => {
    const own = await createCourse('O');
    const other = await createCourse('X');
    const foreign = (await put('manager', other, { sections: [{ items: [lesson('غريب')] }] }).expect(200)).body as CurriculumView;
    const mine = (await put('manager', own, { sections: [{ items: [lesson('لي')] }] }).expect(200)).body as CurriculumView;
    const foreignSection = foreign.sections[0]!;
    const mySection = mine.sections[0]!;
    const myItem = mySection.items[0]!;

    const m = await mark();
    const unknown = await put('manager', own, {
      sections: [
        { id: mySection.id, items: [keep(myItem), keep(foreignSection.items[0]!)] },
        { id: foreignSection.id, items: [] },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({
      code: 'curriculum_invalid',
      unknownSections: [foreignSection.id],
      duplicateSections: [],
      unknownItems: [foreignSection.items[0]!.id],
      duplicateItems: [],
    });
    const repeated = await put('manager', own, { sections: [{ id: mySection.id, items: [keep(myItem)] }, { id: mySection.id, items: [] }], looseItems: [keep(myItem)] });
    expect(repeated.status).toBe(400);
    expect(repeated.body).toMatchObject({ code: 'curriculum_invalid', unknownSections: [], duplicateSections: [mySection.id], unknownItems: [], duplicateItems: [myItem.id] });

    const invalid: Record<string, unknown>[] = [
      { sections: [{ items: [{ title: { ar: 'م' }, isPublished: true }] }] }, // isRequired missing
      { sections: [{ items: [lesson('م', { isRequired: 'true' })] }] },
      { sections: [{ items: [lesson('م', { isPublished: 1 })] }] },
      { sections: [{ items: [lesson('م', { isRequired: null })] }] },
      { sections: [{ items: [lesson('م', { estimatedMinutes: '30' })] }] },
      { sections: [{ items: [lesson('م', { estimatedMinutes: 0 })] }] },
      { sections: [{ items: [lesson('م', { estimatedMinutes: 1441 })] }] },
      { sections: [{ items: [{ title: { en: 'no arabic' }, isRequired: true, isPublished: true }] }] },
      { sections: [{ title: { en: 'Level' }, items: [] }] },
      { sections: [{ items: [lesson('م', { kind: 'video' })] }] }, // kind/content/resources belong to API-228
      { sections: [{ items: [lesson('م', { id: 'nope' })] }] },
      { sections: [{ id: 'nope', items: [] }] },
      { sections: [{ items: 'all' }] },
      { sections: [{}] },
      { sections: Array.from({ length: 51 }, () => ({ items: [] })) },
      { sections: [{ items: Array.from({ length: 150 }, (_v, i) => lesson(`ب${i}`)) }], looseItems: Array.from({ length: 51 }, (_v, i) => lesson(`ح${i}`)) },
      { sections: 'all' },
      { looseItems: [] },
      {},
    ];
    for (const body of invalid) {
      const bad = await put('manager', own, body);
      expect(bad.status, JSON.stringify(body).slice(0, 100)).toBe(400);
      expect(bad.body.code, JSON.stringify(body).slice(0, 100)).not.toBe('curriculum_invalid');
    }
    const denied = await put('teacher', own, bodyOf(mine));
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    const missing = await put('manager', NIL_ID, { sections: [] });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'course_not_found', courseId: NIL_ID });

    expect(await eventsSince(m)).toEqual([]);
    expect((await read('manager', own).expect(200)).body).toEqual(mine);
  });

  it('D-R135 — a lesson with learners’ progress is never deleted (API-227 and API-049): 409 lesson_has_progress, nothing written; unpublishing it works', async () => {
    const courseId = await createCourse('P');
    const built = (await put('manager', courseId, { sections: [{ items: [lesson('مدروس'), lesson('جديد')] }] }).expect(200)).body as CurriculumView;
    const section = built.sections[0]!;
    const [studied, fresh] = section.items as [ItemView, ItemView];
    await addProgress('student', courseId, studied.id);

    const view = (await read('manager', courseId).expect(200)).body as CurriculumView;
    expect(view.sections[0]!.items.map((item) => item.progressCount)).toEqual([1, 0]);

    const m = await mark();
    const dropLesson = await put('manager', courseId, { sections: [{ id: section.id, items: [keep(fresh)] }] });
    expect(dropLesson.status).toBe(409);
    expect(dropLesson.body).toMatchObject({ code: 'lesson_has_progress', itemIds: [studied.id] });
    const dropAll = await put('manager', courseId, { sections: [] });
    expect(dropAll.status).toBe(409);
    expect(dropAll.body).toMatchObject({ code: 'lesson_has_progress', itemIds: [studied.id] });
    // API-049, the flat syllabus PUT, refuses the same deletion before any write.
    const flat = await api()
      .put(`/api/courses/${courseId}/syllabus`)
      .set(bearer('manager'))
      .send({ items: [{ id: fresh.id, title: { ar: 'جديد بعنوان آخر' } }] });
    expect(flat.status).toBe(409);
    expect(flat.body).toMatchObject({ code: 'lesson_has_progress', itemIds: [studied.id] });
    expect(await eventsSince(m)).toEqual([]);
    const untouched = (await read('manager', courseId).expect(200)).body as CurriculumView;
    expect(untouched).toEqual(view);

    // Unpublish it instead, then delete the other lesson (no progress on it).
    const unpublished = (await put('manager', courseId, { sections: [{ id: section.id, items: [keep(studied, { isPublished: false }), keep(fresh)] }] }).expect(200)).body as CurriculumView;
    expect(unpublished.sections[0]!.items[0]).toMatchObject({ id: studied.id, isPublished: false, progressCount: 1 });
    const dropped = (await put('manager', courseId, { sections: [{ id: section.id, items: [keep(unpublished.sections[0]!.items[0]!)] }] }).expect(200)).body as CurriculumView;
    expect(dropped.sections[0]!.items.map((item) => item.id)).toEqual([studied.id]);
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['courses.curriculum.changed', 'courses.curriculum.changed']);
  });

  it('API-228 — writes the content of a text, YouTube, file-video and PDF lesson with one event each; identical content records nothing; invalid content is 400 content_invalid', async () => {
    const courseId = await createCourse('C');
    const other = await createCourse('D');
    const built = (await put('manager', courseId, { sections: [{ items: [lesson('درس المحتوى', { estimatedMinutes: 10 })] }] }).expect(200)).body as CurriculumView;
    const itemId = built.sections[0]!.items[0]!.id;
    const foreignItemId = ((await put('manager', other, { looseItems: [lesson('غريب')], sections: [] }).expect(200)).body as CurriculumView).looseItems[0]!.id;
    const handout = { title: { ar: 'ملف التمارين', en: 'Exercises' }, url: 'https://cdn.example.org/exercises.pdf' };

    const m = await mark();
    const textBody = { kind: 'text', content: { body: { ar: 'الفقرة الأولى\n\nالفقرة الثانية' } }, resources: [handout] };
    const text = await putContent('manager', courseId, itemId, textBody).expect(200);
    expect(Object.keys(text.body).sort()).toEqual(ITEM_KEYS);
    expect(text.body).toMatchObject({
      id: itemId,
      kind: 'text',
      content: { body: { ar: 'الفقرة الأولى\n\nالفقرة الثانية' } },
      resources: [handout],
      completionMode: 'manual',
      durationSeconds: 600,
      progressCount: 0,
      isRequired: true,
      isPublished: true,
    });
    const again = await putContent('manager', courseId, itemId, textBody).expect(200);
    expect(again.body).toEqual(text.body);

    const youtube = await putContent('manager', courseId, itemId, { kind: 'video', content: { provider: 'youtube', url: `https://youtu.be/${YOUTUBE_ID}?t=3` }, resources: [] }).expect(200);
    expect(youtube.body).toMatchObject({
      kind: 'video',
      content: { provider: 'youtube', videoId: YOUTUBE_ID, url: `https://www.youtube.com/watch?v=${YOUTUBE_ID}`, durationSeconds: null },
      resources: [],
      completionMode: 'manual',
      durationSeconds: 600,
    });
    const file = await putContent('manager', courseId, itemId, { kind: 'video', content: { provider: 'file', url: 'https://cdn.example.org/lesson.mp4', durationSeconds: 754 }, resources: [] }).expect(200);
    expect(file.body).toMatchObject({
      kind: 'video',
      content: { provider: 'file', url: 'https://cdn.example.org/lesson.mp4', durationSeconds: 754, captions: [] },
      completionMode: 'playback',
      durationSeconds: 754,
    });
    const pdfBody = { kind: 'pdf', content: { url: 'https://cdn.example.org/notes.pdf' }, resources: [handout, { title: { ar: 'مرجع' }, url: 'https://cdn.example.org/ref.pdf' }] };
    const pdf = await putContent('manager', courseId, itemId, pdfBody).expect(200);
    expect(pdf.body).toMatchObject({ kind: 'pdf', content: { url: 'https://cdn.example.org/notes.pdf' }, completionMode: 'manual', durationSeconds: 600 });
    expect(pdf.body.resources).toHaveLength(2);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(Array.from({ length: 4 }, () => 'courses.curriculum.content.changed'));
    expect(events.every((event) => event.entityType === 'courses' && event.entityId === courseId)).toBe(true);
    expect(events.map((event) => event.metadata)).toEqual([
      { code: `${PREFIX}-C`, itemId, kind: 'text', previousKind: 'text', resources: 1 },
      { code: `${PREFIX}-C`, itemId, kind: 'video', previousKind: 'text', resources: 0 },
      { code: `${PREFIX}-C`, itemId, kind: 'video', previousKind: 'video', resources: 0 },
      { code: `${PREFIX}-C`, itemId, kind: 'pdf', previousKind: 'video', resources: 2 },
    ]);

    const m2 = await mark();
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ kind: 'pdf', content: { url: 'http://cdn.example.org/notes.pdf' }, resources: [] }, /^content: url/],
      [{ kind: 'video', content: { provider: 'file', url: 'https://cdn.example.org/v.mp4' }, resources: [] }, /^content: durationSeconds/],
      [{ kind: 'video', content: { provider: 'vimeo', url: `https://youtu.be/${YOUTUBE_ID}` }, resources: [] }, /^content: url/],
      [{ kind: 'text', content: { body: { en: 'no arabic' } }, resources: [] }, /^content: body\.ar/],
      [{ kind: 'pdf', content: { url: 'https://cdn.example.org/notes.pdf' }, resources: Array.from({ length: 21 }, () => handout) }, /^resources: /],
      [{ kind: 'pdf', content: null, resources: [{ title: { ar: 'م' }, url: 'ftp://x.org/a' }] }, /^resources: 0\.url/],
    ];
    for (const [body, problem] of refused) {
      const bad = await putContent('manager', courseId, itemId, body);
      expect(bad.status, JSON.stringify(body).slice(0, 100)).toBe(400);
      expect(bad.body.code).toBe('content_invalid');
      expect((bad.body.problems as string[]).some((entry) => problem.test(entry)), JSON.stringify(bad.body.problems)).toBe(true);
    }
    const malformed: Record<string, unknown>[] = [
      { kind: 'slides', content: null, resources: [] },
      { content: null, resources: [] },
      { kind: 'pdf', resources: [] },
      { kind: 'pdf', content: null },
      { kind: 'pdf', content: [], resources: [] },
      { kind: 'pdf', content: 'https://cdn.example.org/a.pdf', resources: [] },
      { kind: 'pdf', content: null, resources: {} },
      { kind: 'pdf', content: null, resources: [], extra: true },
    ];
    for (const body of malformed) {
      const bad = await putContent('manager', courseId, itemId, body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.code, JSON.stringify(body)).not.toBe('content_invalid');
    }
    const foreign = await putContent('manager', courseId, foreignItemId, pdfBody);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: 'lesson_not_found', itemId: foreignItemId });
    const unknownItem = await putContent('manager', courseId, NIL_ID, pdfBody);
    expect(unknownItem.body).toMatchObject({ code: 'lesson_not_found', itemId: NIL_ID });
    const unknownCourse = await putContent('manager', NIL_ID, itemId, pdfBody);
    expect(unknownCourse.status).toBe(404);
    expect(unknownCourse.body).toMatchObject({ code: 'course_not_found' });
    const denied = await putContent('teacher', courseId, itemId, pdfBody);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    expect(await eventsSince(m2)).toEqual([]);

    // The curriculum shows the content, and a structure write keeps it: API-227 never touches kind, content or resources.
    const view = (await read('manager', courseId).expect(200)).body as CurriculumView;
    expect(view.sections[0]!.items[0]).toEqual(pdf.body);
    const renamed = (
      await put('manager', courseId, { sections: [{ id: view.sections[0]!.id, items: [keep(view.sections[0]!.items[0]!, { title: { ar: 'درس معاد تسميته' } })] }] }).expect(200)
    ).body as CurriculumView;
    expect(renamed.sections[0]!.items[0]).toMatchObject({ title: { ar: 'درس معاد تسميته' }, kind: 'pdf', content: pdf.body.content, resources: pdf.body.resources });
  });

  it('API-049 keeps the level, kind, content, resources and flags of a kept lesson, and puts a new one outside every level', async () => {
    const courseId = await createCourse('S');
    const built = (await put('manager', courseId, { sections: [{ title: { ar: 'المستوى' }, items: [lesson('أصلي', { isRequired: false })] }] }).expect(200)).body as CurriculumView;
    const item = built.sections[0]!.items[0]!;
    const withContent = (await putContent('manager', courseId, item.id, { kind: 'audio', content: { url: 'https://cdn.example.org/a.mp3', durationSeconds: 300 }, resources: [] }).expect(200))
      .body as ItemView;

    const m = await mark();
    await api()
      .put(`/api/courses/${courseId}/syllabus`)
      .set(bearer('manager'))
      .send({ items: [{ id: item.id, title: { ar: 'أصلي معدل' } }, { title: { ar: 'من المنهج المسطح' } }] })
      .expect(200);
    const view = (await read('manager', courseId).expect(200)).body as CurriculumView;
    expect(view.sections[0]!.items).toHaveLength(1);
    expect(view.sections[0]!.items[0]).toMatchObject({
      id: item.id,
      title: { ar: 'أصلي معدل' },
      kind: 'audio',
      content: withContent.content,
      isRequired: false,
      isPublished: true,
      completionMode: 'playback',
      durationSeconds: 300,
    });
    expect(view.looseItems.map((loose) => [loose.title.ar, loose.kind, loose.content])).toEqual([['من المنهج المسطح', 'text', null]]);
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['courses.syllabus.changed']);
  });

  it(
    'documents the three routes in OpenAPI and refuses a hostile Origin',
    async () => {
      const courseId = await createCourse('H');
      const hostile = await api()
        .put(path(courseId))
        .set({ ...bearer('manager'), Origin: 'https://evil.example' })
        .send({ sections: [{ items: [lesson('م')] }] });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.courseSyllabusItem.count({ where: { courseId } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/courses/{id}/curriculum'] ?? {}).sort()).toEqual(['get', 'put']);
      expect(Object.keys(paths['/api/courses/{id}/curriculum/items/{itemId}/content'] ?? {})).toEqual(['put']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['CurriculumDto', 'CurriculumSectionDto', 'CurriculumItemDto', 'LessonResourceDto', 'ReplaceCurriculumDto', 'CurriculumSectionInputDto', 'CurriculumItemInputDto', 'ReplaceLessonContentDto']) {
        expect(schemas).toHaveProperty(name);
      }
    },
    30_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
