// MOD-01-H06 for the platform (API-203/204) — pure rules of the sessions list:
// folding `platform_refresh_tokens` rows into one item per refresh family.
// A copy of buildSessionItems() of src/auth/sessions.service.ts (API-201),
// not an import: that file loads the academy PrismaService and AuditService,
// and the platform tree never loads the academy client (ADR-073). Keep the two
// in sync. No framework or database imports.
import { uuidV7Time } from '../../auth/refresh-family.js';
import type { PlatformSessionItemDto } from './platform-sessions.dto.js';

/** The platform event of API-204 (master doc 12.4). */
export const PLATFORM_SESSION_REVOKED_ACTION = 'platform.auth.session.revoked';

/** The columns a session item is built from — never the hash or the rotation chain. */
export const PLATFORM_SESSION_TOKEN_SELECT = {
  id: true,
  familyId: true,
  createdAt: true,
  expiresAt: true,
  userAgent: true,
  ipAddress: true,
} as const;

/** One `platform_refresh_tokens` row as PLATFORM_SESSION_TOKEN_SELECT reads it. */
export interface PlatformSessionTokenRow {
  id: string;
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface PlatformSessionItemsInput {
  /** The caller's live tokens: not revoked, not replaced, not expired. */
  live: readonly PlatformSessionTokenRow[];
  /** Other tokens of the same families issued at or after their newest live token (normally none or the live one itself). */
  newer: readonly PlatformSessionTokenRow[];
  /** The family's absolute deadline, or null when it has none (= expired) — `PlatformTokenService.familyDeadline()`. */
  deadlineOf: (familyId: string) => Date | null;
  /** The family of the `pla_refresh` cookie the request carries, when that token is the caller's. */
  currentFamilyId: string | null;
  now: Date;
}

/** Newest first: by `created_at`, then by the UUIDv7 id (insertion order) when two rows share a millisecond. */
function isNewer(a: PlatformSessionTokenRow, b: PlatformSessionTokenRow): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

/**
 * Folds the token rows into one item per session (pure — TEST-221). A family
 * is listed while it has a live token and its absolute deadline
 * (PLATFORM_REFRESH_FAMILY_MAX_DAYS) lies ahead; `lastActiveAt`, `userAgent`
 * and `ipAddress` come from its newest token, `expiresAt` is the latest live
 * expiry capped by the deadline. Newest activity first.
 */
export function buildPlatformSessionItems(input: PlatformSessionItemsInput): PlatformSessionItemDto[] {
  const families = new Map<string, { newest: PlatformSessionTokenRow; expiresAt: Date; deadline: Date }>();
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

  const sessions: Array<{ newest: PlatformSessionTokenRow; item: PlatformSessionItemDto }> = [];
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
