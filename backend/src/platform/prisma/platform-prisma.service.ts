import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/platform/client.js';
import type { Prisma } from '../../generated/platform/client.js';
import { DB_TIMEOUT_MS, errorMessageOf, isUndefinedTable, withTimeout } from '../../prisma/database-checks.js';
import type { AppliedMigrations, DatabasePing } from '../../prisma/database-checks.js';
import type { PlatformEnv } from '../platform.env.schema.js';

/** The interactive-transaction client of the platform database (`db.$transaction(async (tx) => …)`). */
export type PlatformTransaction = Prisma.TransactionClient;

/**
 * Owns the single PrismaClient of the PLATFORM database (`articode_platform`,
 * generated client src/generated/platform) — the academy PrismaService is never
 * loaded by the platform application. Same behaviour as the academy one: the
 * client connects lazily, so the process boots without a reachable database
 * and readiness (/api/health/ready) reports the real state.
 */
@Injectable()
export class PlatformPrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PlatformPrismaService.name);
  private readonly client: PrismaClient | null;

  constructor(config: ConfigService<PlatformEnv, true>) {
    const url = config.get('PLATFORM_DATABASE_URL', { infer: true });
    if (url) {
      this.client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: DB_TIMEOUT_MS }),
      });
    } else {
      this.client = null;
      this.logger.warn(
        'PLATFORM_DATABASE_URL is not set; platform database features are disabled for this process',
      );
    }
  }

  /** True when PLATFORM_DATABASE_URL was provided or derived (platform.env.schema.ts). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** The platform Prisma client for feature modules. Throws 503 when no database is configured. */
  get db(): PrismaClient {
    if (!this.client) {
      throw new ServiceUnavailableException('Platform database is not configured (PLATFORM_DATABASE_URL)');
    }
    return this.client;
  }

  /** Round trip used by the readiness check. Never throws. */
  async ping(): Promise<DatabasePing> {
    if (!this.client) return { ok: false, configured: false };

    const started = performance.now();
    try {
      await withTimeout(this.client.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { ok: false, configured: true, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Reads the platform's `_prisma_migrations` for the readiness check (same
   * timeout as `ping()`). A missing table is an empty list. Never throws.
   */
  async appliedMigrations(): Promise<AppliedMigrations> {
    if (!this.client) {
      return { ok: false, error: 'Platform database is not configured (PLATFORM_DATABASE_URL)' };
    }
    try {
      const rows = await withTimeout(
        this.client.$queryRaw<{ migration_name: string }[]>`
          SELECT DISTINCT migration_name FROM _prisma_migrations
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        DB_TIMEOUT_MS,
      );
      return { ok: true, names: rows.map((row) => row.migration_name) };
    } catch (error) {
      if (isUndefinedTable(error)) return { ok: true, names: [] };
      return { ok: false, error: errorMessageOf(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
