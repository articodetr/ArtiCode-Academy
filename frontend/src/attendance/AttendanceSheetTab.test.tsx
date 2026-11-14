import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AttendanceSheet } from '../api/attendance'
import { ar } from '../i18n/ar'
import { ATTENDANCE_STAFF_PERMISSIONS, ATTENDANCE_TEACHER_PERMISSIONS, STUDENT_IDS, fourStudents, makeAttendanceRecord, makeAttendanceSheet } from '../test/attendance'
import { formatLessonDateTime } from '../lessons/lessons.format'
import { jsonResponse, mockFetch } from '../test/http'
import { FAR_TIME_ZONE, LESSON_ID, LESSON_TIME_ZONE } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { formatDateTime } from '../users/users.format'
import { AttendanceSheetTab } from './AttendanceSheetTab'
import { ATTENDANCE_STATUS_COLORS } from './attendance.format'

const [SARA, YOUSEF, , OMAR] = STUDENT_IDS

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET answers `get()` (re-read on every call), PUT answers `put(body)`; every request is recorded. */
function mockSheetApi(get: () => AttendanceSheet | Response, put?: (body: unknown) => Response) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') {
      const answer = get()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'PUT' && put) return put(body)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

/** `timeZone` = the lesson's (D-R41): the sheet shows its times in it. `onUnsavedChange` is what the drawer hears (KI-058). */
function renderTab(permissions: string[], timeZone: string = LESSON_TIME_ZONE) {
  const onSaved = vi.fn()
  const onLessonStale = vi.fn()
  const onUnsavedChange = vi.fn()
  const view = renderWithProviders(<AttendanceSheetTab lesson={{ id: LESSON_ID, timeZone }} onSaved={onSaved} onLessonStale={onLessonStale} onUnsavedChange={onUnsavedChange} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/lessons',
  })
  return { ...view, onSaved, onLessonStale, onUnsavedChange }
}

/** The last flag the sheet reported to the drawer. */
const lastReported = (onUnsavedChange: ReturnType<typeof vi.fn>) => onUnsavedChange.mock.calls.at(-1)?.[0] as boolean | undefined

const row = (name: string) => screen.getByText(name).closest('[data-attendance-row]') as HTMLElement
const findRow = async (name: string) => (await screen.findByText(name)).closest('[data-attendance-row]') as HTMLElement
const saveButton = () => screen.getByText(ar.attendance.save).closest('button') as HTMLButtonElement
const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT')
const minutesOf = (name: string) => within(row(name)).getByLabelText(`${ar.attendance.columns.minutesLate}: ${name}`)
const noteOf = (name: string) => within(row(name)).getByLabelText(`${ar.attendance.columns.note}: ${name}`)

