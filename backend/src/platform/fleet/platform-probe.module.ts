import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlatformPrismaModule } from '../prisma/platform-prisma.module.js';
import { FleetCoreModule } from './fleet-core.module.js';
import type { ProbeEnv } from './probe.cli.js';

/**
 * MOD-18-T05 — root module of the periodic probe command (src/platform/probe.ts):
 * an application CONTEXT, no HTTP server, no guard, no audit. It holds only the
 * environment the command validated itself (readProbeEnv() — no
 * PLATFORM_JWT_SECRET), the platform database and the fleet service.
 */
@Module({})
export class PlatformProbeModule {
  static withEnv(env: ProbeEnv): DynamicModule {
    return {
      module: PlatformProbeModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          // The command read the environment (and, outside production, the env files) itself.
          ignoreEnvFile: true,
          validate: () => ({ ...env }),
        }),
        PlatformPrismaModule,
        FleetCoreModule,
      ],
    };
  }
}
