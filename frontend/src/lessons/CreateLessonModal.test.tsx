import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Academy } from '../api/academy'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, TEACHER_IDS, makeClass, makeClassList, makeClassTeacher } from '../test/classes'
import { SYLLABUS_ITEM_IDS, makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { FAR_TIME_ZONE, LESSON_ADMIN_PERMISSIONS, LESSON_TIME_ZONE, makeLesson } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { BRANCH_ID, ROOM_ID, makeRoom, makeRoomList } from '../test/timetable'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { CreateLessonModal } from './CreateLessonModal'
import { durationMinutes, formatLessonDay, rangeOf } from './lessons.format'

const twoTeachers = makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى المساعدة', role: 'assistant' })] })
/** A room of a branch: the server would show a lesson there in the branch's zone (D-R41). */
const branchRoom = makeRoom({ id: 'room-branch', code: 'BR-1', name: { ar: 'قاعة الفرع' }, branchId: BRANCH_ID, branch: { id: BRANCH_ID, code: 'IST', name: { ar: 'فرع إسطنبول' } } })

/**
 * Serves the academy (API-035 — the zone the times are read in, makeAcademy()'s Asia/Riyadh by default), the class
 * picker (an open and a completed class), the rooms, the syllabus and POST /api/classes/:id/lessons.
 */
function mockCreateApi(createResponse: Response = jsonResponse(201, makeLesson({ id: 'new-1' })), academy: Academy | Response = makeAcademy()) {
  const posts: unknown[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return academy instanceof Response ? academy : jsonResponse(200, academy)
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([twoTeachers, makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom(), branchRoom]))
    if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    if (parsed.pathname === `/api/classes/${CLASS_ID}/lessons` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return createResponse
    }
    return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'nope' })
  })
  return posts
}

/** The line above the day and the times: which zone they are read in, and this device's when it differs. */
function zoneHint(source: 'academyInput' | 'deviceInput', zone: string): string {
  const device = deviceTimeZone()
  const named = ar.lessons.zone[source].replace('{{zone}}', zone)
  return zone === device ? named : `${named} — ${ar.lessons.zone.device.replace('{{zone}}', device)}`
}

/** Opens the modal and waits until the academy's zone is read (`zone` = what the hint then names). */
async function renderOpen(zone: string = LESSON_TIME_ZONE, source: 'academyInput' | 'deviceInput' = 'academyInput') {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<CreateLessonModal open onClose={onClose} onCreated={onCreated} />, { auth: makeAuth({ user: makeUser({ permissions: LESSON_ADMIN_PERMISSIONS }) }), route: '/lessons' })
  const dialog = (await screen.findByText(ar.lessons.create.title)).closest('[role="dialog"]') as HTMLElement
  await waitFor(() => expect(within(dialog).getByTestId('lesson-zone-hint')).toHaveTextContent(zoneHint(source, zone)))
  return { dialog, onCreated, onClose }
}

async function chooseClass(dialog: HTMLElement) {
  fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.class))
  fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
}

function fillTimes(dialog: HTMLElement, date: string, start: string, end: string) {
  fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.date), { target: { value: date } })
  fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.startTime), { target: { value: start } })
  fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.endTime), { target: { value: end } })
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByText(ar.lessons.create.submit).closest('button')!)
}

