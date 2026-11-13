import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PACKAGE_VERSION } from '../../common/package-info.js';
import type { DatabaseCheckDto } from '../../health/health.dto.js';
import { readNewestMigration, readinessReason, schemaCheck } from '../../health/schema-version.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import { PLATFORM_SERVICE_NAME } from './platform-health.dto.js';
import type { PlatformHealthResponseDto, PlatformReadinessResponseDto } from './platform-health.dto.js';

/** Injection token of the platform migrations folder (tests point it elsewhere). */
export const PLATFORM_MIGRATIONS_DIR = Symbol('PLATFORM_MIGRATIONS_DIR');

/**
 * The folder `prisma.platform.config.ts` names, relative to the working
 * directory: `backend/` in development and e2e, the image's WORKDIR in
 * production (MOD-18-T06 copies the folder there).
 */
export function defaultPlatformMigrationsDir(): string {
  return join(process.cwd(), 'prisma', 'platform', 'migrations');
}

/** API-176/177 with the rules of the academy HealthService (src/health/), on the platform database. */
@Injectable()
export class PlatformHealthService {
  private readonly logger = new Logger(PlatformHealthService.name);
  /** The build's newest platform migration, read once: the shipped folder never changes. */
  private shippedMigration?: Promise<string | null>;

  constructor(
    private readonly config: ConfigService<PlatformEnv, true>,
    private readonly prisma: PlatformPrismaService,
    @Inject(PLATFORM_MIGRATIONS_DIR) private readonly migrationsDir: string,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  check(): PlatformHealthResponseDto {
    return {
      status: 'ok',
      service: PLATFORM_SERVICE_NAME,
      version: PACKAGE_VERSION,
      environment: this.config.get('NODE_ENV', { infer: true }),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Readiness: the platform database answers and holds the schema this build
   * expects. The controller maps `not_ready` to HTTP 503. Never throws.
   */
  async readiness(): Promise<PlatformReadinessResponseDto> {
    const ping = await this.prisma.ping();
    const database: DatabaseCheckDto = ping.ok
      ? { status: 'up', latencyMs: ping.latencyMs }
      : ping.configured
        ? { status: 'down', error: ping.error }
        : { status: 'not_configured' };

    const expected = await this.expectedMigration();
    const databaseUp = database.status === 'up';
    const applied = expected !== null && databaseUp ? await this.prisma.appliedMigrations() : null;
    const schema = schemaCheck(expected, applied);
    const reason = readinessReason(databaseUp, schema.status);

    return {
      status: reason === null ? 'ready' : 'not_ready',
      ...(reason === null ? {} : { reason }),
      checks: { database, schema },
      timestamp: new Date().toISOString(),
    };
  }

  private expectedMigration(): Promise<string | null> {
    this.shippedMigration ??= readNewestMigration(this.migrationsDir).then((name) => {
      if (name === null) {
        this.logger.warn(
          `No platform migration found under ${this.migrationsDir}; readiness does not check the schema version`,
        );
      }
      return name;
    });
    return this.shippedMigration;
  }
}
