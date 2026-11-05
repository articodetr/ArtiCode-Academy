import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { Enrollment } from '../api/enrollments'
import { ar } from '../i18n/ar'
import { CLASS_ID, makeClass } from '../test/classes'
import { ENROLLMENT_IDS, ROSTER_MANAGER_PERMISSIONS, ROSTER_TEACHER_PERMISSIONS, STUDENT_IDS, makeEnrollment, makeEnrollmentList, makeEnrollmentStudent, makeStudentCandidate } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeUserList } from '../test/users'
import { ClassEnrollmentsTab } from './ClassEnrollmentsTab'

interface Call {
  method: string
  url: string
  body: unknown
}

const omar = makeEnrollment()
const sara = makeEnrollment({
  id: ENROLLMENT_IDS[1],
  status: 'withdrawn',
  withdrawnAt: '2026-11-05T08:00:00.000Z',
  withdrawalReason: 'سفر العائلة',
  student: makeEnrollmentStudent({ id: STUDENT_IDS[2], fullName: 'سارة أحمد', fullNameLatin: 'Sara Ahmed', email: 'sara@test.local', username: 'sara' }),
})
const layla = makeStudentCandidate()
const suspended = makeStudentCandidate({ id: '0193c000-0000-7000-8000-00000000b009', fullName: 'موقوف', status: 'suspended' })
const omarCandidate = makeStudentCandidate({ id: STUDENT_IDS[0], fullName: 'عمر خالد', roles: ['student'] })

/**
 * Serves the roster (`roster()` re-read on every GET, recording its queries), the
 * student search (Layla, a suspended student, Omar who is already enrolled) and
 * answers the writes with `writes[method]`.
 */
function mockRosterApi(roster: () => Enrollment[] | Response, writes: Partial<Record<'POST', Response | (() => Response)>> = {}) {
  const calls: Call[] = []
  const rosterQueries: URLSearchParams[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (parsed.pathname === '/api/users') return jsonResponse(200, makeUserList([layla, suspended, omarCandidate]))
    if (method === 'GET') {
      rosterQueries.push(parsed.searchParams)
      const result = roster()
      return result instanceof Response ? result : jsonResponse(200, makeEnrollmentList(result))
    }
    const write = writes[method as 'POST']
    return (typeof write === 'function' ? write() : write) ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { calls, rosterQueries, writes: () => calls.filter((call) => call.method !== 'GET') }
}

function renderTab(permissions: string[], cls: AcademyClass = makeClass({ status: 'open', enrolledCount: 1 })) {
  const onClassChanged = vi.fn()
  const onStale = vi.fn()
  renderWithProviders(<ClassEnrollmentsTab cls={cls} onClassChanged={onClassChanged} onStale={onStale} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/classes',
  })
  return { onClassChanged, onStale }
}

function option(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.ant-select-item-option-content' }).closest('.ant-select-item-option') as HTMLElement
}

async function pickStudent(name: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: ar.classes.enrollments.add }))
  await waitFor(() => expect(option(name)).toBeInTheDocument())
  fireEvent.click(screen.getByText(name, { selector: '.ant-select-item-option-content' }))
}

