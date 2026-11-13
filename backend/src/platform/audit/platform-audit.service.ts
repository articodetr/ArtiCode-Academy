// MOD-18-T02 (D-R104) — the append-only platform event log `platform_audit_logs`
// (the database refuses UPDATE except clearing the actor, and DELETE/TRUNCATE).
// One event per effective write, recorded in the write's own transaction;
// metadata carries identifiers and non-sensitive values only — a key that looks
// like a credential is refused by the academy's own check (assertNoSecrets).
import { Injectable, Logger } from '@nestjs/common';
import { assertNoSecrets } from '../../audit/audit-metadata.js';
import type { RequestContext } from '../../auth/principal.js';
import type { Prisma } from '../../generated/platform/client.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';

export interface PlatformAuditEntry {
  /** The platform user who acted; null for an anonymous or system event (a failed login, the probe service). */
  actorId: string | null;
  /** Dotted event name, e.g. `platform.academies.created` (roadmap §4m.4). */
  action: string;
  /** Table-like name of the subject, e.g. `academies`. */
  entityType?: string | null;
  /** Id (a uuid — the column is `uuid`) of the subject. */
  entityId?: string | null;
  /** A JSON object (the column's CHECK); identifiers and non-sensitive values only — checked at runtime. */
  metadata?: Record<string, unknown> | null;
  /** IP and user agent of the request (requestContext() of src/auth/cookies.ts). */
  ctx?: RequestContext | null;
}

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly prisma: PlatformPrismaService) {}

  /**
   * Writes one `platform_audit_logs` row. Pass the transaction of the write it
   * describes (`tx`) so both commit or roll back together — a failure then
   * throws and the caller's transaction fails with it. With `tx = null` the row
   * is written on its own and a failure is logged, never thrown (an event must
   * not break the request that produced it — the academy AuditService rule).
   * Metadata with a credential-like key throws before anything is written.
   */
  async record(tx: PlatformTransaction | null, entry: PlatformAuditEntry): Promise<void> {
    assertNoSecrets(entry.metadata);
    const data: Prisma.PlatformAuditLogUncheckedCreateInput = {
      action: entry.action,
      actorPlatformUserId: entry.actorId,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata:
        entry.metadata === undefined || entry.metadata === null
          ? undefined
          : (entry.metadata as Prisma.InputJsonValue),
      ipAddress: entry.ctx?.ip ?? null,
      userAgent: entry.ctx?.userAgent ?? null,
    };
    if (tx) {
      await tx.platformAuditLog.create({ data });
      return;
    }
    try {
      await this.prisma.db.platformAuditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `failed to record platform audit event ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
