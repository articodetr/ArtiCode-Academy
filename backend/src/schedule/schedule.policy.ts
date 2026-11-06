// Permission keys of MOD-07 (O9, roadmap §4e.3) as seeded in
// permission-catalog.ts — no new keys (D-R27). Rooms are read by every
// signed-in user (the place of a slot — the D-R21 pattern of branches);
// `schedule.manage` (academy_admin by seed; grantable to staff from the roles
// screen) also sees inactive rooms and writes rooms and class schedules.
// `schedule.read` serves «my schedule» by ownership (T04).
export const MANAGE_SCHEDULE_PERMISSION = 'schedule.manage';
export const READ_SCHEDULE_PERMISSION = 'schedule.read';

/** True when the caller may see inactive rooms and write rooms and schedules. */
export function canManageSchedule(permissions: readonly string[]): boolean {
  return permissions.includes(MANAGE_SCHEDULE_PERMISSION);
}
