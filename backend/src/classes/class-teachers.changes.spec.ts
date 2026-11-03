// TEST-049 (unit) — planning of a class-teacher replacement (MOD-05-T03).
import { describe, expect, it } from 'vitest';
import { isEmptyTeacherPlan, planTeacherReplacement, teacherListProblems, writtenTeacherIds } from './class-teachers.changes.js';
import type { TeacherAssignment } from './class-teachers.changes.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const D = 'dddddddd-0000-4000-8000-000000000004';

describe('teacherListProblems', () => {
  it('accepts at most one lead and no repeated user, an empty list included', () => {
    expect(teacherListProblems([])).toBeNull();
    expect(teacherListProblems([{ userId: A, role: 'lead' }, { userId: B, role: 'assistant' }, { userId: C, role: 'assistant' }])).toBeNull();
    expect(teacherListProblems([{ userId: A, role: 'assistant' }])).toBeNull();
  });

  it('reports two leads and repeated users (each once)', () => {
    expect(teacherListProblems([{ userId: A, role: 'lead' }, { userId: B, role: 'lead' }])).toEqual({ duplicates: [], leadCount: 2 });
    expect(
      teacherListProblems([
        { userId: A, role: 'assistant' },
        { userId: A, role: 'lead' },
        { userId: A, role: 'assistant' },
        { userId: B, role: 'assistant' },
      ]),
    ).toEqual({ duplicates: [A], leadCount: 1 });
  });
});

describe('planTeacherReplacement', () => {
  const current: TeacherAssignment[] = [
    { userId: A, role: 'lead' },
    { userId: B, role: 'assistant' },
    { userId: C, role: 'assistant' },
  ];

  it('is empty for the same list in any order', () => {
    const plan = planTeacherReplacement(current, [...current].reverse());
    expect(isEmptyTeacherPlan(plan)).toBe(true);
  });

  it('adds new users, removes missing ones and records role changes in both directions', () => {
    const requested: TeacherAssignment[] = [
      { userId: B, role: 'lead' },
      { userId: D, role: 'assistant' },
      { userId: A, role: 'assistant' },
    ];
    const plan = planTeacherReplacement(current, requested);
    expect(plan).toEqual({
      added: [{ userId: D, role: 'assistant' }],
      removed: [C],
      roleChanged: [
        { userId: B, from: 'assistant', to: 'lead' },
        { userId: A, from: 'lead', to: 'assistant' },
      ],
    });
    expect(isEmptyTeacherPlan(plan)).toBe(false);
    expect(writtenTeacherIds(plan, requested)).toEqual([B, D, A]);
  });

  it('removes everyone for an empty list and writes nobody', () => {
    const plan = planTeacherReplacement(current, []);
    expect(plan).toEqual({ added: [], removed: [A, B, C], roleChanged: [] });
    expect(writtenTeacherIds(plan, [])).toEqual([]);
  });
});
