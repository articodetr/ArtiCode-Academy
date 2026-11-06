// Planning of a PATCH /api/rooms/:id (MOD-07-T02, O9) as a pure function on
// the pattern of branches.changes.ts, so the rules are unit-tested without a
// database (rooms.changes.spec.ts): only fields whose value changes are
// written, an idempotent PATCH writes nothing and records nothing, and the
// audit metadata carries the names of the changed fields — never their values.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';
import type { RoomKind } from '../generated/prisma/client.js';

/** Fields a PATCH may set, in the fixed order of the audit `fields`. */
export const ROOM_PATCH_FIELDS = ['code', 'name', 'capacity', 'kind', 'branchId', 'isActive'] as const;

export type RoomPatchField = (typeof ROOM_PATCH_FIELDS)[number];

/** Validated request (localized text already reduced to `{ ar, en?, tr? }` strings). */
export interface RoomPatch {
  code?: string;
  name?: LocalizedText | null;
  capacity?: number | null;
  kind?: RoomKind;
  /** `null` = the academy's own site (no branch). */
  branchId?: string | null;
  isActive?: boolean;
}

/** The room as it is now. */
export interface CurrentRoom {
  code: string;
  name: LocalizedText | null;
  capacity: number | null;
  kind: RoomKind;
  branchId: string | null;
  isActive: boolean;
}

export interface RoomUpdatePlan {
  data: Partial<CurrentRoom>;
  /** Names of the changed fields in ROOM_PATCH_FIELDS order; empty = nothing to write. */
  fields: RoomPatchField[];
  /** The room moves to a branch (a non-null target that differs from the current one): the service checks that it exists and is active. */
  targetBranchId: string | null;
  /** The code namespace changes (code or branch): the service checks the code is free there. */
  codeNamespaceChanges: boolean;
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyRoomPatch(patch: Partial<Record<RoomPatchField, unknown>>): boolean {
  return ROOM_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

function sameText(a: LocalizedText | null, b: LocalizedText | null): boolean {
  if (a === null || b === null) return a === b;
  return sameLocalizedText(a, b);
}

/** Decides what a PATCH writes. Normalisation (upper-case code, trimmed values) happened in the DTO. */
export function planRoomUpdate(current: CurrentRoom, patch: RoomPatch): RoomUpdatePlan {
  const data: Partial<CurrentRoom> = {};
  const fields: RoomPatchField[] = [];
  for (const field of ROOM_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged = field === 'name' ? sameText(current.name, requested as LocalizedText | null) : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  const movesToBranch = data.branchId !== undefined && data.branchId !== null;
  return {
    data,
    fields,
    targetBranchId: movesToBranch ? (data.branchId as string) : null,
    codeNamespaceChanges: data.code !== undefined || data.branchId !== undefined,
  };
}
