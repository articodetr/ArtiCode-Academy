// Planning of a PATCH /api/branches/:id (MOD-02-T06, O8) as a pure function on
// the pattern of levels.changes.ts, so the rules are unit-tested without a
// database (branches.changes.spec.ts): only fields whose value changes are
// written, an idempotent PATCH writes nothing and records nothing, and the
// audit metadata carries the names of the changed fields — never their values.
import { sameLocalizedText } from '../authorization/localized-text.js';
import type { LocalizedText } from '../authorization/localized-text.js';

/** Fields a PATCH may set, in the fixed order of the audit `fields`. */
export const BRANCH_PATCH_FIELDS = ['code', 'name', 'address', 'phone', 'timezone', 'isMain', 'isActive'] as const;

export type BranchPatchField = (typeof BRANCH_PATCH_FIELDS)[number];

/** Validated request (localized texts already reduced to `{ ar, en?, tr? }` strings). */
export interface BranchPatch {
  code?: string;
  name?: LocalizedText;
  address?: LocalizedText | null;
  phone?: string | null;
  timezone?: string | null;
  isMain?: boolean;
  isActive?: boolean;
}

/** The branch as it is now. */
export interface CurrentBranch {
  code: string;
  name: LocalizedText;
  address: LocalizedText | null;
  phone: string | null;
  timezone: string | null;
  isMain: boolean;
  isActive: boolean;
}

export type MainInactiveReason = 'deactivate' | 'promote_inactive';

export interface BranchUpdatePlan {
  data: Partial<CurrentBranch>;
  /** Names of the changed fields in BRANCH_PATCH_FIELDS order; empty = nothing to write. */
  fields: BranchPatchField[];
  /**
   * The branch would end up main but inactive — refused with `409 branch_is_main`
   * (the CHECK `ck_branches_main_active` is the database backstop):
   * `deactivate` = the main branch is being deactivated without leaving the
   * main role; `promote_inactive` = an inactive branch is made main without
   * being activated in the same request. `null` = allowed.
   */
  mainInactive: MainInactiveReason | null;
  /** The branch becomes the main one: the current main branch must step down in the same transaction. */
  promotes: boolean;
}

/** True when the body carries no field at all (`{}`). */
export function isEmptyBranchPatch(patch: Partial<Record<BranchPatchField, unknown>>): boolean {
  return BRANCH_PATCH_FIELDS.every((field) => patch[field] === undefined);
}

function sameText(a: LocalizedText | null, b: LocalizedText | null): boolean {
  if (a === null || b === null) return a === b;
  return sameLocalizedText(a, b);
}

/** Decides what a PATCH writes. Normalisation (upper-case code, trimmed values, IANA zone) happened in the DTO. */
export function planBranchUpdate(current: CurrentBranch, patch: BranchPatch): BranchUpdatePlan {
  const data: Partial<CurrentBranch> = {};
  const fields: BranchPatchField[] = [];
  for (const field of BRANCH_PATCH_FIELDS) {
    const requested = patch[field];
    if (requested === undefined) continue;
    const unchanged =
      field === 'name' || field === 'address'
        ? sameText(current[field], requested as LocalizedText | null)
        : current[field] === requested;
    if (unchanged) continue;
    (data as Record<string, unknown>)[field] = requested;
    fields.push(field);
  }
  const isMain = data.isMain ?? current.isMain;
  const isActive = data.isActive ?? current.isActive;
  const promotes = data.isMain === true;
  return {
    data,
    fields,
    mainInactive: isMain && !isActive ? (promotes ? 'promote_inactive' : 'deactivate') : null,
    promotes,
  };
}
