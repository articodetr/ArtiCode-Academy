// MOD-18 (D-R97) — entry of the PLATFORM API, the control plane of the Super
// Admin: `node dist/platform/main.js` (npm run start:platform), or
// `npm run start:platform:dev` in watch mode. Its own port (PLATFORM_PORT,
// 3100), database (articode_platform) and tokens; the same HTTP setup as the
// academy API (configureApp(): helmet, JSON-only bodies, CORS and OriginGuard
// on PLATFORM_CORS_ORIGIN, validation, Swagger outside production).
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CREATE_OPTIONS, configureApp } from '../app.setup.js';
import { PlatformAppModule } from './platform-app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(PlatformAppModule, APP_CREATE_OPTIONS);
  const runtime = configureApp(app);
  await app.listen(runtime.port);

  const logger = new Logger('PlatformBootstrap');
  logger.log(`Platform API ready at http://localhost:${runtime.port}/${runtime.prefix}`);
  if (runtime.swaggerPath) {
    logger.log(`Swagger UI at http://localhost:${runtime.port}/${runtime.swaggerPath}`);
  }
}

await bootstrap();
