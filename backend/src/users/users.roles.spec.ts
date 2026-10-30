// TEST-028 — MOD-03-T07 role assignment rules (diff, admin removal, profile completion).
import { diffRoleKeys, planProfiles, removesAcademyAdmin } from './users.roles.js';

describe('users role assignment rules', () => {
  it('computes the full replacement as a sorted diff, ignoring duplicates', () => {
    expect(diffRoleKeys(['teacher', 'guardian'], ['guardian', 'staff', 'staff'])).toEqual({ added: ['staff'], removed: ['teacher'] });
    expect(diffRoleKeys([], ['student'])).toEqual({ added: ['student'], removed: [] });
    expect(diffRoleKeys(['academy_admin', 'teacher'], [])).toEqual({ added: [], removed: ['academy_admin', 'teacher'] });
    expect(diffRoleKeys(['teacher'], ['teacher'])).toEqual({ added: [], removed: [] });
  });

  it('tells when academy_admin is taken away', () => {
    expect(removesAcademyAdmin(diffRoleKeys(['academy_admin'], []))).toBe(true);
    expect(removesAcademyAdmin(diffRoleKeys(['academy_admin', 'staff'], ['staff']))).toBe(true);
    expect(removesAcademyAdmin(diffRoleKeys(['academy_admin'], ['academy_admin', 'teacher']))).toBe(false);
    expect(removesAcademyAdmin(diffRoleKeys(['teacher'], []))).toBe(false);
  });

  it('completes the missing profile of an added student, teacher or staff role', () => {
    const none = { hasStudentProfile: false, employeeKind: null };
    expect(planProfiles(['student'], none, undefined)).toEqual({ kind: 'plan', student: true, employee: null });
    expect(planProfiles(['teacher'], none, undefined)).toEqual({ kind: 'plan', student: false, employee: 'teacher' });
    expect(planProfiles(['staff', 'guardian'], none, undefined)).toEqual({ kind: 'plan', student: false, employee: 'staff' });
    expect(planProfiles(['student', 'staff'], none, 'teacher')).toEqual({ kind: 'plan', student: true, employee: 'teacher' });
    expect(planProfiles(['guardian', 'academy_admin'], none, undefined)).toEqual({ kind: 'plan', student: false, employee: null });
    expect(planProfiles([], none, undefined)).toEqual({ kind: 'plan', student: false, employee: null });
  });

  it('needs an explicit employeeKind only when both employee roles are added without a profile', () => {
    const none = { hasStudentProfile: false, employeeKind: null };
    expect(planProfiles(['staff', 'teacher'], none, undefined)).toEqual({ kind: 'employee_kind_required', roleKeys: ['staff', 'teacher'] });
    expect(planProfiles(['staff', 'teacher'], none, 'staff')).toEqual({ kind: 'plan', student: false, employee: 'staff' });
  });

  it('leaves existing profiles alone and rejects an employeeKind it would ignore or contradict', () => {
    const teacher = { hasStudentProfile: false, employeeKind: 'teacher' as const };
    expect(planProfiles(['staff'], teacher, undefined)).toEqual({ kind: 'plan', student: false, employee: null });
    expect(planProfiles(['staff'], teacher, 'teacher')).toEqual({ kind: 'plan', student: false, employee: null });
    expect(planProfiles(['staff'], teacher, 'staff')).toMatchObject({ kind: 'profile_mismatch' });
    expect(planProfiles(['student'], { hasStudentProfile: true, employeeKind: null }, undefined)).toEqual({ kind: 'plan', student: false, employee: null });
    expect(planProfiles(['guardian'], { hasStudentProfile: false, employeeKind: null }, 'teacher')).toMatchObject({ kind: 'profile_mismatch' });
  });
});
