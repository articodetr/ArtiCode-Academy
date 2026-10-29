import { ValidationPipe } from '@nestjs/common';
import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

export interface AppRuntimeInfo {
  port: number;
  prefix: string;
  /** Full Swagger UI path, or null when disabled. */
  swaggerPath: string | null;
}

/**
 * Applies the cross-cutting HTTP setup (prefix, JSON-only bodies, CORS,
 * validation, Swagger). Shared by main.ts and the e2e tests so both exercise
 * the same configuration; the app must be created with APP_CREATE_OPTIONS.
 */
export function configureApp(app: NestExpressApplication): AppRuntimeInfo {
  const env: ConfigService<Env, true> = app.get(ConfigService);
  const prefix = env.get('API_PREFIX', { infer: true });

  app.setGlobalPrefix(prefix);
  app.disable('x-powered-by');
  // The only body parser (see APP_CREATE_OPTIONS). Routes that accept files
  // later opt in to multipart explicitly with an interceptor.
  app.useBodyParser('json');
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
