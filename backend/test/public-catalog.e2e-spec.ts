// TEST-248 (part 2) — MOD-20 (roadmap §4q, D-R138): the public catalog for
// visitors who are not signed in (API-236 GET /api/public/catalog/courses,
// API-237 GET /api/public/catalog/courses/:id) and the `catalogPublic` flag of
// API-205, against the live development database. Skipped when no database is
// reachable.
//
// The suite switches `settings.catalog.publicBrowsing` of the shared academy
// row: it reads the `catalog` settings domain first and puts back exactly
// that domain in afterAll (finally), leaving every other key as it finds it at
// that moment. Its courses, lessons, classes, fee plan and teacher carry a
// unique prefix and are deleted at the end. Every request is anonymous; audit
// events are looked for by this suite's own User-Agent above an id watermark.
// The rate-limit test runs last — once it has tripped, this app instance
// answers 429 on the route for a minute.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `PC${RUN}`;
const USER_AGENT = `TEST-248 public-catalog supertest ${RUN}`;
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const LIST = '/api/public/catalog/courses';
const COVER = 'https://cdn.example.org/courses/public-catalog-test.jpg';
const TEACHER_NAME = `Hidden Teacher ${RUN}`;
const CARD_KEYS = [
  'code',
  'coverImageUrl',
  'durationHours',
  'hasFreeSeat',
  'id',
  'level',
  'lessonCount',
  'levelCount',
  'name',
  'openClasses',
  'price',
  'pricing',
  'sessionsCount',
  'summary',
].sort();
/** API-236/237: 60 requests per minute per IP. */
const LIMIT = 60;

type JsonObject = Record<string, unknown>;

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

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Every key name in a JSON value, at any depth. */
function keysOf(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, out);
  else if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      out.add(key);
      keysOf(nested, out);
    }
  }
  return out;
}

