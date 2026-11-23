import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { makeCalendarLesson, makeCalendarLessons, makeMyItem, makeMySchedule, makeTimetableAcademy } from '../test/timetable'
import { TimetableScreen } from './TimetableScreen'

// Thursday 2026-11-12, 10:30 in Riyadh (07:30Z): the shown week is Sunday 8 – Saturday 14 (the
// academy's week starts on Sunday) and "upcoming" covers Thursday 12 – Wednesday 18, so 9–11 belong to
// the week alone and 15–18 to the panel alone.
const NOW = new Date('2026-11-12T07:30:00Z')
const WEEK = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const UPCOMING = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']

/** «My schedule» with one Sunday slot (10:00–11:30), failing with a 500 on the date given. */
function mockApi(failingOn: string) {
  const asked: string[] = []
  mockFetch((raw) => {
    const url = new URL(raw, 'http://localhost')
    if (url.pathname === '/api/academy') return jsonResponse(200, makeTimetableAcademy({ weekStartsOn: 0, workingDays: [0, 1, 2, 3, 4] }))
    if (url.pathname === '/api/me/schedule') {
      const on = url.searchParams.get('on')!
      asked.push(on)
      if (on === failingOn) return jsonResponse(500, { statusCode: 500, message: 'Internal server error' })
      return jsonResponse(200, makeMySchedule([makeMyItem()], on))
    }
    if (url.pathname === '/api/me/lessons') return jsonResponse(200, makeCalendarLessons())
    return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
  })
  return asked
}

/** A student whose class has no weekly slot: only the lessons of API-101, on the dates they start. */
function mockLessonsOnly(lessons: ReturnType<typeof makeCalendarLesson>[]) {
  mockFetch((raw) => {
    const url = new URL(raw, 'http://localhost')
    if (url.pathname === '/api/academy') return jsonResponse(200, makeTimetableAcademy({ weekStartsOn: 0, workingDays: [0, 1, 2, 3, 4] }))
    if (url.pathname === '/api/me/schedule') return jsonResponse(200, makeMySchedule([], url.searchParams.get('on')!))
    if (url.pathname === '/api/me/lessons') {
      const from = Date.parse(url.searchParams.get('from')!)
      const to = Date.parse(url.searchParams.get('to')!)
      return jsonResponse(200, makeCalendarLessons(lessons.filter((lesson) => Date.parse(lesson.startsAt) >= from && Date.parse(lesson.startsAt) <= to)))
    }
    return jsonResponse(404, { statusCode: 404, code: 'not_found', message: 'nope' })
  })
}

function renderScreen() {
  return renderWithProviders(<TimetableScreen canReadAcademy={false} canReadMine canPickTeacher={false} canPickClass={false} />, { route: '/schedule' })
}

const upcomingPanel = () => screen.getByRole('region', { name: ar.schedule.upcoming.title })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TimetableScreen — the «upcoming» panel and the grid’s alert report only their own failures', () => {
  it('keeps the panel’s slots when a date of the shown week outside its seven days fails; the grid keeps its alert', async () => {
    const asked = mockApi('2026-11-09')
    renderScreen()

    // The week's failure is the grid's alert…
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.schedule.calendar.failed)
    await waitFor(() => expect([...new Set(asked)].sort()).toEqual([...new Set([...WEEK, ...UPCOMING])].sort()))
    // …while every date of the panel answered: its Sunday-15 slot stays listed, with no failure text.
    const items = await within(upcomingPanel()).findAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('15')
    expect(within(upcomingPanel()).queryByText(ar.schedule.upcoming.failed)).not.toBeInTheDocument()
  })

  it('shows the panel’s failure when one of its own dates fails outside the shown week — in the panel alone, with no alert over the grid (KI-120)', async () => {
    const asked = mockApi('2026-11-16')
    renderScreen()

    expect(await within(upcomingPanel()).findByText(ar.schedule.upcoming.failed)).toBeInTheDocument()
    expect(within(upcomingPanel()).queryByRole('listitem')).not.toBeInTheDocument()
    // Every date of the shown week answered: the grid shows its Sunday slot and no network alert.
    await waitFor(() => expect([...new Set(asked)].sort()).toEqual([...new Set([...WEEK, ...UPCOMING])].sort()))
    const grid = screen.getByRole('region', { name: ar.schedule.calendar.grid })
    expect(within(grid).getByRole('button', { name: /من 10:00 إلى 11:30/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('in the day view, follows the shown day: a failure on another date of the week shows no alert until that date is shown (KI-120)', async () => {
    mockApi('2026-11-09')
    renderScreen()

    // The week view shows Monday 9: its failure is the grid's alert.
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.schedule.calendar.failed)
    // The day view of today (Thursday 12, which answered with no slot): no alert, and the empty day says so.
    fireEvent.click(screen.getByText(ar.schedule.calendar.dayView))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(ar.schedule.calendar.emptyDay)).toBeInTheDocument()
    // Back to Monday 9, the date that failed: the alert again, and no empty-day claim.
    for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByLabelText(ar.schedule.calendar.previousDay))
    expect(screen.getByRole('alert')).toHaveTextContent(ar.schedule.calendar.failed)
    expect(screen.queryByText(ar.schedule.calendar.emptyDay)).not.toBeInTheDocument()
  })
})

describe('TimetableScreen — a student whose lessons were added by hand (J-F65, KI-064)', () => {
  it('shows the lesson on the grid without any weekly slot, and its details with the link and no «recurring» notice', async () => {
    mockLessonsOnly([makeCalendarLesson()])
    renderScreen()

    const grid = await screen.findByRole('region', { name: ar.schedule.calendar.grid })
    const card = await within(grid).findByRole('button', { name: /من 12:00 إلى 13:00/ })
    expect(card).toHaveClass('is-lesson')
    expect(card).toHaveTextContent('درس المتغيرات')
    expect(screen.getByText(ar.schedule.calendar.recurringMine)).toBeInTheDocument()

    fireEvent.click(card)
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText(ar.schedule.details.lessonTitle)).toBeInTheDocument()
    expect(within(drawer).getByRole('link')).toHaveAttribute('href', 'https://meet.example.com/variables')
    expect(within(drawer).queryByText(ar.schedule.details.recurring)).not.toBeInTheDocument()
  })

  it('marks a cancelled lesson on the grid, offers no link and keeps it out of «upcoming»', async () => {
    // Friday 13, after «now»: it would be upcoming if it were not cancelled.
    mockLessonsOnly([makeCalendarLesson({ status: 'cancelled', startsAt: '2026-11-13T09:00:00.000Z', endsAt: '2026-11-13T10:00:00.000Z' })])
    renderScreen()

    const grid = await screen.findByRole('region', { name: ar.schedule.calendar.grid })
    const card = await within(grid).findByRole('button', { name: /من 12:00 إلى 13:00/ })
    expect(card).toHaveClass('is-cancelled')
    expect(card).toHaveTextContent(ar.labels.cancelled)
    expect(await within(upcomingPanel()).findByText(ar.schedule.upcoming.empty)).toBeInTheDocument()

    fireEvent.click(card)
    expect(within(await screen.findByRole('dialog')).queryByRole('link')).not.toBeInTheDocument()
  })
})
