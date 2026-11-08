import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../api/lessons'
import { ar } from '../i18n/ar'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ADMIN_PERMISSIONS, LESSON_ID, LESSON_STAFF_PERMISSIONS, makeLesson } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { LessonDrawer } from './LessonDrawer'
import { formatLessonDay, formatLessonTimes } from './lessons.format'

interface Call {
  method: string
  url: string
  body: unknown
}

const HOUR = 3_600_000
/** Now, truncated to the minute (lessons created from the form carry no seconds). */
const NOW = Math.floor(Date.now() / 60_000) * 60_000
/** A lesson that started two hours ago (complete is offered) and one next week (complete is not). */
const pastLesson = (overrides: Partial<Lesson> = {}) => makeLesson({ startsAt: new Date(NOW - 2 * HOUR).toISOString(), endsAt: new Date(NOW - HOUR).toISOString(), ...overrides })
const futureLesson = (overrides: Partial<Lesson> = {}) => makeLesson({ startsAt: new Date(NOW + 7 * 24 * HOUR).toISOString(), endsAt: new Date(NOW + 7 * 24 * HOUR + HOUR).toISOString(), ...overrides })

/**
 * GET /api/lessons/:id returns `detail()` (re-read on every call), the pickers answer, writes answer with
 * `writes[method]`; `classReads` records the GET /api/classes/:id of the edit form.
 */
function mockLessonApi(detail: () => Lesson, writes: Partial<Record<string, Response>> = {}) {
  const calls: Call[] = []
  const classReads: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === `/api/classes/${CLASS_ID}`) {
      classReads.push(parsed.pathname)
      return jsonResponse(200, makeClass())
    }
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return jsonResponse(200, detail())
    return writes[method] ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return Object.assign(calls, { classReads })
}

async function editTitle(text: string) {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  const title = await screen.findByLabelText(ar.lessons.fields.titleAr)
  await userEvent.clear(title)
  await userEvent.type(title, text)
}

function renderDrawer(permissions: string[]) {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<LessonDrawer lessonId={LESSON_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={onDeleted} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/lessons',
  })
  return { onUpdated, onDeleted, onClose }
}

async function openMenu() {
  fireEvent.click(screen.getByText(ar.lessons.actions.menu).closest('button')!)
  return screen.findAllByRole('menuitem')
}

