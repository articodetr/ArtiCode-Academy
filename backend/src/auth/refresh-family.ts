// MOD-01-H03: absolute lifetime of a refresh-token family. A family starts at
// sign-in and every rotation keeps its `family_id`, which PostgreSQL generates
// with uuidv7() — so the id itself carries the moment the family started and
// no extra column is needed (ADR-063).

const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The creation time encoded in a version 7 UUID (its first 48 bits, Unix milliseconds), or null for any other value. */
export function uuidV7Time(id: string): Date | null {
  const match = UUID_V7.exec(id);
  if (!match) return null;
  return new Date(Number.parseInt(`${match[1]}${match[2]}`, 16));
}

/**
 * When a family must stop rotating: its start plus the maximum lifetime.
 * Null when the id is not a UUIDv7 — callers treat that as expired (fail closed).
 */
export function familyDeadline(familyId: string, maxLifetimeMs: number): Date | null {
  const startedAt = uuidV7Time(familyId);
  return startedAt ? new Date(startedAt.getTime() + maxLifetimeMs) : null;
}
