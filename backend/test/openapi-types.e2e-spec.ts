// TEST-218 (e2e) — KI-051: every schema of the OpenAPI documents of BOTH
// applications (the academy API and the platform API, each at /api/docs-json
// as configureApp() mounts it) carries a real type.
//
// The bug: a property typed `T | null` (or `LocalizedText`, an intersection
// type) whose decorator names no `type` gets `design:type` = Object from
// emitDecoratorMetadata under `strict`, and @nestjs/swagger printed it as
// `type: object` — next to `minimum`/`maxLength` for a number or a string.
// Validation and responses were right; only a client generating its types from
// the document was misled. The rules, for every schema node (component schemas,
// their properties at any depth, array items, parameters, request and response
// bodies):
//   1. `type: object` never carries a scalar keyword (minimum, maximum,
//      exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern,
//      format, enum);
//   2. `type: object` always says what it holds — `properties`,
//      `additionalProperties`, `$ref`, `allOf`, `oneOf` or `anyOf` — unless it
//      is on FREE_FORM_ALLOWED below.
// No database is needed: both documents are built at boot.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { createPlatformTestApp } from './platform/helpers.js';

type AppName = 'academy' | 'platform';
type SchemaNode = Record<string, unknown>;
interface OpenApiDocument {
  paths: Record<string, Record<string, SchemaNode>>;
  components?: { schemas?: Record<string, SchemaNode> };
}

/**
 * True free-form objects that may stay a bare `type: object`, as
 * `<app>:<Schema>.<property>`. It is EMPTY on purpose: the free-form jsonb
 * values of the API (`AuditLogItemDto.metadata`, `MyNotificationDto.data`)
 * declare `additionalProperties: true`, and every localized text, settings
 * object or snapshot names its DTO. An entry belongs here only for a schema we
 * cannot decorate (a library's DTO), with the reason on its line.
 */
const FREE_FORM_ALLOWED: ReadonlySet<string> = new Set<string>([]);

/** Keywords that only make sense for a number, a string or an enum. */
const SCALAR_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'enum',
] as const;

/** Keywords that tell what an object holds. */
const STRUCTURE_KEYWORDS = ['properties', 'additionalProperties', '$ref', 'allOf', 'oneOf', 'anyOf'] as const;

function isNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every offence of one schema node and of the schemas nested in it. */
function checkSchema(app: AppName, label: string, node: unknown, offences: string[]): void {
  if (!isNode(node)) return;
  if (node['type'] === 'object') {
    const scalar = SCALAR_KEYWORDS.filter((key) => key in node);
    if (scalar.length > 0) offences.push(`${app}: ${label} — type object with ${scalar.join(', ')}`);
    const structured = STRUCTURE_KEYWORDS.some((key) => key in node);
    if (!structured && !FREE_FORM_ALLOWED.has(`${app}:${label}`)) {
      offences.push(`${app}: ${label} — type object without properties, additionalProperties or $ref`);
    }
  }
  const properties = node['properties'];
  if (isNode(properties)) {
    for (const [name, child] of Object.entries(properties)) checkSchema(app, `${label}.${name}`, child, offences);
  }
  checkSchema(app, `${label}[]`, node['items'], offences);
  if (isNode(node['additionalProperties'])) checkSchema(app, `${label}{}`, node['additionalProperties'], offences);
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((child, index) => checkSchema(app, `${label}.${key}[${index}]`, child, offences));
  }
}

/** The schemas of one body (`content` → media type → schema). */
function checkContent(app: AppName, label: string, holder: unknown, offences: string[]): void {
  if (!isNode(holder) || !isNode(holder['content'])) return;
  for (const [media, entry] of Object.entries(holder['content'])) {
    if (isNode(entry)) checkSchema(app, `${label} ${media}`, entry['schema'], offences);
  }
}

