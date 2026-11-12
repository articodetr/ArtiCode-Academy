// Rooms (MOD-07-T02 — O9): API-084 GET /api/rooms (every signed-in user sees
// the active rooms; holders of `schedule.manage` also see inactive ones),
// API-085 POST, API-086 PATCH /:id and API-087 DELETE /:id (`schedule.manage`).
// Types mirror backend/src/schedule/rooms.dto.ts; every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** `room_kind` enum of the database, in the order of the picker. */
export const ROOM_KINDS = ['classroom', 'lab', 'hall', 'virtual'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

/** `branchId=none` lists the rooms of the academy's own site (no branch). */
export const NO_BRANCH_FILTER = 'none'

/** The branch a room belongs to (`RoomBranchDto`): id, code and name only. */
export interface RoomBranch {
  id: string
  code: string
  name: LocalizedLabel
}

/** `RoomDto`. */
export interface Room {
  id: string
  /** Upper-case; unique inside the branch (rooms without a branch share one namespace). */
  code: string
  /** null = the code alone names the room. */
  name: LocalizedLabel | null
  /** Seats, when known; never checked against class capacity (§4e.1). */
  capacity: number | null
  kind: RoomKind
  /** null = the academy's own site. */
  branchId: string | null
  branch: RoomBranch | null
  /**
   * IANA zone the room's times are shown in (since CH-0189): its branch's `timezone`, else the academy's (UTC without
   * the academy row) — the `displayTimeZone()` rule of API-090/091 and `LessonDto` (D-R41). The lesson forms type a
   * lesson's times in the zone of the room they pick (J-F48).
   */
  timeZone: string
  /** An inactive room is visible to holders of `schedule.manage` only and accepts no new slots. */
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** `RoomListDto`: the academy's own site first, then by branch code, then by room code; no pagination. */
export interface RoomList {
  items: Room[]
}

/** Query of API-084: a branch id or `none` (the academy's own site), and a kind. */
export interface ListRoomsParams {
  branchId?: string
  kind?: RoomKind
}

/**
 * Body of API-085 (`CreateRoomDto`): `kind` defaults to `classroom` and
 * `isActive` to true on the server, so a form sends them only when they differ;
 * `capacity` is a JSON integer; an absent `branchId` means the academy's own site.
 */
export interface CreateRoomInput {
  code: string
  name?: LocalizedLabel
  capacity?: number
  kind?: RoomKind
  branchId?: string
  isActive?: boolean
}

/**
 * Body of API-086 (`UpdateRoomDto`): absent = unchanged; `null` clears `name`
 * and `capacity` and moves the room to the academy's own site (`branchId`);
 * `name` replaces the whole localized object; `code`, `kind` and `isActive`
 * are never null.
 */
export interface UpdateRoomInput {
  code?: string
  name?: LocalizedLabel | null
  capacity?: number | null
  kind?: RoomKind
  branchId?: string | null
  isActive?: boolean
}

export const ROOMS_PATH = '/api/rooms'

const roomPath = (id: string) => `${ROOMS_PATH}/${encodeURIComponent(id)}`

/** The list path with the non-empty filters, in a fixed order. */
export function roomsListPath(params: ListRoomsParams = {}): string {
  const search = new URLSearchParams()
  if (params.branchId) search.set('branchId', params.branchId)
  if (params.kind) search.set('kind', params.kind)
  const query = search.toString()
  return query ? `${ROOMS_PATH}?${query}` : ROOMS_PATH
}

export function listRooms(params: ListRoomsParams = {}, signal?: AbortSignal): Promise<RoomList> {
  return apiRequest<RoomList>(roomsListPath(params), { signal })
}

export function createRoom(input: CreateRoomInput): Promise<Room> {
  return apiRequest<Room>(ROOMS_PATH, { method: 'POST', body: input })
}

export function updateRoom(id: string, input: UpdateRoomInput): Promise<Room> {
  return apiRequest<Room>(roomPath(id), { method: 'PATCH', body: input })
}

/** API-087: refused with `409 room_in_use { slotCount }` while a weekly slot uses the room; resolves on 204. */
export function deleteRoom(id: string): Promise<void> {
  return apiRequest<void>(roomPath(id), { method: 'DELETE' })
}
