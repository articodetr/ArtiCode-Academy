import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyScheduleItem, TimetableSlot } from '../api/timetable'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { makeClass, makeClassList, makeTeacherCandidate } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import {
  BRANCH_ID,
  ROOM_ID,
  SCHEDULE_MANAGER_PERMISSIONS,
  SCHEDULE_READER_PERMISSIONS,
  SCHEDULE_STAFF_PERMISSIONS,
  makeAcademySchedule,
  makeBranchOption,
  makeMyItem,
  makeMySchedule,
  makeRoom,
  makeRoomList,
  makeSlot,
  makeTimetableAcademy,
} from '../test/timetable'
import { makeUserList } from '../test/users'
import { formatDate, formatDateRange, formatLongDate } from '../timetable/timetable.format'
import { SchedulePage } from './SchedulePage'

// Sunday 2026-11-08, 10:30 in Riyadh (07:30Z) — the academy's zone in these tests.
const NOW = new Date('2026-11-08T07:30:00Z')
const WEEK = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']

interface ApiOptions {
  academy?: unknown
  slots?: TimetableSlot[]
  mine?: MyScheduleItem[]
  /** Replaces the answer of /api/schedule while it returns a response. */
  schedule?: () => Response | undefined
}

const effectiveOn = (row: { effectiveFrom: string; effectiveTo: string | null }, on: string) => row.effectiveFrom <= on && (row.effectiveTo === null || on <= row.effectiveTo)

/** Serves the calendar's readings like the server (per date, weekday and filters) and records their queries. */
function mockApi(options: ApiOptions = {}) {
  const academyQueries: URLSearchParams[] = []
  const mineQueries: URLSearchParams[] = []
  const fetchMock = mockFetch((raw) => {
    const url = new URL(raw, 'http://localhost')
    const query = url.searchParams
    switch (url.pathname) {
      case '/api/academy':
        return jsonResponse(200, options.academy ?? makeTimetableAcademy({ weekStartsOn: 0, workingDays: [0, 1, 2, 3, 4] }))
      case '/api/schedule': {
        academyQueries.push(query)
        const replaced = options.schedule?.()
        if (replaced) return replaced
        const on = query.get('on')!
        const weekday = Number(query.get('weekday'))
        const roomId = query.get('roomId')
        const slots = (options.slots ?? []).filter((slot) => slot.weekday === weekday && effectiveOn(slot, on) && (!roomId || slot.room?.id === roomId))
        return jsonResponse(200, makeAcademySchedule(slots, on))
      }
      case '/api/me/schedule': {
        mineQueries.push(query)
        const on = query.get('on')!
        return jsonResponse(200, makeMySchedule((options.mine ?? []).filter((item) => effectiveOn(item, on)), on))
      }
      case '/api/branches':
        return jsonResponse(200, { items: [makeBranchOption()] })
      case '/api/rooms':
        return jsonResponse(200, makeRoomList([makeRoom()]))
      case '/api/classes':
        return jsonResponse(200, makeClassList([makeClass()]))
      case '/api/users':
        return jsonResponse(200, makeUserList([makeTeacherCandidate()]))
      default:
        return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
    }
  })
  return { academyQueries, mineQueries, fetchMock }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<SchedulePage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/schedule' })
}

const grid = () => screen.getByRole('region', { name: ar.schedule.calendar.grid })
const dates = (queries: URLSearchParams[]) => queries.map((query) => query.get('on'))
const headerLabels = () => Array.from(grid().querySelectorAll('.tt-dayhead')).map((head) => head.getAttribute('aria-label'))
const rangeHeading = () => screen.getByRole('heading', { level: 2 })

/** Opens a filter once it is on screen (the branch filter waits for API-080) and picks an option. */
async function pickOption(comboboxName: string, option: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }))
}

