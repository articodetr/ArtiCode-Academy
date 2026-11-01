// Permission keys of MOD-04 as seeded in permission-catalog.ts (no new keys —
// roadmap §4c.3). `courses.read` (every system role) reads published courses
// with their levels and syllabus; `courses.manage` (academy_admin by seed)
// reads every state and writes courses, levels and syllabus (D-R13).
export const READ_COURSES_PERMISSION = 'courses.read';
export const MANAGE_COURSES_PERMISSION = 'courses.manage';

/** True when the caller may see drafts, archived courses and inactive levels. */
export function canManageCourses(permissions: readonly string[]): boolean {
  return permissions.includes(MANAGE_COURSES_PERMISSION);
}