function offencesOf(app: AppName, doc: OpenApiDocument): string[] {
  const offences: string[] = [];
  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) checkSchema(app, name, schema, offences);
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!isNode(operation)) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const parameters = operation['parameters'];
      if (Array.isArray(parameters)) {
        for (const parameter of parameters) {
          if (isNode(parameter)) checkSchema(app, `${where} ${String(parameter['in'])} ${String(parameter['name'])}`, parameter['schema'], offences);
        }
      }
      checkContent(app, `${where} body`, operation['requestBody'], offences);
      if (isNode(operation['responses'])) {
        for (const [status, response] of Object.entries(operation['responses'])) checkContent(app, `${where} ${status}`, response, offences);
      }
    }
  }
  return offences;
}

function property(doc: OpenApiDocument, schema: string, name: string): SchemaNode {
  const found = doc.components?.schemas?.[schema]?.['properties'];
  if (!isNode(found) || !isNode(found[name])) throw new Error(`${schema}.${name} is not in the document`);
  return found[name];
}

async function documentOf(app: NestExpressApplication): Promise<OpenApiDocument> {
  const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  return res.body as OpenApiDocument;
}

describe('OpenAPI property types — KI-051 (e2e, TEST-218)', () => {
  let academyApp: NestExpressApplication;
  let platformApp: NestExpressApplication;
  let academy: OpenApiDocument;
  let platform: OpenApiDocument;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    academyApp = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(academyApp);
    await academyApp.init();
    platformApp = await createPlatformTestApp();
    academy = await documentOf(academyApp);
    platform = await documentOf(platformApp);
  });

  afterAll(async () => {
    await academyApp?.close();
    await platformApp?.close();
  });

  it('reads two full documents (the checks below are not vacuous)', () => {
    expect(Object.keys(academy.components?.schemas ?? {}).length).toBeGreaterThan(250);
    expect(Object.keys(academy.paths).length).toBeGreaterThan(100);
    expect(Object.keys(platform.components?.schemas ?? {}).length).toBeGreaterThan(30);
    expect(platform.paths).toHaveProperty('/api/academies');
  });

  for (const app of ['academy', 'platform'] as const) {
    it(`${app}: no \`type: object\` carries a number or string keyword, and none is a bare object`, () => {
      const offences = offencesOf(app, app === 'academy' ? academy : platform);
      expect(offences, `KI-051 — give these properties an explicit Swagger type:\n${offences.join('\n')}`).toEqual([]);
    });
  }

  it('the KI-051 examples carry their real type', () => {
    expect(property(academy, 'SyllabusItemInputDto', 'estimatedMinutes')).toMatchObject({ type: 'integer', nullable: true, minimum: 1 });
    expect(property(academy, 'SyllabusItemDto', 'estimatedMinutes')).toMatchObject({ type: 'integer', nullable: true });
    expect(property(academy, 'LocalizedTextDto', 'en')).toMatchObject({ type: 'string', maxLength: 200 });
    expect(property(academy, 'CourseDto', 'durationHours')).toMatchObject({ type: 'number', nullable: true });
    expect(property(academy, 'UpdateCourseDto', 'minAge')).toMatchObject({ type: 'integer', nullable: true, minimum: 0 });
    expect(property(academy, 'UserDetailDto', 'email')).toMatchObject({ type: 'string', nullable: true });
    expect(property(academy, 'UserDetailDto', 'lockedUntil')).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(property(academy, 'ClassDto', 'startsOn')).toMatchObject({ type: 'string', nullable: true });
    expect(property(academy, 'UpdateBranchDto', 'timezone')).toMatchObject({ type: 'string', nullable: true });
    expect(property(academy, 'CourseDto', 'description')).toMatchObject({ nullable: true, allOf: [{ $ref: '#/components/schemas/LocalizedTextDto' }] });
    expect(property(academy, 'AuditLogItemDto', 'metadata')).toMatchObject({ type: 'object', additionalProperties: true });
    expect(property(platform, 'PlatformLocalizedTextDto', 'en')).toMatchObject({ type: 'string', nullable: true, maxLength: 200 });
    expect(property(platform, 'AcademyItemDto', 'name')).toMatchObject({ allOf: [{ $ref: '#/components/schemas/PlatformLocalizedTextDto' }] });
    expect(property(platform, 'SubscriptionDto', 'endsAt')).toMatchObject({ type: 'string', format: 'date-time', nullable: true });
  });
});
