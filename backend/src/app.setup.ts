import { ValidationPipe } from '@nestjs/common';
import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { IncomingMessage } from 'node:http';
import { PACKAGE_VERSION } from './common/package-info.js';
import type { Env } from './config/env.schema.js';

/** Last path segment of the Swagger UI; the OpenAPI JSON is served at `<path>-json`. */
export const SWAGGER_PATH = 'docs';

/**
 * Options for `NestFactory.create()` / `createNestApplication()` — main.ts and
 * the e2e tests must pass the same ones. Nest's default body parsers (JSON and
 * urlencoded) are disabled; configureApp() registers the JSON parser alone, so
 * a request body is only ever read from `application/json`. An HTML form posted
 * from another site (urlencoded, multipart or text/plain — the only encodings a
 * form can send without a CORS preflight) therefore never yields a parsable
 * body and cannot sign a victim's browser in (login CSRF, ADR-026).
 */
export const APP_CREATE_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** body-parser's default, kept for every route not listed in LARGE_JSON_ROUTES. */
export const DEFAULT_JSON_LIMIT = '100kb';

export interface LargeJsonRoute {
  method: 'POST' | 'PUT' | 'PATCH';
  /** Matched against the path below the API prefix (no query string). */
  path: RegExp;
  limit: string;
}

/**
 * Routes whose valid body can exceed DEFAULT_JSON_LIMIT (KI-050, ADR-062).
 * Keep each limit just above the largest body its DTO accepts; every other
 * route keeps 100 KB.
 */
export const LARGE_JSON_ROUTES: readonly LargeJsonRoute[] = [
  // API-049: up to 200 items (SYLLABUS_ITEMS_MAX), each a title and a
  // description of up to 200 characters in ar/en/tr — about 430 KB at most
  // in Arabic, English and Turkish text (TEST-064).
  { method: 'PUT', path: /^\/courses\/[^/]+\/syllabus\/?$/i, limit: '512kb' },
];

/** Same media type the default JSON parser accepts (`application/json`, any parameters). */
function isJsonRequest(req: IncomingMessage): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

/** The path of the request below `/<prefix>`, or null when it is outside the prefix. */
function pathBelowPrefix(req: IncomingMessage, prefix: string): string | null {
  const path = (req.url ?? '').split('?', 1)[0]!;
  const base = `/${prefix.replace(/^\/+|\/+$/g, '')}`;
  if (base === '/') return path;
  if (path.toLowerCase() === base.toLowerCase()) return '/';
  return path.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? path.slice(base.length) : null;
}

export interface AppRuntimeInfo {
  port: number;
  prefix: string;
  /** Full Swagger UI path, or null when disabled. */
  swaggerPath: string | null;
}

/**
 * helmet's security headers (MOD-01-H04, ADR-064) with its defaults, which the
 * Swagger UI page also satisfies: its scripts are files under the docs path
 * (script-src 'self'), its inline styles and data: icons are allowed by the
 * default style-src / img-src. Only `upgrade-insecure-requests` is limited to
 * production: on plain http://localhost it would send the page's own requests
 * to https and break the docs during development.
 */
export function securityHeaders(nodeEnv: Env['NODE_ENV']): ReturnType<typeof helmet> {
  return helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: nodeEnv === 'production' ? [] : null },
    },
  });
}

/**
 * Applies the cross-cutting HTTP setup (security headers, prefix, JSON-only
 * bodies, CORS, validation, Swagger). Shared by main.ts and the e2e tests so
 * both exercise the same configuration; the app must be created with
 * APP_CREATE_OPTIONS.
 */
export function configureApp(app: NestExpressApplication): AppRuntimeInfo {
  const env: ConfigService<Env, true> = app.get(ConfigService);
  const prefix = env.get('API_PREFIX', { infer: true });

  app.setGlobalPrefix(prefix);
  app.disable('x-powered-by');
  // First middleware: every response — JSON, errors, 404s and the Swagger UI — carries the headers.
  app.use(securityHeaders(env.get('NODE_ENV', { infer: true })));
  // MOD-01-H01 (KI-030): behind a reverse proxy, req.ip and req.protocol come
  // from X-Forwarded-For / X-Forwarded-Proto only for the proxies TRUST_PROXY
  // names; off by default, so a directly exposed API ignores those headers.
  const trustProxy = env.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== false) app.set('trust proxy', trustProxy);
  // The only body parser (see APP_CREATE_OPTIONS). Routes that accept files
  // later opt in to multipart explicitly with an interceptor. A route listed
  // in LARGE_JSON_ROUTES is read by its own JSON parser first; a body that has
  // been read is skipped by the next parser, so the 100 KB one sees the rest.
  for (const route of LARGE_JSON_ROUTES) {
    app.useBodyParser('json', {
      limit: route.limit,
      type: (req: IncomingMessage) => {
        if (req.method !== route.method || !isJsonRequest(req)) return false;
        const path = pathBelowPrefix(req, prefix);
        return path !== null && route.path.test(path);
      },
    });
  }
  app.useBodyParser('json', { limit: DEFAULT_JSON_LIMIT });
  app.enableCors({
    origin: env.get('CORS_ORIGIN', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  let swaggerPath: string | null = null;
  if (env.get('SWAGGER_ENABLED', { infer: true })) {
    swaggerPath = `${prefix}/${SWAGGER_PATH}`;
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ArtiCode Academy API')
        .setDescription('Academy management & learning platform')
        .setVersion(PACKAGE_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(swaggerPath, app, document);
  }

  return { port: env.get('PORT', { infer: true }), prefix, swaggerPath };
}
