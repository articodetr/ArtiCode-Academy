import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { authError } from './auth.errors.js';
import type { AuthPrincipal, RequestContext } from './principal.js';
import { uuidV7Time } from './refresh-family.js';
import type { SessionItemDto, SessionListDto } from './sessions.dto.js';
import { TokenService } from './token.service.js';

export const SESSION_REVOKED_ACTION = 'auth.session.revoked';

/** The columns a session item is built from — never the hash or the rotation chain. */
const SESSION_TOKEN_SELECT = {
  id: true,
  familyId: true,
  createdAt: true,
  expiresAt: true,
  userAgent: true,
  ipAddress: true,
} satisfies Prisma.RefreshTokenSelect;

export type SessionTokenRow = Prisma.RefreshTokenGetPayload<{ select: typeof SESSION_TOKEN_SELECT }>;

export interface SessionItemsInput {
  /** The caller's live tokens: not revoked, not replaced, not expired. */
  live: readonly SessionTokenRow[];
  /** Other tokens of the same families issued at or after their newest live token (normally none or the live one itself). */
  newer: readonly SessionTokenRow[];
  /** The family's absolute deadline, or null when it has none (= expired) — `TokenService.familyDeadline()`. */
  deadlineOf: (familyId: string) => Date | null;
  /** The family of the refresh cookie the request carries, when that token is the caller's. */
  currentFamilyId: string | null;
  now: Date;
}

/** Newest first: by `created_at`, then by the UUIDv7 id (insertion order) when two rows share a millisecond. */
function isNewer(a: SessionTokenRow, b: SessionTokenRow): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

/**
 * Folds the token rows into one item per session (pure — TEST-220). A family
 * is listed while it has a live token and its absolute deadline lies ahead;
 * `lastActiveAt`, `userAgent` and `ipAddress` come from its newest token,
 * `expiresAt` is the latest live expiry capped by the deadline.
 */
export function buildSessionItems(input: SessionItemsInput): SessionItemDto[] {
  const families = new Map<string, { newest: SessionTokenRow; expiresAt: Date; deadline: Date }>();
  for (const row of input.live) {
    const known = families.get(row.familyId);
    if (known) {
      if (isNewer(row, known.newest)) known.newest = row;
      if (row.expiresAt > known.expiresAt) known.expiresAt = row.expiresAt;
      continue;
    }
    const deadline = input.deadlineOf(row.familyId);
    if (deadline === null || deadline <= input.now) continue;
    families.set(row.familyId, { newest: row, expiresAt: row.expiresAt, deadline });
  }
  for (const row of input.newer) {
    const known = families.get(row.familyId);
    if (known && isNewer(row, known.newest)) known.newest = row;
  }

  const sessions: Array<{ newest: SessionTokenRow; item: SessionItemDto }> = [];
  for (const [familyId, family] of families) {
    const startedAt = uuidV7Time(familyId);
    if (!startedAt) continue; // unreachable: a family with a deadline is a UUIDv7
    const expiresAt = family.expiresAt < family.deadline ? family.expiresAt : family.deadline;
    sessions.push({
      newest: family.newest,
      item: {
        id: familyId,
        startedAt: startedAt.toISOString(),
        lastActiveAt: family.newest.createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        userAgent: family.newest.userAgent,
        ipAddress: family.newest.ipAddress,
        current: familyId === input.currentFamilyId,
      },
    });
  }
  sessions.sort((a, b) => (isNewer(a.newest, b.newest) ? -1 : isNewer(b.newest, a.newest) ? 1 : 0));
  return sessions.map((session) => session.item);
}

/**
 * MOD-01-H06 — the caller's own sessions (API-201) and revoking one of them
 * (API-202). Ownership only: no permission key, and another user's session is
 * indistinguishable from an unknown one (404).
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The family behind a refresh cookie, hashed the way AuthService looks it up,
   * when that token belongs to `userId` — whatever its state; null otherwise
   * (no cookie, an unknown token, or another user's cookie in a shared browser — KI-046).
   */
  async currentFamily(userId: string, refreshToken: string | undefined): Promise<string | null> {
    if (!refreshToken) return null;
    const row = await this.prisma.db.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { userId: true, familyId: true },
    });
    return row && row.userId === userId ? row.familyId : null;
  }

  /** API-201: every family of the caller that still has a live token, newest activity first. Reads only — no audit event. */
  async list(caller: AuthPrincipal, refreshToken: string | undefined): Promise<SessionListDto> {
    const db = this.prisma.db;
    const now = new Date();
    const live = await db.refreshToken.findMany({
      where: { userId: caller.id, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
      select: SESSION_TOKEN_SELECT,
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
        : await db.refreshToken.findMany({
            where: {
              userId: caller.id,
              OR: [...newestLive].map(([familyId, createdAt]) => ({ familyId, createdAt: { gte: createdAt } })),
            },
            select: SESSION_TOKEN_SELECT,
          });

    const currentFamilyId = await this.currentFamily(caller.id, refreshToken);
    const items = buildSessionItems({
      live,
      newer,
      deadlineOf: (familyId) => this.tokens.familyDeadline(familyId),
      currentFamilyId,
      now,
    });
    return { items };
  }

  /**
   * API-202: revokes every token of one of the caller's sessions that is not
   * revoked yet, with exactly one `auth.session.revoked` event in the same
   * transaction. A session that is another user's, unknown, already revoked,
   * expired or past its family deadline is `404 session_not_found`, without an event.
   *
   * Like logout, this ends the refresh side only: access tokens already issued
   * for that session stay valid until they expire (JWT_ACCESS_TTL_SECONDS,
   * 15 minutes by default) — they are not tied to a family. Suspending the
   * account or changing the password is what ends them at once.
   *
   * Returns whether the revoked session is the one of the refresh cookie, so
   * the controller clears that cookie as logout does.
   */
  async revoke(caller: AuthPrincipal, sessionId: string, refreshToken: string | undefined, ctx: RequestContext): Promise<{ current: boolean }> {
    // ParseUUIDPipe accepts upper case; PostgreSQL returns lower case.
    const familyId = sessionId.toLowerCase();
    const now = new Date();
    const deadline = this.tokens.familyDeadline(familyId);
    const current = (await this.currentFamily(caller.id, refreshToken)) === familyId;

    await this.prisma.db.$transaction(async (tx) => {
      const live =
        deadline !== null && deadline > now
          ? await tx.refreshToken.findFirst({
              where: { userId: caller.id, familyId, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
              select: { id: true },
            })
          : null;
      if (!live) throw authError.sessionNotFound();

      // Under READ COMMITTED a concurrent revoke of the same session waits for these row locks,
      // then re-reads `revoked_at IS NULL`, finds nothing and answers 404 — one event per session.
      const result = await tx.refreshToken.updateMany({
        where: { userId: caller.id, familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (result.count === 0) throw authError.sessionNotFound();

      // `revokedCount`, not `revokedTokens`: assertNoSecrets() refuses any metadata key matching /token/i.
      await this.audit.record(
        {
          action: SESSION_REVOKED_ACTION,
          actorUserId: caller.id,
          entityType: 'users',
          entityId: caller.id,
          metadata: { familyId, current, revokedCount: result.count },
          ...ctx,
        },
        tx,
      );
    });
    return { current };
  }
}
