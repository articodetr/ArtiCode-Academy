// Fixtures for the schedule screen (MOD-07 — J-F05): the shapes of API-090/091
// and API-084 as the backend returns them, plus permission sets.
import type { Room, RoomList } from '../api/rooms'
import type { AcademySchedule, MySchedule, MyScheduleItem, TimetableSlot } from '../api/schedule'
import { CLASS_COURSE_ID, CLASS_ID } from './classes'

export const SLOT_ID = '0193c000-0000-7000-8000-00000000a001'
export const ROOM_ID = '0193c000-0000-7000-8000-00000000b001'
export const BRANCH_ID = '0193c000-0000-7000-8000-00000000c001'
export const STUDENT_ID = '0193c000-0000-7000-8000-00000000d001'

/** Holders of `schedule.manage` (academy_admin by seed): both views, every filter. */
export const SCHEDULE_MANAGER_PERMISSIONS = ['schedule.read', 'schedule.manage', 'classes.read', 'classes.manage', 'users.read']
/** Staff by seed: `classes.manage` opens the academy view too. */
export const SCHEDULE_STAFF_PERMISSIONS = ['schedule.read', 'classes.read', 'classes.manage', 'users.read']
/** Teachers, students and guardians by seed: «my schedule» only. */
export const SCHEDULE_READER_PERMISSIONS = ['schedule.read']

export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: ROOM_ID,
    code: 'LAB-1',
    name: { ar: 'مختبر 1', en: 'Lab 1' },
    capacity: 24,
    kind: 'lab',
    branchId: null,
    branch: null,
    isActive: true,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  }
}

export function makeRoomList(items: Room[]): RoomList {
  return { items }
}

const CLASS = {
  id: CLASS_ID,
  code: 'PY-101-A',
  name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
  status: 'open' as const,
  course: { id: CLASS_COURSE_ID, code: 'PY-101', name: { ar: 'أساسيات بايثون', en: 'Python Basics' } },
}

/** Sunday 10:00–11:30 in LAB-1 with the lead teacher, open-ended from 2026-01-01. */
export function makeSlot(overrides: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: SLOT_ID,
    weekday: 0,
    startTime: '10:00',
    endTime: '11:30',
    room: { id: ROOM_ID, code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' }, branch: null },
    teacher: { userId: '0193b000-0000-7000-8000-00000000f001', fullName: 'خالد المعلم' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    timeZone: 'Asia/Riyadh',
    class: CLASS,
    ...overrides,
  }
}

export function makeAcademySchedule(slots: TimetableSlot[], on = '2026-11-08'): AcademySchedule {
  return { on, slots }
}

export function makeMyItem(overrides: Partial<MyScheduleItem> = {}): MyScheduleItem {
  return {
    id: SLOT_ID,
    weekday: 0,
    startTime: '10:00',
    endTime: '11:30',
    timeZone: 'Asia/Riyadh',
    room: { id: ROOM_ID, code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' }, branch: null },
    teacher: { fullName: 'خالد المعلم', displayName: null },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    class: CLASS,
    relation: 'self',
    student: { id: STUDENT_ID, fullName: 'سارة الطالبة', displayName: null },
    ...overrides,
  }
}

export function makeMySchedule(items: MyScheduleItem[], on = '2026-11-08'): MySchedule {
  return { on, items }
}
