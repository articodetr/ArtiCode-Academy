import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Branch } from '../api/branches'
import type { Room } from '../api/rooms'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { BRANCH_IDS, makeRoom, ROOM_IDS, SCHEDULE_MANAGER_PERMISSIONS, THREE_ROOMS, TWO_BRANCHES } from '../test/rooms'
import { RoomsManager } from './RoomsManager'

interface Call {
  method: string
  url: string
  body: unknown
}

/**
 * GET /api/rooms serves `state.current` (re-read on every call), GET /api/branches the given branches (`null`: the
 * branch list fails with 503); writes answer with `writes()`.
 */
function mockRoomsApi(initial: Room[], writes: (method: string, url: string, body: unknown) => Response, branches: Branch[] | null = TWO_BRANCHES()) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET' && url === '/api/branches') return branches ? jsonResponse(200, { items: branches }) : jsonResponse(503, { statusCode: 503, message: 'down' })
    if (method === 'GET') return jsonResponse(200, { items: state.current })
    return writes(method, url, body)
  })
  return { calls, state }
}

/** The tab is management-only (the route and SettingsPage gate it on schedule.manage — J-F20), so it renders for a holder of the key. */
function renderManager() {
  renderWithProviders(<RoomsManager />, { auth: makeAuth({ user: makeUser({ permissions: SCHEDULE_MANAGER_PERMISSIONS }) }), route: '/settings/rooms' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const codesShown = () => bodyRows().map((row) => within(row).getByText(/^(LAB-1|R-2|HALL|LAB-2)$/).textContent)
const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')
const roomReads = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.url.startsWith('/api/rooms')).map((call) => call.url)

/** Waits until the open Select list draws the option with the given text (a table cell with the same text does not count). */
const findOption = (text: string) => screen.findByText(text, { selector: '.ant-select-item-option-content' })

/** Opens an antd Select by its accessible name and picks the option with the given text. */
async function pick(label: string, option: string, scope: Pick<typeof screen, 'getByLabelText'> = screen) {
  fireEvent.mouseDown(scope.getByLabelText(label))
  fireEvent.click(await findOption(option))
}

describe('RoomsManager (J-F06)', () => {
  it('lists the rooms as the server orders them with name, kind, branch or site, capacity and status; a manager gets the actions', async () => {
    mockRoomsApi(THREE_ROOMS(), () => jsonResponse(500, {}))
    renderManager()

    expect(await screen.findByText('HALL')).toBeInTheDocument()
    expect(codesShown()).toEqual(['LAB-1', 'R-2', 'HALL'])
    const rows = bodyRows()
    expect(within(rows[0]!).getByText('مختبر 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.rooms.kinds.lab)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.rooms.site)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('24')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.labels.inactive)).toBeInTheDocument()
    expect(within(rows[1]!).getAllByText('—')).toHaveLength(2)
    expect(within(rows[2]!).getByText('MAIN — الفرع الرئيسي')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.rooms.kinds.hall)).toBeInTheDocument()
    expect(screen.getByText(ar.rooms.add)).toBeInTheDocument()
    expect(screen.getByText(ar.rooms.hint)).toBeInTheDocument()
    expect(screen.getByLabelText(`${ar.rooms.actions.deactivate}: LAB-1`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.rooms.actions.activate}: R-2`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.rooms.actions.delete}: HALL`)).toBeEnabled()
    expect(screen.getByLabelText(ar.rooms.columns.status)).toBeInTheDocument()
  })

  it('creates a room through the modal (POST with the normalised, minimal body) and re-reads the list', async () => {
    const created = makeRoom({ id: '0193b000-0000-7000-8000-00000000e009', code: 'LAB-2', name: { ar: 'مختبر 2' }, capacity: 20, kind: 'classroom' })
    const { calls, state } = mockRoomsApi(THREE_ROOMS(), () => {
      state.current = [...THREE_ROOMS(), created]
      return jsonResponse(201, created)
    })
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByText(ar.rooms.add).closest('button')!)
    const dialog = (await screen.findByText(ar.rooms.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.rooms.fields.code), 'lab-2')
    await userEvent.type(within(dialog).getByLabelText(ar.rooms.fields.nameAr), 'مختبر 2')
    await userEvent.type(within(dialog).getByLabelText(ar.rooms.fields.capacity), '20')
    fireEvent.click(within(dialog).getByText(ar.rooms.create).closest('button')!)

    expect(await screen.findByText('تم إنشاء القاعة «مختبر 2»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'POST', url: '/api/rooms', body: { code: 'LAB-2', name: { ar: 'مختبر 2' }, capacity: 20 } }])
    await waitFor(() => expect(codesShown()).toEqual(['LAB-1', 'R-2', 'HALL', 'LAB-2']))
    expect(roomReads(calls)).toHaveLength(2)
  })

  it('creates a room in a branch with a kind and inactive, offering active branches only', async () => {
    const { calls } = mockRoomsApi(THREE_ROOMS(), (_method, _url, body) => jsonResponse(201, makeRoom({ ...(body as object), id: '0193b000-0000-7000-8000-00000000e010' })))
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByText(ar.rooms.add).closest('button')!)
    const dialog = (await screen.findByText(ar.rooms.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.rooms.fields.code), 'V1')
    await pick(ar.rooms.fields.kind, ar.rooms.kinds.virtual, within(dialog))
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.rooms.fields.branch))
    const main = await findOption('MAIN — الفرع الرئيسي')
    // Only now that the list is drawn does the absence mean something: MAIN is offered, the inactive NORTH branch is not.
    expect(screen.queryByText(/NORTH/)).not.toBeInTheDocument()
    fireEvent.click(main)
    fireEvent.click(within(dialog).getByLabelText(ar.rooms.fields.isActive))
    fireEvent.click(within(dialog).getByText(ar.rooms.create).closest('button')!)

    await waitFor(() => expect(writesOf(calls)).toEqual([{ method: 'POST', url: '/api/rooms', body: { code: 'V1', kind: 'virtual', branchId: BRANCH_IDS[0], isActive: false } }]))
  })

  it('edits with the smallest PATCH, and sends nothing when the form did not change', async () => {
    const rooms = THREE_ROOMS()
    const { calls } = mockRoomsApi(rooms, (_method, _url, body) => jsonResponse(200, { ...rooms[2]!, ...(body as object), updatedAt: '2026-11-06T12:00:00.000Z' }))
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: HALL`))
    let dialog = (await screen.findByText('تعديل القاعة «القاعة الكبرى»')).closest('[role="dialog"]') as HTMLElement
    const capacity = within(dialog).getByLabelText(ar.rooms.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '100')
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.rooms.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/rooms/${ROOM_IDS[2]}`, body: { capacity: 100 } }])

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: LAB-1`))
    dialog = (await screen.findByText('تعديل القاعة «مختبر 1»')).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.rooms.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(1)
  })

  it("names a room's own branch in the picker when the branch list failed — never its raw id — and saves only what changed (J-F20)", async () => {
    const rooms = THREE_ROOMS()
    const { calls } = mockRoomsApi(rooms, (_method, _url, body) => jsonResponse(200, { ...rooms[2]!, ...(body as object), updatedAt: '2026-11-09T12:00:00.000Z' }), null)
    renderManager()
    await screen.findByText('HALL')
    expect(await screen.findByText(ar.rooms.branchesFailed)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: HALL`))
    const dialog = (await screen.findByText('تعديل القاعة «القاعة الكبرى»')).closest('[role="dialog"]') as HTMLElement
    // The fallback comes from RoomDto.branch: code and name, as the table shows them.
    expect(within(dialog).getByText('MAIN — الفرع الرئيسي')).toBeInTheDocument()
    expect(within(dialog).queryByText(BRANCH_IDS[0])).not.toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.rooms.fields.branch))
    const fallback = await findOption('MAIN — الفرع الرئيسي')
    const offered = [...fallback.closest('.ant-select-dropdown')!.querySelectorAll('.ant-select-item-option-content')].map((node) => node.textContent)
    expect(offered).toEqual([ar.rooms.site, 'MAIN — الفرع الرئيسي'])
    fireEvent.click(fallback)

    const capacity = within(dialog).getByLabelText(ar.rooms.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '90')
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.rooms.saved)).toBeInTheDocument()
    // Keeping the branch sends no branchId.
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/rooms/${ROOM_IDS[2]}`, body: { capacity: 90 } }])
  })

  it('puts a taken code on the code field and keeps the modal open', async () => {
    mockRoomsApi(THREE_ROOMS(), () => jsonResponse(409, { statusCode: 409, code: 'room_code_taken', roomCode: 'HALL', branchId: null, message: 'taken' }))
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByText(ar.rooms.add).closest('button')!)
    const dialog = (await screen.findByText(ar.rooms.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.rooms.fields.code), 'hall')
    fireEvent.click(within(dialog).getByText(ar.rooms.create).closest('button')!)

    expect(await within(dialog).findByText('الرمز HALL مستخدم لقاعة أخرى في الفرع نفسه.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(ar.rooms.fields.code)).toHaveValue('HALL')
  })

  it('deactivates after confirmation and activates directly, each as one PATCH followed by a re-read', async () => {
    const { calls } = mockRoomsApi(THREE_ROOMS(), (_method, _url, body) => jsonResponse(200, makeRoom(body as object)))
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByLabelText(`${ar.rooms.actions.deactivate}: LAB-1`))
    const popup = (await screen.findByText('إيقاف القاعة «مختبر 1»؟ تبقى حصصها القائمة ولا تُقبل حصص جديدة عليها.')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(ar.rooms.actions.deactivate).closest('button')!)
    expect(await screen.findByText('تم إيقاف القاعة «مختبر 1»')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(`${ar.rooms.actions.activate}: R-2`))
    expect(await screen.findByText('تم تفعيل القاعة «R-2»')).toBeInTheDocument()

    expect(writesOf(calls)).toEqual([
      { method: 'PATCH', url: `/api/rooms/${ROOM_IDS[0]}`, body: { isActive: false } },
      { method: 'PATCH', url: `/api/rooms/${ROOM_IDS[1]}`, body: { isActive: true } },
    ])
    await waitFor(() => expect(roomReads(calls)).toHaveLength(3))
  })

  it('deletes after confirmation, and shows the room_in_use refusal with its slot count', async () => {
    const { calls, state } = mockRoomsApi(THREE_ROOMS(), (_method, url) =>
      url.endsWith(ROOM_IDS[1]) ? jsonResponse(204) : jsonResponse(409, { statusCode: 409, code: 'room_in_use', slotCount: 2, message: 'in use' }),
    )
    renderManager()
    await screen.findByText('HALL')

    fireEvent.click(screen.getByLabelText(`${ar.rooms.actions.delete}: R-2`))
    let popup = (await screen.findByText('حذف القاعة «R-2» نهائياً؟ لا يُحذف إلا ما لا تستخدمه حصة.')).closest('.ant-popover') as HTMLElement
    state.current = THREE_ROOMS().filter((room) => room.code !== 'R-2')
    fireEvent.click(within(popup).getByText(ar.rooms.actions.delete).closest('button')!)
    expect(await screen.findByText('تم حذف القاعة «R-2»')).toBeInTheDocument()
    await waitFor(() => expect(codesShown()).toEqual(['LAB-1', 'HALL']))

    fireEvent.click(screen.getByLabelText(`${ar.rooms.actions.delete}: HALL`))
    popup = (await screen.findByText('حذف القاعة «القاعة الكبرى» نهائياً؟ لا يُحذف إلا ما لا تستخدمه حصة.')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(ar.rooms.actions.delete).closest('button')!)
    expect(await screen.findByText('لا تُحذف هذه القاعة: تستخدمها 2 حصة. أوقفها بدلاً من ذلك.')).toBeInTheDocument()
    expect(codesShown()).toEqual(['LAB-1', 'HALL'])
    expect(writesOf(calls).map((call) => [call.method, call.url])).toEqual([
      ['DELETE', `/api/rooms/${ROOM_IDS[1]}`],
      ['DELETE', `/api/rooms/${ROOM_IDS[2]}`],
    ])
  })

  it('sends the branch and kind filters to the server, and searches and filters by status locally', async () => {
    const { calls } = mockRoomsApi(THREE_ROOMS(), () => jsonResponse(500, {}))
    renderManager()
    await screen.findByText('HALL')

    await pick(ar.rooms.columns.kind, ar.rooms.kinds.lab)
    await waitFor(() => expect(roomReads(calls).at(-1)).toBe('/api/rooms?kind=lab'))
    await pick(ar.rooms.columns.branch, ar.rooms.site)
    await waitFor(() => expect(roomReads(calls).at(-1)).toBe('/api/rooms?branchId=none&kind=lab'))
    await pick(ar.rooms.columns.branch, 'MAIN — الفرع الرئيسي')
    await waitFor(() => expect(roomReads(calls).at(-1)).toBe(`/api/rooms?branchId=${BRANCH_IDS[0]}&kind=lab`))

    await userEvent.type(screen.getByLabelText(ar.common.search), 'الكبرى')
    await waitFor(() => expect(codesShown()).toEqual(['HALL']))
    expect(screen.getByText('1 من 3 قاعة')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText(ar.common.search))
    await pick(ar.rooms.columns.status, ar.labels.inactive)
    await waitFor(() => expect(codesShown()).toEqual(['R-2']))
    await userEvent.type(screen.getByLabelText(ar.common.search), 'hall')
    expect(await screen.findByText(ar.rooms.noMatch)).toBeInTheDocument()
    // Local filtering never asks the server again.
    expect(roomReads(calls)).toHaveLength(4)
  })

  it('says "no match" rather than "no rooms yet" when a server filter returns an empty list', async () => {
    const calls: Call[] = []
    mockFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, body: undefined })
      if (url === '/api/branches') return jsonResponse(200, { items: TWO_BRANCHES() })
      return jsonResponse(200, { items: url.includes('?') ? [] : THREE_ROOMS() })
    })
    renderManager()
    await screen.findByText('HALL')

    await pick(ar.rooms.columns.kind, ar.rooms.kinds.virtual)
    expect(await screen.findByText(ar.rooms.noMatch)).toBeInTheDocument()
    expect(screen.queryByText(ar.rooms.empty)).not.toBeInTheDocument()
    expect(roomReads(calls).at(-1)).toBe('/api/rooms?kind=virtual')
  })

  it('shows the load failure with a retry that reads again, and warns when the branches cannot be loaded', async () => {
    let fail = true
    const calls: Call[] = []
    mockFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, body: undefined })
      if (url === '/api/branches') return jsonResponse(503, { statusCode: 503, message: 'down' })
      if (fail) return jsonResponse(500, { statusCode: 500, message: 'boom' })
      return jsonResponse(200, { items: THREE_ROOMS() })
    })
    renderManager()

    expect(await screen.findByText(ar.rooms.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.login.errors.server)).toBeInTheDocument()
    expect(screen.getByText(ar.rooms.branchesFailed)).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByText(ar.rooms.retry).closest('button')!)
    expect(await screen.findByText('HALL')).toBeInTheDocument()
    expect(screen.queryByText(ar.rooms.loadFailed)).not.toBeInTheDocument()
    expect(roomReads(calls)).toHaveLength(2)
  })
})
