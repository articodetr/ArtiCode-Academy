// KI-078 (TEST-216): no NUL character (U+0000) reaches the application.
// PostgreSQL stores none — a text parameter that holds one fails with SQLSTATE
// 22021 and a jsonb value with 22P05 — so such a request used to end in a 500.
// configureApp() now answers 400 `nul_character { location: body | query }`
// for a NUL in any string value or key of a JSON body (any depth, every JSON
// parser — LARGE_JSON_ROUTES included) or of the query string, before any
// guard, pipe or controller runs, in the academy API and in the platform API.
//
//   1. A minimal academy app (the real configureApp(), probe routes behind a
//      probe global guard that wants `Authorization: Bearer probe`). No database.
//   2. The platform app (PlatformAppModule boots without its database).
//   3. With the development database: the real AppModule — former 500s
//      (`GET /api/users?q=%00`, `GET /api/courses?q=…%00…`, a NUL in
//      `fullName` on PATCH /api/users/:id, in a level's jsonb name, in a login
//      identifier) are 400 and nothing is written. Skipped without a database;
//      fixture users and the role are deleted at the end.
//   4. With the platform database: a NUL in a platform login identifier.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Injectable, Patch, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import type { Request } from 'express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { NUL_CHARACTER_CODE } from '../src/common/nul-character.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { validateEnv } from '../src/config/env.schema.js';
import { ReplaceSyllabusDto, SYLLABUS_ITEMS_MAX } from '../src/courses/syllabus.dto.js';
import { RESULT_FEEDBACK_MAX_LENGTH, RESULTS_BATCH_MAX, RecordExamResultsDto } from '../src/exams/exam-results.dto.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ATTENDANCE_BATCH_MAX, ATTENDANCE_NOTE_MAX_LENGTH, RecordAttendanceDto } from '../src/lessons/attendance.dto.js';
import { LOCALIZED_TEXT_MAX_LENGTH } from '../src/roles/roles.dto.js';
import { PLATFORM_TEST_ORIGIN, createPlatformTestApp, platformDbReachable } from './platform/helpers.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const NUL = '\u0000';
const KB = 1024;

/** How many times a probe controller ran: a refused request must never reach one. */
let controllerCalls = 0;

@Controller('probe')
class ProbeController {
  @Get()
  get(@Query() query: Record<string, unknown>): { query: Record<string, unknown> } {
    controllerCalls += 1;
    return { query };
  }

  @Post()
  post(@Body() body: unknown): { body: unknown } {
    controllerCalls += 1;
    return { body };
  }

  @Put()
  put(@Body() body: unknown): { body: unknown } {
    controllerCalls += 1;
    return { body };
  }

  @Patch()
  patch(@Body() body: unknown): { body: unknown } {
    controllerCalls += 1;
    return { body };
  }

  @Delete()
  remove(@Body() body: unknown): { body: unknown } {
    controllerCalls += 1;
    return { body };
  }

  /** Answers without echoing: a very deep body would not serialize back. */
  @Post('deep')
  deep(@Body() body: unknown): { array: boolean } {
    controllerCalls += 1;
    return { array: Array.isArray(body) };
  }
}

// The three LARGE_JSON_ROUTES with their real DTOs behind the global ValidationPipe (as in TEST-064).
@Controller('courses/:id/syllabus')
class SyllabusProbeController {
  @Put()
  replace(@Body() body: ReplaceSyllabusDto): { items: number } {
    controllerCalls += 1;
    return { items: body.items.length };
  }
}

@Controller('lessons/:id/attendance')
class AttendanceProbeController {
  @Put()
  record(@Body() body: RecordAttendanceDto): { records: number } {
    controllerCalls += 1;
    return { records: body.records.length };
  }
}

@Controller('exams/:id/results')
class ExamResultsProbeController {
  @Put()
  record(@Body() body: RecordExamResultsDto): { results: number } {
    controllerCalls += 1;
    return { results: body.results.length };
  }
}

/** Stands in for the AuthGuard: a global guard that refuses a request without `Bearer probe`. */
@Injectable()
class ProbeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<Request>().headers.authorization === 'Bearer probe') return true;
    throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'unauthenticated', message: 'Authentication required' });
  }
}

const AUTH = { Authorization: 'Bearer probe' };

/** The exact answer to a NUL: the app's error shape, the location, never the value. */
function expectNulRefusal(res: SupertestResponse, location: 'body' | 'query', label = ''): void {
  expect(res.status, label).toBe(400);
  expect(res.body, label).toEqual({
    statusCode: 400,
    error: 'Bad Request',
    code: NUL_CHARACTER_CODE,
    message: expect.any(String),
    location,
  });
  expect(res.text, label).not.toContain('\\u0000');
  expect(res.text, label).not.toContain(NUL);
}

