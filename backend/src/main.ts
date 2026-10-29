import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, APP_CREATE_OPTIONS);
  const runtime = configureApp(app);
  await app.listen(runtime.port);

  const logger = new Logger('Bootstrap');
  logger.log(`API ready at http://localhost:${runtime.port}/${runtime.prefix}`);
  if (runtime.swaggerPath) {
    logger.log(
      `Swagger UI at http://localhost:${runtime.port}/${runtime.swaggerPath}`,
    );
  }
}

await bootstrap();
