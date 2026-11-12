// Fixtures for the weekly class schedule (MOD-07 — J-F07): the shapes of
// API-084 (rooms) and API-088/API-089 (class schedule) as the backend returns
// them, plus the permission sets the tests use; since J-F16 the API-092 answer.
import type { Room } from '../api/rooms'
import type { ClassSchedule, GeneratedLessons, ScheduleSlot } from '../api/schedule'
import { CLASS_ADMIN_PERMISSIONS, CLASS_ID, CLASS_MANAGER_PERMISSIONS, TEACHER_IDS } from './classes'

export const SLOT_IDS = ['0193c000-0000-7000-8000-00000000a001', '0193c000-0000-7000-8000-00000000a002', '0193c000-0000-7000-8000-00000000a003'] as const
export const ROOM_IDS = ['0193c000-0000-7000-8000-00000000b001', '0193c000-0000-7000-8000-00000000b002'] as const
export const BRANCH_ID = '0193c000-0000-7000-8000-00000000c001'
export const OTHER_CLASS_ID = '0193b000-0000-7000-8000-00000000e002'

/** An academy admin as far as the schedule tab is concerned: every class, and `schedule.manage`. */
export const SCHEDULE_ADMIN_PERMISSIONS = [...CLASS_ADMIN_PERMISSIONS, 'schedule.manage']

/** Staff by seed: every class, but no `schedule.manage` — read-only schedule. */
export const SCHEDULE_READER_PERMISSIONS = CLASS_MANAGER_PERMISSIONS

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
    createdAt: '2026-11-04T09:00:00.000Z',
    updatedAt: '2026-11-04T09:00:00.000Z',
    ...overrides,
  }
}

/** Sunday 10:00–11:00 in LAB-1 with the lead teacher, from 2026-11-10, open-ended. */
export function makeSlot(overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    id: SLOT_IDS[0],
    weekday: 0,
    startTime: '10:00',
    endTime: '11:00',
    room: { id: ROOM_IDS[0], code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' }, branch: null },
    teacher: { userId: TEACHER_IDS[0], fullName: 'خالد المعلم' },
    effectiveFrom: '2026-11-10',
    effectiveTo: null,
    createdAt: '2026-11-05T08:00:00.000Z',
    updatedAt: '2026-11-05T08:00:00.000Z',
    ...overrides,
  }
}

export function makeSchedule(slots: ScheduleSlot[] = [makeSlot()], classId: string = CLASS_ID): ClassSchedule {
  return { classId, slots }
}

/** An existing lesson a generated one would double-book (J-F16). */
export const LESSON_ID = '0193d000-0000-7000-8000-00000000d001'

/**
 * The API-092 answer of the contract's example (two slots, 13 lessons created);
 * `lessons` stays empty — the tab shows the counts only (J-F16).
 */
export function makeGeneratedLessons(overrides: Partial<GeneratedLessons> = {}): GeneratedLessons {
  return { classId: CLASS_ID, from: '2026-11-15', to: '2026-12-31', slots: 2, occurrences: 13, created: 13, existing: 0, offDays: 0, lessons: [], ...overrides }
}
