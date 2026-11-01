// Generic opaque keyset cursor (ADR-028), extracted for its second consumer
// (courses, MOD-04-T03); users.cursor.ts keeps its own copy for now. The
// cursor is a base64url JSON tuple `[version, sort, order, key, id]`: decoding
// checks that it belongs to the same sort and order, so a cursor cannot be
// replayed against a differently ordered query. `key` is the sort value of the
// last row, or null when the id itself is the sort key.

export type SortOrder = 'asc' | 'desc';

export interface KeysetCursor<S extends string> {
  sort: S;
  order: SortOrder;
  key: string | null;
  id: string;
}

const CURSOR_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeKeysetCursor<S extends string>(cursor: KeysetCursor<S>): string {
  return Buffer.from(JSON.stringify([CURSOR_VERSION, cursor.sort, cursor.order, cursor.key, cursor.id]), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor for the given sort and order. `keyed` says whether the
 * sort carries a string key (true) or sorts by the id alone (false). Any
 * mismatch throws the error built by `invalid` (the caller's dictionary).
 */
export function decodeKeysetCursor<S extends string>(raw: string, sort: S, order: SortOrder, keyed: boolean, invalid: () => Error): KeysetCursor<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 5) throw invalid();
  const [version, cursorSort, cursorOrder, key, id] = parsed as unknown[];
  if (version !== CURSOR_VERSION || cursorSort !== sort || cursorOrder !== order) throw invalid();
  if (typeof id !== 'string' || !UUID.test(id)) throw invalid();
  if (keyed ? typeof key !== 'string' : key !== null) throw invalid();
  return { sort, order, key: key as string | null, id };
}
