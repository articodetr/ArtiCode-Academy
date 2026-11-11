// KI-058 (J-F40): while the lesson drawer's edit form or its attendance sheet holds
// unsaved work — a field changed, a row marked — Escape and a mask click no longer close
// the drawer, the close button asks before discarding it (common.unsaved.* — the guard of
// the class, user and course drawers and the role editor: KI-052, KI-054, KI-055, KI-057),
// and a reload or a tab close is held (beforeunload). Both editors compare with what the
// server holds, so a change changed back holds nothing; a read-only sheet never holds; a
// tab switch is no close. Browser back/forward: LessonDrawer.navigation.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AttendanceSheet } from '../api/attendance'
import type { Lesson } from '../api/lessons'
import { ar } from '../i18n/ar'
import { ATTENDANCE_STAFF_PERMISSIONS, ATTENDANCE_TEACHER_PERMISSIONS, fourStudents, makeAttendanceRecord, makeAttendanceSheet } from '../test/attendance'
import { CLASS_ID, makeClass } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { clickWhenSettled, waitForDrawersToSettle } from '../test/drawer'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, makeLesson } from '../test/lessons'
import { unloadWouldPrompt } from '../test/navigation'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { LessonDrawer } from './LessonDrawer'

type WriteMethod = 'PATCH' | 'PUT' | 'POST'

interface DrawerApiOptions {
  /** The sheet GET answers — re-read on every call. */
  sheet?: () => AttendanceSheet
  /** The answer of a write, by method (PATCH the lesson, PUT the sheet, POST the lesson's status); any other write fails. */
  answers?: Partial<Record<WriteMethod, () => Response>>
}

/** The lesson (API-094), its sheet (API-099) and the pickers of the edit form; every write is recorded. */
function mockDrawerApi({ sheet = () => makeAttendanceSheet(), answers = {} }: DrawerApiOptions = {}) {
  const writes: string[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (method !== 'GET') {
      writes.push(`${method} ${pathname}`)
      return answers[method as WriteMethod]?.() ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
    }
    if (pathname === `/api/lessons/${LESSON_ID}/attendance`) return jsonResponse(200, sheet())
    if (pathname === `/api/lessons/${LESSON_ID}`) return jsonResponse(200, makeLesson())
    if (pathname === `/api/classes/${CLASS_ID}`) return jsonResponse(200, makeClass())
    if (pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    return jsonResponse(404, { statusCode: 404, message: 'not found' })
  })
  return { writes }
}

/** The drawer with a spy parent: it stays open, so every close request is counted. */
async function renderDrawer(permissions: string[] = ATTENDANCE_TEACHER_PERMISSIONS) {
  const onClose = vi.fn()
  const onUpdated = vi.fn()
  renderWithProviders(<LessonDrawer lessonId={LESSON_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={vi.fn()} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/lessons',
  })
  await screen.findByText('PY-101-A')
  return { onClose, onUpdated }
}

/** Escape as the browser sends it: the drawer listens on the window (rc portal stack). */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })
const closeButton = () => document.querySelector<HTMLButtonElement>('.ant-drawer-close')!
const mask = () => document.querySelector<HTMLElement>('.ant-drawer-mask')!
/** Escape and the mask do nothing at all while an editor holds unsaved work: no close and no «discard?» question either. */
const expectNoDiscardQuestion = () => expect(screen.queryByText(ar.common.unsaved.title)).not.toBeInTheDocument()

const detailsTab = () => screen.getByRole('tab', { name: ar.attendance.drawerTabs.details })
const sheetTab = () => screen.getByRole('tab', { name: ar.attendance.drawerTabs.sheet })
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const titleInput = () => screen.getByLabelText(ar.lessons.fields.titleAr)

/** Opens the edit form of the details tab and returns its Arabic title. */
async function startEditing() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.lessons.fields.titleAr)
}

/** Opens the attendance tab and waits for its rows. */
async function openSheet() {
  fireEvent.click(sheetTab())
  await screen.findByText('سارة الطالبة')
}

/** Marks a student with a status button of the sheet (no popup is opened). */
const mark = (name: string, status: string) => fireEvent.click(within(row(name)).getByLabelText(status))