/** A phone-sized viewport (below antd's `md`) for this test; undone after it. */
function stubPhoneViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767.98px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SchedulePage — weekly calendar (J-F08)', () => {
  it('shows a holder of schedule.read alone «my schedule» as a week of cards — one request per shown date, never the academy schedule', async () => {
    const api = mockApi({
      mine: [
        makeMyItem(),
        makeMyItem({ relation: 'child', student: { id: 'k-1', fullName: 'أحمد الصغير', displayName: null } }),
        makeMyItem({ id: 'tuesday', weekday: 2, startTime: '12:00', endTime: '13:00', relation: 'teacher', student: null }),
      ],
    })
    renderPage(SCHEDULE_READER_PERMISSIONS)

    const sunday = await within(await screen.findByRole('region', { name: ar.schedule.calendar.grid })).findByRole('button', { name: /أساسيات بايثون، الفصل PY-101-A، .*من 10:00 إلى 11:30/ })
    // One card for the slot, naming both relations.
    expect(within(sunday).getByText(ar.schedule.relation.self)).toBeInTheDocument()
    expect(within(sunday).getByText('ابني/ابنتي: أحمد الصغير')).toBeInTheDocument()
    expect(within(grid()).getByRole('region', { name: `${formatLongDate('2026-11-10', 'ar')} — عدد الحصص: 1` })).toBeInTheDocument()
    await waitFor(() => expect(dates(api.mineQueries)).toEqual(WEEK))
    expect(api.mineQueries.every((query) => [...query.keys()].join() === 'on')).toBe(true)
    expect(api.academyQueries).toHaveLength(0)
    // No mode switch for a single view; the running slot leads "upcoming".
    expect(screen.queryByText(ar.schedule.tabs.academy)).not.toBeInTheDocument()
    const upcoming = screen.getByRole('region', { name: ar.schedule.upcoming.title })
    expect(within(upcoming).getAllByRole('listitem')[0]).toHaveTextContent(ar.schedule.upcoming.inProgress)
    expect(screen.getByText(ar.schedule.calendar.recurring)).toBeInTheDocument()
  })

  it('opens the academy schedule to a manager — one request per date with its weekday — and switches to «my schedule»', async () => {
    const api = mockApi({ slots: [makeSlot(), makeSlot({ id: 'monday', weekday: 1, startTime: '09:00', endTime: '10:00' })] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)

    expect(await within(await screen.findByRole('region', { name: ar.schedule.calendar.grid })).findByRole('button', { name: /من 09:00 إلى 10:00/ })).toBeInTheDocument()
    await waitFor(() => expect(api.academyQueries).toHaveLength(7))
    expect(api.academyQueries.map((query) => `${query.get('on')}:${query.get('weekday')}`)).toEqual(WEEK.map((date, index) => `${date}:${index}`))
    expect(api.mineQueries).toHaveLength(0)
    // Working days Sunday–Thursday; Sunday is today and selected.
    expect(headerLabels()).toEqual(WEEK.slice(0, 5).map((date) => formatLongDate(date, 'ar')))
    const today = within(grid()).getByRole('button', { name: formatLongDate('2026-11-08', 'ar') })
    expect(today).toHaveAttribute('aria-pressed', 'true')
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(rangeHeading()).toHaveTextContent(formatDateRange('2026-11-08', '2026-11-12', 'ar'))

    fireEvent.click(screen.getByText(ar.schedule.tabs.mine))
    await waitFor(() => expect(dates(api.mineQueries)).toEqual(WEEK))
    expect(screen.queryByRole('combobox', { name: ar.schedule.columns.room })).not.toBeInTheDocument()
  })

  it('filters on the server: the room and the branch travel with every request, and a new branch clears the room', async () => {
    const api = mockApi({ slots: [makeSlot(), makeSlot({ id: 'tuesday', weekday: 2, room: null })] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    await waitFor(() => expect(api.academyQueries).toHaveLength(7))

    const tuesdaySlot = () => within(grid()).queryByLabelText(new RegExp(`^أساسيات بايثون.*${formatLongDate('2026-11-10', 'ar')}`))
    await waitFor(() => expect(tuesdaySlot()).toBeInTheDocument())
    await pickOption(ar.schedule.columns.room, 'LAB-1 — مختبر 1')
    await waitFor(() => expect(api.academyQueries.filter((query) => query.get('roomId') === ROOM_ID)).toHaveLength(7))
    // The server's answer decides: the Tuesday slot has no room, so the room filter drops it.
    await waitFor(() => expect(tuesdaySlot()).not.toBeInTheDocument())

    await pickOption(ar.schedule.filters.branch, ar.schedule.filters.site)
    await waitFor(() => expect(api.academyQueries.filter((query) => query.get('branchId') === 'none')).toHaveLength(7))
    expect(api.academyQueries.at(-1)?.get('roomId')).toBeNull()
  })

  it('shows the filtered weekday alone, asks nothing twice and asks only that day of another week', async () => {
    const api = mockApi({ slots: [makeSlot()] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    await pickOption(ar.schedule.filters.branch, 'IST — فرع إسطنبول')
    await waitFor(() => expect(api.academyQueries.filter((query) => query.get('branchId') === BRANCH_ID)).toHaveLength(7))

    // Tuesday was already read with these filters: nothing is asked again.
    const asked = api.academyQueries.length
    await pickOption(ar.schedule.filters.weekday, ar.days.tue)
    await waitFor(() => expect(headerLabels()).toEqual([formatLongDate('2026-11-10', 'ar')]))
    expect(api.academyQueries).toHaveLength(asked)
    fireEvent.click(screen.getByLabelText(ar.schedule.calendar.nextWeek))
    await waitFor(() => expect(api.academyQueries).toHaveLength(asked + 1))
    expect(api.academyQueries.at(-1)?.toString()).toBe(`on=2026-11-17&branchId=${BRANCH_ID}&weekday=2`)
    expect(headerLabels()).toEqual([formatLongDate('2026-11-17', 'ar')])

    fireEvent.click(screen.getByText(ar.schedule.filters.clear))
    await waitFor(() => expect(headerLabels()).toHaveLength(5))
  })

  it('moves by week and by day, follows a date picked in the month calendar and comes back to today', async () => {
    const api = mockApi({ slots: [makeSlot()] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    await waitFor(() => expect(api.academyQueries).toHaveLength(7))

    fireEvent.click(screen.getByLabelText(ar.schedule.calendar.nextWeek))
    await waitFor(() => expect(dates(api.academyQueries).slice(7)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']))
    expect(rangeHeading()).toHaveTextContent(formatDateRange('2026-11-15', '2026-11-19', 'ar'))

    fireEvent.click(screen.getByText(ar.schedule.calendar.today))
    expect(rangeHeading()).toHaveTextContent(formatDateRange('2026-11-08', '2026-11-12', 'ar'))

    fireEvent.click(screen.getByText(ar.schedule.calendar.dayView))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-08', 'ar'))
    expect(screen.getByRole('region', { name: formatLongDate('2026-11-08', 'ar') })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(ar.schedule.calendar.nextDay))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-09', 'ar'))

    const month = screen.getByRole('region', { name: ar.schedule.month.label })
    fireEvent.click(within(month).getByLabelText(formatLongDate('2026-11-25', 'ar')))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-25', 'ar'))
    await waitFor(() => expect(dates(api.academyQueries)).toContain('2026-11-28'))
  })

  it('shows a server refusal with a retry, then the empty week with its hint', async () => {
    let failing = true
    mockApi({
      schedule: () => (failing ? jsonResponse(403, { statusCode: 403, code: 'permission_denied', message: 'Missing permission', missing: ['schedule.manage', 'classes.manage'] }) : undefined),
    })
    renderPage(SCHEDULE_STAFF_PERMISSIONS)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ar.schedule.calendar.failed)
    expect(alert).toHaveTextContent(ar.schedule.errors.permission_denied.replace('{{list}}', '(schedule.manage, classes.manage)'))
    failing = false
    fireEvent.click(within(alert).getByRole('button', { name: ar.schedule.calendar.retry }))

    expect(await screen.findByText(ar.schedule.calendar.emptyWeek)).toBeInTheDocument()
    expect(screen.getByText(ar.schedule.calendar.emptyHintAcademy)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(ar.schedule.upcoming.empty)).toBeInTheDocument()
  })

  it('refuses a user without any schedule key without calling the server', () => {
    const { fetchMock } = mockApi()
    renderPage([])
    expect(screen.getByText(ar.schedule.noAccess)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: ar.schedule.calendar.grid })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads today in the academy zone, starts the week on its first day and never hides a busy day off', async () => {
    // 01:30 on Sunday 8 November in Riyadh — still Saturday 7 November in UTC.
    vi.setSystemTime(new Date('2026-11-07T22:30:00Z'))
    const api = mockApi({
      academy: makeTimetableAcademy({ weekStartsOn: 6, workingDays: [0, 1, 2, 3, 4] }),
      slots: [makeSlot(), makeSlot({ id: 'friday', weekday: 5, startTime: '16:00', endTime: '17:00' })],
    })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)

    await within(await screen.findByRole('region', { name: ar.schedule.calendar.grid })).findByRole('button', { name: /من 16:00 إلى 17:00/ })
    // The week from Saturday 7 November, plus the upcoming days up to Saturday 14.
    await waitFor(() => expect([...dates(api.academyQueries)].sort()).toEqual(['2026-11-07', ...WEEK]))
    // Saturday is a day off without slots (hidden); Friday is a day off that holds one (shown, marked).
    expect(headerLabels()).toEqual([...WEEK.slice(0, 5).map((date) => formatLongDate(date, 'ar')), `${formatLongDate('2026-11-13', 'ar')} (${ar.schedule.calendar.nonWorkingDay})`])
    expect(within(grid()).getByRole('button', { name: formatLongDate('2026-11-08', 'ar') })).toHaveAttribute('aria-current', 'date')
    expect(within(screen.getByRole('region', { name: ar.schedule.month.label })).getAllByRole('columnheader')[0]).toHaveTextContent(ar.schedule.calendar.weekdaysShort.sat)
    expect(screen.getByText(ar.schedule.calendar.zone.replace('{{zone}}', 'Asia/Riyadh'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: ar.schedule.calendar.allDays }))
    expect(headerLabels()[0]).toBe(`${formatLongDate('2026-11-07', 'ar')} (${ar.schedule.calendar.nonWorkingDay})`)
    expect(headerLabels()).toHaveLength(7)
  })

  it('opens the details of a slot: class, time and zone, teacher, room and branch, effective period', async () => {
    mockApi({
      slots: [makeSlot({ room: { id: ROOM_ID, code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' }, branch: { id: BRANCH_ID, code: 'IST', name: { ar: 'فرع إسطنبول' } } }, effectiveTo: '2026-12-20' })],
    })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    fireEvent.click(await within(await screen.findByRole('region', { name: ar.schedule.calendar.grid })).findByRole('button', { name: /من 10:00 إلى 11:30/ }))

    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent(ar.schedule.details.title)
    expect(drawer).toHaveTextContent('PY-101-A')
    expect(drawer).toHaveTextContent('بايثون — الفصل أ')
    expect(drawer).toHaveTextContent(formatLongDate('2026-11-08', 'ar'))
    expect(drawer).toHaveTextContent('10:00 – 11:30')
    expect(drawer).toHaveTextContent(`Asia/Riyadh (${ar.schedule.details.academyZone})`)
    expect(drawer).toHaveTextContent('خالد المعلم')
    expect(drawer).toHaveTextContent('LAB-1 — مختبر 1')
    expect(drawer).toHaveTextContent('IST — فرع إسطنبول')
    expect(drawer).toHaveTextContent(`${formatDate('2026-01-01', 'ar')} – ${formatDate('2026-12-20', 'ar')}`)
    expect(drawer).toHaveTextContent(ar.schedule.details.recurring)
  })

  it('renders in English with the same data', async () => {
    await act(() => i18n.changeLanguage('en'))
    try {
      mockApi({ slots: [makeSlot()] })
      renderPage(SCHEDULE_MANAGER_PERMISSIONS)
      const region = await screen.findByRole('region', { name: en.schedule.calendar.grid })
      expect(await within(region).findByRole('button', { name: /^Python Basics, class PY-101-A, .*, 10:00 to 11:30, room LAB-1 — Lab 1, teacher خالد المعلم$/ })).toBeInTheDocument()
      expect(within(region).getByRole('button', { name: formatLongDate('2026-11-08', 'en') })).toHaveTextContent('08Sun')
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(formatDateRange('2026-11-08', '2026-11-12', 'en'))
      expect(screen.getByText(en.schedule.tabs.academy)).toBeInTheDocument()
      expect(screen.getByText(en.schedule.calendar.today).closest('button')).toBeInTheDocument()
    } finally {
      await act(() => i18n.changeLanguage('ar'))
    }
  })

  it('gives a phone the day first: the week strip, a timeline of large cards, the week as an agenda and the filters behind a toggle', async () => {
    stubPhoneViewport()
    mockApi({ slots: [makeSlot(), makeSlot({ id: 'monday', weekday: 1, startTime: '09:00', endTime: '10:00' })] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)

    const strip = await screen.findByRole('group', { name: ar.schedule.calendar.weekStrip })
    expect(screen.queryByRole('region', { name: ar.schedule.calendar.grid })).not.toBeInTheDocument()
    const timeline = await screen.findByRole('list', { name: formatLongDate('2026-11-08', 'ar') })
    expect(await within(timeline).findByRole('button', { name: /من 10:00 إلى 11:30/ })).toBeInTheDocument()

    fireEvent.click(within(strip).getByRole('button', { name: formatLongDate('2026-11-09', 'ar') }))
    expect(await within(screen.getByRole('list', { name: formatLongDate('2026-11-09', 'ar') })).findByRole('button', { name: /من 09:00 إلى 10:00/ })).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.schedule.calendar.weekView))
    expect(screen.getByRole('heading', { name: new RegExp(`^${ar.days.mon}`) })).toBeInTheDocument()
    expect(screen.getAllByText(ar.schedule.calendar.emptyDay).length).toBeGreaterThan(0)

    expect(screen.queryByRole('combobox', { name: ar.schedule.columns.room })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.schedule.filters.toggle))
    expect(screen.getByRole('combobox', { name: ar.schedule.columns.room })).toBeInTheDocument()
  })

  // ---- J-F18: the owner's note 4 on PR #46 — the day view with a weekday filter ----

  it('keeps the day view on the filtered weekday: the arrows, «today» and the month calendar land on that weekday of their week', async () => {
    const api = mockApi({ slots: [makeSlot({ id: 'tuesday', weekday: 2, startTime: '12:00', endTime: '13:00' })] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    await waitFor(() => expect(api.academyQueries).toHaveLength(7))
    const tuesdaySlot = (date: string) => within(screen.getByRole('region', { name: formatLongDate(date, 'ar') })).findByRole('button', { name: /من 12:00 إلى 13:00/ })

    fireEvent.click(screen.getByText(ar.schedule.calendar.dayView))
    await pickOption(ar.schedule.filters.weekday, ar.days.tue)
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-10', 'ar'))
    expect(await tuesdaySlot('2026-11-10')).toBeInTheDocument()

    // A week at a time, Tuesday to Tuesday.
    fireEvent.click(screen.getByLabelText(ar.schedule.calendar.nextWeek))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-17', 'ar'))
    // «Today» (Sunday the 8th) comes back to the Tuesday of this week — not to an empty Sunday — and is then done.
    fireEvent.click(screen.getByText(ar.schedule.calendar.today))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-10', 'ar'))
    expect(screen.getByText(ar.schedule.calendar.today).closest('button')).toBeDisabled()
    // Thursday the 26th picked in the month calendar lands on the Tuesday of its week.
    fireEvent.click(within(screen.getByRole('region', { name: ar.schedule.month.label })).getByLabelText(formatLongDate('2026-11-26', 'ar')))
    expect(rangeHeading()).toHaveTextContent(formatLongDate('2026-11-24', 'ar'))
    expect(await tuesdaySlot('2026-11-24')).toBeInTheDocument()
    expect(screen.queryByText(ar.schedule.calendar.emptyDay)).not.toBeInTheDocument()
    // Once the filter was set, only Tuesdays were asked.
    expect(api.academyQueries.slice(7).map((query) => query.toString())).toEqual(['on=2026-11-17&weekday=2', 'on=2026-11-24&weekday=2'])
  })

  it('on a phone, a day of the week strip keeps the timeline on the filtered weekday of that week', async () => {
    stubPhoneViewport()
    mockApi({ slots: [makeSlot({ id: 'monday', weekday: 1, startTime: '09:00', endTime: '10:00' })] })
    renderPage(SCHEDULE_MANAGER_PERMISSIONS)
    const strip = await screen.findByRole('group', { name: ar.schedule.calendar.weekStrip })
    fireEvent.click(screen.getByText(ar.schedule.filters.toggle))
    await pickOption(ar.schedule.filters.weekday, ar.days.mon)
    const monday = formatLongDate('2026-11-09', 'ar')
    expect(await within(await screen.findByRole('list', { name: monday })).findByRole('button', { name: /من 09:00 إلى 10:00/ })).toBeInTheDocument()

    // Wednesday in the strip stays on Monday instead of opening an empty Wednesday.
    fireEvent.click(within(strip).getByRole('button', { name: formatLongDate('2026-11-11', 'ar') }))
    expect(within(strip).getByRole('button', { name: monday })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('list', { name: monday })).toBeInTheDocument()
    expect(screen.queryByText(ar.schedule.calendar.emptyDay)).not.toBeInTheDocument()
  })
})
