import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttendanceSheet } from '../api/attendance'
import type { Lesson } from '../api/lessons'
import { ar } from '../i18n/ar'
import { ATTENDANCE_TEACHER_PERMISSIONS, fourStudents, makeAttendanceRecord, makeAttendanceSheet } from '../test/attendance'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ADMIN_PERMISSIONS, LESSON_ID, makeLesson } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { LessonDrawer } from './LessonDrawer'

/** The lesson (API-094), its sheet (API-099/API-100) and the pickers of the edit form; `methods` records lesson and sheet requests. */
function mockDrawerApi(lesson: () => Lesson, sheet: () => AttendanceSheet, put?: () => Response) {
  const methods: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === `/api/lessons/${LESSON_ID}/attendance`) {
      methods.push(`${method} sheet`)
      return method === 'PUT' && put ? put() : jsonResponse(200, sheet())
    }
    if (parsed.pathname === `/api/lessons/${LESSON_ID}`) {
      methods.push(`${method} lesson`)
      return jsonResponse(200, lesson())
    }
    if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    return jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', message: 'nope' })
  })
  return methods
}

function renderDrawer(permissions: string[]) {
  const onUpdated = vi.fn()
  renderWithProviders(<LessonDrawer lessonId={LESSON_ID} onClose={vi.fn()} onUpdated={onUpdated} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/lessons',
  })
  return { onUpdated }
}

const sheetTab = () => screen.getByRole('tab', { name: ar.attendance.drawerTabs.sheet })
const detailsTab = () => screen.getByRole('tab', { name: ar.attendance.drawerTabs.details })
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('LessonDrawer — the attendance tab (J-F10)', () => {
  it('gives a holder of attendance.read a details tab and an attendance tab, reads the sheet only when it opens, and the summary links to it', async () => {
    const methods = mockDrawerApi(() => makeLesson(), () => makeAttendanceSheet())
    renderDrawer(ATTENDANCE_TEACHER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(detailsTab()).toHaveAttribute('aria-selected', 'true')
    expect(methods).toEqual(['GET lesson'])

    fireEvent.click(screen.getByText(ar.attendance.openSheet).closest('button')!)
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(sheetTab()).toHaveAttribute('aria-selected', 'true')
    expect(methods).toEqual(['GET lesson', 'GET sheet'])
  })

  it('updates the summary and hands the lesson back with the counts and the stamp the server answered after a save', async () => {
    const items = fourStudents()
    const answer = makeAttendanceSheet({
      attendanceTakenAt: '2026-11-10T10:20:00.000Z',
      counts: { recorded: 4, present: 3, absent: 0, late: 1, excused: 0 },
      items: [{ ...items[0]!, record: makeAttendanceRecord() }, items[1]!, items[2]!, { ...items[3]!, record: makeAttendanceRecord() }],
    })
    const methods = mockDrawerApi(
      () => makeLesson({ attendance: { recorded: 2, present: 1, absent: 0, late: 1, excused: 0 } }),
      () => makeAttendanceSheet(),
      () => jsonResponse(200, answer),
    )
    const { onUpdated } = renderDrawer(ATTENDANCE_TEACHER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(within(screen.getByTestId('lesson-attendance')).getByText(`${ar.lessons.attendance.recorded}: 2`)).toBeInTheDocument()

    fireEvent.click(sheetTab())
    await screen.findByText('سارة الطالبة')
    fireEvent.click(screen.getByText(ar.attendance.markAllPresent).closest('button')!)
    fireEvent.click(screen.getByText(ar.attendance.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(onUpdated.mock.calls[0]![0]).toMatchObject({ id: LESSON_ID, attendance: answer.counts, attendanceTakenAt: answer.attendanceTakenAt })
    fireEvent.click(detailsTab())
    expect(within(screen.getByTestId('lesson-attendance')).getByText(`${ar.lessons.attendance.recorded}: 4`)).toBeInTheDocument()
    // The counts came from the PUT's answer: no extra read of the lesson.
    expect(methods).toEqual(['GET lesson', 'GET sheet', 'PUT sheet'])
  })

  it('keeps unsaved attendance rows while the lesson is edited in the details tab', async () => {
    mockDrawerApi(() => makeLesson(), () => makeAttendanceSheet())
    renderDrawer(ATTENDANCE_TEACHER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    fireEvent.click(sheetTab())
    fireEvent.click(within(await screen.findByText('سارة الطالبة').then((cell) => cell.closest('tr') as HTMLElement)).getByLabelText(ar.lessons.attendance.absent))

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    expect(await screen.findByLabelText(ar.lessons.fields.titleAr)).toBeInTheDocument()
    expect(detailsTab()).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)

    fireEvent.click(sheetTab())
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.absent)).toBeChecked()
    expect(screen.getByText(ar.attendance.unsaved.replace('{{count}}', '1'))).toBeInTheDocument()
  })

  it('shows no tabs and no link to the sheet without attendance.read', async () => {
    const methods = mockDrawerApi(() => makeLesson(), () => makeAttendanceSheet())
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.attendance.openSheet)).not.toBeInTheDocument()
    expect(document.querySelector('.ant-tabs')).toBeNull()
    expect(methods).toEqual(['GET lesson'])
  })
})
