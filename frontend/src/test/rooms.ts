// Fixtures for the rooms screen (J-F06, MOD-07-T02 screen): the shapes of
// API-080 and API-084..API-087 as the backend returns them, plus the permission sets.
import type { Branch, BranchList } from '../api/branches'
import type { Room, RoomList } from '../api/rooms'

export const BRANCH_IDS = ['0193b000-0000-7000-8000-00000000a001', '0193b000-0000-7000-8000-00000000a002'] as const
export const ROOM_IDS = ['0193b000-0000-7000-8000-00000000e001', '0193b000-0000-7000-8000-00000000e002', '0193b000-0000-7000-8000-00000000e003'] as const

/** An academy admin as far as the rooms screen is concerned (reads need no key). */
export const SCHEDULE_MANAGER_PERMISSIONS = ['schedule.manage']

export function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: BRANCH_IDS[0],
    code: 'MAIN',
    name: { ar: 'الفرع الرئيسي', en: 'Main branch' },
    address: null,
    phone: null,
    timezone: null,
    isMain: true,
    isActive: true,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  }
}

/** Two branches: MAIN (active, main) and NORTH (inactive). */
export function TWO_BRANCHES(): Branch[] {
  return [makeBranch(), makeBranch({ id: BRANCH_IDS[1], code: 'NORTH', name: { ar: 'الفرع الشمالي' }, isMain: false, isActive: false })]
}

export function makeBranchList(items: Branch[] = TWO_BRANCHES()): BranchList {
  return { items }
}

export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: ROOM_IDS[0],
    code: 'LAB-1',
    name: { ar: 'مختبر 1', en: 'Lab 1' },
    capacity: 24,
    kind: 'lab',
    branchId: null,
    branch: null,
    // RoomDto.timeZone (CH-0189): the academy's zone of makeAcademy() — a room of the site, or of a branch without a zone.
    timeZone: 'Asia/Riyadh',
    isActive: true,
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * Three rooms in the server's order: LAB-1 (site, lab, 24 seats), R-2 (site,
 * classroom, no name, no capacity, inactive), HALL (MAIN branch, hall, 120 seats).
 */
export function THREE_ROOMS(): Room[] {
  return [
    makeRoom(),
    makeRoom({ id: ROOM_IDS[1], code: 'R-2', name: null, capacity: null, kind: 'classroom', isActive: false }),
    makeRoom({
      id: ROOM_IDS[2],
      code: 'HALL',
      name: { ar: 'القاعة الكبرى', en: 'Great hall' },
      capacity: 120,
      kind: 'hall',
      branchId: BRANCH_IDS[0],
      branch: { id: BRANCH_IDS[0], code: 'MAIN', name: { ar: 'الفرع الرئيسي', en: 'Main branch' } },
    }),
  ]
}

export function makeRoomList(items: Room[] = THREE_ROOMS()): RoomList {
  return { items }
}
