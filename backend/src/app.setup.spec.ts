// configureApp() and the homepage-image raw body parser: registered for the
// academy API only (configureApp() called without options), read only for an
// authenticated-looking request, and imported from a file without imports so
// the platform application's import graph gains no academy module.
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hasBearerCredentials } from './academy/homepage-images.limits.js';
import { RAW_IMAGE_ROUTE, configureApp, isRawImageRequest, registersRawImageUploads } from './app.setup.js';
import { validateEnv } from './config/env.schema.js';

/** A stand-in for the Nest application that records the body parsers configureApp() registers. */
function fakeApp(): { app: NestExpressApplication; parsers: string[] } {
  const env = validateEnv({ SWAGGER_ENABLED: 'false' }) as unknown as Record<string, unknown>;
  const parsers: string[] = [];
  const app = {
    get: () => ({ get: (key: string) => env[key] }),
    setGlobalPrefix: () => undefined,
    disable: () => undefined,
    use: () => undefined,
    set: () => undefined,
    useBodyParser: (type: string) => parsers.push(type),
    enableCors: () => undefined,
    useGlobalPipes: () => undefined,
    enableShutdownHooks: () => undefined,
  };
  return { app: app as unknown as NestExpressApplication, parsers };
}

function request(method: string, url: string, headers: Record<string, string>): IncomingMessage {
  return { method, url, headers } as unknown as IncomingMessage;
}

describe('configureApp — the homepage-image raw body parser', () => {
  it('is registered for the academy API (no options) and not for an application that passes its own options (the platform)', () => {
    expect(registersRawImageUploads(undefined)).toBe(true);
    expect(registersRawImageUploads({ swaggerTitle: 'ArtiCode Platform API', swaggerDescription: 'x' })).toBe(false);
    expect(registersRawImageUploads({})).toBe(false);
    expect(registersRawImageUploads({ swaggerTitle: 'x', rawImageUploads: true })).toBe(true);
    expect(registersRawImageUploads({ rawImageUploads: false })).toBe(false);

    const academy = fakeApp();
    configureApp(academy.app);
    expect(academy.parsers).toContain('raw');
    expect(academy.parsers.filter((type) => type !== 'raw').every((type) => type === 'json')).toBe(true);

    const platform = fakeApp();
    configureApp(platform.app, { swaggerTitle: 'ArtiCode Platform API' });
    expect(platform.parsers).not.toContain('raw');
    expect(platform.parsers.every((type) => type === 'json')).toBe(true);
  });

  it('reads only PUT /<prefix>/academy/homepage-images/:key with an image type AND a bearer token', () => {
    const headers = { 'content-type': 'image/png', authorization: 'Bearer abc.def.ghi' };
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', headers), 'api')).toBe(true);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent?x=1', headers), 'api')).toBe(true);
    // Anonymous: never read, the guards answer 401 with the body unread.
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', { 'content-type': 'image/png' }), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', { 'content-type': 'image/png', authorization: 'Bearer ' }), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', { 'content-type': 'image/png', authorization: 'Basic dXNlcjpwYXNz' }), 'api')).toBe(false);
    // Other methods, routes and media types.
    expect(isRawImageRequest(request('POST', '/api/academy/homepage-images/heroStudent', headers), 'api')).toBe(false);
    expect(isRawImageRequest(request('PATCH', '/api/academy', headers), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent/extra', headers), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/academy/homepage-images/heroStudent', headers), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', { ...headers, 'content-type': 'image/svg+xml' }), 'api')).toBe(false);
    expect(isRawImageRequest(request('PUT', '/api/academy/homepage-images/heroStudent', { ...headers, 'content-type': 'application/json' }), 'api')).toBe(false);
    expect(RAW_IMAGE_ROUTE.limit).toBe(5 * 1024 * 1024);
  });

  it('recognises a bearer header by its shape only', () => {
    expect(hasBearerCredentials('Bearer x')).toBe(true);
    expect(hasBearerCredentials('bearer   token')).toBe(true);
    for (const other of [undefined, '', 'Bearer', 'Bearer   ', 'Token abc', ['Bearer x']]) expect(hasBearerCredentials(other as never), String(other)).toBe(false);
  });

  it('imports from the academy tree only a file without imports (the platform API loads configureApp too — ADR-073)', () => {
    const setup = readFileSync(fileURLToPath(new URL('./app.setup.ts', import.meta.url)), 'utf8');
    const academyImports = [...setup.matchAll(/from '(\.\/academy\/[^']+)'/g)].map((match) => match[1]);
    expect(academyImports).toEqual(['./academy/homepage-images.limits.js']);
    const limits = readFileSync(fileURLToPath(new URL('./academy/homepage-images.limits.ts', import.meta.url)), 'utf8');
    expect(limits).not.toMatch(/^\s*import\s/m);
    expect(limits).not.toMatch(/\brequire\(/);
  });
});
