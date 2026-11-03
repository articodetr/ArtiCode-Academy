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
import { LOCALIZED_TEXT_MAX_LENGTH } from '../src/roles/roles.dto.js';

@Controller('courses/:id/syllabus')
class SyllabusProbeController {
  @Put()
  replace(@Body() body: ReplaceSyllabusDto): { items: number } {
    return { items: body.items.length };
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
      controllers: [SyllabusProbeController, ProbeController],
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

  it('bodies stay JSON only (ADR-026): the same text sent as text/plain is not read', async () => {
    const res = await api().put(SYLLABUS_PATH).set('Content-Type', 'text/plain').send(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('items');
  });
});
