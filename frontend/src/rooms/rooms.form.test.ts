import { describe, expect, it } from 'vitest'
import { BRANCH_IDS, makeRoom, THREE_ROOMS, TWO_BRANCHES } from '../test/rooms'
import { branchOptionsFor, buildCreateRoomInput, EMPTY_ROOM_FORM, filterRooms, planRoomPatch, ROOM_CODE_PATTERN, roomDisplayName, roomFormValuesOf } from './rooms.form'

describe('rooms.form (J-F06)', () => {
  it('mirrors the server code alphabet (1–16 of A–Z 0–9 . _ -, starting with a letter or digit)', () => {
    for (const code of ['LAB-1', 'A', 'R_2.B', '1234567890123456']) expect(ROOM_CODE_PATTERN.test(code)).toBe(true)
    for (const code of ['', 'lab-1', '-LAB', 'LAB 1', '12345678901234567', 'قاعة']) expect(ROOM_CODE_PATTERN.test(code)).toBe(false)
  })

  it('turns a room into form values (null → blank, no branch → the site option)', () => {
    expect(roomFormValuesOf(makeRoom())).toEqual({ code: 'LAB-1', nameAr: 'مختبر 1', nameEn: 'Lab 1', kind: 'lab', capacity: 24, branchId: '', isActive: true })
    expect(roomFormValuesOf(makeRoom({ name: null, capacity: null, branchId: BRANCH_IDS[0], isActive: false }))).toMatchObject({
      nameAr: '',
      nameEn: '',
      capacity: null,
      branchId: BRANCH_IDS[0],
      isActive: false,
    })
  })

  it('builds the create body with the filled-in fields only (the server defaults kind and isActive)', () => {
    expect(buildCreateRoomInput({ ...EMPTY_ROOM_FORM, code: ' lab-2 ' })).toEqual({ code: 'LAB-2' })
    expect(
      buildCreateRoomInput({ code: 'HALL', nameAr: 'القاعة الكبرى', nameEn: ' Great hall ', kind: 'hall', capacity: 120, branchId: BRANCH_IDS[0], isActive: false }),
    ).toEqual({ code: 'HALL', name: { ar: 'القاعة الكبرى', en: 'Great hall' }, capacity: 120, kind: 'hall', branchId: BRANCH_IDS[0], isActive: false })
    // English without Arabic is no name at all (the form refuses it before this point).
    expect(buildCreateRoomInput({ ...EMPTY_ROOM_FORM, code: 'X', nameEn: 'Only English' })).toEqual({ code: 'X' })
  })

  it('plans the smallest PATCH: changed fields only, null clears the name and the capacity and moves to the site, nothing changed → null', () => {
    const room = makeRoom()
    expect(planRoomPatch(room, roomFormValuesOf(room))).toBeNull()
    expect(planRoomPatch(room, { ...roomFormValuesOf(room), code: 'lab-1 ' })).toBeNull()
    expect(planRoomPatch(room, { ...roomFormValuesOf(room), capacity: 30 })).toEqual({ capacity: 30 })
    expect(planRoomPatch(room, { ...roomFormValuesOf(room), nameAr: '', nameEn: '', capacity: null, isActive: false })).toEqual({ name: null, capacity: null, isActive: false })
    expect(planRoomPatch(room, { ...roomFormValuesOf(room), nameEn: 'Lab one', kind: 'classroom', branchId: BRANCH_IDS[0] })).toEqual({
      name: { ar: 'مختبر 1', en: 'Lab one' },
      kind: 'classroom',
      branchId: BRANCH_IDS[0],
    })
    const inBranch = makeRoom({ branchId: BRANCH_IDS[0], name: { ar: 'قاعة', tr: 'Salon' } })
    // Moving to the site sends null; a Turkish text the form does not show survives a name change.
    expect(planRoomPatch(inBranch, { ...roomFormValuesOf(inBranch), branchId: '', nameEn: 'Room' })).toEqual({ name: { ar: 'قاعة', en: 'Room', tr: 'Salon' }, branchId: null })
  })

  it('names a room by its localized name, else by its code', () => {
    expect(roomDisplayName(makeRoom(), 'ar')).toBe('مختبر 1')
    expect(roomDisplayName(makeRoom(), 'en')).toBe('Lab 1')
    expect(roomDisplayName(makeRoom({ name: { ar: 'قاعة' } }), 'en')).toBe('قاعة')
    expect(roomDisplayName(makeRoom({ name: null }), 'ar')).toBe('LAB-1')
  })

  it('filters the list locally by text (code or any stored name, case-insensitively) and by status', () => {
    const rooms = THREE_ROOMS()
    const codes = (filtered: typeof rooms) => filtered.map((room) => room.code)
    expect(codes(filterRooms(rooms, { q: '', status: 'all' }))).toEqual(['LAB-1', 'R-2', 'HALL'])
    expect(codes(filterRooms(rooms, { q: 'lab', status: 'all' }))).toEqual(['LAB-1'])
    expect(codes(filterRooms(rooms, { q: 'الكبرى', status: 'all' }))).toEqual(['HALL'])
    expect(codes(filterRooms(rooms, { q: 'great HALL', status: 'all' }))).toEqual(['HALL'])
    expect(codes(filterRooms(rooms, { q: '', status: 'inactive' }))).toEqual(['R-2'])
    expect(codes(filterRooms(rooms, { q: 'r-', status: 'active' }))).toEqual([])
  })

  it('offers the active branches to a room, plus its current inactive branch (marked), never another inactive one', () => {
    const branches = TWO_BRANCHES()
    expect(branchOptionsFor(branches, null, 'ar')).toEqual([{ value: BRANCH_IDS[0], label: 'MAIN — الفرع الرئيسي', inactive: false }])
    expect(branchOptionsFor(branches, BRANCH_IDS[1], 'en')).toEqual([
      { value: BRANCH_IDS[0], label: 'MAIN — Main branch', inactive: false },
      { value: BRANCH_IDS[1], label: 'NORTH — الفرع الشمالي', inactive: true },
    ])
  })
})
