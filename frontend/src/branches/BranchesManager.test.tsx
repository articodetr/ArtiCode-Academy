import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Branch } from '../api/branches'
import { ar } from '../i18n/ar'
import { BRANCH_IDS, BRANCH_MANAGER_PERMISSIONS, BRANCH_READER_PERMISSIONS, makeBranch, THREE_BRANCHES } from '../test/branches'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { BranchesManager } from './BranchesManager'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET serves `state.current` (re-read on every call); writes answer with `writes(method, url, body)`. */
function mockBranchesApi(initial: Branch[], writes: (method: string, url: string, body: unknown) => Response) {
  const state = { current: initial }
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') return jsonResponse(200, { items: state.current })
    return writes(method, url, body)
  })
  return { calls, state }
}

function renderManager(permissions: string[] = BRANCH_MANAGER_PERMISSIONS) {
  renderWithProviders(<BranchesManager />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/settings/branches' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const codesOf = (rows: HTMLElement[]) => rows.map((row) => within(row).getByText(/^(MAIN|NORTH|OLD|WEST)$/).textContent)
const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')
const getsOf = (calls: Call[]) => calls.filter((call) => call.method === 'GET')

async function confirmPopup(title: string, okText: string) {
  const popup = (await screen.findByText(title)).closest('.ant-popover') as HTMLElement
  fireEvent.click(within(popup).getByText(okText).closest('button')!)
}

describe('BranchesManager (MOD-02-T06 screen, API-080..API-083)', () => {
  it('lists the branches as the server orders them: main tag, academy time zone fallback, status, and the actions each row allows', async () => {
    mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(500, {}))
    renderManager()

    expect(await screen.findByText('NORTH')).toBeInTheDocument()
    const rows = bodyRows()
    expect(codesOf(rows)).toEqual(['MAIN', 'NORTH', 'OLD'])
    expect(within(rows[0]!).getByText(ar.branches.main)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.branches.academyTimezone)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('+966500000000')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Europe/Istanbul')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.labels.inactive)).toBeInTheDocument()
    expect(screen.getByText(ar.branches.hint)).toBeInTheDocument()
    // The main branch can neither be deactivated nor deleted, and has no "make main" button.
    expect(screen.getByLabelText(`${ar.branches.actions.deactivate}: MAIN`)).toBeDisabled()
    expect(screen.getByLabelText(`${ar.branches.actions.delete}: MAIN`)).toBeDisabled()
    expect(screen.queryByLabelText(`${ar.branches.actions.setMain}: MAIN`)).not.toBeInTheDocument()
    expect(screen.getByLabelText(`${ar.branches.actions.setMain}: NORTH`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.branches.actions.deactivate}: NORTH`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.branches.actions.delete}: NORTH`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.branches.actions.activate}: OLD`)).toBeEnabled()
  })

  it('is read-only without branches.manage: no add button, no actions, the read-only hint', async () => {
    mockBranchesApi(THREE_BRANCHES().slice(0, 2), () => jsonResponse(500, {}))
    renderManager(BRANCH_READER_PERMISSIONS)

    expect(await screen.findByText('NORTH')).toBeInTheDocument()
    expect(screen.getByText(ar.branches.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.branches.add)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.common.actions)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`${ar.common.edit}: MAIN`)).not.toBeInTheDocument()
  })

  it('shows the empty state, and a load failure with a retry that re-reads the list', async () => {
    let failures = 1
    const calls: string[] = []
    mockFetch((url) => {
      calls.push(url)
      if (failures > 0) {
        failures -= 1
        return jsonResponse(503, { statusCode: 503, message: 'down' })
      }
      return jsonResponse(200, { items: [] })
    })
    renderManager()

    expect(await screen.findByText(ar.branches.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.branches.retry).closest('button')!)
    expect(await screen.findByText(ar.branches.empty)).toBeInTheDocument()
    expect(screen.queryByText(ar.branches.loadFailed)).not.toBeInTheDocument()
    expect(calls).toEqual(['/api/branches', '/api/branches'])
  })

  it('creates a branch through the modal (POST with the normalised body) and re-reads the list', async () => {
    const created = makeBranch({ id: '0193b000-0000-7000-8000-00000000e009', code: 'WEST', name: { ar: 'الفرع الغربي' }, address: null, phone: '+966500000009', isMain: false })
    const { calls, state } = mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(201, created))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByText(ar.branches.add).closest('button')!)
    const dialog = (await screen.findByText(ar.branches.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.branches.fields.code), 'west')
    await userEvent.type(within(dialog).getByLabelText(ar.branches.fields.nameAr), 'الفرع الغربي')
    await userEvent.type(within(dialog).getByLabelText(ar.branches.fields.phone), '+966500000009')
    state.current = [...THREE_BRANCHES(), created]
    fireEvent.click(within(dialog).getByText(ar.branches.create).closest('button')!)

    expect(await screen.findByText('تم إنشاء الفرع «الفرع الغربي»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'POST', url: '/api/branches', body: { code: 'WEST', name: { ar: 'الفرع الغربي' }, phone: '+966500000009' } }])
    expect(await screen.findByText('WEST')).toBeInTheDocument()
    expect(getsOf(calls)).toHaveLength(2)
  })

  it('edits with the smallest PATCH, and sends nothing when the form did not change', async () => {
    const branches = THREE_BRANCHES()
    const { calls } = mockBranchesApi(branches, (_method, _url, body) => jsonResponse(200, { ...branches[1]!, ...(body as object) }))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: NORTH`))
    let dialog = (await screen.findByText('تعديل الفرع «الفرع الشمالي»')).closest('[role="dialog"]') as HTMLElement
    const english = within(dialog).getByLabelText(ar.branches.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'North')
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.branches.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/branches/${BRANCH_IDS[1]}`, body: { name: { ar: 'الفرع الشمالي', en: 'North' } } }])

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: OLD`))
    dialog = (await screen.findByText('تعديل الفرع «الفرع القديم»')).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.branches.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(1)
  })

  it('refuses deactivating the main branch inside the modal before any request (mirror of branch_is_main)', async () => {
    const { calls } = mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(500, {}))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: MAIN`))
    const dialog = (await screen.findByText('تعديل الفرع «الفرع الرئيسي»')).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByRole('switch', { name: ar.branches.fields.isActive }))
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)

    expect(await within(dialog).findByText(ar.branches.validation.deactivate)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(0)
  })

  it('lands a taken code on the code field of the modal', async () => {
    mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(409, { statusCode: 409, code: 'branch_code_taken', message: 'taken', branchCode: 'NORTH' }))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByText(ar.branches.add).closest('button')!)
    const dialog = (await screen.findByText(ar.branches.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.branches.fields.code), 'north')
    await userEvent.type(within(dialog).getByLabelText(ar.branches.fields.nameAr), 'مكرر')
    fireEvent.click(within(dialog).getByText(ar.branches.create).closest('button')!)

    expect(await within(dialog).findByText('الرمز NORTH مستخدم لفرع آخر.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(ar.branches.fields.code)).toHaveValue('NORTH')
  })

  it('makes a branch main after confirmation; an inactive one is activated in the same request', async () => {
    const { calls } = mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(200, makeBranch()))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.setMain}: NORTH`))
    await confirmPopup('تعيين «الفرع الشمالي» الفرع الرئيسي؟ سيُنزَل الفرع الرئيسي الحالي.', ar.branches.actions.setMain)
    expect(await screen.findByText('صار «الفرع الشمالي» الفرع الرئيسي')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/branches/${BRANCH_IDS[1]}`, body: { isMain: true } }])

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.setMain}: OLD`))
    await confirmPopup('تعيين «الفرع القديم» الفرع الرئيسي؟ سيُفعَّل في الطلب نفسه، ويُنزَل الفرع الرئيسي الحالي.', ar.branches.actions.setMain)
    await waitFor(() => expect(writesOf(calls)).toHaveLength(2))
    expect(writesOf(calls)[1]).toEqual({ method: 'PATCH', url: `/api/branches/${BRANCH_IDS[2]}`, body: { isMain: true, isActive: true } })
    // Every write is followed by a re-read: the server orders the list and demotes the previous main branch.
    await waitFor(() => expect(getsOf(calls)).toHaveLength(3))
  })

  it('deactivates after confirmation and activates directly', async () => {
    const { calls } = mockBranchesApi(THREE_BRANCHES(), () => jsonResponse(200, makeBranch()))
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.deactivate}: NORTH`))
    await confirmPopup('إيقاف الفرع «الفرع الشمالي»؟ لن يراه إلا من يدير الفروع.', ar.branches.actions.deactivate)
    expect(await screen.findByText('تم إيقاف الفرع «الفرع الشمالي»')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.activate}: OLD`))
    expect(await screen.findByText('تم تفعيل الفرع «الفرع القديم»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([
      { method: 'PATCH', url: `/api/branches/${BRANCH_IDS[1]}`, body: { isActive: false } },
      { method: 'PATCH', url: `/api/branches/${BRANCH_IDS[2]}`, body: { isActive: true } },
    ])
  })

  it('deletes a branch after confirmation; a branch with rooms gets the server message with the room count and the list is re-read', async () => {
    const { calls } = mockBranchesApi(THREE_BRANCHES(), (_method, url) =>
      url.endsWith(BRANCH_IDS[2]) ? jsonResponse(409, { statusCode: 409, code: 'branch_in_use', message: 'rooms', roomCount: 3 }) : jsonResponse(204),
    )
    renderManager()
    await screen.findByText('NORTH')

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.delete}: NORTH`))
    await confirmPopup('حذف الفرع «الفرع الشمالي» نهائياً؟', ar.branches.actions.delete)
    expect(await screen.findByText('تم حذف الفرع «الفرع الشمالي»')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', url: `/api/branches/${BRANCH_IDS[1]}`, body: undefined }])

    fireEvent.click(screen.getByLabelText(`${ar.branches.actions.delete}: OLD`))
    await confirmPopup('حذف الفرع «الفرع القديم» نهائياً؟', ar.branches.actions.delete)
    expect(await screen.findByText('لا يُحذف هذا الفرع: تتبعه 3 قاعة. أوقفه بدلاً من ذلك.')).toBeInTheDocument()
    await waitFor(() => expect(getsOf(calls)).toHaveLength(3))
  })
})