describe('AttendanceSheetTab', () => {
  it('shows a teacher one row per student with the enrollment and the record; a student withdrawn after the lesson stays read-only', async () => {
    mockSheetApi(() => makeAttendanceSheet())
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS)

    const yousef = await findRow('يوسف الطالب')
    // An active enrollment is the normal case and carries no tag (redesign); the others do.
    expect(within(yousef).queryByText(ar.attendance.enrollment.active)).not.toBeInTheDocument()
    expect(within(yousef).getByLabelText(ar.lessons.attendance.late)).toBeChecked()
    expect(minutesOf('يوسف الطالب')).toHaveValue('10')
    expect(noteOf('يوسف الطالب')).toHaveValue('زحمة السير')
    expect(within(yousef).getByText(/خالد المعلم/)).toBeInTheDocument()

    const layla = row('ليلى المنسحبة')
    expect(within(layla).getByText(ar.attendance.enrollment.withdrawn)).toBeInTheDocument()
    expect(within(layla).getByText(ar.attendance.readOnlyRow)).toBeInTheDocument()
    expect(within(layla).getByText(ar.lessons.attendance.present)).toHaveClass(`ant-tag-${ATTENDANCE_STATUS_COLORS.present}`)
    expect(within(layla).queryByLabelText(ar.lessons.attendance.absent)).not.toBeInTheDocument()

    expect(within(row('عمر الخريج')).getByText(ar.attendance.enrollment.completed)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present)).not.toBeChecked()
    expect(screen.getByText(`${ar.lessons.attendance.recorded}: 2`)).toBeInTheDocument()
    expect(screen.getByText(ar.attendance.noChanges)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('marks the unrecorded students present and saves ONE PUT with the changed rows only, each as its whole record; then shows the server answer', async () => {
    const items = fourStudents()
    const answer = makeAttendanceSheet({
      counts: { recorded: 4, present: 3, absent: 0, late: 1, excused: 0 },
      items: [
        { ...items[0]!, record: makeAttendanceRecord({ recordedBy: { userId: 'u-9', fullName: 'منى المساعدة' } }) },
        { ...items[1]!, record: makeAttendanceRecord({ status: 'late', minutesLate: 5, note: 'المواصلات', recordedBy: { userId: 'u-9', fullName: 'منى المساعدة' } }) },
        items[2]!,
        { ...items[3]!, record: makeAttendanceRecord({ recordedBy: { userId: 'u-9', fullName: 'منى المساعدة' } }) },
      ],
    })
    const calls = mockSheetApi(
      () => makeAttendanceSheet(),
      () => jsonResponse(200, answer),
    )
    const { onSaved } = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')

    fireEvent.click(screen.getByText(ar.attendance.markAllPresent).closest('button')!)
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present)).toBeChecked()
    expect(within(row('عمر الخريج')).getByLabelText(ar.lessons.attendance.present)).toBeChecked()
    await userEvent.clear(minutesOf('يوسف الطالب'))
    await userEvent.type(minutesOf('يوسف الطالب'), '5')
    await userEvent.clear(noteOf('يوسف الطالب'))
    await userEvent.type(noteOf('يوسف الطالب'), ' المواصلات ')
    expect(screen.getByText(ar.attendance.unsaved.replace('{{count}}', '3'))).toBeInTheDocument()
    fireEvent.click(saveButton())

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(answer))
    expect(puts(calls)).toEqual([
      {
        method: 'PUT',
        url: `/api/lessons/${LESSON_ID}/attendance`,
        body: { records: [{ studentId: SARA, status: 'present' }, { studentId: YOUSEF, status: 'late', minutesLate: 5, note: 'المواصلات' }, { studentId: OMAR, status: 'present' }] },
      },
    ])
    expect(await screen.findByText(ar.attendance.saved)).toBeInTheDocument()
    // The screen shows the server's answer — its counts and its recorder — in a new edit session.
    expect(await screen.findByText(`${ar.lessons.attendance.recorded}: 4`)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByText(/منى المساعدة/)).toBeInTheDocument()
    expect(screen.getByText(ar.attendance.noChanges)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
  })

  it('sends nothing while nothing changed, and an undone row drops out of the batch', async () => {
    const calls = mockSheetApi(
      () => makeAttendanceSheet(),
      () => jsonResponse(200, makeAttendanceSheet()),
    )
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    const yousef = await findRow('يوسف الطالب')

    fireEvent.click(within(yousef).getByLabelText(ar.lessons.attendance.absent))
    expect(saveButton()).not.toBeDisabled()
    fireEvent.click(within(yousef).getByText(ar.attendance.revert).closest('button')!)
    expect(within(yousef).getByLabelText(ar.lessons.attendance.late)).toBeChecked()
    expect(saveButton()).toBeDisabled()
    // Typing the same note back is no change either.
    await userEvent.type(noteOf('يوسف الطالب'), ' ')
    expect(saveButton()).toBeDisabled()

    fireEvent.click(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.excused))
    fireEvent.click(saveButton())
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect(puts(calls)[0]!.body).toEqual({ records: [{ studentId: SARA, status: 'excused' }] })
  })

  it('sends the whole new state: leaving late disables the minutes, and the dropped minutes and emptied note are cleared on the server', async () => {
    const calls = mockSheetApi(
      () => makeAttendanceSheet(),
      () => jsonResponse(200, makeAttendanceSheet()),
    )
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    const yousef = await findRow('يوسف الطالب')

    fireEvent.click(within(yousef).getByLabelText(ar.lessons.attendance.present))
    // The minutes show only while the status is «late» (redesign).
    expect(within(row('يوسف الطالب')).queryByLabelText(`${ar.attendance.columns.minutesLate}: يوسف الطالب`)).not.toBeInTheDocument()
    await userEvent.clear(noteOf('يوسف الطالب'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect(puts(calls)[0]!.body).toEqual({ records: [{ studentId: YOUSEF, status: 'present' }] })
  })

  it('shows staff (attendance.read without attendance.record) the sheet read-only with the reason', async () => {
    mockSheetApi(() => makeAttendanceSheet())
    renderTab(ATTENDANCE_STAFF_PERMISSIONS)

    expect(await screen.findByText(ar.attendance.readOnly)).toBeInTheDocument()
    const yousef = row('يوسف الطالب')
    expect(within(yousef).getByText(ar.lessons.attendance.late)).toBeInTheDocument()
    expect(within(yousef).getByText('زحمة السير')).toBeInTheDocument()
    expect(within(yousef).queryByLabelText(ar.lessons.attendance.absent)).not.toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByText(ar.attendance.notRecorded)).toBeInTheDocument()
    expect(screen.queryByText(ar.attendance.save)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.attendance.markAllPresent)).not.toBeInTheDocument()
  })

  it('keeps a lesson that has not started, a cancelled lesson and a cancelled class read-only even for a teacher, saying why', async () => {
    const closed = makeAttendanceSheet({ recordable: false, closedReason: 'not_started', attendanceTakenAt: null })
    const cases: [AttendanceSheet, string][] = [
      [closed, ar.attendance.closed.not_started.replace('{{time}}', formatLessonDateTime(closed.startsAt, 'ar', LESSON_TIME_ZONE))],
      [makeAttendanceSheet({ recordable: false, closedReason: 'cancelled', lessonStatus: 'cancelled' }), ar.attendance.closed.cancelled],
      [makeAttendanceSheet({ recordable: false, closedReason: 'class_cancelled' }), ar.attendance.closed.class_cancelled],
    ]
    for (const [sheet, text] of cases) {
      mockSheetApi(() => sheet)
      const { unmount } = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(within(row('يوسف الطالب')).queryByLabelText(ar.lessons.attendance.absent)).not.toBeInTheDocument()
      expect(screen.queryByText(ar.attendance.save)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('says when a lesson that has not started opens — and when the sheet and each record were written — in the lesson’s zone, not the browser’s (D-R41 — J-F28)', async () => {
    // 10:00 UTC on the 10th is midnight of the 11th in UTC+14.
    const closed = makeAttendanceSheet({ recordable: false, closedReason: 'not_started' })
    mockSheetApi(() => closed)
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS, FAR_TIME_ZONE)
    const opensAt = formatLessonDateTime(closed.startsAt, 'ar', FAR_TIME_ZONE)
    expect(opensAt).not.toBe(formatDateTime(closed.startsAt, 'ar'))
    expect(await screen.findByText(ar.attendance.closed.not_started.replace('{{time}}', opensAt))).toBeInTheDocument()
    expect(screen.getByText(ar.lessons.attendance.takenAt.replace('{{date}}', formatLessonDateTime(closed.attendanceTakenAt, 'ar', FAR_TIME_ZONE)))).toBeInTheDocument()
    // Yousef's record (written 10:05 UTC) — under his name, after who wrote it.
    expect(within(row('يوسف الطالب')).getByText(formatLessonDateTime('2026-11-10T10:05:00.000Z', 'ar', FAR_TIME_ZONE), { exact: false })).toBeInTheDocument()
    // The tab names the zone of those times, with this device's beside it, as the details tab does (J-F48 — the owner's note 1 on #105).
    const zone = screen.getByTestId('attendance-zone')
    expect(zone).toHaveTextContent(`${ar.lessons.fields.timeZone}: ${FAR_TIME_ZONE}`)
    expect(zone).toHaveTextContent(ar.lessons.zone.device.replace('{{zone}}', deviceTimeZone()))
  })

  it('names no zone when the lesson is in the device’s own zone (J-F48)', async () => {
    mockSheetApi(() => makeAttendanceSheet())
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS, deviceTimeZone())
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(screen.queryByTestId('attendance-zone')).not.toBeInTheDocument()
  })

  it('re-reads the sheet and asks the drawer to re-read the lesson when the server says it no longer takes attendance', async () => {
    let reads = 0
    const calls = mockSheetApi(
      () => (++reads === 1 ? makeAttendanceSheet() : makeAttendanceSheet({ recordable: false, closedReason: 'cancelled', lessonStatus: 'cancelled' })),
      () => jsonResponse(409, { statusCode: 409, code: 'attendance_closed', reason: 'cancelled', startsAt: '2026-11-10T10:00:00.000Z', message: 'closed' }),
    )
    const { onLessonStale, onSaved } = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    fireEvent.click(within(await findRow('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present))
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.attendance.errors.lesson_cancelled)).toBeInTheDocument()
    expect(await screen.findByText(ar.attendance.closed.cancelled)).toBeInTheDocument()
    expect(onLessonStale).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)
  })

  it('refuses the whole batch when a student is no longer enrolled: names them, marks their row and keeps the other changes', async () => {
    const calls = mockSheetApi(
      () => makeAttendanceSheet(),
      () => jsonResponse(422, { statusCode: 422, code: 'not_enrolled', studentIds: [OMAR], message: 'nope' }),
    )
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    fireEvent.click(within(await findRow('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present))
    fireEvent.click(within(row('عمر الخريج')).getByLabelText(ar.lessons.attendance.absent))
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.attendance.errors.not_enrolled.replace('{{names}}', 'عمر الخريج'))).toBeInTheDocument()
    expect(within(row('عمر الخريج')).getByText(ar.attendance.refusedRow)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present)).toBeChecked()
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
  })

  it('shows a too-large batch and a validation refusal above the table, and hands a vanished lesson back to the drawer', async () => {
    let answer = 413
    mockSheetApi(
      () => makeAttendanceSheet(),
      () =>
        answer === 413
          ? jsonResponse(413, { statusCode: 413, message: 'request entity too large' })
          : answer === 400
            ? jsonResponse(400, { statusCode: 400, message: 'records must not repeat a studentId' })
            : jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', lessonId: LESSON_ID, message: 'No lesson' }),
    )
    const { onLessonStale } = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    fireEvent.click(within(await findRow('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present))

    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.attendance.errors.too_large)).toBeInTheDocument()
    answer = 400
    fireEvent.click(saveButton())
    expect(await screen.findByText('رفض الخادم البيانات: records must not repeat a studentId')).toBeInTheDocument()
    answer = 404
    fireEvent.click(saveButton())
    await waitFor(() => expect(onLessonStale).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(ar.lessons.errors.lesson_not_found)).toBeInTheDocument()
  })

  it('shows a failed read with a retry that reads the sheet again', async () => {
    let reads = 0
    const calls = mockSheetApi(() => (++reads === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeAttendanceSheet()))
    renderTab(ATTENDANCE_TEACHER_PERMISSIONS)

    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.attendance.reload).closest('button')!)
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)
  })

  it('tells the drawer whether a row would be sent (KI-058): on a change, not once changed back, not after the saved answer, not after it leaves', async () => {
    mockSheetApi(
      () => makeAttendanceSheet(),
      () => jsonResponse(200, makeAttendanceSheet()),
    )
    const { onUnsavedChange, unmount } = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    const yousef = await findRow('يوسف الطالب')
    expect(lastReported(onUnsavedChange)).toBe(false)

    fireEvent.click(within(yousef).getByLabelText(ar.lessons.attendance.absent))
    expect(lastReported(onUnsavedChange)).toBe(true)
    fireEvent.click(within(yousef).getByText(ar.attendance.revert).closest('button')!)
    expect(lastReported(onUnsavedChange)).toBe(false)
    // A note on a row without a status is nothing the save sends (the sheet says so too).
    fireEvent.click(within(row('سارة الطالبة')).getByText(ar.attendance.addNote).closest('button')!)
    await userEvent.type(noteOf('سارة الطالبة'), 'تأخرت')
    expect(screen.getByText(ar.attendance.noChanges)).toBeInTheDocument()
    expect(lastReported(onUnsavedChange)).toBe(false)

    fireEvent.click(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.present))
    expect(lastReported(onUnsavedChange)).toBe(true)
    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.attendance.saved)).toBeInTheDocument()
    // The saved answer starts a new edit session (KI-049): nothing is held.
    await waitFor(() => expect(lastReported(onUnsavedChange)).toBe(false))

    fireEvent.click(within(row('عمر الخريج')).getByLabelText(ar.lessons.attendance.excused))
    expect(lastReported(onUnsavedChange)).toBe(true)
    unmount()
    expect(lastReported(onUnsavedChange)).toBe(false)
  })

  it('never tells the drawer a read-only sheet holds anything: staff, and a lesson that takes no attendance', async () => {
    mockSheetApi(() => makeAttendanceSheet())
    const staff = renderTab(ATTENDANCE_STAFF_PERMISSIONS)
    expect(await screen.findByText(ar.attendance.readOnly)).toBeInTheDocument()
    expect(staff.onUnsavedChange).toHaveBeenCalled()
    expect(staff.onUnsavedChange.mock.calls.every(([unsaved]) => unsaved === false)).toBe(true)
    staff.unmount()

    mockSheetApi(() => makeAttendanceSheet({ recordable: false, closedReason: 'cancelled', lessonStatus: 'cancelled' }))
    const teacher = renderTab(ATTENDANCE_TEACHER_PERMISSIONS)
    expect(await screen.findByText(ar.attendance.closed.cancelled)).toBeInTheDocument()
    expect(teacher.onUnsavedChange).toHaveBeenCalled()
    expect(teacher.onUnsavedChange.mock.calls.every(([unsaved]) => unsaved === false)).toBe(true)
  })
})
