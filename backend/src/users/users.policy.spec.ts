// TEST-015 — MOD-03-T02 creation policy (kind → profile, extra roles, escalation guard).
import { PERMISSION_KEYS } from '../authorization/permission-catalog.js';
import { LEARNER_BASELINE_PERMISSIONS, SYSTEM_ROLES } from '../authorization/system-roles.js';
import { exceedingPermissions, extraRoleKeys, extraRoleProfileProblem, profileKindFor } from './users.policy.js';

const permissionsOf = (key: string): readonly string[] => SYSTEM_ROLES.find((role) => role.key === key)!.permissions;

describe('users creation policy', () => {
  it('maps the kind to the profile it creates', () => {
    expect(profileKindFor('student')).toBe('student');
    expect(profileKindFor('teacher')).toBe('employee');
    expect(profileKindFor('staff')).toBe('employee');
    expect(profileKindFor('guardian')).toBeNull();
  });

  it('drops duplicates and the kind’s own role from the extra roles', () => {
    expect(extraRoleKeys('student', undefined)).toEqual([]);
    expect(extraRoleKeys('student', ['student'])).toEqual([]);
    expect(extraRoleKeys('teacher', ['staff', 'teacher', 'staff', 'academy_admin'])).toEqual(['staff', 'academy_admin']);
  });

  it('refuses extra system roles whose profile the kind does not create', () => {
    expect(extraRoleProfileProblem('teacher', ['staff', 'guardian'])).toBeNull();
    expect(extraRoleProfileProblem('staff', ['teacher'])).toBeNull();
    expect(extraRoleProfileProblem('student', ['guardian'])).toBeNull();
    expect(extraRoleProfileProblem('guardian', ['academy_admin', 'librarian'])).toBeNull();
    expect(extraRoleProfileProblem('teacher', ['student'])).toEqual({ code: 'profile_mismatch', roleKey: 'student' });
    expect(extraRoleProfileProblem('guardian', ['student'])).toEqual({ code: 'profile_mismatch', roleKey: 'student' });
    expect(extraRoleProfileProblem('student', ['teacher'])).toEqual({ code: 'employee_kind_required', roleKeys: ['teacher'] });
    expect(extraRoleProfileProblem('guardian', ['staff', 'teacher'])).toEqual({ code: 'employee_kind_required', roleKeys: ['staff', 'teacher'] });
  });

  it('builds the learner baseline from the seeded student and guardian defaults only', () => {
    for (const key of [...permissionsOf('student'), ...permissionsOf('guardian')]) {
      expect(LEARNER_BASELINE_PERMISSIONS.has(key), key).toBe(true);
    }
    for (const key of ['users.read', 'users.create', 'grades.manage', 'lessons.manage', 'payments.record', 'roles.manage']) {
      expect(LEARNER_BASELINE_PERMISSIONS.has(key), key).toBe(false);
    }
  });

  it('lets a creator grant only what they hold, apart from the learner baseline', () => {
    const staff = permissionsOf('staff');
    const teacher = permissionsOf('teacher');
    // Staff registers learners: their roles confer nothing beyond the baseline.
    expect(exceedingPermissions(permissionsOf('student'), staff)).toEqual([]);
    expect(exceedingPermissions(permissionsOf('guardian'), staff)).toEqual([]);
    // Staff may create another staff account (no permission they lack) …
    expect(exceedingPermissions(staff, staff)).toEqual([]);
    // … but not a teacher (grades, lessons, exams management) nor an admin.
    const overTeacher = exceedingPermissions(teacher, staff);
    expect(overTeacher).toContain('grades.manage');
    expect(overTeacher).toContain('lessons.manage');
    expect(overTeacher).not.toContain('users.read');
    expect(overTeacher).not.toContain('courses.read');
    expect(exceedingPermissions(PERMISSION_KEYS, staff)).toContain('roles.manage');
    expect(exceedingPermissions(PERMISSION_KEYS, staff)).toContain('users.roles.assign');
    // An academy admin holds everything, so nothing exceeds.
    expect(exceedingPermissions(PERMISSION_KEYS, PERMISSION_KEYS)).toEqual([]);
    expect(exceedingPermissions(teacher, PERMISSION_KEYS)).toEqual([]);
    // A caller with users.roles.assign but little else cannot mint an admin.
    expect(exceedingPermissions(PERMISSION_KEYS, ['users.create', 'users.roles.assign']).length).toBeGreaterThan(40);
    // Result is sorted and de-duplicated.
    expect(exceedingPermissions(['b.x', 'a.x', 'b.x'], [])).toEqual(['a.x', 'b.x']);
  });
});
