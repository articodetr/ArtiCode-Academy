// Room form ↔ API bodies (J-F06, MOD-07-T02 screen) on the pattern of
// courses/levels.form.ts: the create body carries only what was filled in
// (the server defaults `kind` to classroom and `isActive` to true), the PATCH
// body only what changed (null clears the name and the capacity and moves the
// room to the academy's own site; a localized name travels whole and keeps a
// Turkish text the form does not show), nothing changed → null. The list
// helpers filter the short server list locally (API-084 has no text search).
import type { Branch } from '../api/branches'
import type { CreateRoomInput, Room, RoomKind, UpdateRoomInput } from '../api/rooms'
import { localizedOf, normaliseCourseCode, sameLabel } from '../courses/courses.form'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

/** Room codes: trimmed and upper-cased, 1–16 of A–Z 0–9 . _ - (mirror of ROOM_CODE_PATTERN = LEVEL_CODE_PATTERN). */
export const ROOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,15}$/
export const ROOM_CODE_MAX_LENGTH = 16
/** `LOCALIZED_TEXT_MAX_LENGTH` of the backend `LocalizedTextDto`. */
export const ROOM_TEXT_MAX_LENGTH = 200
/** `capacity` is a positive smallint (`ROOM_CAPACITY_MAX`). */
export const ROOM_CAPACITY_MAX = 32767
/** The server's default kind: the create body omits it. */
export const DEFAULT_ROOM_KIND: RoomKind = 'classroom'

/** Value of the branch picker for the academy's own site (no branch). */
export const SITE_OPTION = ''

export interface RoomFormValues {
  code: string
  nameAr?: string
  nameEn?: string
  kind: RoomKind
  /** Blank = unknown. */
  capacity?: number | null
  /** `SITE_OPTION` (blank) = the academy's own site. */
  branchId?: string | null
  isActive: boolean
}

export const EMPTY_ROOM_FORM: RoomFormValues = { code: '', nameAr: '', nameEn: '', kind: DEFAULT_ROOM_KIND, capacity: null, branchId: SITE_OPTION, isActive: true }

export const normaliseRoomCode = normaliseCourseCode

export function roomFormValuesOf(room: Room): RoomFormValues {
  return {
    code: room.code,
    nameAr: room.name?.ar ?? '',
    nameEn: room.name?.en ?? '',
    kind: room.kind,
    capacity: room.capacity,
    branchId: room.branchId ?? SITE_OPTION,
    isActive: room.isActive,
  }
}

const blankToNull = (value: number | null | undefined) => (value === undefined || value === null ? null : value)
const branchOrNull = (value: string | null | undefined) => value || null

export function buildCreateRoomInput(values: RoomFormValues): CreateRoomInput {
  const input: CreateRoomInput = { code: normaliseRoomCode(values.code) }
  const name = localizedOf(values.nameAr, values.nameEn)
  if (name) input.name = name
  const capacity = blankToNull(values.capacity)
  if (capacity !== null) input.capacity = capacity
  if (values.kind !== DEFAULT_ROOM_KIND) input.kind = values.kind
  const branchId = branchOrNull(values.branchId)
  if (branchId) input.branchId = branchId
  // The server creates active rooms by default: send the flag only to create an inactive one.
  if (values.isActive === false) input.isActive = false
  return input
}

/** The smallest PATCH body (API-086), or null when nothing changed. */
export function planRoomPatch(room: Room, values: RoomFormValues): UpdateRoomInput | null {
  const body: UpdateRoomInput = {}
  const code = normaliseRoomCode(values.code)
  if (code && code !== room.code) body.code = code
  const name = localizedOf(values.nameAr, values.nameEn, room.name?.tr)
  if (!sameLabel(name, room.name)) body.name = name
  const capacity = blankToNull(values.capacity)
  if (capacity !== room.capacity) body.capacity = capacity
  if (values.kind !== room.kind) body.kind = values.kind
  const branchId = branchOrNull(values.branchId)
  if (branchId !== room.branchId) body.branchId = branchId
  if (values.isActive !== room.isActive) body.isActive = values.isActive
  return Object.keys(body).length > 0 ? body : null
}

/** What the screen calls the room: its name in the active language, else its code. */
export function roomDisplayName(room: Pick<Room, 'code' | 'name'>, language: Language): string {
  return room.name ? localizedLabel(room.name, language) : room.code
}

export type RoomStatusFilter = 'all' | 'active' | 'inactive'

export interface LocalRoomFilters {
  /** Free text matched against the code and every stored name, case-insensitively. */
  q: string
  status: RoomStatusFilter
}

export const EMPTY_LOCAL_FILTERS: LocalRoomFilters = { q: '', status: 'all' }

/** The rooms matching the local filters (the server already applied `branchId`/`kind`). */
export function filterRooms(rooms: readonly Room[], filters: LocalRoomFilters): Room[] {
  const needle = filters.q.trim().toLocaleLowerCase()
  return rooms.filter((room) => {
    if (filters.status === 'active' && !room.isActive) return false
    if (filters.status === 'inactive' && room.isActive) return false
    if (!needle) return true
    const haystack = [room.code, room.name?.ar, room.name?.en, room.name?.tr].filter((text): text is string => Boolean(text))
    return haystack.some((text) => text.toLocaleLowerCase().includes(needle))
  })
}

export interface BranchOption {
  value: string
  label: string
  /** True for an inactive branch kept only because the room already belongs to it. */
  inactive: boolean
}

/**
 * The branches a room may be moved to: the active ones (the server refuses an
 * inactive branch with `branch_inactive`), plus the room's current branch when
 * it is inactive — so the form still shows where the room is, and leaving it
 * there sends nothing.
 */
export function branchOptionsFor(branches: readonly Branch[], currentBranchId: string | null, language: Language): BranchOption[] {
  return branches
    .filter((branch) => branch.isActive || branch.id === currentBranchId)
    .map((branch) => ({ value: branch.id, label: `${branch.code} — ${localizedLabel(branch.name, language)}`, inactive: !branch.isActive }))
}
