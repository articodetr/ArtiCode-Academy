// KI-050 (TEST-064): JSON body limits per route. A minimal Nest app with the
// real configureApp() and two probe routes — PUT /courses/:id/syllabus with
// the real ReplaceSyllabusDto behind the global ValidationPipe, and a plain
// PUT/POST elsewhere. No database.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Post, Put } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { validateEnv } from '../src/config/env.schema.js';
import { ReplaceSyllabusDto, SYLLABUS_ITEMS_MAX, SYLLABUS_MINUTES_MAX } from '../src/courses/syllabus.dto.js';
import { ATTENDANCE_BATCH_MAX, ATTENDANCE_NOTE_MAX_LENGTH, MINUTES_LATE_MAX, RecordAttendanceDto } from '../src/lessons/attendance.dto.js';
import { LOCALIZED_TEXT_MAX_LENGTH } from '../src/roles/roles.dto.js';

@Controller('courses/:id/syllabus')
class SyllabusProbeController {
  @Put()
  replace(@Body() body: ReplaceSyllabusDto): { items: number } {
    return { items: body.items.length };
  }
}

// MOD-06-T03 (API-100): PUT /lessons/:id/attendance with the real RecordAttendanceDto.
@Controller('lessons/:id/attendance')
class AttendanceProbeController {
  @Put()
  record(@Body() body: RecordAttendanceDto): { records: number } {
    return { records: body.records.length };
  }
}

@Controller('probe')
class ProbeController {
  @Put()
  put(@Body() body: Record<string, unknown>): { keys: number } {
    return { keys: Object.keys(body).length };
  }

  @Post()
  post(@Body() body: Record<string, unknown>): { keys: number } {
    return { keys: Object.keys(body).length };
  }
}

const KB = 1024;
const SYLLABUS_PATH = `/api/courses/${randomUUID()}/syllabus`;
const ATTENDANCE_PATH = `/api/lessons/${randomUUID()}/attendance`;

/** The largest attendance batch the DTO accepts: 500 late students with the longest note in three-byte letters. */
function largestAttendance(): { records: unknown[] } {
  return {
    records: Array.from({ length: ATTENDANCE_BATCH_MAX }, () => ({
      studentId: randomUUID(),
      status: 'late',
      minutesLate: MINUTES_LATE_MAX,
      note: '漢'.repeat(ATTENDANCE_NOTE_MAX_LENGTH),
    })),
  };
}

/** The largest syllabus the DTO accepts with Arabic, English and Turkish text (two-byte letters for ar and tr). */
function largestSyllabus(): { items: unknown[] } {
  const text = (letter: string) => letter.repeat(LOCALIZED_TEXT_MAX_LENGTH);
  const localized = () => ({ ar: text('ش'), en: text('a'), tr: text('ş') });
  return {
    items: Array.from({ length: SYLLABUS_ITEMS_MAX }, () => ({
      id: randomUUID(),
      title: localized(),
      description: localized(),
      estimatedMinutes: SYLLABUS_MINUTES_MAX,
    })),
  };
}

describe('JSON body limits (KI-050, TEST-064)', () => {
  let app: NestExpressApplication;
  const body = largestSyllabus();
  const bytes = Buffer.byteLength(JSON.stringify(body));
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
      controllers: [SyllabusProbeController, AttendanceProbeController, ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the largest valid syllabus is above 100 KB and below 512 KB', () => {
    expect(bytes).toBeGreaterThan(100 * KB);
    expect(bytes).toBeLessThan(512 * KB);
  });

  it('PUT /courses/:id/syllabus reads it and validates it (the query string is ignored)', async () => {
    const res = await api().put(`${SYLLABUS_PATH}?from=test`).send(body).expect(200);
    expect(res.body).toEqual({ items: SYLLABUS_ITEMS_MAX });
  });

  it('every other route keeps 100 KB: the same body is 413 there', async () => {
    await api().put('/api/probe').send(body).expect(413);
    await api().put('/api/probe').send({ small: true }).expect(200, { keys: 1 });
  });

  it('only the listed method gets the larger limit: a POST of that body to the syllabus path is 413', async () => {
    await api().post(SYLLABUS_PATH).send(body).expect(413);
  });

  it('the larger limit has a ceiling: a syllabus body above 512 KB is 413', async () => {
    await api().put(SYLLABUS_PATH).send({ items: [], pad: 'x'.repeat(530 * KB) }).expect(413);
  });

  it('MOD-06-T03: the largest valid attendance batch is above 100 KB and below 1 MB, PUT /lessons/:id/attendance reads and validates it, every other route and method keeps its limit', async () => {
    const attendance = largestAttendance();
    const attendanceBytes = Buffer.byteLength(JSON.stringify(attendance));
    expect(attendanceBytes).toBeGreaterThan(512 * KB);
    expect(attendanceBytes).toBeLessThan(1024 * KB);
    const res = await api().put(ATTENDANCE_PATH).send(attendance).expect(200);
    expect(res.body).toEqual({ records: ATTENDANCE_BATCH_MAX });
    await api().post(ATTENDANCE_PATH).send(attendance).expect(413);
    await api().put('/api/probe').send(attendance).expect(413);
    await api().put(SYLLABUS_PATH).send(attendance).expect(413); // above the syllabus route's 512 KB
    await api().put(ATTENDANCE_PATH).send({ records: [], pad: 'x'.repeat(1030 * KB) }).expect(413);
  });

  it('bodies stay JSON only (ADR-026): a valid syllabus sent as text/plain is not read', async () => {
    // A small body on purpose (KI-070): no parser reads text/plain, so a large one stays unread on the
    // socket and Windows may reset the connection (ECONNRESET) before the client reads the 400.
    const res = await api()
      .put(SYLLABUS_PATH)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ items: [{ title: { ar: 'مقدمة' } }] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('items');
  });
});
