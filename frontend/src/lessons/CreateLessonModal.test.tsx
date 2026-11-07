import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { CLASS_ID, TEACHER_IDS, makeClass, makeClassList, makeClassTeacher } from '../test/classes'
import { SYLLABUS_ITEM_IDS, makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ADMIN_PERMISSIONS, makeLesson } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ROOM_ID, makeRoom, makeRoomList } from '../test/timetable'
import { CreateLessonModal } from './CreateLessonModal'
import { rangeOf } from './lessons.format'

const twoTeachers = makeClass({ teachers: [makeClassTeacher(), makeClassTeacher({ userId: TEACHER_IDS[1], fullName: 'منى المساعدة', role: 'assistant' })] })

/** Serves the class picker (an open and a completed class), the rooms, the syllabus and POST /api/classes/:id/lessons. */
function mockCreateApi(createResponse: Response = jsonResponse(201, makeLesson({ id: 'new-1' }))) {
  const posts: unknown[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([twoTeachers, makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    if (parsed.pathname === `/api/classes/${CLASS_ID}/lessons` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return createResponse
    }
    return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'nope' })
  })
  return posts
}

async function renderOpen() {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<CreateLessonModal open onClose={onClose} onCreated={onCreated} />, { auth: makeAuth({ user: makeUser({ permissions: LESSON_ADMIN_PERMISSIONS }) }), route: '/lessons' })
  const dialog = (await screen.findByText(ar.lessons.create.title)).closest('[role="dialog"]') as HTMLElement
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
    fireEvent.click(await screen.findByText(ar.lessons.deliveryModes.hybrid, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.meetingUrl), 'https://meet.example.com/f')
    submit(dialog)

    const range = rangeOf('2026-11-12', '22:00', '00:30')!
    await waitFor(() =>
      expect(posts).toEqual([
        {
          title: { ar: 'الدوال', en: 'Functions' },
          deliveryMode: 'hybrid',
          startsAt: range.startsAt,
          endsAt: range.endsAt,
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
})
