import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { renderWithProviders } from '../test/render'
import { makeCalendarLesson, makeCalendarLessons, makeMyItem, makeMySchedule, makeTimetableAcademy } from '../test/timetable'
import { TimetableScreen } from './TimetableScreen'

// Thursday 2026-11-12, 10:30 in Riyadh (07:30Z): the shown week is Sunday 8 – Saturday 14 (the
// academy's week starts on Sunday); only the shown week is read — there is no «upcoming» panel.
const NOW = new Date('2026-11-12T07:30:00Z')
const WEEK = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TimetableScreen — the grid’s alert follows the shown dates', () => {
  it('reads the shown week alone, and a failure of one of its dates is the grid’s alert; no side panel', async () => {
    const asked = mockApi('2026-11-09')
    renderScreen()

    expect(await screen.findByRole('alert')).toHaveTextContent(ar.schedule.calendar.failed)
    await waitFor(() => expect([...new Set(asked)].sort()).toEqual([...WEEK].sort()))
    expect(screen.queryByRole('region', { name: ar.schedule.upcoming.title })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: ar.schedule.month.label })).not.toBeInTheDocument()
  })

  it('never asks a date outside the shown week, so a failure there shows no alert over the grid (KI-120)', async () => {
    const asked = mockApi('2026-11-16')
    renderScreen()

    // Every date of the shown week answered: the grid shows its Sunday slot and no network alert.
    await waitFor(() => expect([...new Set(asked)].sort()).toEqual([...WEEK].sort()))
    expect(asked).not.toContain('2026-11-16')
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

  it('marks a cancelled lesson on the grid and offers no link', async () => {
    mockLessonsOnly([makeCalendarLesson({ status: 'cancelled', startsAt: '2026-11-13T09:00:00.000Z', endsAt: '2026-11-13T10:00:00.000Z' })])
    renderScreen()

    const grid = await screen.findByRole('region', { name: ar.schedule.calendar.grid })
    const card = await within(grid).findByRole('button', { name: /من 12:00 إلى 13:00/ })
    expect(card).toHaveClass('is-cancelled')
    expect(card).toHaveTextContent(ar.labels.cancelled)

    fireEvent.click(card)
    expect(within(await screen.findByRole('dialog')).queryByRole('link')).not.toBeInTheDocument()
  })
})
