// MOD-01-H06 for the platform — the caller's own sessions (API-203) and
// revoking one of them (API-204), the academy SessionsService
// (src/auth/sessions.service.ts, API-201/202) on `platform_refresh_tokens`
// and `platform_audit_logs`. Ownership only: no platform role restriction, and
// another account's session is indistinguishable from an unknown one (404).
import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../auth/principal.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import { platformAuthError } from '../platform.errors.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformPrincipal } from './platform-principal.js';
import { PLATFORM_USERS_ENTITY } from './platform-session.rules.js';
import type { PlatformSessionListDto } from './platform-sessions.dto.js';
import {
  PLATFORM_SESSION_REVOKED_ACTION,
  PLATFORM_SESSION_TOKEN_SELECT,
  buildPlatformSessionItems,
} from './platform-sessions.rules.js';
import { PlatformTokenService } from './platform-token.service.js';

@Injectable()
export class PlatformSessionsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly tokens: PlatformTokenService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * The family behind a `pla_refresh` cookie, hashed the way
   * PlatformSessionService looks it up, when that token belongs to `userId` —
   * whatever its state; null otherwise (no cookie, an unknown token, or another
   * account's cookie in a shared browser).
   */
  async currentFamily(userId: string, refreshToken: string | undefined): Promise<string | null> {
    if (!refreshToken) return null;
    const row = await this.prisma.db.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { userId: true, familyId: true },
    });
    return row && row.userId === userId ? row.familyId : null;
  }

  /** API-203: every family of the caller that still has a live token, newest activity first. Reads only — no audit event. */
  async list(caller: PlatformPrincipal, refreshToken: string | undefined): Promise<PlatformSessionListDto> {
    const db = this.prisma.db;
    const now = new Date();
    const live = await db.platformRefreshToken.findMany({
      where: { userId: caller.id, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
      select: PLATFORM_SESSION_TOKEN_SELECT,
    });

    // The newest token of a family is its live one unless two rotations raced; read only the
    // rows issued at or after each family's newest live token (Prisma reads created_at to the
    // millisecond, so `gte` keeps a same-millisecond row) instead of the whole rotation history.
    const newestLive = new Map<string, Date>();
    for (const row of live) {
      const known = newestLive.get(row.familyId);
      if (!known || row.createdAt > known) newestLive.set(row.familyId, row.createdAt);
    }
    const newer =
      newestLive.size === 0
        ? []
        : await db.platformRefreshToken.findMany({
            where: {
              userId: caller.id,
              OR: [...newestLive].map(([familyId, createdAt]) => ({ familyId, createdAt: { gte: createdAt } })),
            },
            select: PLATFORM_SESSION_TOKEN_SELECT,
          });

    const currentFamilyId = await this.currentFamily(caller.id, refreshToken);
    const items = buildPlatformSessionItems({
      live,
      newer,
      deadlineOf: (familyId) => this.tokens.familyDeadline(familyId),
      currentFamilyId,
      now,
    });
    return { items };
  }

  /**
   * API-204: revokes every token of one of the caller's sessions that is not
   * revoked yet, with exactly one `platform.auth.session.revoked` event in the
   * same transaction. A session that is another account's, unknown, already
   * revoked, expired or past its family deadline is `404 session_not_found`,
   * without an event.
   *
   * Like logout, this ends the refresh side only: platform access tokens
   * already issued for that session stay valid until they expire
   * (PLATFORM_JWT_ACCESS_TTL_SECONDS) — they are not tied to a family.
   * Suspending the account or changing the password is what ends them at once.
   *
   * Returns whether the revoked session is the one of the `pla_refresh` cookie,
   * so the controller clears that cookie as logout does.
   */
  async revoke(
    caller: PlatformPrincipal,
    sessionId: string,
    refreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ current: boolean }> {
    // ParseUUIDPipe accepts upper case; PostgreSQL returns lower case.
    const familyId = sessionId.toLowerCase();
    const now = new Date();
    const deadline = this.tokens.familyDeadline(familyId);
    const current = (await this.currentFamily(caller.id, refreshToken)) === familyId;

    await this.prisma.db.$transaction(async (tx) => {
      const live =
        deadline !== null && deadline > now
          ? await tx.platformRefreshToken.findFirst({
              where: { userId: caller.id, familyId, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
              select: { id: true },
            })
          : null;
      if (!live) throw platformAuthError.sessionNotFound();

      // Under READ COMMITTED a concurrent revoke of the same session waits for these row locks,
      // then re-reads `revoked_at IS NULL`, finds nothing and answers 404 — one event per session.
      const result = await tx.platformRefreshToken.updateMany({
        where: { userId: caller.id, familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (result.count === 0) throw platformAuthError.sessionNotFound();

      // `revokedCount`, not `revokedTokens`: assertNoSecrets() refuses any metadata key matching /token/i.
      await this.audit.record(tx, {
        actorId: caller.id,
        action: PLATFORM_SESSION_REVOKED_ACTION,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: caller.id,
        metadata: { familyId, current, revokedCount: result.count },
        ctx,
      });
    });
    return { current };
  }
}
