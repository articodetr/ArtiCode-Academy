// Rooms (MOD-07-T02): API-084 GET /api/rooms (every signed-in user; inactive
// rooms for `schedule.manage` only). The writes (API-085..087) come with the
// rooms screen. Types mirror backend/src/schedule/rooms.dto.ts.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export const ROOM_KINDS = ['classroom', 'lab', 'hall', 'virtual'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

/** `RoomBranchDto`: the branch a room belongs to (no address or phone). */
export interface RoomBranch {
  id: string
  code: string
  name: LocalizedLabel
}

/** `RoomDto`. */
export interface Room {
  id: string
  code: string
  name: LocalizedLabel | null
  capacity: number | null
  kind: RoomKind
  /** null = the academy's own site. */
  branchId: string | null
  branch: RoomBranch | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface RoomList {
  items: Room[]
}

export interface ListRoomsParams {
  /** A branch id, or `none` for the rooms without a branch. */
  branchId?: string
  kind?: RoomKind
}

export const ROOMS_PATH = '/api/rooms'

export function roomsListPath(params: ListRoomsParams = {}): string {
  const query = new URLSearchParams()
  if (params.branchId) query.set('branchId', params.branchId)
  if (params.kind) query.set('kind', params.kind)
  const search = query.toString()
  return search ? `${ROOMS_PATH}?${search}` : ROOMS_PATH
}

/** API-084: the academy's site first, then by branch code, then by room code; no pagination. */
export function listRooms(params: ListRoomsParams = {}, signal?: AbortSignal): Promise<RoomList> {
  return apiRequest<RoomList>(roomsListPath(params), { signal })
}
