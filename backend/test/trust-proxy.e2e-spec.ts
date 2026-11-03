// MOD-01-H01 (TEST-063): TRUST_PROXY decides whether X-Forwarded-For and
// X-Forwarded-Proto describe the client. A minimal Nest app with the real
// configureApp() and a probe route that answers what the server sees:
// requestContext(req).ip (audit log, refresh tokens) and req.protocol
// (OriginGuard). The rate-limit tracker reads the same req.ip. No database.
import { Controller, Get, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { requestContext } from '../src/auth/cookies.js';
import { validateEnv } from '../src/config/env.schema.js';

@Controller('probe')
class ProbeController {
  @Get()
  probe(@Req() req: Request): { ip: string | null; protocol: string } {
    return { ip: requestContext(req).ip, protocol: req.protocol };
  }
}

/** The client's own address, a spoofed entry it added in front, and an HTTPS proxy. */
const FORWARDED = { 'X-Forwarded-For': '198.51.100.23, 203.0.113.7', 'X-Forwarded-Proto': 'https' };
const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

describe('TRUST_PROXY (MOD-01-H01, TEST-063)', () => {
  let app: NestExpressApplication | undefined;

  async function probeWith(trustProxy: string | undefined): Promise<{ ip: string | null; protocol: string }> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // Only these values: the developer's .env must not change what is tested.
          validate: () => validateEnv({ SWAGGER_ENABLED: 'false', ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }) }),
        }),
      ],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    const res = await request(app.getHttpServer()).get('/api/probe').set(FORWARDED).expect(200);
    return res.body as { ip: string | null; protocol: string };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('is off by default: the forwarded headers are ignored (a directly exposed API cannot be fooled)', async () => {
    const seen = await probeWith(undefined);
    expect(seen.ip).toMatch(LOOPBACK);
    expect(seen.protocol).toBe('http');
  });

  it('1 proxy: the client is the address that proxy saw, not the entry the client added; the scheme is the proxy\'s', async () => {
    expect(await probeWith('1')).toEqual({ ip: '203.0.113.7', protocol: 'https' });
  });

  it('2 proxies: one hop further to the left', async () => {
    expect((await probeWith('2')).ip).toBe('198.51.100.23');
  });

  it('a list of trusted addresses: the first address that is not a trusted proxy is the client', async () => {
    expect(await probeWith('loopback')).toEqual({ ip: '203.0.113.7', protocol: 'https' });
  });

  it('a list that does not include the actual proxy: the headers are ignored', async () => {
    const seen = await probeWith('10.0.0.0/8');
    expect(seen.ip).toMatch(LOOPBACK);
    expect(seen.protocol).toBe('http');
  });
});
