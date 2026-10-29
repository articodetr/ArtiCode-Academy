import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from './../src/app.setup.js';
import { PACKAGE_VERSION, SERVICE_NAME } from './../src/common/package-info.js';
import { NODE_ENVS } from './../src/config/env.schema.js';

// Matches the CORS_ORIGIN default in src/config/env.schema.ts.
const ALLOWED_ORIGIN = 'http://localhost:5173';

describe('API (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns the service report as JSON', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(res.body).toMatchObject({
      status: 'ok',
      service: SERVICE_NAME,
      version: PACKAGE_VERSION,
    });
    expect(NODE_ENVS).toContain(res.body.environment);
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('does not expose the X-Powered-By header', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a JSON 404 for unknown routes under the prefix', async () => {
    for (const path of ['/api', '/api/nope', '/api/docs/nope']) {
      const res = await request(app.getHttpServer())
        .get(path)
        .expect(404)
        .expect('Content-Type', /application\/json/);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: `Cannot GET ${path}`,
      });
    }
  });

  it('no longer serves the scaffold root; paths outside the prefix get the Express 404', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(404)
      .expect('Content-Type', /text\/html/);
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://evil.test')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /api/health/ready reports the database check and maps it to 200/503', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready');

    expect([200, 503]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);

    const database = res.body.checks.database;
    if (res.status === 200) {
      expect(res.body.status).toBe('ready');
      expect(database.status).toBe('up');
      expect(typeof database.latencyMs).toBe('number');
    } else {
      expect(res.body.status).toBe('not_ready');
      expect(['down', 'not_configured']).toContain(database.status);
    }
  });

  it('reads request bodies from application/json only (form posts cannot sign anyone in — ADR-026)', async () => {
    // What a cross-site <form> can send without a CORS preflight: urlencoded, multipart, text/plain.
    // Without a parsable body the DTO validation fails (400) before any credential is checked.
    const form = await request(app.getHttpServer())
      .post('/api/auth/login')
      .type('form')
      .send({ identifier: 'csrf-probe@example.test', password: 'probe-only' })
      .expect(400);
    expect(form.body.statusCode).toBe(400);
    expect(form.body.message).toEqual(expect.arrayContaining([expect.stringContaining('identifier')]));

    const text = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('{"identifier":"csrf-probe@example.test","password":"probe-only"}')
      .expect(400);
    expect(text.body.statusCode).toBe(400);

    // JSON is still parsed: the same payload reaches validation and passes it (401 = credentials checked).
    const json = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'csrf-probe@example.test', password: 'probe-only' });
    expect([401, 503]).toContain(json.status);
  });

  it('serves the OpenAPI document under the prefix', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toHaveProperty('/api/health');
    expect(res.body.paths).toHaveProperty('/api/health/ready');
  });
});
