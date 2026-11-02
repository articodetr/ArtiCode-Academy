import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Level } from '../api/levels'
import { ar } from '../i18n/ar'
import { COURSE_MANAGER_PERMISSIONS, LEVEL_IDS, THREE_LEVELS, makeLevel } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LevelsManager } from './LevelsManager'
import { useLevels } from './useLevels'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET serves `current` (re-read on every call); writes answer with `writes(method, url, body)`. */
function mockLevelsApi(initial: Level[], writes: (method: string, url: string, body: unknown) => Response) {
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

function Harness() {
  const state = useLevels()
  return <LevelsManager state={state} />
}

function renderManager() {
  renderWithProviders(<Harness />, { auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }), route: '/courses' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')

describe('LevelsManager (MOD-04-T06)', () => {
  it('lists the levels in order with status and course counts; a level in use cannot be deleted', async () => {
    mockLevelsApi(THREE_LEVELS(), () => jsonResponse(500, {}))
    renderManager()

    expect(await screen.findByText('INT')).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows.map((row) => within(row).getByText(/^(BEG|INT|ADV)$/).textContent)).toEqual(['BEG', 'INT', 'ADV'])
    expect(within(rows[2]!).getByText(ar.labels.inactive)).toBeInTheDocument()
    expect(screen.getByLabelText(`${ar.courses.levels.delete}: BEG`)).toBeDisabled()
    expect(screen.getByLabelText(`${ar.courses.levels.delete}: INT`)).toBeEnabled()
    expect(screen.getByLabelText(`${ar.courses.levels.moveUp}: BEG`)).toBeDisabled()
    expect(screen.getByLabelText(`${ar.courses.levels.moveDown}: ADV`)).toBeDisabled()
  })

  it('creates a level through the modal (POST with the normalised body) and appends the server row', async () => {
    const created = makeLevel({ id: '0193a000-0000-7000-8000-00000000b009', code: 'PRO', name: { ar: 'محترف' }, sortOrder: 3, courseCount: 0 })
    const { calls } = mockLevelsApi(THREE_LEVELS(), () => jsonResponse(201, created))
    renderManager()
    await screen.findByText('INT')

    fireEvent.click(screen.getByText(ar.courses.levels.add).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.levels.createTitle)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.levels.fields.code), 'pro')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.levels.fields.nameAr), 'محترف')
    fireEvent.click(within(dialog).getByText(ar.courses.levels.create).closest('button')!)

    expect(await screen.findByText('PRO')).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'POST', url: '/api/levels', body: { code: 'PRO', name: { ar: 'محترف' } } }])
    expect(bodyRows()).toHaveLength(4)
    expect(await screen.findByText('تم إنشاء المستوى «محترف»')).toBeInTheDocument()
  })

  it('edits with the smallest PATCH, and sends nothing when the form did not change', async () => {
    const levels = THREE_LEVELS()
    const { calls } = mockLevelsApi(levels, (_method, _url, body) => jsonResponse(200, { ...levels[1]!, ...(body as object), updatedAt: '2026-11-02T12:00:00.000Z' }))
    renderManager()
    await screen.findByText('INT')

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: INT`))
    let dialog = (await screen.findByText('تعديل المستوى «متوسط»')).closest('[role="dialog"]') as HTMLElement
    const english = within(dialog).getByLabelText(ar.courses.levels.fields.nameEn)
    await userEvent.clear(english)
    await userEvent.type(english, 'Mid')
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.courses.levels.saved)).toBeInTheDocument()
    expect(writesOf(calls)).toEqual([{ method: 'PATCH', url: `/api/levels/${LEVEL_IDS[1]}`, body: { name: { ar: 'متوسط', en: 'Mid' } } }])

    fireEvent.click(screen.getByLabelText(`${ar.common.edit}: ADV`))
    dialog = (await screen.findByText('تعديل المستوى «متقدم»')).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.courses.levels.nothingChanged)).toBeInTheDocument()
    expect(writesOf(calls)).toHaveLength(1)
  })

  it('moves a level down by sending the complete new order and shows the order the server returns', async () => {
    const [beg, int, adv] = THREE_LEVELS()
    const { calls } = mockLevelsApi([beg!, int!, adv!], () => jsonResponse(200, { items: [int!, beg!, adv!] }))
    renderManager()
    await screen.findByText('INT')

    fireEvent.click(screen.getByLabelText(`${ar.courses.levels.moveDown}: BEG`))
    await waitFor(() => expect(writesOf(calls)).toEqual([{ method: 'PUT', url: '/api/levels/order', body: { levelIds: [LEVEL_IDS[1], LEVEL_IDS[0], LEVEL_IDS[2]] } }]))
    await waitFor(() => expect(bodyRows().map((row) => within(row).getByText(/^(BEG|INT|ADV)$/).textContent)).toEqual(['INT', 'BEG', 'ADV']))
  })

  it('deletes an unused level after confirmation and drops its row', async () => {
    const { calls } = mockLevelsApi(THREE_LEVELS(), () => jsonResponse(204))
    renderManager()
    await screen.findByText('INT')

    fireEvent.click(screen.getByLabelText(`${ar.courses.levels.delete}: INT`))
    const popup = (await screen.findByText('حذف المستوى «متوسط» نهائياً؟')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(ar.courses.levels.delete).closest('button')!)

    await waitFor(() => expect(screen.queryByText('INT')).not.toBeInTheDocument())
    expect(writesOf(calls)).toEqual([{ method: 'DELETE', url: `/api/levels/${LEVEL_IDS[1]}`, body: undefined }])
    expect(await screen.findByText(ar.courses.levels.deleted)).toBeInTheDocument()
  })

  it('shows the level_in_use refusal with its count when the local count was stale, then reloads the list (AC2)', async () => {
    const { calls, state } = mockLevelsApi(THREE_LEVELS(), () => jsonResponse(409, { statusCode: 409, code: 'level_in_use', courseCount: 2, message: 'in use' }))
    renderManager()
    await screen.findByText('INT')
    state.current = THREE_LEVELS().map((level) => (level.code === 'INT' ? { ...level, courseCount: 2 } : level))

    fireEvent.click(screen.getByLabelText(`${ar.courses.levels.delete}: INT`))
    const popup = (await screen.findByText('حذف المستوى «متوسط» نهائياً؟')).closest('.ant-popover') as HTMLElement
    fireEvent.click(within(popup).getByText(ar.courses.levels.delete).closest('button')!)

    expect(await screen.findByText('لا يُحذف هذا المستوى: تستخدمه 2 دورة. عطّله بدلاً من ذلك.')).toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText(`${ar.courses.levels.delete}: INT`)).toBeDisabled())
  })
})
