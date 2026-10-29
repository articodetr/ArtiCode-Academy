import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ENV_FILE_PATHS } from './config/env-files.js';
import { validateEnv } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // backend/.env.local, backend/.env, then the repository root .env shared
      // with compose.yaml; all optional and git-ignored (src/config/env-files.ts).
      envFilePath: [...ENV_FILE_PATHS],
      validate: validateEnv,
    }),
    // Named limiter used by the auth routes only (AuthThrottlerGuard); routes
    // override it with @Throttle, nothing else is throttled yet.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'login', ttl: 15 * 60 * 1000, limit: 10 }],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
