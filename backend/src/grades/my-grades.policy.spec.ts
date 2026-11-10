// TEST-132 (unit) — the keys of «my grades» (MOD-09-T06, D-R48): each relation needs its own key; neither key is a 403.
import { describe, expect, it } from 'vitest';
import { myGradesAccess, myGradesMissing, opensRelation } from './my-grades.policy.js';

describe('«my grades» keys', () => {
  it('opens the own enrollments with grades.read_own and the children’s with grades.read_linked', () => {
    const student = myGradesAccess(['grades.read_own', 'courses.read']);
    expect(student).toEqual({ self: true, child: false });
    expect(opensRelation(student, 'self')).toBe(true);
    expect(opensRelation(student, 'child')).toBe(false);
    const guardian = myGradesAccess(['grades.read_linked']);
    expect([opensRelation(guardian, 'self'), opensRelation(guardian, 'child')]).toEqual([false, true]);
    expect(myGradesAccess(['grades.read_own', 'grades.read_linked'])).toEqual({ self: true, child: true });
  });

  it('refuses a caller with neither key, whatever else they hold', () => {
    expect(myGradesMissing(['grades.read_all', 'grades.manage'])).toEqual(['grades.read_own', 'grades.read_linked']);
    expect(myGradesMissing([])).toEqual(['grades.read_own', 'grades.read_linked']);
    expect(myGradesMissing(['grades.read_linked'])).toBeNull();
  });
});
