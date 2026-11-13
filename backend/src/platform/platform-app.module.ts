// MOD-18 (D-R97) — root module of the PLATFORM application, the second entry of
// the backend package (src/platform/main.ts → dist/platform/main.js). It
// imports nothing of the academy AppModule tree that touches an academy
// database: no PrismaModule, no academy AuthModule, no feature module. Generic
// pieces are reused as files: configureApp() and APP_CREATE_OPTIONS
// (src/app.setup.ts), OriginGuard, @Public(), bearerToken()/requestContext(),
// PasswordService (src/auth/), assertNoSecrets() (src/audit/audit-metadata.ts),
// the readiness rules (src/health/schema-version.ts) and the env files
// (src/config/env-files.ts).
//
// Feature modules of later tasks add one import line each below: T03 the
// session routes, T04 the registry, T05 the fleet probe.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ENV_FILE_PATHS } from '../config/env-files.js';
import { PlatformAuditModule } from './audit/platform-audit.module.js';
import { PlatformAuthModule } from './auth/platform-auth.module.js';
import { PlatformSessionModule } from './auth/platform-session.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { PlatformHealthModule } from './health/platform-health.module.js';
import { validatePlatformEnv } from './platform.env.schema.js';
import { PlatformPrismaModule } from './prisma/platform-prisma.module.js';
import { PlatformRegistryModule } from './registry/registry.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The same optional, git-ignored files as the academy API: backend/.env.local,
      // backend/.env, then the repository root .env shared with compose.yaml.
      envFilePath: [...ENV_FILE_PATHS],
      validate: validatePlatformEnv,
    }),
    PlatformPrismaModule,
    PlatformAuditModule,
    PlatformAuthModule,
    // MOD-18-T03: the session routes (API-178..182).
    PlatformSessionModule,
    PlatformHealthModule,
    FleetModule, // MOD-18-T05: fleet health (API-196..198)
    PlatformRegistryModule, // MOD-18-T04: the academies registry (API-183..195)
  ],
})
export class PlatformAppModule {}
