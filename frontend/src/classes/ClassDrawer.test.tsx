import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import { ar } from '../i18n/ar'
import { CLASS_ID, CLASS_MANAGER_PERMISSIONS, CLASS_READER_PERMISSIONS, TEACHER_IDS, makeClass } from '../test/classes'
import { ROSTER_MANAGER_PERMISSIONS, ROSTER_TEACHER_PERMISSIONS, makeEnrollment, makeEnrollmentList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { canReadRoster } from '../enrollments/enrollments.status'
import { ClassDrawer } from './ClassDrawer'

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET returns `detail()` (re-read on every call), writes answer with `writes[method]`. */
function mockClassApi(detail: () => AcademyClass, writes: Partial<Record<string, Response>> = {}) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return jsonResponse(200, detail())
    return writes[method] ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderDrawer(permissions: string[], userId = 'user-1') {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={onDeleted} />, {
    auth: makeAuth({ user: makeUser({ id: userId, permissions }) }),
    route: '/classes',
  })
  return { onUpdated, onDeleted, onClose }
}

async function chooseAction(label: string) {
  fireEvent.click(screen.getByText(ar.classes.actions.menu).closest('button')!)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

function dialogOf(hint: string): HTMLElement {
  return screen.getByText(hint).closest('[role="dialog"]') as HTMLElement
}

describe('ClassDrawer', () => {
  it('shows a teacher the class read-only: details, course, seats, no edit button and no actions menu', async () => {
    mockClassApi(() => makeClass({ enrolledCount: 7, notes: 'فصل مسائي' }))
    renderDrawer(CLASS_READER_PERMISSIONS)

    expect(await screen.findByText('فصل مسائي')).toBeInTheDocument()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByText('7 / 20')).toBeInTheDocument()
    expect(screen.getByText(ar.labels.planned)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.classes.actions.menu)).not.toBeInTheDocument()
  })

  it('says "not found or not assigned to you" when the server answers 404', async () => {
    mockFetch(() => jsonResponse(404, { statusCode: 404, code: 'class_not_found', classId: CLASS_ID, message: 'No class' }))
    renderDrawer(CLASS_READER_PERMISSIONS)
    expect(await screen.findByText(ar.classes.errors.class_not_found)).toBeInTheDocument()
  })

  it('edits with the smallest PATCH and hands the saved class back', async () => {
    const calls = mockClassApi(() => makeClass(), { PATCH: jsonResponse(200, makeClass({ capacity: 25, notes: 'مسائي', updatedAt: '2026-11-04T10:00:00.000Z' })) })
    const { onUpdated } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const capacity = await screen.findByLabelText(ar.classes.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '25')
    await userEvent.type(screen.getByLabelText(ar.classes.fields.notes), ' مسائي ')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/classes/${CLASS_ID}`, body: { capacity: 25, notes: 'مسائي' } }])
    expect(await screen.findByText(ar.classes.drawer.saved)).toBeInTheDocument()
  })

  it('refuses locally a capacity below the active enrollments, and sends nothing when nothing changed', async () => {
    const calls = mockClassApi(() => makeClass({ status: 'open', enrolledCount: 8 }))
    renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const capacity = await screen.findByLabelText(ar.classes.fields.capacity)
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '5')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText('السعة أقل من عدد المسجّلين حالياً (8)')).toBeInTheDocument()

    await userEvent.clear(capacity)
    await userEvent.type(capacity, '20')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.classes.drawer.nothingChanged)).toBeInTheDocument()
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('cancels a running class with the reason, warns about the active enrollments, and hands the cancelled class back', async () => {
    const running = makeClass({ status: 'running', enrolledCount: 4 })
    const calls = mockClassApi(() => running, { POST: jsonResponse(200, makeClass({ status: 'cancelled', enrolledCount: 0 })) })
    const { onUpdated } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    await chooseAction(ar.classes.actions.cancel)
    const dialog = dialogOf(ar.classes.confirm.cancel)
    expect(within(dialog).getByText('سيُلغى تسجيل 4 طالب نشط.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.classes.confirm.reason), ' لم يكتمل العدد ')
    fireEvent.click(within(dialog).getByText(ar.classes.actions.cancel, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', url: `/api/classes/${CLASS_ID}/status`, body: { action: 'cancel', reason: 'لم يكتمل العدد' } },
    ])
    expect(await screen.findByText(ar.classes.done.cancel)).toBeInTheDocument()
  })

  it('offers open, cancel and delete for a planned class; delete sends DELETE and closes the drawer', async () => {
    const calls = mockClassApi(() => makeClass(), { DELETE: jsonResponse(204) })
    const { onDeleted, onClose } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.classes.actions.menu).closest('button')!)
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([ar.classes.actions.open, ar.classes.actions.cancel, ar.classes.actions.delete])
    fireEvent.click(within(items[2]!).getByText(ar.classes.actions.delete))

    const dialog = dialogOf(ar.classes.confirm.delete)
    expect(within(dialog).queryByLabelText(ar.classes.confirm.reason)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.classes.actions.delete, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(CLASS_ID))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([{ method: 'DELETE', url: `/api/classes/${CLASS_ID}`, body: undefined }])
  })

  it('shows the students tab to an enrollment manager and to the assigned teacher only (J-F04 — mirror of the roster rule)', async () => {
    const hasAll = (keys: string[]) => (key: string) => keys.includes(key)
    const cls = makeClass({ status: 'open', enrolledCount: 3 })
    expect(canReadRoster(hasAll(ROSTER_MANAGER_PERMISSIONS), cls, 'someone-else')).toBe(true)
    expect(canReadRoster(hasAll(ROSTER_TEACHER_PERMISSIONS), cls, TEACHER_IDS[0])).toBe(true)
    expect(canReadRoster(hasAll(ROSTER_TEACHER_PERMISSIONS), cls, 'someone-else')).toBe(false)
    // `enrollments.manage` without `enrollments.read` would get 403 on the list — no tab.
    expect(canReadRoster(hasAll(['classes.read', 'enrollments.manage']), cls, 'someone-else')).toBe(false)
    expect(canReadRoster(hasAll(CLASS_READER_PERMISSIONS), cls, TEACHER_IDS[0])).toBe(false)

    mockFetch((url) => (url.endsWith('/enrollments?limit=50') ? jsonResponse(200, makeEnrollmentList([makeEnrollment()])) : jsonResponse(200, cls)))
    const { unmount } = renderWithProviders(<ClassDrawer classId={CLASS_ID} onClose={vi.fn()} onUpdated={vi.fn()} onDeleted={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ id: TEACHER_IDS[0], permissions: ROSTER_TEACHER_PERMISSIONS }) }),
      route: '/classes',
    })
    await screen.findByText('PY-101-A')
    fireEvent.click(screen.getByText('الطلاب (3)'))
    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    unmount()

    renderDrawer(CLASS_READER_PERMISSIONS, 'someone-else')
    await screen.findByText('PY-101-A')
    expect(screen.queryByText('الطلاب (3)')).not.toBeInTheDocument()
  })

  it('closes the dialog on invalid_transition, shows the message and re-reads the class, whose menu then offers what is valid now (PR #26 note 3)', async () => {
    // The class was opened elsewhere: the drawer still shows it planned, the server holds it open.
    let detail = makeClass()
    const calls = mockClassApi(() => detail, {
      POST: jsonResponse(409, { statusCode: 409, code: 'invalid_transition', from: 'open', action: 'open', allowed: ['start', 'cancel'], message: 'nope' }),
    })
    const { onUpdated } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const reads = () => calls.filter((call) => call.method === 'GET').length
    const before = reads()
    detail = makeClass({ status: 'open' })

    await chooseAction(ar.classes.actions.open)
    const dialog = dialogOf(ar.classes.confirm.open)
    fireEvent.click(within(dialog).getByText(ar.classes.actions.open, { selector: 'button span' }).closest('button')!)

    const shown = await screen.findByText(ar.classes.errors.invalid_transition)
    expect(shown.closest('[role="dialog"]')).toBeNull()
    expect(screen.queryByText(ar.classes.confirm.open)).not.toBeInTheDocument()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
    expect(await screen.findByText(ar.labels.open)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classes.actions.menu).closest('button')!)
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([ar.classes.actions.start, ar.classes.actions.cancel])
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('closes the dialog on class_not_deletable too, with the count, re-reads the class and keeps the drawer open', async () => {
    const calls = mockClassApi(() => makeClass(), {
      DELETE: jsonResponse(409, { statusCode: 409, code: 'class_not_deletable', status: 'planned', enrollmentCount: 2, message: 'no' }),
    })
    const { onDeleted, onClose } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const reads = () => calls.filter((call) => call.method === 'GET').length
    const before = reads()

    await chooseAction(ar.classes.actions.delete)
    const dialog = dialogOf(ar.classes.confirm.delete)
    fireEvent.click(within(dialog).getByText(ar.classes.actions.delete, { selector: 'button span' }).closest('button')!)

    const shown = await screen.findByText(ar.classes.errors.class_not_deletable.replace('{{enrollmentCount}}', '2'))
    expect(shown.closest('[role="dialog"]')).toBeNull()
    expect(screen.queryByText(ar.classes.confirm.delete)).not.toBeInTheDocument()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
  })

  it('keeps the dialog open on a network failure or a server error, so the same action can be retried', async () => {
    const answers: Array<() => Response> = [
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => jsonResponse(503, { statusCode: 503, message: 'down' }),
      () => jsonResponse(200, makeClass({ status: 'open' })),
    ]
    const calls: Call[] = []
    mockFetch((url, init) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'GET') return jsonResponse(200, makeClass())
      return answers.shift()!()
    })
    const { onUpdated } = renderDrawer(CLASS_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const reads = () => calls.filter((call) => call.method === 'GET').length
    const before = reads()

    await chooseAction(ar.classes.actions.open)
    const dialog = dialogOf(ar.classes.confirm.open)
    const confirm = () => fireEvent.click(within(dialog).getByText(ar.classes.actions.open, { selector: 'button span' }).closest('button')!)
    await userEvent.type(within(dialog).getByLabelText(ar.classes.confirm.reason), 'بداية الفصل')

    confirm()
    expect(await within(dialog).findByText(ar.login.errors.network)).toBeInTheDocument()
    // The reason the user typed stays for the retry.
    expect(within(dialog).getByLabelText(ar.classes.confirm.reason)).toHaveValue('بداية الفصل')
    await waitFor(() => expect(within(dialog).getByText(ar.classes.actions.open, { selector: 'button span' }).closest('button')).not.toHaveClass('ant-btn-loading'))

    confirm()
    expect(await within(dialog).findByText(ar.login.errors.server)).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText(ar.classes.actions.open, { selector: 'button span' }).closest('button')).not.toHaveClass('ant-btn-loading'))

    confirm()
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(reads()).toBe(before)
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { action: 'open', reason: 'بداية الفصل' },
      { action: 'open', reason: 'بداية الفصل' },
      { action: 'open', reason: 'بداية الفصل' },
    ])
    expect(await screen.findByText(ar.classes.done.open)).toBeInTheDocument()
  })
})
