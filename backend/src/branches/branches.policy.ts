// Permission key of the branches (MOD-02-T06, O8) as seeded in
// permission-catalog.ts — no new keys. Reading needs no key (D-R21: every
// signed-in user sees the active branches, like the academy row — D-R09);
// `branches.manage` (academy_admin by seed) also sees inactive branches and
// writes.
export const MANAGE_BRANCHES_PERMISSION = 'branches.manage';

/** True when the caller may see inactive branches and write. */
export function canManageBranches(permissions: readonly string[]): boolean {
  return permissions.includes(MANAGE_BRANCHES_PERMISSION);
}
