import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  /** Dotted event name, e.g. `auth.login.succeeded`. */
  action: string;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Identifiers and non-sensitive values only (P11) — checked at runtime. */
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const FORBIDDEN_METADATA_KEY = /(password|passwd|secret|token|hash|authorization|cookie)/i;

/** Rejects metadata that looks like it carries a credential (defense in depth). */
export function assertNoSecrets(metadata: Record<string, unknown> | null | undefined, path = 'metadata'): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      throw new Error(`audit metadata must not contain credentials (${path}.${key})`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertNoSecrets(value as Record<string, unknown>, `${path}.${key}`);
    }
  }
}

/**
 * Append-only security/business event log (D5, 12.2). `record()` never stores
 * passwords or tokens; pass the transaction of the event so the row is written
 * atomically with it.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    assertNoSecrets(entry.metadata);
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata === undefined || entry.metadata === null
        ? undefined
        : (entry.metadata as Prisma.InputJsonValue),
      ipAddress: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    };
    try {
      await (tx ?? this.prisma.db).auditLog.create({ data });
    } catch (error) {
      // Inside a transaction the caller must fail with it; outside, the event
      // must never break the request that produced it.
      if (tx) throw error;
      this.logger.error(`failed to record audit event ${entry.action}`, error instanceof Error ? error.stack : String(error));
    }
  }
}