function largestSyllabus(): { items: unknown[] } {
  const text = (letter: string) => letter.repeat(LOCALIZED_TEXT_MAX_LENGTH);
  const localized = () => ({ ar: text('ش'), en: text('a'), tr: text('ş') });
  return {
    items: Array.from({ length: SYLLABUS_ITEMS_MAX }, () => ({ id: randomUUID(), title: localized(), description: localized(), estimatedMinutes: 60 })),
  };
}

function largestAttendance(): { records: { studentId: string; status: string; minutesLate: number; note: string }[] } {
  return {
    records: Array.from({ length: ATTENDANCE_BATCH_MAX }, () => ({
      studentId: randomUUID(),
      status: 'late',
      minutesLate: 5,
      note: '漢'.repeat(ATTENDANCE_NOTE_MAX_LENGTH),
    })),
  };
}

function largestResults(): { results: { studentId: string; status: string; score: number; feedback: string }[] } {
  return {
    results: Array.from({ length: RESULTS_BATCH_MAX }, () => ({
      studentId: randomUUID(),
      status: 'scored',
      score: 10,
      feedback: '漢'.repeat(RESULT_FEEDBACK_MAX_LENGTH),
    })),
  };
}

describe('NUL characters — academy configureApp(), no database (KI-078, TEST-216)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // Only these values: the developer's .env must not change what is tested.
          validate: () => validateEnv({ SWAGGER_ENABLED: 'false' }),
        }),
      ],
      controllers: [ProbeController, SyllabusProbeController, AttendanceProbeController, ExamResultsProbeController],
      providers: [{ provide: APP_GUARD, useClass: ProbeAuthGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a NUL in a nested body string is 400 nul_character { location: body } on every method — before the guard (no token: 400, not 401) and the controller', async () => {
    const calls = controllerCalls;
    const body = { a: { b: [1, true, null, 'fine', { c: `x${NUL}y` }] } };
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expectNulRefusal(await api()[method]('/api/probe').send(body), 'body', `${method} without a token`);
      expectNulRefusal(await api()[method]('/api/probe').set(AUTH).send(body), 'body', `${method} with a token`);
    }
    // A NUL at the very start, the very end, alone, and in a top-level array.
    for (const value of [`${NUL}start`, `end${NUL}`, NUL]) {
      expectNulRefusal(await api().post('/api/probe').set(AUTH).send({ value }), 'body', JSON.stringify(value));
    }
    expectNulRefusal(await api().post('/api/probe').set(AUTH).send(['fine', `n${NUL}`]), 'body', 'top-level array');
    expect(controllerCalls).toBe(calls);
    // The guard is really there: the same route without a NUL and without a token is 401.
    const unauthenticated = await api().post('/api/probe').send({ a: 'fine' }).expect(401);
    expect(unauthenticated.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('a NUL in a body key — top level or nested — is 400 { location: body }', async () => {
    const calls = controllerCalls;
    expectNulRefusal(await api().post('/api/probe').set(AUTH).send({ [`na${NUL}me`]: 'x' }), 'body', 'top-level key');
    expectNulRefusal(await api().post('/api/probe').set(AUTH).send({ a: [{ ok: 1 }, { [`k${NUL}`]: 1 }] }), 'body', 'nested key');
    expectNulRefusal(await api().post('/api/probe').send({ [NUL]: null }), 'body', 'a key that is only a NUL, without a token');
    expect(controllerCalls).toBe(calls);
  });

  it('a NUL in a query value or key is 400 { location: query } — repeated, bracketed, on a GET and on a write, with or without a token', async () => {
    const calls = controllerCalls;
    for (const query of ['q=%00', 'q=a%00b', 'q=fine&q=%00', 'a%00b=1', '%00=', '%00', 'filter[a%00]=1', 'filter%5Bx%5D=%00']) {
      expectNulRefusal(await api().get(`/api/probe?${query}`), 'query', `GET ?${query} without a token`);
      expectNulRefusal(await api().get(`/api/probe?${query}`).set(AUTH), 'query', `GET ?${query}`);
    }
    expectNulRefusal(await api().post('/api/probe?q=%00').set(AUTH).send({ fine: true }), 'query', 'a write with a clean body');
    // A route that does not exist answers the same: the check runs before routing.
    expectNulRefusal(await api().get('/api/nothing-here?q=%00'), 'query', 'unknown route');
    expect(controllerCalls).toBe(calls);
    // The check runs after CORS: a browser on an allowed origin can read the answer.
    const cors = await api().get('/api/probe?q=%00').set('Origin', 'http://localhost:5173');
    expectNulRefusal(cors, 'query', 'allowed origin');
    expect(cors.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('a normal request still passes, unchanged — other control characters, the escaped text `\\u0000`, a literal `%00` in the query', async () => {
    const body = { text: `tab\tbell\u0001 emoji \u{1F600} عربي`, escaped: '\\u0000', ['\\u0000']: 1, nested: [{ deep: ['ok', 2, false, null] }] };
    const res = await api().post('/api/probe').set(AUTH).send(body).expect(201);
    expect(res.body).toEqual({ body });
    const query = await api().get('/api/probe?q=%2500&x=%01&arr=1&arr=2&empty=').set(AUTH).expect(200);
    expect(query.body).toEqual({ query: { q: '%00', x: '\u0001', arr: ['1', '2'], empty: '' } });
    // Bodies stay JSON only (ADR-026): a text/plain body is never read, so its NUL never reaches the app.
    const text = await api().post('/api/probe').set(AUTH).set('Content-Type', 'text/plain').send(`a${NUL}b`).expect(201);
    expect(text.body).toEqual({});
  });

  it('a deeply nested body is scanned without recursion: a NUL 30,000 arrays deep is 400, the same body without it passes', async () => {
    const depth = 30_000;
    const nested = (leaf: string) => `${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`;
    const deepWith = nested('"\\u0000"');
    expect(Buffer.byteLength(deepWith)).toBeLessThan(100 * KB);
    const calls = controllerCalls;
    expectNulRefusal(await api().post('/api/probe/deep').set(AUTH).set('Content-Type', 'application/json').send(deepWith), 'body');
    expect(controllerCalls).toBe(calls);
    const clean = await api().post('/api/probe/deep').set(AUTH).set('Content-Type', 'application/json').send(nested('"fine"')).expect(201);
    expect(clean.body).toEqual({ array: true });
  });

  it('LARGE_JSON_ROUTES are covered: a NUL in the last item of a large syllabus, attendance or results batch is 400 before validation; the valid batch passes', async () => {
    const syllabus = largestSyllabus();
    expect(Buffer.byteLength(JSON.stringify(syllabus))).toBeGreaterThan(100 * KB);
    const lastItem = syllabus.items[syllabus.items.length - 1] as { description: { en: string } };
    lastItem.description.en = `${lastItem.description.en.slice(1)}${NUL}`;
    const attendance = largestAttendance();
    attendance.records[attendance.records.length - 1]!.note = `late${NUL}`;
    expect(Buffer.byteLength(JSON.stringify(attendance))).toBeGreaterThan(512 * KB);
    const results = largestResults();
    results.results[results.results.length - 1]!.feedback = `good${NUL}`;

    const calls = controllerCalls;
    expectNulRefusal(await api().put(`/api/courses/${randomUUID()}/syllabus`).set(AUTH).send(syllabus), 'body', 'syllabus (512 KB route)');
    expectNulRefusal(await api().put(`/api/lessons/${randomUUID()}/attendance`).send(attendance), 'body', 'attendance (1 MB route), no token');
    expectNulRefusal(await api().put(`/api/exams/${randomUUID()}/results`).set(AUTH).send(results), 'body', 'results (1 MB route)');
    // A NUL in a body key that the DTO would refuse anyway is still the NUL answer, not a validation error.
    expectNulRefusal(await api().put(`/api/exams/${randomUUID()}/results`).set(AUTH).send({ results: [], [`x${NUL}`]: 1 }), 'body', 'unknown key');
    expect(controllerCalls).toBe(calls);

    const valid = largestAttendance();
    await api().put(`/api/lessons/${randomUUID()}/attendance`).set(AUTH).send(valid).expect(200, { records: ATTENDANCE_BATCH_MAX });
  });
});

describe('NUL characters — the platform app, no database (KI-078, TEST-216)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createPlatformTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 400 nul_character before OriginGuard, the auth guard and the throttler: a body, a query value, a query key', async () => {
    // A public, throttled route: never counted, never read.
    expectNulRefusal(
      await api().post('/api/auth/login').send({ identifier: `ops${NUL}@example.test`, password: 'correct horse battery staple' }),
      'body',
      'login',
    );
    // A foreign Origin would be 403 origin_forbidden (OriginGuard): the NUL check comes first.
    expectNulRefusal(await api().post('/api/auth/login').set('Origin', 'https://evil.example').send({ [`k${NUL}`]: 1 }), 'body', 'foreign origin');
    // A protected route without a token would be 401.
    expectNulRefusal(await api().get('/api/academies?q=%00'), 'query', 'academies');
    expectNulRefusal(await api().get('/api/health?x%00=1'), 'query', 'public health, query key');
    await api().get('/api/academies?q=fine').expect(401);
    await api().get('/api/health').expect(200);
    // The allowlisted origin of the Super Admin frontend: the same answer.
    expectNulRefusal(await api().get('/api/academies?q=%00').set('Origin', PLATFORM_TEST_ORIGIN), 'query', 'allowed origin');
  });
});

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');

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

const academyDbAvailable = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!academyDbAvailable)('NUL characters — the academy API with the database: former 500s are 400 (KI-078, TEST-216)', () => {
  const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const PASSWORD = 'Correct-Horse-Battery-9';
  const USER_AGENT = 'TEST-216 supertest';
  const NIL_ID = '00000000-0000-0000-0000-000000000000';
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const createdUserIds: string[] = [];
  let roleId: string | undefined;
  const fx: Record<string, string> = {};
  let token = '';

  const email = (name: string) => `nul-${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = () => ({ Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT });

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    const passwords = new PasswordService();

    const role = await prisma.role.create({
      data: {
        key: `test_nul_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار NUL' },
        permissions: { create: ['users.read', 'users.update', 'courses.read', 'courses.manage', 'audit.read'].map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    roleId = role.id;
    for (const [name, roles] of [['actor', [role.id]], ['target', []]] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(name),
          fullName: `Nul ${name} ${RUN}`,
          passwordHash: await passwords.hash(PASSWORD),
          status: 'active',
          roles: { create: roles.map((id) => ({ roleId: id })) },
        },
        select: { id: true },
      });
      createdUserIds.push(user.id);
      fx[name] = user.id;
    }
    const login = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email('actor'), password: PASSWORD }).expect(200);
    token = login.body.accessToken as string;
  });

  afterAll(async () => {
    try {
      await prisma?.level.deleteMany({ where: { code: { startsWith: `N${RUN}` } } });
    } finally {
      if (createdUserIds.length > 0) await prisma?.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (roleId) await prisma?.role.deleteMany({ where: { id: roleId } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('searches, a text field, a jsonb field and a login identifier with a NUL are 400 nul_character — nothing is written and no event recorded', async () => {
    const m = await mark();
    const answers: [string, SupertestResponse, 'body' | 'query'][] = [
      ['GET /api/users?q=%00', await api().get('/api/users?q=%00').set(bearer()), 'query'],
      ['GET /api/courses?q=a%00b', await api().get('/api/courses?q=a%00b').set(bearer()), 'query'],
      ['GET /api/audit-logs?action=%00', await api().get('/api/audit-logs?action=%00').set(bearer()), 'query'],
      ['PATCH /api/users/:id fullName', await api().patch(`/api/users/${fx['target']}`).set(bearer()).send({ fullName: `Te${NUL}st` }), 'body'],
      ['POST /api/levels name.ar (jsonb)', await api().post('/api/levels').set(bearer()).send({ code: `N${RUN}A`.slice(0, 16), name: { ar: `مستوى${NUL}` } }), 'body'],
      ['POST /api/auth/login identifier', await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: `nul${NUL}@example.test`, password: PASSWORD }), 'body'],
    ];
    // The whole table first, so a failure shows every status at once. Before KI-078 each was a 500
    // (SQLSTATE 22021, and 22P05 for the jsonb name) except the audit filter, refused by its own pattern.
    expect(answers.map(([label, res]) => [label, res.status])).toEqual(answers.map(([label]) => [label, 400]));
    for (const [label, res, location] of answers) expectNulRefusal(res, location, label);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: fx['target']! }, select: { fullName: true } });
    expect(target.fullName).toBe(`Nul target ${RUN}`);
    expect(await prisma.level.count({ where: { code: { startsWith: `N${RUN}` } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { id: { gt: m }, actorUserId: { in: createdUserIds } } })).toBe(0);
  });

  it('the check runs before the real guards: without a token a NUL is 400, the same request without it 401; a clean search still finds the fixture', async () => {
    expectNulRefusal(await api().get('/api/users?q=%00'), 'query');
    expectNulRefusal(await api().patch(`/api/users/${fx['target']}`).send({ fullName: `x${NUL}` }), 'body');
    await api().get('/api/users?q=x').expect(401);
    const found = await api().get(`/api/users?q=${encodeURIComponent(`Nul target ${RUN}`)}`).set(bearer()).expect(200);
    expect((found.body.items as { id: string }[]).map((item) => item.id)).toEqual([fx['target']]);
  });
});

const platformDbAvailable = await platformDbReachable();

describe.skipIf(!platformDbAvailable)('NUL characters — the platform API with its database (KI-078, TEST-216)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createPlatformTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a NUL in a platform login identifier is 400 nul_character, a clean unknown identifier the ordinary 401', async () => {
    const api = () => request(app.getHttpServer());
    expectNulRefusal(await api().post('/api/auth/login').send({ identifier: `nobody${NUL}@example.test`, password: 'correct horse battery staple' }), 'body');
    const unknown = await api().post('/api/auth/login').send({ identifier: `nobody-${randomUUID()}@example.test`, password: 'correct horse battery staple' });
    expect(unknown.status).toBe(401);
  });
});