async function chooseRowAction(student: string, label: string) {
  fireEvent.click(screen.getByLabelText(`${ar.classes.enrollments.actions.menu}: ${student}`))
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

function dialogOf(hint: string): HTMLElement {
  return screen.getByText(hint, { exact: false }).closest('[role="dialog"]') as HTMLElement
}

describe('ClassEnrollmentsTab', () => {
  it('shows an assigned teacher the roster read-only: names and statuses, no contact column, no reason, no enroll form, no actions', async () => {
    const api = mockRosterApi(() => [omar, { ...sara, withdrawalReason: null, student: { ...sara.student, email: null, username: null, phone: null } }])
    renderTab(ROSTER_TEACHER_PERMISSIONS)

    expect(await screen.findByText('عمر خالد')).toBeInTheDocument()
    expect(screen.getByText('سارة أحمد')).toBeInTheDocument()
    expect(screen.getByText(ar.labels.active)).toBeInTheDocument()
    expect(screen.getByText(ar.labels.withdrawn)).toBeInTheDocument()
    expect(screen.getByText('1 / 20')).toBeInTheDocument()
    expect(screen.getByText(ar.classes.enrollments.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText('omar@test.local')).not.toBeInTheDocument()
    expect(screen.queryAllByText(ar.classes.enrollments.columns.reason)).toHaveLength(0)
    expect(screen.queryByRole('combobox', { name: ar.classes.enrollments.add })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`${ar.classes.enrollments.actions.menu}: عمر خالد`)).not.toBeInTheDocument()
    expect(api.rosterQueries).toHaveLength(1)
    expect(Object.fromEntries(api.rosterQueries[0]!)).toEqual({ limit: '50' })
  })

  it('says "not found or not assigned to you" when the server refuses the roster with 404', async () => {
    mockRosterApi(() => jsonResponse(404, { statusCode: 404, code: 'class_not_found', classId: CLASS_ID, message: 'No class' }))
    renderTab(ROSTER_TEACHER_PERMISSIONS)
    expect(await screen.findByText(ar.classes.errors.class_not_found)).toBeInTheDocument()
  })

  it('enrolls a student found by the search in ONE POST, reloads the roster, moves the count up and resets the search', async () => {
    let rows = [omar]
    const created = makeEnrollment({ id: ENROLLMENT_IDS[2], student: makeEnrollmentStudent({ id: layla.id, fullName: layla.fullName, email: layla.email }) })
    const api = mockRosterApi(
      () => rows,
      {
        POST: () => {
          rows = [omar, created]
          return jsonResponse(201, created)
        },
      },
    )
    const { onClassChanged } = renderTab(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('عمر خالد')
    // Contact details for users.read_contact, the withdrawal-reason column for enrollments.manage.
    expect(screen.getByText('omar@test.local')).toBeInTheDocument()
    expect(screen.getAllByText(ar.classes.enrollments.columns.reason).length).toBeGreaterThan(0)

    expect(screen.getByText(ar.classes.enrollments.enroll).closest('button')).toBeDisabled()
    await pickStudent('ليلى سعيد')
    // Mirrors of the server rules: a suspended account and an already enrolled student are offered disabled.
    expect(option('موقوف')).toHaveClass('ant-select-item-option-disabled')
    expect(option('عمر خالد')).toHaveClass('ant-select-item-option-disabled')
    expect(Object.fromEntries(new URL(api.calls.find((call) => call.url.startsWith('/api/users'))!.url, 'http://localhost').searchParams)).toEqual({ role: 'student', limit: '10' })

    fireEvent.click(screen.getByText(ar.classes.enrollments.enroll).closest('button')!)
    await waitFor(() => expect(onClassChanged).toHaveBeenCalledTimes(1))
    expect(api.writes()).toEqual([{ method: 'POST', url: `/api/classes/${CLASS_ID}/enrollments`, body: { studentId: layla.id } }])
    expect(onClassChanged).toHaveBeenCalledWith(expect.objectContaining({ id: CLASS_ID, enrolledCount: 2 }))
    expect(await screen.findByText('تم تسجيل «ليلى سعيد» في الفصل')).toBeInTheDocument()
    expect(await within(screen.getByRole('table')).findByText('ليلى سعيد')).toBeInTheDocument()
    expect(api.rosterQueries).toHaveLength(2)
    expect(screen.getByText(ar.classes.enrollments.pickStudent)).toBeInTheDocument()
    expect(screen.getByText(ar.classes.enrollments.enroll).closest('button')).toBeDisabled()
  })

  it('shows class_full with the numbers, re-reads the class and keeps the count; already_enrolled reloads the roster', async () => {
    const api = mockRosterApi(() => [omar], { POST: jsonResponse(409, { statusCode: 409, code: 'class_full', capacity: 20, enrolledCount: 20, message: 'full' }) })
    const { onClassChanged, onStale } = renderTab(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('عمر خالد')

    await pickStudent('ليلى سعيد')
    fireEvent.click(screen.getByText(ar.classes.enrollments.enroll).closest('button')!)
    const alert = await screen.findByText('الفصل ممتلئ (20 / 20)؛ لا مقعد متاحاً.')
    expect(alert).toBeInTheDocument()
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(onClassChanged).not.toHaveBeenCalled()
    expect(api.rosterQueries).toHaveLength(1)

    mockRosterApi(() => [omar], { POST: jsonResponse(409, { statusCode: 409, code: 'already_enrolled', enrollmentId: ENROLLMENT_IDS[1], status: 'withdrawn', message: 'dup' }) })
    fireEvent.click(screen.getByText(ar.classes.enrollments.enroll).closest('button')!)
    expect(await screen.findByText('للطالب تسجيل سابق في هذا الفصل (منسحب)؛ أعد تفعيله من القائمة بدلاً من تسجيله مجدداً.')).toBeInTheDocument()
  })

  it('offers no enroll form for a planned or a full class, and sends nothing', async () => {
    const api = mockRosterApi(() => [])
    const { unmount } = renderWithProviders(<ClassEnrollmentsTab cls={makeClass({ status: 'planned' })} onClassChanged={vi.fn()} onStale={vi.fn()} />, {
      auth: makeAuth({ user: makeUser({ permissions: ROSTER_MANAGER_PERMISSIONS }) }),
      route: '/classes',
    })
    expect(await screen.findByText('التسجيل ممكن في فصل مفتوح أو جارٍ فقط (الحالة الحالية: مخطَّط).')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: ar.classes.enrollments.add })).not.toBeInTheDocument()
    expect(await screen.findByText(ar.classes.enrollments.empty)).toBeInTheDocument()
    unmount()

    renderTab(ROSTER_MANAGER_PERMISSIONS, makeClass({ status: 'running', capacity: 2, enrolledCount: 2 }))
    expect(await screen.findByText('الفصل ممتلئ (2 / 2)؛ لا يمكن تسجيل طالب جديد قبل توفر مقعد.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: ar.classes.enrollments.add })).not.toBeInTheDocument()
    expect(api.writes()).toEqual([])
    expect(api.calls.some((call) => call.url.startsWith('/api/users'))).toBe(false)
  })

  it('withdraws with the reason in ONE POST, replaces the row without re-reading, and moves the count down', async () => {
    const withdrawn = makeEnrollment({ status: 'withdrawn', withdrawnAt: '2026-11-05T10:00:00.000Z', withdrawalReason: 'انتقل' })
    const api = mockRosterApi(() => [omar], { POST: jsonResponse(200, withdrawn) })
    const { onClassChanged } = renderTab(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('عمر خالد')

    await chooseRowAction('عمر خالد', ar.classes.enrollments.actions.withdraw)
    const dialog = dialogOf(ar.classes.enrollments.confirm.withdraw)
    await userEvent.type(within(dialog).getByLabelText(ar.classes.enrollments.confirm.reason), ' انتقل ')
    fireEvent.click(within(dialog).getByText(ar.classes.enrollments.actions.withdraw, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onClassChanged).toHaveBeenCalledTimes(1))
    expect(api.writes()).toEqual([{ method: 'POST', url: `/api/enrollments/${ENROLLMENT_IDS[0]}/status`, body: { action: 'withdraw', reason: 'انتقل' } }])
    expect(onClassChanged).toHaveBeenCalledWith(expect.objectContaining({ enrolledCount: 0 }))
    expect(await screen.findByText(ar.classes.enrollments.done.withdraw)).toBeInTheDocument()
    expect(await screen.findByText('انتقل')).toBeInTheDocument()
    expect(screen.getByText(ar.labels.withdrawn)).toBeInTheDocument()
    expect(api.rosterQueries).toHaveLength(1)
  })

  it('offers reactivate to a withdrawn student, warns when the class is full, and sends the action without a reason', async () => {
    const reactivated = makeEnrollment({ ...sara, status: 'active', withdrawnAt: null, withdrawalReason: null, activatedAt: '2026-11-05T11:00:00.000Z' })
    const api = mockRosterApi(() => [sara], { POST: jsonResponse(200, reactivated) })
    const { onClassChanged } = renderTab(ROSTER_MANAGER_PERMISSIONS, makeClass({ status: 'running', capacity: 1, enrolledCount: 1 }))
    await screen.findByText('سارة أحمد')

    fireEvent.click(screen.getByLabelText(`${ar.classes.enrollments.actions.menu}: سارة أحمد`))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([ar.classes.enrollments.actions.reactivate])
    fireEvent.click(within(items[0]!).getByText(ar.classes.enrollments.actions.reactivate))

    const dialog = dialogOf(ar.classes.enrollments.confirm.reactivate)
    expect(within(dialog).getByText('الفصل ممتلئ حالياً (1 / 1)؛ سيرفض الخادم إعادة التفعيل حتى يتوفر مقعد.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.classes.enrollments.actions.reactivate, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onClassChanged).toHaveBeenCalledWith(expect.objectContaining({ enrolledCount: 2 })))
    expect(api.writes()).toEqual([{ method: 'POST', url: `/api/enrollments/${ENROLLMENT_IDS[1]}/status`, body: { action: 'reactivate' } }])
  })

  it('shows invalid_transition in the dialog and reloads the roster', async () => {
    const api = mockRosterApi(() => [omar], {
      POST: jsonResponse(409, { statusCode: 409, code: 'invalid_transition', from: 'withdrawn', action: 'complete', allowed: ['reactivate'], message: 'nope' }),
    })
    const { onClassChanged } = renderTab(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('عمر خالد')

    await chooseRowAction('عمر خالد', ar.classes.enrollments.actions.complete)
    const dialog = dialogOf(ar.classes.enrollments.confirm.complete)
    fireEvent.click(within(dialog).getByText(ar.classes.enrollments.actions.complete, { selector: 'button span' }).closest('button')!)

    expect(await within(dialog).findByText(ar.classes.errors.invalid_transition)).toBeInTheDocument()
    await waitFor(() => expect(api.rosterQueries).toHaveLength(2))
    expect(onClassChanged).not.toHaveBeenCalled()
  })

  it('filters by status on the server and by name locally without a request', async () => {
    const api = mockRosterApi(() => [omar, sara])
    renderTab(ROSTER_MANAGER_PERMISSIONS)
    await screen.findByText('سارة أحمد')

    await userEvent.type(screen.getByLabelText(ar.classes.enrollments.searchLabel), 'sara')
    await waitFor(() => expect(screen.queryByText('عمر خالد')).not.toBeInTheDocument())
    expect(screen.getByText('سارة أحمد')).toBeInTheDocument()
    expect(api.rosterQueries).toHaveLength(1)

    await userEvent.clear(screen.getByLabelText(ar.classes.enrollments.searchLabel))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.common.status }))
    fireEvent.click(await screen.findByText(ar.labels.withdrawn, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.rosterQueries).toHaveLength(2))
    expect(Object.fromEntries(api.rosterQueries[1]!)).toEqual({ status: 'withdrawn', limit: '50' })
  })
})
