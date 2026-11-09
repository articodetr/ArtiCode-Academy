// TEST-125 (unit) — the due-date keyset shared by API-102/API-112 and the pending filter of «my assignments» (MOD-08-T04).
import { describe, expect, it } from 'vitest';
import { NO_DUE_DATE_KEY, afterDueCursor, dueCursorKey, dueOrderBy } from './assignments.keyset.js';
import { MY_ASSIGNMENT_STATUSES, pendingWhere } from './my-assignments.policy.js';

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
