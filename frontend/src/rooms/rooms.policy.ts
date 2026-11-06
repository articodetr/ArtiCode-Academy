// Permission key of the rooms as the backend catalog names it
// (backend/src/schedule/schedule.policy.ts). Reading the list needs no key
// (D-R27 — every signed-in user sees the active rooms, the D-R21 pattern of
// branches); `schedule.manage` (academy_admin by seed; grantable to staff from
// the roles screen) also sees inactive rooms and writes. The rooms screen is
// shown to holders of that key (navigation.ts); the server stays the boundary.
export const MANAGE_SCHEDULE_PERMISSION = 'schedule.manage'
