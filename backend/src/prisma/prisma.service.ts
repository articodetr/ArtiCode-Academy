import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

export type DatabasePing =
  | { ok: true; latencyMs: number }
  | { ok: false; configured: boolean; error?: string };

/** Upper bound for a connection attempt or the readiness round trip. */
const DB_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Owns the single PrismaClient of the process. The client is created lazily by
 * Prisma (first query), so booting without a reachable database is possible;
 * readiness (/api/health/ready) reports the real state.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: PrismaClient | null;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('DATABASE_URL', { infer: true });
    if (url) {
      this.client = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          connectionTimeoutMillis: DB_TIMEOUT_MS,
        }),
      });
    } else {
      this.client = null;
      this.logger.warn(
        'DATABASE_URL is not set; database features are disabled for this process',
      );
    }
  }

  /** True when DATABASE_URL was provided (validated in src/config/env.schema.ts). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** The Prisma client for feature modules. Throws 503 when no database is configured. */
  get db(): PrismaClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Database is not configured (DATABASE_URL)',
      );
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
      return {
        ok: false,
        configured: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
