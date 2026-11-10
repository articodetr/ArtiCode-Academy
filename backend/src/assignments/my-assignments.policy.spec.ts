// TEST-125 (unit) — the due-date keyset shared by API-102/API-112 and the pending filter of «my assignments» (MOD-08-T04).
import { describe, expect, it } from 'vitest';
import { NO_DUE_DATE_KEY, afterDueCursor, dueCursorKey, dueOrderBy } from './assignments.keyset.js';
import { MY_ASSIGNMENT_STATUSES, awaitingRework, isPendingItem, pendingWhere } from './my-assignments.policy.js';

const ID = '01a1c029-93e8-7402-a176-8fa8224c0217';

describe('due-date keyset', () => {
  it('keys a dated row by its instant and an undated one by the empty marker, ordered NULLS LAST', () => {
    expect(dueCursorKey(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01T10:00:00.000Z');
    expect(dueCursorKey(null)).toBe(NO_DUE_DATE_KEY);
    expect(dueOrderBy('desc')).toEqual([{ dueAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]);
  });

  it('continues after a dated cursor with later dates, the same date and a later id, then the undated rows; inside the undated group by id only', () => {
    const at = new Date('2026-12-01T10:00:00.000Z');
    expect(afterDueCursor('2026-12-01T10:00:00.000Z', ID, 'asc')).toEqual({ OR: [{ dueAt: { gt: at } }, { dueAt: at, id: { gt: ID } }, { dueAt: null }] });
    expect(afterDueCursor('2026-12-01T10:00:00.000Z', ID, 'desc')).toEqual({ OR: [{ dueAt: { lt: at } }, { dueAt: at, id: { lt: ID } }, { dueAt: null }] });
    expect(afterDueCursor(NO_DUE_DATE_KEY, ID, 'asc')).toEqual({ dueAt: null, id: { gt: ID } });
    expect(afterDueCursor('not-a-date', ID, 'asc')).toBeNull();
  });
});

describe('pendingWhere / MY_ASSIGNMENT_STATUSES', () => {
  it('keeps an assignment while one owned student of its class has not submitted; drafts are never a learner status', () => {
    const ownerships = [
      { classId: 'A', student: { id: 's1', fullName: 'S1', displayName: null } },
      { classId: 'A', student: { id: 's2', fullName: 'S2', displayName: null } },
      { classId: 'B', student: { id: 's2', fullName: 'S2', displayName: null } },
    ];
    expect(pendingWhere(ownerships)).toEqual({
      OR: [
        { classId: 'A', submissions: { none: { studentUserId: 's1' } } },
        { classId: 'A', submissions: { none: { studentUserId: 's2' } } },
        { classId: 'B', submissions: { none: { studentUserId: 's2' } } },
      ],
    });
    expect(MY_ASSIGNMENT_STATUSES).toEqual(['open', 'closed']);
  });
});

// MOD-08-T07 (D-R49): an attempt returned for rework waits for the student again.
describe('awaitingRework / isPendingItem / pendingWhere with rework', () => {
  const ownerships = [
    { classId: 'A', student: { id: 's1', fullName: 'S1', displayName: null } },
    { classId: 'B', student: { id: 's2', fullName: 'S2', displayName: null } },
  ];

  it('keeps the assignments whose latest attempt of an owned student is returned', () => {
    const attempts = [
      { assignmentId: 'a1', classId: 'A', studentUserId: 's1', attemptNo: 1, status: 'returned' as const },
      { assignmentId: 'a2', classId: 'A', studentUserId: 's1', attemptNo: 1, status: 'returned' as const },
      { assignmentId: 'a2', classId: 'A', studentUserId: 's1', attemptNo: 2, status: 'submitted' as const }, // resubmitted: no longer waiting
      { assignmentId: 'a3', classId: 'A', studentUserId: 's2', attemptNo: 1, status: 'returned' as const }, // s2 is not owned in A
      { assignmentId: 'b1', classId: 'B', studentUserId: 's2', attemptNo: 1, status: 'graded' as const },
    ];
    expect(awaitingRework(attempts, ownerships)).toEqual(['a1']);
    expect(pendingWhere(ownerships, ['a1'])).toEqual({
      OR: [
        { classId: 'A', submissions: { none: { studentUserId: 's1' } } },
        { classId: 'B', submissions: { none: { studentUserId: 's2' } } },
        { id: { in: ['a1'] } },
      ],
    });
  });

  it('an item is pending without an attempt, or when its latest attempt was returned and an attempt is left', () => {
    expect(isPendingItem(null, 0, 1)).toBe(true);
    expect(isPendingItem('returned', 1, 2)).toBe(true);
    expect(isPendingItem('returned', 2, 2)).toBe(false);
    expect(isPendingItem('submitted', 1, 2)).toBe(false);
    expect(isPendingItem('graded', 1, 1)).toBe(false);
  });
});