describe('CreateLessonModal', () => {
  it('offers a completed class disabled, and once a class is chosen its teachers (lead first, then «no teacher») and its syllabus items', async () => {
    mockCreateApi()
    const { dialog } = await renderOpen()
    // Before a class is chosen the teacher select waits for it.
    expect(within(dialog).getByLabelText(ar.lessons.fields.teacher).closest('.ant-select')).toHaveClass('ant-select-disabled')

    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.class))
    const closed = await screen.findByText('OLD-A — فصل قديم', { selector: '.ant-select-item-option-content' })
    expect(closed.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(screen.getByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))

    const teacher = within(dialog).getByLabelText(ar.lessons.fields.teacher)
    await waitFor(() => expect(teacher.closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
    fireEvent.mouseDown(teacher)
    const options = await screen.findAllByText(/خالد المعلم|منى المساعدة|بلا معلم/, { selector: '.ant-select-item-option-content' })
    expect(options.map((option) => option.textContent)).toEqual([`خالد المعلم — ${ar.lessons.teacherOptions.lead}`, `منى المساعدة — ${ar.lessons.teacherOptions.assistant}`, ar.lessons.teacherOptions.none])
    fireEvent.click(options[2]!)

    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.syllabusItem))
    expect(await screen.findByText('2. الشروط', { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
  })

  it('refuses locally an end time equal to the start, a lesson longer than 12 hours and an http meeting link, before any request', async () => {
    const posts = mockCreateApi()
    const { dialog } = await renderOpen()
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'درس')
    fillTimes(dialog, '2026-11-12', '10:00', '10:00')
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.meetingUrl), 'http://meet.example.com/a')
    submit(dialog)
    expect(await within(dialog).findByText(ar.lessons.validation.rangeEmpty)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.lessons.validation.meetingUrl)).toBeInTheDocument()

    fillTimes(dialog, '2026-11-12', '10:00', '23:30')
    submit(dialog)
    expect(await within(dialog).findByText('مدة الدرس لا تتجاوز 12 ساعة')).toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('refuses an English description without the Arabic one (it would be dropped) and sends nothing', async () => {
    const posts = mockCreateApi()
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'الدوال')
    fillTimes(dialog, '2026-11-12', '10:00', '11:00')
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.descriptionEn), 'Defining functions')
    submit(dialog)

    expect(await within(dialog).findByText(ar.lessons.validation.arabicFirst)).toBeInTheDocument()
    expect(posts).toEqual([])
    expect(onCreated).not.toHaveBeenCalled()

    // With the Arabic text the same English text travels with it.
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.descriptionAr), 'تعريف الدوال')
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect((posts[0] as { description: unknown }).description).toEqual({ ar: 'تعريف الدوال', en: 'Defining functions' })
  })

  it('sends the whole body: localized texts, NO_TEACHER as null, room, syllabus item, mode and link', async () => {
    const posts = mockCreateApi()
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'الدوال')
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleEn), 'Functions')
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.descriptionAr), 'تعريف الدوال')
    fillTimes(dialog, '2026-11-12', '22:00', '00:30')
    const teacher = within(dialog).getByLabelText(ar.lessons.fields.teacher)
    await waitFor(() => expect(teacher.closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
    fireEvent.mouseDown(teacher)
    fireEvent.click(await screen.findByText(ar.lessons.teacherOptions.none, { selector: '.ant-select-item-option-content' }))
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.room))
    fireEvent.click(await screen.findByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' }))
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.syllabusItem))
    fireEvent.click(await screen.findByText('2. الشروط', { selector: '.ant-select-item-option-content' }))
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.deliveryMode))
    // The select words the modes as the list's tag does (`labels.*` — J-F19).
    fireEvent.click(await screen.findByText(ar.labels.hybrid, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.meetingUrl), 'https://meet.example.com/f')
    submit(dialog)

    // 22:00 → 00:30 of the next day in the academy's zone (Asia/Riyadh, UTC+3).
    await waitFor(() =>
      expect(posts).toEqual([
        {
          title: { ar: 'الدوال', en: 'Functions' },
          deliveryMode: 'hybrid',
          startsAt: '2026-11-12T19:00:00.000Z',
          endsAt: '2026-11-12T21:30:00.000Z',
          description: { ar: 'تعريف الدوال' },
          roomId: ROOM_ID,
          teacherUserId: null,
          syllabusItemId: SYLLABUS_ITEM_IDS[1],
          meetingUrl: 'https://meet.example.com/f',
        },
      ]),
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('marks an end time that rolls over to the next day — (+1), the end day and the length — and drops the mark once the end is after the start (J-F19)', async () => {
    const posts = mockCreateApi()
    const { dialog } = await renderOpen()
    const endMark = () => within(dialog).getByTestId('lesson-end-mark')
    const sentence = (date: string, start: string, end: string) => {
      const range = rangeOf(date, start, end, LESSON_TIME_ZONE)!
      return ar.lessons.hints.endsNextDay
        .replace('{{date}}', formatLessonDay(range.endsAt, 'ar', LESSON_TIME_ZONE))
        .replace('{{minutes}}', String(durationMinutes(range.startsAt, range.endsAt)))
    }

    // The owner's typo: 13:00 → 01:00 is a valid 12-hour night lesson, so it must not pass unseen.
    fillTimes(dialog, '2026-11-12', '13:00', '01:00')
    await waitFor(() => expect(endMark()).toHaveTextContent('(+1)'))
    expect(within(dialog).getByText(sentence('2026-11-12', '13:00', '01:00'))).toBeInTheDocument()
    expect(sentence('2026-11-12', '13:00', '01:00')).toContain('720')

    // The mark sits beside the end time, inside the input's own box.
    expect(endMark().closest('.ant-input-affix-wrapper')).toContainElement(within(dialog).getByLabelText(ar.lessons.fields.endTime))

    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.endTime), { target: { value: '14:00' } })
    await waitFor(() => expect(endMark().textContent).toBe(''))
    expect(within(dialog).queryByText(/ينتهي الدرس في اليوم التالي/)).not.toBeInTheDocument()

    // An end equal to the start is refused as empty, not marked as a 24-hour lesson.
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.endTime), { target: { value: '13:00' } })
    await waitFor(() => expect(endMark().textContent).toBe(''))
    expect(posts).toEqual([])
  })

  it('words every refusal itself — the required fields and texts over 200 characters — never with antd’s default text (J-F19)', async () => {
    const posts = mockCreateApi()
    const { dialog } = await renderOpen()
    submit(dialog)
    for (const text of [ar.lessons.validation.classRequired, ar.lessons.validation.titleArRequired, ar.lessons.validation.dateRequired, ar.lessons.validation.startRequired, ar.lessons.validation.endRequired]) {
      expect(await within(dialog).findByText(text)).toBeInTheDocument()
    }

    const tooLong = 'أ'.repeat(201)
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.titleAr), { target: { value: tooLong } })
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.titleEn), { target: { value: 'a'.repeat(201) } })
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.descriptionAr), { target: { value: tooLong } })
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.descriptionEn), { target: { value: 'b'.repeat(201) } })
    submit(dialog)
    const maxLength = ar.lessons.validation.maxLength.replace('{{max}}', '200')
    await waitFor(() => expect(within(dialog).getAllByText(maxLength)).toHaveLength(4))
    // antd's own wording (ar_EG: «يرجى إدخال …», «… يصل إلى … أحرف») never shows.
    expect(within(dialog).queryByText(/يرجى إدخال|يصل إلى/)).not.toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('shows a server refusal on the field it names (teacher not assigned, room conflict) and keeps the dialog open', async () => {
    mockCreateApi(jsonResponse(422, { statusCode: 422, code: 'teacher_not_assigned', userId: TEACHER_IDS[0], message: 'nope' }))
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'درس')
    fillTimes(dialog, '2026-11-12', '10:00', '11:00')
    submit(dialog)
    expect(await within(dialog).findByText(ar.lessons.errors.teacher_not_assigned)).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()

    mockCreateApi(jsonResponse(409, { statusCode: 409, code: 'lesson_conflict', resource: 'room', conflictingLessonId: 'l-9', conflictingClassId: 'c-9', message: 'nope' }))
    submit(dialog)
    expect(await within(dialog).findByText(ar.lessons.errors.lesson_conflict_room)).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('reads the typed day and times in the academy’s zone and names it beside the device’s — never the browser’s zone (D-R41 — J-F28)', async () => {
    expect(deviceTimeZone()).not.toBe(FAR_TIME_ZONE)
    const posts = mockCreateApi(undefined, makeAcademy({ timezone: FAR_TIME_ZONE }))
    const { dialog } = await renderOpen(FAR_TIME_ZONE)
    // «Times in the academy's time zone: Pacific/Kiritimati — your device: …».
    expect(within(dialog).getByTestId('lesson-zone-hint')).toHaveTextContent(ar.lessons.zone.device.replace('{{zone}}', deviceTimeZone()))
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'درس')
    fillTimes(dialog, '2026-11-12', '23:00', '00:30')
    // The next day of the academy's zone, whose midnight is 10:00 UTC.
    await waitFor(() => expect(within(dialog).getByTestId('lesson-end-mark')).toHaveTextContent('(+1)'))
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    // 23:00 on the 12th in UTC+14 is 09:00 UTC on the 12th; 00:30 on the 13th is 10:30 UTC.
    expect(posts[0]).toMatchObject({ startsAt: '2026-11-12T09:00:00.000Z', endsAt: '2026-11-12T10:30:00.000Z' })
  })

  it('reads the times in the device’s zone when the academy cannot be read, and says so', async () => {
    const posts = mockCreateApi(undefined, jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'nope' }))
    const { dialog } = await renderOpen(deviceTimeZone(), 'deviceInput')
    expect(within(dialog).getByTestId('lesson-zone-hint')).not.toHaveTextContent(ar.lessons.zone.device.replace('{{zone}}', deviceTimeZone()))
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), 'درس')
    fillTimes(dialog, '2026-11-12', '09:00', '10:30')
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    const range = rangeOf('2026-11-12', '09:00', '10:30', deviceTimeZone())!
    expect(posts[0]).toMatchObject({ startsAt: range.startsAt, endsAt: range.endsAt })
  })

  it('says under the room that a room of a branch may show the lesson in that branch’s zone once created (D-R41)', async () => {
    mockCreateApi()
    const { dialog } = await renderOpen()
    const room = within(dialog).getByLabelText(ar.lessons.fields.room)
    expect(within(dialog).queryByText(ar.lessons.zone.followsRoom)).not.toBeInTheDocument()

    fireEvent.mouseDown(room)
    fireEvent.click(await screen.findByText('BR-1 — قاعة الفرع (IST)', { selector: '.ant-select-item-option-content' }))
    expect(await within(dialog).findByText(ar.lessons.zone.followsRoom)).toBeInTheDocument()

    // A room of the academy's own site keeps the academy's zone: nothing to say.
    fireEvent.mouseDown(room)
    fireEvent.click(await screen.findByText('LAB-1 — مختبر 1', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(within(dialog).queryByText(ar.lessons.zone.followsRoom)).not.toBeInTheDocument())
  })
})
