import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AcademySchedule, MySchedule } from '../api/schedule'
import { ar } from '../i18n/ar'
import { makeClass, makeClassList, makeTeacherCandidate } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { SCHEDULE_MANAGER_PERMISSIONS, SCHEDULE_READER_PERMISSIONS, SCHEDULE_STAFF_PERMISSIONS, makeAcademySchedule, makeMyItem, makeMySchedule, makeRoom, makeRoomList, makeSlot } from '../test/schedule'
import { makeUserList } from '../test/users'
import { formatDay } from '../users/users.format'
import { SchedulePage } from './SchedulePage'

/** Serves both schedule readings (recording their queries) and the three pickers. */
function mockScheduleApi(academy: AcademySchedule | Response, mine: MySchedule | Response) {
  const academyQueries: URLSearchParams[] = []
  const mineQueries: URLSearchParams[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/schedule') {
      academyQueries.push(parsed.searchParams)
      return academy instanceof Response ? academy : jsonResponse(200, academy)
    }
    if (parsed.pathname === '/api/me/schedule') {
      mineQueries.push(parsed.searchParams)
      return mine instanceof Response ? mine : jsonResponse(200, mine)
    }
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass()]))
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom(), makeRoom({ id: 'room-2', code: 'HALL', name: null, isActive: false })]))
    if (parsed.pathname === '/api/users') return jsonResponse(200, makeUserList([makeTeacherCandidate()]))
    return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
  })
  return { academyQueries, mineQueries }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<SchedulePage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/schedule' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

const sunday = makeSlot()
const tuesday = makeSlot({ id: 'slot-2', weekday: 2, startTime: '12:00', endTime: '13:00', room: null, teacher: null, effectiveTo: '2026-12-20', timeZone: 'Europe/Istanbul' })

describe('SchedulePage', () => {
  it('shows a holder of schedule.read alone «my schedule» without tabs: day, time, class, room, teacher, relation and the child', async () => {
    const api = mockScheduleApi(
      makeAcademySchedule([]),
      makeMySchedule([
        makeMyItem(),
        makeMyItem({ id: 'slot-2', weekday: 2, startTime: '12:00', endTime: '13:00', relation: 'child', student: { id: 'k-1', fullName: 'أحمد الصغير', displayName: null }, room: null, teacher: null }),
        makeMyItem({ id: 'slot-3', weekday: 2, startTime: '15:00', endTime: '16:00', relation: 'teacher', student: null }),
      ]),
    )
    renderPage(SCHEDULE_READER_PERMISSIONS)

    expect(await screen.findAllByText('PY-101-A')).toHaveLength(3)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(api.academyQueries).toHaveLength(0)
    expect(Object.fromEntries(api.mineQueries[0]!)).toEqual({})
    const rows = bodyRows()
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText(ar.days.sun)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('10:00 – 11:30')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Asia/Riyadh')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.schedule.site)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.schedule.relation.self)).toBeInTheDocument()
    // The second day label shows once, on its first row.
    expect(within(rows[1]!).getByText(ar.days.tue)).toBeInTheDocument()
    expect(within(rows[2]!).queryByText(ar.days.tue)).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.schedule.relation.child)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('أحمد الصغير')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.schedule.noRoom)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.schedule.noTeacher)).toBeInTheDocument()
    expect(within(rows[2]!).getByText(ar.schedule.relation.teacher)).toBeInTheDocument()
    expect(screen.getByText(ar.schedule.effectiveOn.replace('{{date}}', formatDay('2026-11-08', 'ar')))).toBeInTheDocument()
  })

  it('tells a user without any slot that the date is empty, and re-reads «my schedule» for another date', async () => {
    const api = mockScheduleApi(makeAcademySchedule([]), makeMySchedule([]))
    renderPage(SCHEDULE_READER_PERMISSIONS)
    expect(await screen.findByText(ar.schedule.empty.mine)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ar.schedule.filters.date), { target: { value: '2026-12-01' } })
    await waitFor(() => expect(api.mineQueries.at(-1)?.get('on')).toBe('2026-12-01'))
    fireEvent.change(screen.getByLabelText(ar.schedule.filters.date), { target: { value: '' } })
    await waitFor(() => expect(api.mineQueries.at(-1)?.get('on')).toBeNull())
    expect(api.mineQueries).toHaveLength(3)
  })

  it('gives a manager both tabs: the academy view with its filters re-queries /api/schedule, «my schedule» loads on its tab', async () => {
    const api = mockScheduleApi(makeAcademySchedule([sunday, tuesday]), makeMySchedule([makeMyItem()]))
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)

    expect(await screen.findByRole('tab', { name: ar.schedule.tabs.academy })).toBeInTheDocument()
    expect(await screen.findByText('10:00 – 11:30')).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText(ar.schedule.openEnded, { exact: false })).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(ar.schedule.openEnded, { exact: false })).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText('Europe/Istanbul')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.schedule.noRoom)).toBeInTheDocument()
    expect(screen.queryByText(ar.schedule.relation.self)).not.toBeInTheDocument()
    expect(api.mineQueries).toHaveLength(0)
    expect(Object.fromEntries(api.academyQueries[0]!)).toEqual({})

    // Filters: date, class, teacher (users.read) and room.
    fireEvent.change(screen.getByLabelText(ar.schedule.filters.date), { target: { value: '2026-11-15' } })
    await waitFor(() => expect(api.academyQueries.at(-1)?.get('on')).toBe('2026-11-15'))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.schedule.columns.class }))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.academyQueries.at(-1)?.get('classId')).toBe(makeClass().id))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.schedule.columns.teacher }))
    fireEvent.click(await screen.findByText('منى المساعدة', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.academyQueries.at(-1)?.get('teacherUserId')).toBe(makeTeacherCandidate().id))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.schedule.columns.room }))
    fireEvent.click(await screen.findByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.academyQueries.at(-1)?.get('roomId')).toBe(makeRoom().id))
    expect(api.academyQueries.at(-1)?.get('on')).toBe('2026-11-15')
    expect(api.academyQueries.at(-1)?.get('classId')).toBe(makeClass().id)

    fireEvent.click(screen.getByRole('tab', { name: ar.schedule.tabs.mine }))
    expect(await screen.findByText(ar.schedule.relation.self)).toBeInTheDocument()
    expect(api.mineQueries).toHaveLength(1)
  })

  it('opens the academy view to staff through classes.manage, shows a permission error from the server, and refuses a user without any key', async () => {
    mockScheduleApi(jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['schedule.manage', 'classes.manage'] }), makeMySchedule([]))
    const { unmount } = renderPage(SCHEDULE_STAFF_PERMISSIONS)
    expect(await screen.findByRole('tab', { name: ar.schedule.tabs.academy })).toBeInTheDocument()
    expect(await screen.findByText(ar.schedule.errors.permission_denied.replace('{{list}}', '(schedule.manage, classes.manage)'))).toBeInTheDocument()
    unmount()

    renderPage([])
    expect(screen.getByText(ar.schedule.noAccess)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
