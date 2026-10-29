import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PACKAGE_VERSION } from './common/package-info.js';
import type { Env } from './config/env.schema.js';

/** Last path segment of the Swagger UI; the OpenAPI JSON is served at `<path>-json`. */
export const SWAGGER_PATH = 'docs';

export interface AppRuntimeInfo {
  port: number;
  prefix: string;
  /** Full Swagger UI path, or null when disabled. */
  swaggerPath: string | null;
}

/**
 * Applies the cross-cutting HTTP setup (prefix, CORS, validation, Swagger).
 * Shared by main.ts and the e2e tests so both exercise the same configuration.
 */
export function configureApp(app: NestExpressApplication): AppRuntimeInfo {
  const env: ConfigService<Env, true> = app.get(ConfigService);
  const prefix = env.get('API_PREFIX', { infer: true });

  app.setGlobalPrefix(prefix);
  app.disable('x-powered-by');
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
