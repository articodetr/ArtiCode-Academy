import { HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { STATUS_CODES } from 'node:http';
import type { IncomingMessage } from 'node:http';
// A file without imports: the platform application's import graph gains no academy module.
import {
  IMAGE_MAX_BYTES,
  IMAGE_TOO_LARGE_CODE,
  IMAGE_TOO_LARGE_MESSAGE,
  hasBearerCredentials,
  imageContentTypeOf,
} from './academy/homepage-images.limits.js';
import { rejectNulCharacters } from './common/nul-character.js';
import { PACKAGE_VERSION } from './common/package-info.js';
import type { Env } from './config/env.schema.js';

/** Last path segment of the Swagger UI; the OpenAPI JSON is served at `<path>-json`. */
export const SWAGGER_PATH = 'docs';

/**
 * Options for `NestFactory.create()` / `createNestApplication()` — main.ts and
 * the e2e tests must pass the same ones. Nest's default body parsers (JSON and
 * urlencoded) are disabled; configureApp() registers the JSON parser alone, so
 * a request body is only ever read from `application/json` — the one exception
 * is the image bytes of RAW_IMAGE_ROUTE, read on that route alone and only as
 * image/png, image/jpeg or image/webp (none of which a form can send). An HTML form posted
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
  // API-100: up to 500 records (ATTENDANCE_BATCH_MAX), each a uuid, a status,
  // minutes and a note of up to 500 characters — about 800 KB at most with
  // three-byte text (TEST-064).
  { method: 'PUT', path: /^\/lessons\/[^/]+\/attendance\/?$/i, limit: '1mb' },
  // API-120 (MOD-09-T04): up to 500 results (RESULTS_BATCH_MAX), each a uuid,
  // a status, a score and a feedback of up to 500 characters — about 800 KB at
  // most with three-byte text (TEST-064).
  { method: 'PUT', path: /^\/exams\/[^/]+\/results\/?$/i, limit: '1mb' },
  // API-227 (MOD-20): up to 50 levels (CURRICULUM_SECTIONS_MAX) with a title
  // and a description, and 200 lessons in all (SYLLABUS_ITEMS_MAX) with the
  // syllabus fields and two flags — about 530 KB at most in Arabic, English
  // and Turkish text (TEST-064).
  { method: 'PUT', path: /^\/courses\/[^/]+\/curriculum\/?$/i, limit: '640kb' },
  // API-228 (MOD-20): a text body of up to 8,000 characters per locale and 20
  // resources with a 2,048-character URL and a 300-character title per locale
  // — about 164 KB at most with three-byte text (TEST-064).
  { method: 'PUT', path: /^\/courses\/[^/]+\/curriculum\/items\/[^/]+\/content\/?$/i, limit: '192kb' },
];

/**
 * The ONE route whose body is not JSON (homepage images, Settings → «صور
 * الصفحة الرئيسية»): `PUT /academy/homepage-images/:key` carries the image
 * bytes themselves as `image/png`, `image/jpeg` or `image/webp`, up to 5 MiB.
 * Its raw parser reads nothing else — no other route, method or media type —
 * so every other route stays JSON only (ADR-026); a body over the limit is
 * `413 image_too_large { maxBytes }`. A compressed upload (Content-Encoding)
 * is refused with 415: browsers never compress a request body. A request
 * without `Authorization: Bearer …` is never read (an anonymous client cannot
 * make the server buffer 5 MiB): it reaches the guards bodiless and gets their
 * 401. Only the academy API registers this parser (ConfigureAppOptions).
 */
export const RAW_IMAGE_ROUTE = { method: 'PUT', path: /^\/academy\/homepage-images\/[^/]+\/?$/i, limit: IMAGE_MAX_BYTES } as const;

/** True for a request the raw image parser reads: RAW_IMAGE_ROUTE, one of the three image types and a bearer token. */
export function isRawImageRequest(req: IncomingMessage, prefix: string): boolean {
  if (req.method !== RAW_IMAGE_ROUTE.method || imageContentTypeOf(req.headers['content-type']) === null) return false;
  if (!hasBearerCredentials(req.headers.authorization)) return false;
  const path = pathBelowPrefix(req, prefix);
  return path !== null && RAW_IMAGE_ROUTE.path.test(path);
}

/** The 413 of an upload over the limit — the body of academy.errors.ts's `image_too_large`. */
function imageTooLarge(): HttpException {
  const status = HttpStatus.PAYLOAD_TOO_LARGE;
  return new HttpException(
    { statusCode: status, error: STATUS_CODES[status] ?? 'Error', code: IMAGE_TOO_LARGE_CODE, message: IMAGE_TOO_LARGE_MESSAGE, maxBytes: RAW_IMAGE_ROUTE.limit },
    status,
  );
}

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

/** Title and description of the academy API's OpenAPI document (the defaults of configureApp()). */
export const ACADEMY_SWAGGER_TITLE = 'ArtiCode Academy API';
export const ACADEMY_SWAGGER_DESCRIPTION = 'Academy management & learning platform';

/**
 * What differs between the applications that share configureApp() (KI-081):
 * the academy API keeps the defaults (it passes no options at all); the
 * platform API (MOD-18, src/platform/main.ts) names its own OpenAPI document.
 */
export interface ConfigureAppOptions {
  swaggerTitle?: string;
  swaggerDescription?: string;
  /**
   * Register the raw body parser of the homepage-image upload
   * (RAW_IMAGE_ROUTE) — an academy route. Default: on when configureApp() is
   * called WITHOUT options (the academy's main.ts and its e2e tests), off as
   * soon as an application passes its own options (the platform API).
   */
  rawImageUploads?: boolean;
}

/** Whether configureApp() registers the raw image parser for these options (see ConfigureAppOptions.rawImageUploads). */
export function registersRawImageUploads(options: ConfigureAppOptions | undefined): boolean {
  return options?.rawImageUploads ?? options === undefined;
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
 * bodies, CORS, no NUL character, validation, Swagger). Shared by main.ts,
 * the platform's main.ts and the e2e tests so
 * they all exercise the same configuration; the app must be created with
 * APP_CREATE_OPTIONS. `options` names the OpenAPI document (KI-081) and
 * switches the academy's raw image upload off for another application.
 */
export function configureApp(app: NestExpressApplication, options?: ConfigureAppOptions): AppRuntimeInfo {
  const rawImageUploads = registersRawImageUploads(options);
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
  // The homepage-image upload is the one raw body (RAW_IMAGE_ROUTE), academy
  // only. Its size error becomes the module's own 413; every other error goes
  // on unchanged (this error handler sees only the errors of the raw parser).
  if (rawImageUploads) {
    app.useBodyParser('raw', {
      limit: RAW_IMAGE_ROUTE.limit,
      inflate: false,
      type: (req: IncomingMessage) => isRawImageRequest(req, prefix),
    });
    app.use((error: unknown, req: Request, _res: Response, next: NextFunction) => {
      const tooLarge = (error as { type?: unknown } | null)?.type === 'entity.too.large';
      next(tooLarge && isRawImageRequest(req, prefix) ? imageTooLarge() : error);
    });
  }
  // The JSON body parsers (see APP_CREATE_OPTIONS). Routes that accept files
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
  // KI-078: a NUL character (U+0000) in any string or key of the parsed JSON
  // body or of the query string is `400 nul_character { location }` here —
  // after every JSON parser (LARGE_JSON_ROUTES included) and after CORS, so a
  // browser can read the answer, and before routing, the guards and the pipes.
  app.use(rejectNulCharacters);
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
        .setTitle(options?.swaggerTitle ?? ACADEMY_SWAGGER_TITLE)
        .setDescription(options?.swaggerDescription ?? ACADEMY_SWAGGER_DESCRIPTION)
        .setVersion(PACKAGE_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(swaggerPath, app, document);
  }

  return { port: env.get('PORT', { infer: true }), prefix, swaggerPath };
}
