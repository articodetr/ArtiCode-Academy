// Permission key of the branches as the backend catalog names it
// (backend/src/branches/branches.policy.ts). Reading the list needs no key
// (D-R21 — every signed-in user sees the active branches); `branches.manage`
// (academy_admin by seed) also sees inactive branches and writes. The screen
// is shown to holders of that key (navigation.ts); the server stays the boundary.
export const MANAGE_BRANCHES_PERMISSION = 'branches.manage'
