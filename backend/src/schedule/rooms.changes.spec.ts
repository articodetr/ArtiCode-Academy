// TEST-071 (unit part) — MOD-07-T02 update planning of a room (O9): diff
// against the current row, whole-object localized name, null clears the name,
// the capacity and the branch, fixed field order, and the branch/code checks
// the service must run — pure functions, no database.
import type { CurrentRoom } from './rooms.changes.js';
import { ROOM_PATCH_FIELDS, isEmptyRoomPatch, planRoomUpdate } from './rooms.changes.js';

const BRANCH_A = '0193c000-0000-7000-8000-0000000000a1';
const BRANCH_B = '0193c000-0000-7000-8000-0000000000b2';

function room(overrides: Partial<CurrentRoom> = {}): CurrentRoom {
  return {
    code: 'LAB-1',
    name: { ar: 'مختبر 1', en: 'Lab 1' },
    capacity: 24,
    kind: 'lab',
    branchId: BRANCH_A,
    isActive: true,
    ...overrides,
  };
}

describe('room update planning (TEST-071)', () => {
  it('detects an empty body and nothing else', () => {
    expect(isEmptyRoomPatch({})).toBe(true);
    expect(isEmptyRoomPatch({ capacity: undefined })).toBe(true);
    expect(isEmptyRoomPatch({ capacity: null })).toBe(false);
    expect(isEmptyRoomPatch({ branchId: null })).toBe(false);
    expect(isEmptyRoomPatch({ isActive: false })).toBe(false);
  });

  it('writes only the changed fields, in the fixed order of ROOM_PATCH_FIELDS', () => {
    expect(ROOM_PATCH_FIELDS).toEqual(['code', 'name', 'capacity', 'kind', 'branchId', 'isActive']);
    const plan = planRoomUpdate(room(), {
      isActive: false,
      kind: 'classroom',
      code: 'LAB-1',
      capacity: 24,
      name: { ar: 'مختبر 1', en: 'Lab 1' },
      branchId: BRANCH_A,
    });
    expect(plan.fields).toEqual(['kind', 'isActive']);
    expect(plan.data).toEqual({ kind: 'classroom', isActive: false });
    expect(plan).toMatchObject({ targetBranchId: null, codeNamespaceChanges: false });
  });

  it('compares the localized name as a whole object and clears name and capacity with null', () => {
    const current = room();
    expect(planRoomUpdate(current, { name: { ar: 'مختبر 1', en: 'Lab 1' } }).fields).toEqual([]);
    expect(planRoomUpdate(current, { name: { ar: 'مختبر 1' } }).fields).toEqual(['name']);
    const cleared = planRoomUpdate(current, { name: null, capacity: null });
    expect(cleared.fields).toEqual(['name', 'capacity']);
    expect(cleared.data).toEqual({ name: null, capacity: null });
    expect(planRoomUpdate(room({ name: null, capacity: null }), { name: null, capacity: null }).fields).toEqual([]);
  });

  it('flags a move to another branch for the branch check, and none for a move to the academy site', () => {
    const toB = planRoomUpdate(room(), { branchId: BRANCH_B });
    expect(toB).toMatchObject({ fields: ['branchId'], targetBranchId: BRANCH_B, codeNamespaceChanges: true });
    const toSite = planRoomUpdate(room(), { branchId: null });
    expect(toSite).toMatchObject({ fields: ['branchId'], targetBranchId: null, codeNamespaceChanges: true });
    expect(toSite.data).toEqual({ branchId: null });
    expect(planRoomUpdate(room(), { branchId: BRANCH_A })).toMatchObject({ fields: [], targetBranchId: null, codeNamespaceChanges: false });
    expect(planRoomUpdate(room({ branchId: null }), { branchId: BRANCH_A })).toMatchObject({ fields: ['branchId'], targetBranchId: BRANCH_A });
  });

  it('marks a code change as a namespace change even when the branch stays', () => {
    const plan = planRoomUpdate(room(), { code: 'LAB-2' });
    expect(plan).toMatchObject({ fields: ['code'], targetBranchId: null, codeNamespaceChanges: true });
    expect(planRoomUpdate(room(), { code: 'LAB-1', capacity: 30 })).toMatchObject({ fields: ['capacity'], codeNamespaceChanges: false });
  });
});