describe.skipIf(!available)('MOD-20 public catalog (e2e, TEST-248 part 2)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let academyId: string;
  let currency: string;
  /** The `catalog` domain of the settings as the suite found it (undefined = absent). */
  let originalCatalog: unknown;
  let hadCatalog = false;
  let markId: string;
  let teacherId: string | undefined;
  const ids: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const anonymous = (path: string) => api().get(path).set('User-Agent', USER_AGENT);
  const list = (query = '') => anonymous(`${LIST}?q=${PREFIX}${query}`);

  /** Rewrites only `settings.catalog` of the academy row (read-modify-write of the current jsonb). */
  async function setCatalogDomain(present: boolean, value: unknown): Promise<void> {
    const row = await prisma.academy.findUniqueOrThrow({ where: { id: academyId }, select: { settings: true } });
    const next: JsonObject = isObject(row.settings) ? structuredClone(row.settings) : {};
    if (present) next['catalog'] = value;
    else delete next['catalog'];
    await prisma.academy.update({ where: { id: academyId }, data: { settings: next as Prisma.InputJsonValue }, select: { id: true } });
  }

  /** The catalog domain as found, with `publicBrowsing` set to `value` (null = the key absent). */
  const setPublicBrowsing = (value: boolean | null) => {
    const domain: JsonObject = isObject(originalCatalog) ? { ...originalCatalog } : {};
    if (value === null) delete domain['publicBrowsing'];
    else domain['publicBrowsing'] = value;
    return setCatalogDomain(true, domain);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

    const academy = await prisma.academy.findFirstOrThrow({ select: { id: true, settings: true, currency: true } });
    academyId = academy.id;
    currency = academy.currency;
    hadCatalog = isObject(academy.settings) && Object.hasOwn(academy.settings, 'catalog');
    originalCatalog = hadCatalog ? structuredClone((academy.settings as JsonObject)['catalog']) : undefined;

    // A teacher whose name must never reach a visitor.
    teacherId = (
      await prisma.user.create({ data: { email: `pc-teacher-${RUN.toLowerCase()}@example.test`, fullName: TEACHER_NAME, status: 'active' }, select: { id: true } })
    ).id;

    // Course A — published, paid, with a curriculum of two titled/untitled levels, an empty level, an unpublished lesson and a loose lesson.
    const a = await prisma.course.create({
      data: {
        code: `${PREFIX}-A`,
        name: { ar: `دورة عامة ${RUN}`, en: `Public course ${RUN}` },
        summary: { ar: 'ملخص' },
        description: { ar: 'وصف الدورة' },
        coverImageUrl: COVER,
        durationHours: 12.5,
        sessionsCount: 8,
        minAge: 10,
        maxAge: 16,
        status: 'published',
      },
      select: { id: true },
    });
    ids['a'] = a.id;
    const plan = await prisma.feePlan.create({
      data: {
        name: { ar: `${PREFIX} رسوم` },
        courseId: a.id,
        lines: [{ description: { ar: 'رسوم الدورة' }, amount: 750 }],
        installments: [{ percent: 100, dueOffsetDays: 0 }],
      },
      select: { id: true },
    });
    ids['plan'] = plan.id;
    await prisma.course.update({ where: { id: a.id }, data: { enrollmentFeePlanId: plan.id }, select: { id: true } });
    const basics = await prisma.courseSection.create({ data: { courseId: a.id, sortOrder: 0, title: { ar: 'الأساسيات', en: 'Basics' } }, select: { id: true } });
    const empty = await prisma.courseSection.create({ data: { courseId: a.id, sortOrder: 1, title: { ar: 'مستوى فارغ' } }, select: { id: true } });
    const second = await prisma.courseSection.create({ data: { courseId: a.id, sortOrder: 2 }, select: { id: true } });
    const item = (sortOrder: number, data: Omit<Prisma.CourseSyllabusItemUncheckedCreateInput, 'courseId' | 'sortOrder'>) =>
      prisma.courseSyllabusItem.create({ data: { courseId: a.id, sortOrder, ...data }, select: { id: true } });
    ids['l1'] = (await item(0, { sectionId: basics.id, title: { ar: 'مقدمة' }, estimatedMinutes: 10, kind: 'text', content: { body: { ar: 'نص الدرس السري' } } })).id;
    ids['l2'] = (
      await item(1, { sectionId: basics.id, title: { ar: 'فيديو' }, kind: 'video', content: { provider: 'file', url: 'https://cdn.example.org/v/secret.mp4', durationSeconds: 600, captions: [] } })
    ).id;
    ids['l3'] = (await item(2, { sectionId: basics.id, title: { ar: 'درس غير منشور' }, isPublished: false })).id;
    ids['l4'] = (await item(3, { sectionId: empty.id, title: { ar: 'مخفي أيضًا' }, isPublished: false })).id;
    ids['l5'] = (await item(4, { sectionId: second.id, title: { ar: 'ملف PDF' }, kind: 'pdf', estimatedMinutes: 15, content: { url: 'https://cdn.example.org/p/secret.pdf' } })).id;
    ids['l6'] = (await item(5, { title: { ar: 'صوت' }, kind: 'audio', isRequired: false, content: { url: 'https://cdn.example.org/a/secret.mp3', durationSeconds: 120 } })).id;

    // Its classes: one open to self-service with a lead teacher and a free seat; one open but not to self-service (never counted).
    const open = await prisma.class.create({
      data: { courseId: a.id, code: `${PREFIX}-A-OPEN`, name: { ar: 'فصل مفتوح' }, capacity: 3, status: 'open', selfEnrollment: true },
      select: { id: true },
    });
    await prisma.classTeacher.create({ data: { classId: open.id, teacherUserId: teacherId, role: 'lead' }, select: { classId: true } });
    await prisma.class.create({ data: { courseId: a.id, code: `${PREFIX}-A-OFFICE`, name: { ar: 'فصل المكتب' }, capacity: 3, status: 'open' }, select: { id: true } });

    // Course B — published, free, no curriculum, no class. Course D — a draft, never shown.
    ids['b'] = (await prisma.course.create({ data: { code: `${PREFIX}-B`, name: { ar: 'دورة مجانية' }, status: 'published' }, select: { id: true } })).id;
    ids['d'] = (await prisma.course.create({ data: { code: `${PREFIX}-D`, name: { ar: 'مسودة' }, status: 'draft' }, select: { id: true } })).id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma && academyId) await setCatalogDomain(hadCatalog, originalCatalog);
    } finally {
      try {
        if (prisma) {
          await prisma.classTeacher.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
          await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
          await prisma.course.updateMany({ where: { code: { startsWith: PREFIX } }, data: { enrollmentFeePlanId: null } });
          await prisma.feePlan.deleteMany({ where: { name: { path: ['ar'], string_starts_with: PREFIX } } });
          await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
          if (teacherId) await prisma.user.deleteMany({ where: { id: teacherId } });
        }
      } finally {
        await prisma?.$disconnect();
        await app?.close();
      }
    }
  });

  it('AC1 — while publicBrowsing is not true (absent or false) both routes are 404 catalog_not_public without a token, and API-205 says catalogPublic false', async () => {
    for (const value of [null, false] as const) {
      await setPublicBrowsing(value);
      const listed = await list();
      expect(listed.status, String(value)).toBe(404);
      expect(listed.body).toMatchObject({ statusCode: 404, code: 'catalog_not_public' });
      // Checked before the course itself: even a real published course is not revealed.
      const detail = await anonymous(`${LIST}/${ids['a']}`);
      expect(detail.status).toBe(404);
      expect(detail.body.code).toBe('catalog_not_public');
      expect((await anonymous('/api/academy/public').expect(200)).body.catalogPublic).toBe(false);
    }
  });

  it('AC2 — once open, the list shows the published courses only, with price, open classes and the curriculum counts; never a teacher, a class code or a lesson', async () => {
    await setPublicBrowsing(true);
    expect((await anonymous('/api/academy/public').expect(200)).body.catalogPublic).toBe(true);
    // An invalid bearer token changes nothing on a public route.
    await api().get(`${LIST}?q=${PREFIX}`).set({ 'User-Agent': USER_AGENT, Authorization: 'Bearer not-a-token' }).expect(200);

    const res = await list().expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'nextCursor']);
    expect(res.body.nextCursor).toBeNull();
    const items = res.body.items as JsonObject[];
    expect(items.map((item) => item['code'])).toEqual([`${PREFIX}-A`, `${PREFIX}-B`]);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(CARD_KEYS);
    expect(items[0]).toEqual({
      id: ids['a'],
      code: `${PREFIX}-A`,
      name: { ar: `دورة عامة ${RUN}`, en: `Public course ${RUN}` },
      summary: { ar: 'ملخص' },
      coverImageUrl: COVER,
      level: null,
      durationHours: 12.5,
      sessionsCount: 8,
      pricing: 'paid',
      price: { amount: 750, currency },
      openClasses: 1,
      hasFreeSeat: true,
      // Published lessons: l1, l2, l5, l6; levels a learner sees: «الأساسيات», the untitled level, the loose group.
      lessonCount: 4,
      levelCount: 3,
    });
    expect(items[1]).toMatchObject({ id: ids['b'], pricing: 'free', price: null, openClasses: 0, hasFreeSeat: false, lessonCount: 0, levelCount: 0 });

    const text = JSON.stringify(res.body);
    for (const hidden of [TEACHER_NAME, `${PREFIX}-A-OPEN`, `${PREFIX}-A-OFFICE`, `${PREFIX}-D`, 'secret', 'نص الدرس السري']) expect(text).not.toContain(hidden);
    for (const key of ['teachers', 'leadTeacher', 'classes', 'schedule', 'mine', 'syllabus', 'content']) expect(keysOf(res.body).has(key), key).toBe(false);

    // Keyset by code: one per page.
    const first = await list('&limit=1').expect(200);
    expect((first.body.items as JsonObject[]).map((item) => item['code'])).toEqual([`${PREFIX}-A`]);
    expect(typeof first.body.nextCursor).toBe('string');
    const next = await list(`&limit=1&cursor=${encodeURIComponent(first.body.nextCursor as string)}`).expect(200);
    expect((next.body.items as JsonObject[]).map((item) => item['code'])).toEqual([`${PREFIX}-B`]);
    expect(next.body.nextCursor).toBeNull();
    // Validation: limit 1..48, a malformed cursor.
    for (const query of ['&limit=0', '&limit=49', '&limit=x']) await list(query).expect(400);
    expect((await list('&cursor=not-a-cursor').expect(400)).body.code).toBe('cursor_invalid');
  });

  it('AC3 — the detail adds the description, the ages and the outline of published lessons: titles, kinds and durations only — no ids, no content', async () => {
    await setPublicBrowsing(true);
    const res = await anonymous(`${LIST}/${ids['a']}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual([...CARD_KEYS, 'description', 'maxAge', 'minAge', 'outline'].sort());
    expect(res.body).toMatchObject({ id: ids['a'], description: { ar: 'وصف الدورة' }, minAge: 10, maxAge: 16, lessonCount: 4, levelCount: 3, price: { amount: 750, currency } });
    expect(res.body.outline).toEqual([
      {
        number: 1,
        title: { ar: 'الأساسيات', en: 'Basics' },
        lessons: [
          { title: { ar: 'مقدمة' }, kind: 'text', durationSeconds: 600 },
          { title: { ar: 'فيديو' }, kind: 'video', durationSeconds: 600 },
        ],
      },
      { number: 2, title: null, lessons: [{ title: { ar: 'ملف PDF' }, kind: 'pdf', durationSeconds: 900 }] },
      { number: 3, title: null, lessons: [{ title: { ar: 'صوت' }, kind: 'audio', durationSeconds: 120 }] },
    ]);
    const text = JSON.stringify(res.body);
    for (const hidden of [TEACHER_NAME, `${PREFIX}-A-OPEN`, 'درس غير منشور', 'مخفي أيضًا', 'مستوى فارغ', 'secret', 'نص الدرس السري', ids['l1']!, ids['l5']!]) {
      expect(text).not.toContain(hidden);
    }
    for (const outlineLevel of res.body.outline as JsonObject[]) {
      expect(Object.keys(outlineLevel).sort()).toEqual(['lessons', 'number', 'title']);
      for (const lesson of outlineLevel['lessons'] as JsonObject[]) expect(Object.keys(lesson).sort()).toEqual(['durationSeconds', 'kind', 'title']);
    }

    const free = await anonymous(`${LIST}/${ids['b']}`).expect(200);
    expect(free.body).toMatchObject({ pricing: 'free', price: null, outline: [], description: null, minAge: null, maxAge: null });

    // A draft and an unknown course are 404 course_not_found; a malformed id 400.
    for (const id of [ids['d']!, '0192f0b0-0000-7000-8000-0000000000ee']) {
      const missing = await anonymous(`${LIST}/${id}`);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('course_not_found');
    }
    await anonymous(`${LIST}/not-a-uuid`).expect(400);
  });

  it('AC4 — records no audit event', async () => {
    await setPublicBrowsing(true);
    await list().expect(200);
    await anonymous(`${LIST}/${ids['a']}`).expect(200);
    expect(await prisma.auditLog.count({ where: { id: { gt: markId }, userAgent: USER_AGENT } })).toBe(0);
  });

  it(
    'AC5 — the OpenAPI document shows both routes without a security scheme',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      for (const path of ['/api/public/catalog/courses', '/api/public/catalog/courses/{id}']) {
        const route = docs.body.paths[path];
        expect(Object.keys(route), path).toEqual(['get']);
        expect(route.get.security ?? [], path).toEqual([]);
        for (const status of ['200', '404', '429']) expect(route.get.responses, `${path} ${status}`).toHaveProperty(status);
      }
      expect(Object.keys(docs.body.components.schemas['PublicCatalogCourseDto'].properties).sort()).toEqual(CARD_KEYS);
      expect(docs.body.components.schemas['AcademyPublicDto'].properties).toHaveProperty('catalogPublic');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );

  it('AC7 — leaks nothing sensitive: no lesson resource, live note or media URL (also in a level not open yet), no enrolled student, no fee plan, no archived or draft course', async () => {
    await setPublicBrowsing(true);
    const STUDENT_NAME = `Hidden Student ${RUN}`;
    const STUDENT_EMAIL = `pc-student-${RUN.toLowerCase()}@example.test`;
    const SECRET_URL = 'https://cdn.example.org/r/secret-resource.zip';
    const SECRET_NOTE = 'رابط الاجتماع السري';
    let studentId: string | undefined;
    try {
      // An active learner in the open class of course A: their identity must never reach a visitor.
      studentId = (await prisma.user.create({ data: { email: STUDENT_EMAIL, fullName: STUDENT_NAME, status: 'active' }, select: { id: true } })).id;
      const openClass = await prisma.class.findFirstOrThrow({ where: { code: `${PREFIX}-A-OPEN` }, select: { id: true } });
      await prisma.enrollment.create({ data: { classId: openClass.id, studentUserId: studentId, status: 'active', activatedAt: new Date() }, select: { id: true } });

      // Course C — published, with a level released 30 days after a class starts, holding lessons with resources, a live note and an image URL.
      const c = await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة بمستوى مقفل' }, status: 'published' }, select: { id: true } });
      const locked = await prisma.courseSection.create({ data: { courseId: c.id, sortOrder: 0, title: { ar: 'مستوى لاحق' }, releaseAfterDays: 30 }, select: { id: true } });
      const lesson = (sortOrder: number, data: Omit<Prisma.CourseSyllabusItemUncheckedCreateInput, 'courseId' | 'sortOrder'>) =>
        prisma.courseSyllabusItem.create({ data: { courseId: c.id, sortOrder, sectionId: locked.id, ...data }, select: { id: true } });
      const withResources = await lesson(0, {
        title: { ar: 'درس بمرفقات' },
        kind: 'text',
        content: { body: { ar: 'نص الدرس السري' } },
        resources: [{ title: { ar: 'ملف إضافي' }, url: SECRET_URL }],
      });
      await lesson(1, { title: { ar: 'حصة مباشرة' }, kind: 'live', content: { note: { ar: SECRET_NOTE } } });
      await lesson(2, { title: { ar: 'صورة' }, kind: 'image', content: { url: 'https://cdn.example.org/i/secret.png' } });

      // Course E — archived: never listed, never readable.
      const e = await prisma.course.create({ data: { code: `${PREFIX}-E`, name: { ar: 'مؤرشفة' }, status: 'archived' }, select: { id: true } });

      const listed = await list().expect(200);
      expect((listed.body.items as JsonObject[]).map((item) => item['code'])).toEqual([`${PREFIX}-A`, `${PREFIX}-B`, `${PREFIX}-C`]);
      const detailA = await anonymous(`${LIST}/${ids['a']}`).expect(200);
      const detailC = await anonymous(`${LIST}/${c.id}`).expect(200);
      // The locked level's lessons are listed by title (the outline is a syllabus), never with what they hold.
      expect(detailC.body.outline).toEqual([
        {
          number: 1,
          title: { ar: 'مستوى لاحق' },
          lessons: [
            { title: { ar: 'درس بمرفقات' }, kind: 'text', durationSeconds: null },
            { title: { ar: 'حصة مباشرة' }, kind: 'live', durationSeconds: null },
            { title: { ar: 'صورة' }, kind: 'image', durationSeconds: null },
          ],
        },
      ]);

      const text = JSON.stringify([listed.body, detailA.body, detailC.body]);
      const hidden = [STUDENT_NAME, STUDENT_EMAIL, studentId, `${PREFIX} رسوم`, ids['plan']!, SECRET_URL, SECRET_NOTE, 'secret', 'نص الدرس السري', 'ملف إضافي', withResources.id, `${PREFIX}-E`, 'مؤرشفة'];
      for (const value of hidden) expect(text, value).not.toContain(value);
      const keys = keysOf([listed.body, detailA.body, detailC.body]);
      for (const key of ['resources', 'content', 'url', 'note', 'enrollments', 'students', 'enrolledCount', 'capacity', 'feePlan', 'enrollmentFeePlan', 'isPublished', 'releaseAfterDays', 'opensOn']) {
        expect(keys.has(key), key).toBe(false);
      }

      // Neither the archived course nor the draft answers, by its id or by a search for it.
      for (const id of [e.id, ids['d']!]) expect((await anonymous(`${LIST}/${id}`).expect(404)).body.code).toBe('course_not_found');
      for (const q of [`${PREFIX}-E`, `${PREFIX}-D`, 'مؤرشفة']) {
        const found = await anonymous(`${LIST}?q=${encodeURIComponent(q)}`).expect(200);
        expect((found.body.items as JsonObject[]).map((item) => item['code'])).not.toEqual(expect.arrayContaining([`${PREFIX}-E`, `${PREFIX}-D`]));
      }
    } finally {
      if (studentId) {
        await prisma.enrollment.deleteMany({ where: { studentUserId: studentId } });
        await prisma.user.deleteMany({ where: { id: studentId } });
      }
    }
  });

  // Last: from here on this app instance answers 429 on the list for a minute.
  it('AC6 — is rate limited per IP: at most 60 requests a minute, then 429 rate_limited', async () => {
    await setPublicBrowsing(true);
    let limited: request.Response | undefined;
    let answered = 0;
    for (let i = 0; i < LIMIT + 10 && !limited; i += 1) {
      const res = await list();
      if (res.status === 429) limited = res;
      else answered += 1;
    }
    expect(limited?.body).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    expect(answered).toBeLessThanOrEqual(LIMIT);
  });
});