async function chooseAction(label: string) {
  fireEvent.click(screen.getByText(ar.lessons.actions.menu).closest('button')!)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

function dialogOf(hint: string): HTMLElement {
  return screen.getByText(hint).closest('[role="dialog"]') as HTMLElement
}

describe('LessonDrawer', () => {
  it('shows staff the lesson read-only: class, course, day, times, mode, room, teacher, syllabus item, origin and attendance counts; no edit, no actions', async () => {
    const lesson = makeLesson({ description: { ar: 'مقدمة إلى الأنواع' }, attendance: { recorded: 4, present: 3, absent: 1, late: 0, excused: 0 } })
    mockLessonApi(() => lesson)
    renderDrawer(LESSON_STAFF_PERMISSIONS)

    expect(await screen.findByText('مقدمة إلى الأنواع')).toBeInTheDocument()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByText(/أساسيات بايثون/)).toBeInTheDocument()
    expect(screen.getByText(formatLessonDay(lesson.startsAt, 'ar'))).toBeInTheDocument()
    expect(screen.getByText(formatLessonTimes(lesson.startsAt, lesson.endsAt, 'ar'))).toBeInTheDocument()
    expect(screen.getByText('90 دقيقة')).toBeInTheDocument()
    expect(screen.getByText(ar.labels.in_person)).toBeInTheDocument()
    expect(screen.getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(screen.getByText(ar.lessons.drawer.site)).toBeInTheDocument()
    expect(screen.getByText('خالد المعلم')).toBeInTheDocument()
    expect(screen.getByText('1. المتغيرات')).toBeInTheDocument()
    expect(screen.getByText(ar.lessons.drawer.manual)).toBeInTheDocument()
    const attendance = screen.getByTestId('lesson-attendance')
    expect(within(attendance).getByText(ar.lessons.attendance.notTaken)).toBeInTheDocument()
    expect(within(attendance).getByText(`${ar.lessons.attendance.recorded}: 4`)).toBeInTheDocument()
    expect(within(attendance).getByText(`${ar.lessons.attendance.present}: 3`)).toBeInTheDocument()
    expect(within(attendance).getByText(`${ar.lessons.attendance.absent}: 1`)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.actions.menu)).not.toBeInTheDocument()
  })

  it('says "not found or not in a class assigned to you" when the server answers 404', async () => {
    mockFetch(() => jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', lessonId: LESSON_ID, message: 'No lesson' }))
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.lessons.errors.lesson_not_found)).toBeInTheDocument()
  })

  it('offers complete, cancel and delete for a scheduled lesson that has started', async () => {
    mockLessonApi(() => pastLesson())
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.lessons.actions.complete, ar.lessons.actions.cancel, ar.lessons.actions.delete])
  })

  it('offers only cancel and delete before the lesson starts, and no delete once attendance exists', async () => {
    mockLessonApi(() => futureLesson({ attendance: { recorded: 2, present: 2, absent: 0, late: 0, excused: 0 } }))
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.lessons.actions.cancel])
  })

  it('shows a lesson of a completed class frozen: a warning, no edit button and no actions menu even for an admin', async () => {
    mockLessonApi(() => pastLesson({ class: { ...makeLesson().class, status: 'completed' } }))
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.lessons.drawer.classClosed)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.actions.menu)).not.toBeInTheDocument()
  })

  it('cancels with the reason (POST /status) and hands the cancelled lesson back', async () => {
    const calls = mockLessonApi(() => futureLesson(), { POST: jsonResponse(200, futureLesson({ status: 'cancelled', cancellationReason: 'عطلة رسمية' })) })
    const { onUpdated } = renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    await chooseAction(ar.lessons.actions.cancel)
    const dialog = dialogOf(ar.lessons.confirm.cancel)
    expect(within(dialog).getByText(ar.lessons.confirm.reasonStored)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.confirm.reason), ' عطلة رسمية ')
    fireEvent.click(within(dialog).getByText(ar.lessons.actions.cancel, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => call.method === 'POST')).toEqual([{ method: 'POST', url: `/api/lessons/${LESSON_ID}/status`, body: { action: 'cancel', reason: 'عطلة رسمية' } }])
    expect(await screen.findByText(ar.lessons.done.cancel)).toBeInTheDocument()
    expect(await screen.findByText('عطلة رسمية')).toBeInTheDocument()
  })

  it('deletes a scheduled lesson without attendance: DELETE, then the drawer closes', async () => {
    const calls = mockLessonApi(() => futureLesson(), { DELETE: jsonResponse(204) })
    const { onDeleted, onClose } = renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    await chooseAction(ar.lessons.actions.delete)
    const dialog = dialogOf(ar.lessons.confirm.delete)
    expect(within(dialog).queryByLabelText(ar.lessons.confirm.reason)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.lessons.actions.delete, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(LESSON_ID))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([{ method: 'DELETE', url: `/api/lessons/${LESSON_ID}`, body: undefined }])
  })

  it('restores a cancelled lesson and shows a room conflict from the server in the dialog', async () => {
    const calls = mockLessonApi(() => futureLesson({ status: 'cancelled', cancellationReason: 'عطلة' }), {
      POST: jsonResponse(409, { statusCode: 409, code: 'lesson_conflict', resource: 'room', conflictingLessonId: 'l-2', conflictingClassId: 'c-2', message: 'nope' }),
    })
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByText('عطلة')).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.lessons.actions.restore])
    fireEvent.click(screen.getByText(ar.lessons.actions.restore, { selector: '.ant-dropdown-menu-title-content' }))

    const dialog = dialogOf(ar.lessons.confirm.restore)
    fireEvent.click(within(dialog).getByText(ar.lessons.actions.restore, { selector: 'button span' }).closest('button')!)
    expect(await within(dialog).findByText(ar.lessons.errors.lesson_conflict_room)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST')).toEqual([{ method: 'POST', url: `/api/lessons/${LESSON_ID}/status`, body: { action: 'restore' } }])
  })

  it('shows invalid_transition in the dialog and re-reads the lesson', async () => {
    const calls = mockLessonApi(() => futureLesson(), {
      POST: jsonResponse(409, { statusCode: 409, code: 'invalid_transition', from: 'completed', action: 'cancel', allowed: [], message: 'nope' }),
    })
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const reads = () => calls.filter((call) => call.method === 'GET').length
    const before = reads()

    await chooseAction(ar.lessons.actions.cancel)
    const dialog = dialogOf(ar.lessons.confirm.cancel)
    fireEvent.click(within(dialog).getByText(ar.lessons.actions.cancel, { selector: 'button span' }).closest('button')!)

    expect(await within(dialog).findByText(ar.lessons.errors.invalid_transition)).toBeInTheDocument()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it('edits with the smallest PATCH (title and end time) and hands the saved lesson back', async () => {
    const lesson = futureLesson()
    const calls = mockLessonApi(() => lesson, { PATCH: jsonResponse(200, futureLesson({ title: { ar: 'الأنواع', en: 'Variables and data types' }, updatedAt: '2026-11-07T10:00:00.000Z' })) })
    const { onUpdated } = renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    const title = await screen.findByLabelText(ar.lessons.fields.titleAr)
    await userEvent.clear(title)
    await userEvent.type(title, 'الأنواع')
    expect(screen.getByLabelText(ar.lessons.fields.date)).not.toBeDisabled()
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/lessons/${LESSON_ID}`, body: { title: { ar: 'الأنواع', en: 'Variables and data types' } } }])
    expect(await screen.findByText(ar.lessons.drawer.saved)).toBeInTheDocument()
    expect(await screen.findByText('الأنواع')).toBeInTheDocument()
  })

  it('refuses to keep an English description once its Arabic text is cleared (the PATCH would clear both) and sends nothing', async () => {
    const calls = mockLessonApi(() => futureLesson({ description: { ar: 'مقدمة', en: 'Intro' } }))
    const { onUpdated } = renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('مقدمة')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    await userEvent.clear(await screen.findByLabelText(ar.lessons.fields.descriptionAr))
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    expect(await screen.findByText(ar.lessons.validation.arabicFirst)).toBeInTheDocument()
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('closes the edit form on lesson_locked, names the locked fields in words and re-reads the lesson', async () => {
    const calls = mockLessonApi(() => futureLesson(), {
      PATCH: jsonResponse(409, { statusCode: 409, code: 'lesson_locked', status: 'completed', fields: ['startsAt', 'roomId'], message: 'nope' }),
    })
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const reads = () => calls.filter((call) => call.method === 'GET').length

    await editTitle('الأنواع')
    const before = reads()
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    const names = `(${ar.lessons.patchFields.startsAt}${ar.lessons.errors.listSeparator}${ar.lessons.patchFields.roomId})`
    expect(await screen.findByText(ar.lessons.errors.lesson_locked.replace('{{list}}', names))).toBeInTheDocument()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
    expect(screen.queryByText(ar.common.save)).not.toBeInTheDocument()
    expect(await screen.findByText('PY-101-A')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  })

  it('closes the edit form when the lesson is gone and shows the not-found message instead of its last details', async () => {
    let gone = false
    const notFound = () => jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', lessonId: LESSON_ID, message: 'No lesson' })
    mockFetch((url, init) => {
      const method = init?.method ?? 'GET'
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
      if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
      if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
      if (method === 'PATCH') {
        gone = true
        return notFound()
      }
      return gone ? notFound() : jsonResponse(200, futureLesson())
    })
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    await editTitle('الأنواع')
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)

    // The re-read answers 404: the drawer keeps only the message and its retry button.
    expect(await screen.findByText(ar.lessons.refresh)).toBeInTheDocument()
    expect(screen.queryByText('PY-101-A')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.common.save)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.getAllByText(ar.lessons.errors.lesson_not_found).length).toBeGreaterThan(0)
  })

  it('edits without classes.read: never reads the class, offers the current teacher by name and «no teacher», and says why', async () => {
    const calls = mockLessonApi(() => futureLesson())
    renderDrawer(['lessons.read', 'lessons.manage'])
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    expect(await screen.findByText(ar.lessons.hints.teacherNeedsClassesRead)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByLabelText(ar.lessons.fields.teacher))
    const options = await screen.findAllByText(/خالد المعلم|بلا معلم/, { selector: '.ant-select-item-option-content' })
    expect(options.map((option) => option.textContent)).toEqual(['خالد المعلم', ar.lessons.teacherOptions.none])
    expect(calls.classReads).toEqual([])
  })

  it('locks time, room and teacher of a completed lesson in the edit form and sends nothing when nothing changed', async () => {
    const calls = mockLessonApi(() => pastLesson({ status: 'completed' }))
    renderDrawer(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.lessons.actions.menu)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
    expect(await screen.findByText(ar.lessons.hints.timingLocked)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.lessons.fields.date)).toBeDisabled()
    expect(screen.getByLabelText(ar.lessons.fields.startTime)).toBeDisabled()
    expect(screen.getByLabelText(ar.lessons.fields.endTime)).toBeDisabled()
    expect(screen.getByLabelText(ar.lessons.fields.teacher).closest('.ant-select')).toHaveClass('ant-select-disabled')
    expect(screen.getByLabelText(ar.lessons.fields.room).closest('.ant-select')).toHaveClass('ant-select-disabled')
    expect(screen.getByLabelText(ar.lessons.fields.titleAr)).not.toBeDisabled()

    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.lessons.drawer.nothingChanged)).toBeInTheDocument()
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })
})
