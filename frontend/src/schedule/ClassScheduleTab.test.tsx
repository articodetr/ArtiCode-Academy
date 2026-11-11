import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { ClassSchedule } from '../api/schedule'
import type { Room } from '../api/rooms'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, TEACHER_IDS, makeClass, makeClassTeacher } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { OTHER_CLASS_ID, ROOM_IDS, SCHEDULE_ADMIN_PERMISSIONS, SCHEDULE_READER_PERMISSIONS, SLOT_IDS, makeRoom, makeSchedule, makeSlot } from '../test/schedule'
import { formatDay } from '../users/users.format'
import { ClassScheduleTab } from './ClassScheduleTab'

interface Scheduling {
  weekStartsOn?: number | null
  workingDays?: number[] | null
}

interface ApiOptions {
  schedule?: ClassSchedule
  rooms?: Room[]
  scheduling?: Scheduling
  /** Answer of the PUT (default: the schedule). */
  put?: Response
  /** Answer of the GET schedule when given (e.g. a 404). */
  get?: Response
}

/** GET /api/academy, GET /api/rooms and GET/PUT /api/classes/:id/schedule; everything else is a 500. */
function mockScheduleApi({ schedule = makeSchedule(), rooms = [makeRoom()], scheduling = {}, put, get }: ApiOptions = {}) {
  const puts: unknown[] = []
  let reads = 0
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return jsonResponse(200, { ...makeAcademy(), settings: { scheduling: { weekStartsOn: null, workingDays: null, ...scheduling } } })
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, { items: rooms })
    if (parsed.pathname === `/api/classes/${CLASS_ID}/schedule`) {
      if (method === 'GET') {
        reads += 1
        return get ?? jsonResponse(200, schedule)
      }
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body)))
        return put ?? jsonResponse(200, schedule)
      }
    }
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return { puts, reads: () => reads }
}

function renderTab(permissions: string[], cls: AcademyClass = makeClass()) {
  renderWithProviders(<ClassScheduleTab cls={cls} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/classes' })
}

// The «تعديل» button is disabled until the schedule has arrived; a click on it before then is lost (KI-060).
const editButton = () => screen.getByText(ar.classSchedule.edit).closest('button')!
const openEditor = async () => {
  await waitFor(() => expect(editButton()).toBeEnabled())
  fireEvent.click(editButton())
}
const field = (name: keyof typeof ar.classSchedule.fields, n: number) => `${ar.classSchedule.fields[name]}: ${n}`
const setValue = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const option = (text: string): HTMLElement => screen.getByText(text, { selector: '.ant-select-item-option-content' }).closest('.ant-select-item-option') as HTMLElement
async function pick(label: string, text: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByText(text, { selector: '.ant-select-item-option-content' }))
}