/** Clicks the drawer's close button and returns the «discard?» confirmation it opens (the latest one). */
async function openDiscardDialog(): Promise<HTMLElement> {
  await clickWhenSettled(closeButton)
  const titles = await screen.findAllByText(ar.common.unsaved.title)
  return titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement
}

describe('LessonDrawer — unsaved edit form and attendance sheet (KI-058)', () => {
  it('closes at once on Escape, on a mask click and with the close button while nothing is unsaved — the sheet and the edit form open untouched', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer()
    await openSheet()
    await startEditing()
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await clickWhenSettled(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(3)
    expectNoDiscardQuestion()
  })

  it('keeps the edit form and its draft on Escape (twice) and on a mask click; the close button asks — «keep editing» stays, «discard» closes once without a request', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.clear(title)
    await userEvent.type(title, 'الأنواع')

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(titleInput()).toHaveValue('الأنواع')
    expect(unloadWouldPrompt()).toBe(true)

    const first = await openDiscardDialog()
    expect(within(first).getByText(ar.common.unsaved.content)).toBeInTheDocument()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(titleInput()).toHaveValue('الأنواع'))
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('keeps an attendance row marked on Escape (twice) and on a mask click; the close button asks — «keep editing» stays, «discard» closes once without a PUT', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    await openSheet()
    mark('سارة الطالبة', ar.lessons.attendance.absent)

    pressEscape()
    pressEscape()
    await clickWhenSettled(mask)
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.absent)).toBeChecked()
    expect(unloadWouldPrompt()).toBe(true)

    const first = await openDiscardDialog()
    fireEvent.click(within(first).getByText(ar.common.unsaved.cancel).closest('button')!)
    await waitFor(() => expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.absent)).toBeChecked())
    expect(screen.getByText(ar.attendance.unsaved.replace('{{count}}', '1'))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    const second = await openDiscardDialog()
    fireEvent.click(within(second).getByText(ar.common.unsaved.ok).closest('button')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([])
  })

  it('drops the edit form’s draft on its own Cancel (an explicit discard): the form closes, nothing is held, and Escape closes at once', async () => {
    const { writes } = mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')
    expect(unloadWouldPrompt()).toBe(true)

    fireEvent.click(screen.getByText(ar.common.cancel).closest('button')!)
    await waitFor(() => expect(screen.queryByLabelText(ar.lessons.fields.titleAr)).not.toBeInTheDocument())
    expect(unloadWouldPrompt()).toBe(false)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('treats a tab switch as no close: with a title typed and a row marked, switching asks nothing and both keep their work', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer()
    const title = await startEditing()
    await userEvent.type(title, '!')

    fireEvent.click(sheetTab())
    await screen.findByText('سارة الطالبة')
    mark('سارة الطالبة', ar.lessons.attendance.late)
    fireEvent.click(detailsTab())
    expect(detailsTab()).toHaveAttribute('aria-selected', 'true')
    expect(titleInput()).toHaveValue('المتغيرات وأنواع البيانات!')
    fireEvent.click(sheetTab())
    expect(within(row('سارة الطالبة')).getByLabelText(ar.lessons.attendance.late)).toBeChecked()
    expectNoDiscardQuestion()

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expectNoDiscardQuestion()
  })

  it('lets go of changes changed back — a title typed away and back, a row set back to its saved status: then Escape closes at once', async () => {
    // Sara holds a present record (no minutes, no note): marked absent, then present again, the row is the server's record.
    const [sara, ...others] = fourStudents()
    const { writes } = mockDrawerApi({ sheet: () => makeAttendanceSheet({ items: [{ ...sara!, record: makeAttendanceRecord() }, ...others] }) })
    const { onClose } = await renderDrawer()

    const title = await startEditing()
    await userEvent.type(title, '!')
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)
    await userEvent.type(title, '{Backspace}')
    expect(title).toHaveValue('المتغيرات وأنواع البيانات')
    expect(unloadWouldPrompt()).toBe(false)

    await openSheet()
    mark('سارة الطالبة', ar.lessons.attendance.absent)
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect(unloadWouldPrompt()).toBe(true)
    mark('سارة الطالبة', ar.lessons.attendance.present)
    expect(screen.getByText(ar.attendance.noChanges)).toBeInTheDocument()
    expect(unloadWouldPrompt()).toBe(false)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([])
  })

  it('never holds a read-only sheet: staff without attendance.record see the rows, and Escape closes at once', async () => {
    mockDrawerApi()
    const { onClose } = await renderDrawer(ATTENDANCE_STAFF_PERMISSIONS)
    await openSheet()
    expect(screen.getByText(ar.attendance.readOnly)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).queryByLabelText(ar.lessons.attendance.absent)).not.toBeInTheDocument()

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(unloadWouldPrompt()).toBe(false)
  })

  it('holds nothing once the lesson is cancelled in the drawer: its sheet is read again read-only, so a reload is not held and the close button closes at once', async () => {
    let cancelled = false
    const { writes } = mockDrawerApi({
      sheet: () => (cancelled ? makeAttendanceSheet({ recordable: false, closedReason: 'cancelled', lessonStatus: 'cancelled' }) : makeAttendanceSheet()),
      answers: {
        POST: () => {
          cancelled = true
          return jsonResponse(200, makeLesson({ status: 'cancelled' }))
        },
      },
    })
    const { onClose, onUpdated } = await renderDrawer()
    await openSheet()
    mark('سارة الطالبة', ar.lessons.attendance.absent)
    expect(unloadWouldPrompt()).toBe(true)

    // The rows could not be saved any more: a cancelled lesson takes no attendance.
    // The dialog is drawn inside the drawer: until the drawer has settled it can show late (KI-060).
    await waitForDrawersToSettle()
    fireEvent.click(screen.getByText(ar.lessons.actions.menu).closest('button')!)
    fireEvent.click(await screen.findByText(ar.lessons.actions.cancel, { selector: '.ant-dropdown-menu-title-content' }))
    const dialog = screen.getByText(ar.lessons.confirm.cancel).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.lessons.actions.cancel, { selector: 'button span' }).closest('button')!)
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' })))
    expect(await screen.findByText(ar.attendance.closed.cancelled)).toBeInTheDocument()
    expect(unloadWouldPrompt()).toBe(false)

    await clickWhenSettled(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expectNoDiscardQuestion()
    expect(writes).toEqual([`POST /api/lessons/${LESSON_ID}/status`])
  })

  it('holds a reload or a tab close only while unsaved: released once the edit form saves, and once the sheet saves', async () => {
    const items = fourStudents()
    const saved = makeAttendanceSheet({ counts: { recorded: 3, present: 1, absent: 1, late: 1, excused: 0 }, items: [{ ...items[0]!, record: makeAttendanceRecord({ status: 'absent' }) }, ...items.slice(1)] })
    const renamed: Lesson = makeLesson({ title: { ar: 'الأنواع', en: 'Variables and data types' }, updatedAt: '2026-11-09T12:00:00.000Z' })
    const { writes } = mockDrawerApi({ answers: { PATCH: () => jsonResponse(200, renamed), PUT: () => jsonResponse(200, saved) } })
    await renderDrawer()
    expect(unloadWouldPrompt()).toBe(false)

    const title = await startEditing()
    await userEvent.clear(title)
    await userEvent.type(title, 'الأنواع')
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
    expect(await screen.findByText(ar.lessons.drawer.saved)).toBeInTheDocument()
    await waitFor(() => expect(unloadWouldPrompt()).toBe(false))

    await openSheet()
    mark('سارة الطالبة', ar.lessons.attendance.absent)
    expect(unloadWouldPrompt()).toBe(true)
    fireEvent.click(screen.getByText(ar.attendance.save).closest('button')!)
    expect(await screen.findByText(ar.attendance.saved)).toBeInTheDocument()
    // The server's answer starts a new session of the sheet: nothing is left to lose.
    await waitFor(() => expect(screen.getByText(ar.attendance.noChanges)).toBeInTheDocument())
    expect(unloadWouldPrompt()).toBe(false)
    expect(writes).toEqual([`PATCH /api/lessons/${LESSON_ID}`, `PUT /api/lessons/${LESSON_ID}/attendance`])
  })
})
