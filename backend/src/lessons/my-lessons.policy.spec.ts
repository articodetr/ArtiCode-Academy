// TEST-079 (unit) — the pure ownership rules of «my lessons» (MOD-06-T04).
import { describe, expect, it } from 'vitest';
import { compareLessonOwnerships, expandLessonOwnership, ownedClassIds, ownedEnrollmentsWhere, ownershipOf } from './my-lessons.policy.js';
import type { LessonOwnership } from './my-lessons.policy.js';

const me = { id: 'u-me', fullName: 'Me', displayName: null };
const kid1 = { id: 'u-kid1', fullName: 'Kid 1', displayName: null };
const kid2 = { id: 'u-kid2', fullName: 'Kid 2', displayName: 'K2' };

describe('ownedEnrollmentsWhere', () => {
  it('reads active and completed enrollments of the caller, and of their linked, not soft-deleted children only while they hold the guardian role', () => {
    expect(ownedEnrollmentsWhere({ id: 'u-me', roles: ['student'] })).toEqual({ status: { in: ['active', 'completed'] }, OR: [{ studentUserId: 'u-me' }] });
    expect(ownedEnrollmentsWhere({ id: 'u-me', roles: ['guardian'] })).toEqual({
      status: { in: ['active', 'completed'] },
      OR: [{ studentUserId: 'u-me' }, { student: { deletedAt: null, guardians: { some: { guardianUserId: 'u-me' } } } }],
    });
  });

  it('narrows to one student when asked (an unowned student matches nothing by construction)', () => {
    expect(ownedEnrollmentsWhere({ id: 'u-me', roles: ['guardian'] }, 'u-kid1')).toMatchObject({ studentUserId: 'u-kid1' });
  });
});

describe('ownershipOf / compareLessonOwnerships / ownedClassIds', () => {
  it('names the relation by the student and orders self before child, then by student id', () => {
    const self = ownershipOf({ classId: 'c1', studentUserId: 'u-me', student: me }, 'u-me');
    const child = ownershipOf({ classId: 'c1', studentUserId: 'u-kid1', student: kid1 }, 'u-me');
    expect(self).toEqual({ classId: 'c1', relation: 'self', student: me });
    expect(child.relation).toBe('child');
    const child2: LessonOwnership = { classId: 'c1', relation: 'child', student: kid2 };
    expect([child2, child, self].sort(compareLessonOwnerships)).toEqual([self, child, child2]);
    expect(ownedClassIds([self, child, child2, { classId: 'c2', relation: 'child', student: kid1 }])).toEqual(['c1', 'c2']);
    expect(ownedClassIds([self, { classId: 'c2', relation: 'child', student: kid1 }], 'c2')).toEqual(['c2']);
    expect(ownedClassIds([self], 'c9')).toEqual([]);
  });
});

describe('expandLessonOwnership', () => {
  it('yields one item per lesson and ownership in lesson order, self first then children by id, never repeating an ownership, dropping unowned lessons', () => {
    const lessons = [
      { id: 'l1', classId: 'c1' },
      { id: 'l2', classId: 'c2' },
      { id: 'l3', classId: 'c9' },
    ];
    const ownerships: LessonOwnership[] = [
      { classId: 'c1', relation: 'child', student: kid2 },
      { classId: 'c1', relation: 'child', student: kid1 },
      { classId: 'c1', relation: 'self', student: me },
      { classId: 'c1', relation: 'child', student: kid1 }, // repeated — ignored
      { classId: 'c2', relation: 'child', student: kid1 },
    ];
    const items = expandLessonOwnership(lessons, ownerships).map(({ lesson, ownership }) => `${lesson.id}:${ownership.relation}:${ownership.student.id}`);
    expect(items).toEqual(['l1:self:u-me', 'l1:child:u-kid1', 'l1:child:u-kid2', 'l2:child:u-kid1']);
    expect(expandLessonOwnership(lessons, [])).toEqual([]);
  });
});