describe('ClassScheduleTab', () => {
  it('shows a reader the slots by weekday — time, room, teacher, effective range — without an edit button', async () => {
    mockScheduleApi({
      schedule: makeSchedule([makeSlot(), makeSlot({ id: SLOT_IDS[1], weekday: 2, startTime: '13:00', endTime: '14:30', room: null, teacher: null, effectiveTo: '2026-12-20' })]),
    })
    renderTab(SCHEDULE_READER_PERMISSIONS)

    const time = await screen.findByText('10:00–11:00')
    // The range reads left to right in Arabic: dir="ltr" sits on a plain span, not on the
    // Typography element whose RTL class would override it (seen reversed in the browser run).
    expect(time).toHaveAttribute('dir', 'ltr')
    expect(time).not.toHaveClass('ant-typography')
    expect(screen.getByText('عدد الحصص الأسبوعية: 2')).toBeInTheDocument()
    expect(screen.getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(screen.getByText('المعلم: خالد المعلم')).toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.effectiveFrom.replace('{{from}}', formatDay('2026-11-10', 'ar')))).toBeInTheDocument()
    expect(screen.getByText('13:00–14:30')).toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.noRoom)).toBeInTheDocument()
    expect(screen.getByText(`المعلم: ${ar.classSchedule.defaultTeacher}`)).toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.effectiveRange.replace('{{from}}', formatDay('2026-11-10', 'ar')).replace('{{to}}', formatDay('2026-12-20', 'ar')))).toBeInTheDocument()
    const headings = within(screen.getByTestId('schedule-week')).getAllByRole('heading', { level: 5 }).map((heading) => heading.textContent)
    expect(headings).toEqual([ar.classSchedule.weekdays[0], ar.classSchedule.weekdays[2]])
    expect(screen.queryByText(ar.classSchedule.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.classSchedule.frozen)).not.toBeInTheDocument()
  })

  it('orders the week from weekStartsOn, and tells a manager that a completed class is frozen', async () => {
    mockScheduleApi({ schedule: makeSchedule([makeSlot(), makeSlot({ id: SLOT_IDS[1], weekday: 6 })]), scheduling: { weekStartsOn: 6 } })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS, makeClass({ status: 'completed' }))

    await screen.findByTestId('schedule-week')
    await waitFor(() => expect(within(screen.getByTestId('schedule-week')).getAllByRole('heading', { level: 5 }).map((heading) => heading.textContent)).toEqual([ar.classSchedule.weekdays[6], ar.classSchedule.weekdays[0]]))
    expect(screen.getByText(ar.classSchedule.frozen)).toBeInTheDocument()
    expect(screen.queryByText(ar.classSchedule.edit)).not.toBeInTheDocument()
    expect(screen.getByText(ar.labels.completed)).toBeInTheDocument()
  })

  it('adds a slot in the editor — working days only, active rooms, the class teachers — and saves the whole list in ONE PUT', async () => {
    const saved = makeSchedule([makeSlot(), makeSlot({ id: SLOT_IDS[1], weekday: 1, startTime: '09:00', endTime: '10:30', effectiveFrom: '2026-11-12' })])
    const api = mockScheduleApi({ rooms: [makeRoom(), makeRoom({ id: ROOM_IDS[1], code: 'OLD', name: null, isActive: false })], scheduling: { workingDays: [0, 1, 2, 3, 4] }, put: jsonResponse(200, saved) })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    expect(await screen.findByText('الحصة 1')).toBeInTheDocument()
    expect(screen.getByLabelText(field('startTime', 1))).toHaveValue('10:00')
    fireEvent.click(screen.getByText(ar.classSchedule.addSlot).closest('button')!)
    expect(screen.getByText('الحصة 2')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: field('weekday', 2) }))
    await screen.findByText(ar.classSchedule.weekdays[1], { selector: '.ant-select-item-option-content' })
    expect(option(`${ar.classSchedule.weekdays[5]} — ${ar.classSchedule.nonWorkingDay}`)).toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(screen.getByText(ar.classSchedule.weekdays[1], { selector: '.ant-select-item-option-content' }))
    setValue(field('startTime', 2), '09:00')
    setValue(field('endTime', 2), '10:30')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: field('room', 2) }))
    await screen.findByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' })
    // An inactive room is not offered to a new slot.
    expect(screen.queryByText(/OLD/, { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' }))
    await pick(field('teacher', 2), `خالد المعلم — ${ar.classes.teacherRoles.lead}`)
    setValue(field('effectiveFrom', 2), '2026-11-12')
    fireEvent.click(screen.getByText(ar.classSchedule.save).closest('button')!)

    await waitFor(() => expect(api.puts).toHaveLength(1))
    expect(api.puts).toEqual([
      {
        slots: [
          { id: SLOT_IDS[0], weekday: 0, startTime: '10:00', endTime: '11:00', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-10', effectiveTo: null },
          { weekday: 1, startTime: '09:00', endTime: '10:30', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-12', effectiveTo: null },
        ],
      },
    ])
    expect(await screen.findByText(ar.classSchedule.saved)).toBeInTheDocument()
    // The view shows what the server returned, not the drafts.
    expect(await screen.findByText('عدد الحصص الأسبوعية: 2')).toBeInTheDocument()
    expect(screen.getByText('09:00–10:30')).toBeInTheDocument()
    expect(screen.queryByTestId('schedule-editor')).not.toBeInTheDocument()
  })

  it('blocks saving on a local conflict or an end before the start, and sends nothing when the list did not change', async () => {
    const api = mockScheduleApi()
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    fireEvent.click((await screen.findByText(ar.classSchedule.addSlot)).closest('button')!)
    await pick(field('weekday', 2), ar.classSchedule.weekdays[0])
    setValue(field('startTime', 2), '10:30')
    setValue(field('endTime', 2), '11:30')
    setValue(field('effectiveFrom', 2), '2026-11-12')
    await pick(field('room', 2), 'LAB-1 — مختبر 1')
    expect(await screen.findByText('الحصتان 1 و2 تحجزان القاعة نفسها في وقت متداخل.')).toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.save).closest('button')).toBeDisabled()

    setValue(field('endTime', 2), '10:00')
    expect(await screen.findByText(ar.classSchedule.validation.end_after_start)).toBeInTheDocument()
    expect(screen.queryByText('الحصتان 1 و2 تحجزان القاعة نفسها في وقت متداخل.')).not.toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.save).closest('button')).toBeDisabled()

    fireEvent.click(screen.getByLabelText(`${ar.classSchedule.removeSlot}: 2`))
    expect(screen.queryByText('الحصة 2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classSchedule.save).closest('button')!)
    expect(await screen.findByText(ar.classSchedule.nothingChanged)).toBeInTheDocument()
    expect(api.puts).toEqual([])
    expect(await screen.findByText(ar.classSchedule.edit)).toBeInTheDocument()
  })

  it('sends an empty list to remove every slot', async () => {
    const api = mockScheduleApi({ put: jsonResponse(200, makeSchedule([])) })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    fireEvent.click(await screen.findByLabelText(`${ar.classSchedule.removeSlot}: 1`))
    expect(screen.getByText(ar.classSchedule.emptyDraft)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classSchedule.save).closest('button')!)

    await waitFor(() => expect(api.puts).toEqual([{ slots: [] }]))
    expect(await screen.findByText(ar.classSchedule.empty)).toBeInTheDocument()
  })

  it('shows a conflict with another class on the refused row (found by its values) and keeps the editor open', async () => {
    const tuesday = makeSlot({ id: SLOT_IDS[1], weekday: 2, startTime: '13:00', endTime: '14:00', room: null })
    const api = mockScheduleApi({
      schedule: makeSchedule([makeSlot(), tuesday]),
      put: jsonResponse(409, {
        statusCode: 409,
        code: 'schedule_conflict',
        kind: 'teacher',
        // As the real server answers: index 0 among the WRITTEN slots (only the Tuesday slot changed), values echoed.
        slot: { index: 0, weekday: 2, startTime: '13:00', endTime: '14:30', roomId: null, teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-10', effectiveTo: null },
        conflictingSlotId: SLOT_IDS[2],
        conflictingClassId: OTHER_CLASS_ID,
        message: 'booked',
      }),
    })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    setValue(field('endTime', 2), '14:30')
    fireEvent.click(screen.getByText(ar.classSchedule.save).closest('button')!)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('المعلم محجوز لفصل آخر في وقت متداخل (الحصة 2).')).toBeInTheDocument()
    expect(screen.getByTestId('slot-card-2')).toHaveStyle({ borderColor: '#ff4d4f' })
    expect(screen.getByTestId('slot-card-1')).not.toHaveStyle({ borderColor: '#ff4d4f' })
    expect(screen.getByTestId('schedule-editor')).toBeInTheDocument()
    expect(api.puts).toHaveLength(1)
    expect(screen.getByText(ar.classSchedule.save).closest('button')).toBeEnabled()
  })

  it('leaves the editor and re-reads the schedule when the server says the class is no longer schedulable', async () => {
    const api = mockScheduleApi({ put: jsonResponse(409, { statusCode: 409, code: 'class_not_schedulable', status: 'cancelled', message: 'frozen' }) })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    const before = api.reads()
    setValue(field('endTime', 1), '12:00')
    fireEvent.click(screen.getByText(ar.classSchedule.save).closest('button')!)

    expect(await screen.findByText(`لا يُعدَّل جدول فصل مكتمل أو ملغى (الحالة: ${ar.labels.cancelled}).`)).toBeInTheDocument()
    await waitFor(() => expect(api.reads()).toBeGreaterThan(before))
    expect(screen.queryByTestId('schedule-editor')).not.toBeInTheDocument()
  })

  it('keeps an inactive room on its kept slot with the marker first, and offers it to no new slot', async () => {
    mockScheduleApi({
      schedule: makeSchedule([makeSlot({ room: { id: ROOM_IDS[1], code: 'OLD', name: null, branch: null } })]),
      rooms: [makeRoom(), makeRoom({ id: ROOM_IDS[1], code: 'OLD', name: null, isActive: false })],
    })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS)

    await openEditor()
    // The marker leads the label, so a narrow select never cuts it off (seen in the real-backend run).
    expect(await screen.findByText('(موقوفة) OLD')).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.classSchedule.addSlot).closest('button')!)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: field('room', 2) }))
    await screen.findByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' })
    expect(screen.queryByText(/OLD/, { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
  })

  it('offers only the class teachers, and reports a class the caller may not see with a reload button', async () => {
    mockScheduleApi({ get: jsonResponse(404, { statusCode: 404, code: 'class_not_found', classId: CLASS_ID, message: 'no' }) })
    renderTab(SCHEDULE_ADMIN_PERMISSIONS, makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى المساعدة', role: 'assistant' })] }))

    expect(await screen.findByText(ar.classSchedule.errors.class_not_found)).toBeInTheDocument()
    expect(screen.getByText(ar.classSchedule.refresh)).toBeInTheDocument()
    // Without a schedule the editor cannot open.
    expect(screen.getByText(ar.classSchedule.edit).closest('button')).toBeDisabled()
  })
})
