// MOD-01-H04 (TEST-066): helmet's security headers on every response, Swagger
// UI still working under its Content-Security-Policy, and Swagger off by
// default in production. A minimal Nest app with the real configureApp() and a
// probe route; the configuration comes only from the values below. No database.
import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { validateEnv } from '../src/config/env.schema.js';

@Controller('probe')
class ProbeController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

/** What NODE_ENV=production needs to boot; nothing connects to this database. */
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.invalid:5432/app',
  JWT_SECRET: 'security-headers-test-secret-'.repeat(2),
};

function expectSecurityHeaders(res: SupertestResponse): void {
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
  expect(res.headers['x-xss-protection']).toBe('0');
  expect(res.headers['x-powered-by']).toBeUndefined();
  const csp = String(res.headers['content-security-policy']);
  for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'"]) {
    expect(csp).toContain(directive);
  }
}

describe('security headers and Swagger exposure (MOD-01-H04, TEST-066)', () => {
  let app: NestExpressApplication | undefined;

  async function appWith(input: Record<string, string>): Promise<NestExpressApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => validateEnv(input) })],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    return app;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('every response carries the headers — a JSON route and a 404 — and development keeps plain http', async () => {
    const server = (await appWith({})).getHttpServer();
    const ok = await request(server).get('/api/probe').expect(200, { ok: true });
    expectSecurityHeaders(ok);
    expect(String(ok.headers['content-security-policy'])).not.toContain('upgrade-insecure-requests');
    expectSecurityHeaders(await request(server).get('/api/nothing-here').expect(404));
  });

  it('Swagger UI works under the policy: its page loads only script files from the API itself', async () => {
    const server = (await appWith({})).getHttpServer();
    const page = await request(server).get('/api/docs').redirects(1).expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expectSecurityHeaders(page);
    const scripts = [...page.text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      // An inline script would be blocked by script-src 'self'; each one must be a file.
      expect(attributes).toMatch(/\bsrc=/);
      expect(body!.trim()).toBe('');
    }
    await request(server).get('/api/docs/swagger-ui-init.js').expect(200).expect('content-type', /javascript/);
    await request(server).get('/api/docs-json').expect(200);
  });

  it('production: Swagger is off by default, an explicit true turns it on, and the policy upgrades insecure requests', async () => {
    let server = (await appWith(PRODUCTION)).getHttpServer();
    const hidden = await request(server).get('/api/docs-json').expect(404);
    expectSecurityHeaders(hidden);
    expect(String(hidden.headers['content-security-policy'])).toContain('upgrade-insecure-requests');
    await request(server).get('/api/docs').redirects(1).expect(404);
    await app!.close();

    server = (await appWith({ ...PRODUCTION, SWAGGER_ENABLED: 'true' })).getHttpServer();
    await request(server).get('/api/docs-json').expect(200);
  });
});
