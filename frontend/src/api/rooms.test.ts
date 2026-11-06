import { beforeEach, describe, expect, it } from 'vitest'
import { setAccessToken } from '../auth/token-store'
import { jsonResponse, mockFetch } from '../test/http'
import { makeBranchList, makeRoom, makeRoomList, ROOM_IDS } from '../test/rooms'
import { listBranches } from './branches'
import { createRoom, deleteRoom, listRooms, roomsListPath, updateRoom } from './rooms'

describe('rooms API (API-084..API-087) and the branch list it needs (API-080)', () => {
  beforeEach(() => {
    setAccessToken('access-1')
  })

  it('builds the list path with the non-empty filters only, in a fixed order', () => {
    expect(roomsListPath()).toBe('/api/rooms')
    expect(roomsListPath({ branchId: undefined, kind: undefined })).toBe('/api/rooms')
    expect(roomsListPath({ kind: 'lab' })).toBe('/api/rooms?kind=lab')
    expect(roomsListPath({ branchId: 'none' })).toBe('/api/rooms?branchId=none')
    expect(roomsListPath({ kind: 'hall', branchId: ROOM_IDS[0] })).toBe(`/api/rooms?branchId=${ROOM_IDS[0]}&kind=hall`)
  })

  it('reads the rooms and the branches with the Bearer token and the abort signal', async () => {
    const fetchMock = mockFetch((url) => jsonResponse(200, url.startsWith('/api/branches') ? makeBranchList() : makeRoomList()))
    const controller = new AbortController()
    const rooms = await listRooms({ kind: 'lab' }, controller.signal)
    const branches = await listBranches(controller.signal)
    expect(rooms.items.map((room) => room.code)).toEqual(['LAB-1', 'R-2', 'HALL'])
    expect(branches.items.map((branch) => branch.code)).toEqual(['MAIN', 'NORTH'])
    const [[roomsUrl, roomsInit], [branchesUrl, branchesInit]] = fetchMock.mock.calls
    expect(roomsUrl).toBe('/api/rooms?kind=lab')
    expect(branchesUrl).toBe('/api/branches')
    expect(new Headers(roomsInit?.headers).get('Authorization')).toBe('Bearer access-1')
    expect(roomsInit?.signal).toBe(controller.signal)
    expect(branchesInit?.signal).toBe(controller.signal)
  })

  it('writes rooms with the documented methods, paths and bodies; DELETE resolves on 204', async () => {
    const fetchMock = mockFetch((_url, init) => (init?.method === 'DELETE' ? jsonResponse(204) : jsonResponse(200, makeRoom())))
    await createRoom({ code: 'LAB-2', name: { ar: 'مختبر 2' }, capacity: 20, kind: 'lab', branchId: 'b-1' })
    await updateRoom(ROOM_IDS[0], { name: null, capacity: null, branchId: null, isActive: false })
    await expect(deleteRoom(ROOM_IDS[0])).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/rooms', 'POST', JSON.stringify({ code: 'LAB-2', name: { ar: 'مختبر 2' }, capacity: 20, kind: 'lab', branchId: 'b-1' })],
      [`/api/rooms/${ROOM_IDS[0]}`, 'PATCH', JSON.stringify({ name: null, capacity: null, branchId: null, isActive: false })],
      [`/api/rooms/${ROOM_IDS[0]}`, 'DELETE', undefined],
    ])
  })
})
