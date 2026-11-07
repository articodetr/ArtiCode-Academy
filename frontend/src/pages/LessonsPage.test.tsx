import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { LessonList } from '../api/lessons'
import { ar } from '../i18n/ar'
import { dayEndInstant, dayStartInstant, formatLessonDay, formatLessonTimes, rangeOf, todayIso } from '../lessons/lessons.format'
import { CLASS_ID, makeClass, makeClassList, makeTeacherCandidate } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ADMIN_PERMISSIONS, LESSON_ID_2, LESSON_LEARNER_PERMISSIONS, LESSON_STAFF_PERMISSIONS, LESSON_TEACHER_PERMISSIONS, makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { makeUserList } from '../test/users'
import { LessonsPage } from './LessonsPage'

const variables = makeLesson()
const loops = makeLesson({
  id: LESSON_ID_2,
  title: { ar: 'الحلقات' },
  deliveryMode: 'live_online',
  startsAt: '2026-11-12T14:00:00.000Z',
  endsAt: '2026-11-12T15:00:00.000Z',
  status: 'cancelled',
  room: null,
  teacher: null,
  meetingUrl: 'https://meet.example.com/loops',
  cancellationReason: 'عطلة',
})
const created = makeLesson({ id: 'new-1', title: { ar: 'الدوال' } })

/** Serves the lessons list (recording its queries), the pickers, the detail and POST /api/classes/:id/lessons. */
function mockLessonsApi(list: LessonList | Response, createResponse: Response = jsonResponse(201, created)) {
  const queries: URLSearchParams[] = []
  const posts: { url: string; body: unknown }[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/lessons' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list : jsonResponse(200, list)
    }
    if (parsed.pathname.startsWith('/api/lessons/') && method === 'GET') {
      const id = parsed.pathname.split('/').pop()
      return jsonResponse(200, id === 'new-1' ? created : variables)
    }
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass(), makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === `/api/classes/${CLASS_ID}` && method === 'GET') return jsonResponse(200, makeClass())
    if (parsed.pathname === `/api/classes/${CLASS_ID}/lessons` && method === 'POST') {
      posts.push({ url: parsed.pathname, body: JSON.parse(String(init?.body)) })
      return createResponse
    }
    if (parsed.pathname === '/api/users') return jsonResponse(200, makeUserList([makeTeacherCandidate()]))
    if (parsed.pathname === '/api/rooms') return jsonResponse(200, makeRoomList([makeRoom()]))
    if (parsed.pathname.endsWith('/syllabus')) return jsonResponse(200, makeSyllabus())
    return jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', message: 'nope' })
  })
  return { queries, posts }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<LessonsPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/lessons' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('LessonsPage', () => {
  it('shows a teacher the lessons of GET /api/lessons from today on: day, times, title, mode, class, course, teacher, place and status', async () => {
    const api = mockLessonsApi(makeLessonList([variables, loops]))
    renderPage(LESSON_TEACHER_PERMISSIONS)

    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ from: dayStartInstant(todayIso())!, order: 'asc', limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText(formatLessonDay(variables.startsAt, 'ar'))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(formatLessonTimes(variables.startsAt, variables.endsAt, 'ar'))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.in_person)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('LAB-1 — مختبر 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.scheduled)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.labels.live_online)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.lessons.drawer.noTeacher)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.lessons.drawer.noRoom)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.lessons.drawer.openMeeting).closest('a')).toHaveAttribute('href', 'https://meet.example.com/loops')
    expect(within(rows[1]!).getByText(ar.labels.cancelled)).toBeInTheDocument()
    // A teacher holds lessons.manage (adds lessons in their classes) and classes.read (the class filter), but not the teacher filter.
    expect(screen.getByText(ar.lessons.readOnlyHint)).toBeInTheDocument()
    expect(screen.getByText(ar.lessons.addLesson).closest('button')).toBeInTheDocument()
    expect(screen.getByLabelText(ar.lessons.columns.class)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.lessons.columns.teacher)).not.toBeInTheDocument()
  })

  it('tells a student that «my lessons» is still to come, with no add button and no class filter', async () => {
    const api = mockLessonsApi(makeLessonList([]))
    renderPage(LESSON_LEARNER_PERMISSIONS)

    expect(await screen.findByText(ar.lessons.learnerHint)).toBeInTheDocument()
    await waitFor(() => expect(api.queries).toHaveLength(1))
    expect(await screen.findByText(ar.lessons.emptyFiltered)).toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.addLesson)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.lessons.columns.class)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.readOnlyHint)).not.toBeInTheDocument()
  })

  it('gives staff every filter but no add button; status, order, class and dates re-query from the first page', async () => {
    const api = mockLessonsApi(makeLessonList([variables]))
    renderPage(LESSON_STAFF_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.lessons.addLesson)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.readOnlyHint)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.lessons.columns.teacher)).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.lessons.columns.status))
    fireEvent.click(await screen.findByText(ar.labels.cancelled, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('cancelled'))

    fireEvent.mouseDown(screen.getByLabelText(ar.lessons.filters.order))
    fireEvent.click(await screen.findByText(ar.lessons.filters.orderDesc, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))

    fireEvent.mouseDown(screen.getByLabelText(ar.lessons.columns.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe(CLASS_ID))

    fireEvent.change(screen.getByLabelText(ar.lessons.filters.from), { target: { value: '' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBeNull())
    fireEvent.change(screen.getByLabelText(ar.lessons.filters.to), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).toBe(dayEndInstant('2026-11-30')!))
    const last = api.queries.at(-1)!
    expect(last.get('status')).toBe('cancelled')
    expect(last.get('order')).toBe('desc')
    expect(last.get('classId')).toBe(CLASS_ID)
    expect(last.get('cursor')).toBeNull()
  })

  it('pages with the server cursor and back to the first page', async () => {
    const api = mockLessonsApi(makeLessonList([variables], 'cursor-2'))
    renderPage(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.lessons.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(await screen.findByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.lessons.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('الصفحة 1')).toBeInTheDocument()
  })

  it('shows a failed list with a retry button', async () => {
    const api = mockLessonsApi(jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage(LESSON_ADMIN_PERMISSIONS)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(within(alert).getByText(ar.lessons.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.length).toBe(2))
  })

  it('creates a lesson for a chosen class: POST /api/classes/:id/lessons carries the body, the list reloads and the new lesson opens', async () => {
    const api = mockLessonsApi(makeLessonList([variables]))
    renderPage(LESSON_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.lessons.addLesson).closest('button')!)
    const dialog = (await screen.findByText(ar.lessons.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.lessons.fields.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.lessons.fields.titleAr), ' الدوال ')
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.date), { target: { value: '2026-11-12' } })
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.startTime), { target: { value: '09:00' } })
    fireEvent.change(within(dialog).getByLabelText(ar.lessons.fields.endTime), { target: { value: '10:30' } })
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.lessons.create.submit).closest('button')!)

    const range = rangeOf('2026-11-12', '09:00', '10:30')!
    await waitFor(() => expect(api.posts).toEqual([{ url: `/api/classes/${CLASS_ID}/lessons`, body: { title: { ar: 'الدوال' }, deliveryMode: 'in_person', startsAt: range.startsAt, endsAt: range.endsAt } }]))
    expect(await screen.findByText('تم إنشاء الدرس «الدوال»')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
    // The drawer opens on the created lesson.
    expect(await screen.findByText(ar.lessons.fields.origin)).toBeInTheDocument()
  })
})
