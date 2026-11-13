import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PACKAGE_VERSION, SERVICE_NAME } from '../common/package-info.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DatabaseCheckDto,
  HealthResponseDto,
  ReadinessResponseDto,
} from './health.dto.js';
import {
  MIGRATIONS_DIR,
  readNewestMigration,
  readinessReason,
  schemaCheck,
} from './schema-version.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  /** The build's newest migration, read once: the shipped folder never changes. */
  private shippedMigration?: Promise<string | null>;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Inject(MIGRATIONS_DIR) private readonly migrationsDir: string,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  check(): HealthResponseDto {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: PACKAGE_VERSION,
      environment: this.config.get('NODE_ENV', { infer: true }),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Readiness: the database answers and holds the schema this build expects
   * (MOD-17-T03). The controller maps `not_ready` to HTTP 503. Never throws.
   */
  async readiness(): Promise<ReadinessResponseDto> {
    const ping = await this.prisma.ping();
    const database: DatabaseCheckDto = ping.ok
      ? { status: 'up', latencyMs: ping.latencyMs }
      : ping.configured
        ? { status: 'down', error: ping.error }
        : { status: 'not_configured' };

    const expected = await this.expectedMigration();
    const databaseUp = database.status === 'up';
    // Nothing to compare with, or nobody to ask: the table is not read.
    const applied =
      expected !== null && databaseUp
        ? await this.prisma.appliedMigrations()
        : null;
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
    this.shippedMigration ??= readNewestMigration(this.migrationsDir).then(
      (name) => {
        if (name === null) {
          this.logger.warn(
            `No migration found under ${this.migrationsDir}; readiness does not check the schema version`,
          );
        }
        return name;
      },
    );
    return this.shippedMigration;
  }
}
