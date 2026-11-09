import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Academy } from '../api/academy'
import type { LessonList } from '../api/lessons'
import { ar } from '../i18n/ar'
import { dayEndInstant, dayStartInstant, formatLessonDay, formatLessonTimes, rangeOf, todayIn } from '../lessons/lessons.format'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, makeClass, makeClassList, makeTeacherCandidate } from '../test/classes'
import { makeSyllabus } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import {
  FAR_TIME_ZONE,
  LESSON_ADMIN_PERMISSIONS,
  LESSON_ID_2,
  LESSON_LEARNER_PERMISSIONS,
  LESSON_STAFF_PERMISSIONS,
  LESSON_TEACHER_PERMISSIONS,
  LESSON_TIME_ZONE,
  makeLesson,
  makeLessonList,
} from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeRoom, makeRoomList } from '../test/timetable'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { makeUserList } from '../test/users'
import { LessonsPage } from './LessonsPage'

/** The first instant of today in a zone — the default «from» of the list. */
const todayStart = (zone: string) => dayStartInstant(todayIn(zone), zone)!

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

/**
 * Serves the academy (API-035 — its zone is the zone of the filter days, makeAcademy()'s Asia/Riyadh by default), the
 * lessons list (recording its queries), the pickers, the detail and POST /api/classes/:id/lessons; `paths` records
 * every request.
 */
function mockLessonsApi(list: LessonList | Response, createResponse: Response = jsonResponse(201, created), academy: Academy | Response | Promise<Response> = makeAcademy()) {
  const queries: URLSearchParams[] = []
  const posts: { url: string; body: unknown }[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    paths.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname === '/api/academy') return academy instanceof Response || academy instanceof Promise ? academy : jsonResponse(200, academy)
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
  return { queries, posts, paths }
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
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ from: todayStart(LESSON_TIME_ZONE), order: 'asc', limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText(formatLessonDay(variables.startsAt, 'ar', LESSON_TIME_ZONE))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(formatLessonTimes(variables.startsAt, variables.endsAt, 'ar', LESSON_TIME_ZONE))).toBeInTheDocument()
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

  it('points a student to «my lessons» (J-F11), with no add button and no class filter; without the student/guardian role the hint has no link', async () => {
    const api = mockLessonsApi(makeLessonList([]))
    const { unmount } = renderWithProviders(<LessonsPage />, {
      auth: makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: LESSON_LEARNER_PERMISSIONS }) }),
      route: '/lessons',
      routes: { '/my-lessons': <p>my lessons page</p> },
    })

    expect(await screen.findByText(ar.lessons.learnerHint)).toBeInTheDocument()
    await waitFor(() => expect(api.queries).toHaveLength(1))
    // The default «from today» is not a filter: the empty list is the plain «nothing from today on in your classes».
    expect(await screen.findByText(ar.lessons.emptyAssigned)).toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.emptyFiltered)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.addLesson)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.lessons.columns.class)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.readOnlyHint)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.lessons.myLessonsLink))
    expect(await screen.findByText('my lessons page')).toBeInTheDocument()
    unmount()

    // A custom role holding lessons.read without those role keys keeps the hint; a link would only meet the 403 page.
    renderWithProviders(<LessonsPage />, { auth: makeAuth({ user: makeUser({ role: null, roles: ['auditor'], permissions: ['lessons.read'] }) }), route: '/lessons' })
    expect(await screen.findByText(ar.lessons.learnerHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.myLessonsLink)).not.toBeInTheDocument()
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
    // The last millisecond of the 30th in the academy's zone (Asia/Riyadh, UTC+3).
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).toBe('2026-11-30T20:59:59.999Z'))
    const last = api.queries.at(-1)!
    expect(last.get('status')).toBe('cancelled')
    expect(last.get('order')).toBe('desc')
    expect(last.get('classId')).toBe(CLASS_ID)
    expect(last.get('cursor')).toBeNull()
  })

  it('says «no lessons from today on» under the default filters, and «nothing matches» once a filter is set or «from» is cleared', async () => {
    const api = mockLessonsApi(makeLessonList([]))
    renderPage(LESSON_STAFF_PERMISSIONS)

    expect(await screen.findByText(ar.lessons.empty)).toBeInTheDocument()
    expect(screen.queryByText(ar.lessons.emptyFiltered)).not.toBeInTheDocument()

    // A cleared «from» widens the list beyond the default: an empty answer is then «nothing matches».
    fireEvent.change(screen.getByLabelText(ar.lessons.filters.from), { target: { value: '' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBeNull())
    expect(await screen.findByText(ar.lessons.emptyFiltered)).toBeInTheDocument()

    // Today again = the default.
    fireEvent.change(screen.getByLabelText(ar.lessons.filters.from), { target: { value: todayIn(LESSON_TIME_ZONE) } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBe(todayStart(LESSON_TIME_ZONE)))
    expect(await screen.findByText(ar.lessons.empty)).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.lessons.columns.status))
    fireEvent.click(await screen.findByText(ar.labels.cancelled, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('cancelled'))
    expect(await screen.findByText(ar.lessons.emptyFiltered)).toBeInTheDocument()
  })

  it('keeps the class filter and the add button behind classes.read: classes.manage alone gets no picker and a disabled button with the reason', async () => {
    const api = mockLessonsApi(makeLessonList([variables]))
    renderPage(['lessons.read', 'lessons.manage', 'classes.manage'])
    await screen.findByText('PY-101-A')

    expect(screen.queryByLabelText(ar.lessons.columns.class)).not.toBeInTheDocument()
    const add = screen.getByText(ar.lessons.addLesson).closest('button')!
    expect(add).toBeDisabled()
    await userEvent.hover(add.parentElement!)
    expect(await screen.findByText(ar.lessons.hints.needsClassesRead)).toBeInTheDocument()
    // GET /api/classes would answer 403 without classes.read: the page never asks.
    expect(api.paths.filter((path) => path.startsWith('GET /api/classes'))).toEqual([])
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

    // Typed in the academy's zone (Asia/Riyadh): 09:00 is 06:00 UTC.
    const range = rangeOf('2026-11-12', '09:00', '10:30', LESSON_TIME_ZONE)!
    expect(range).toMatchObject({ startsAt: '2026-11-12T06:00:00.000Z', endsAt: '2026-11-12T07:30:00.000Z' })
    await waitFor(() => expect(api.posts).toEqual([{ url: `/api/classes/${CLASS_ID}/lessons`, body: { title: { ar: 'الدوال' }, deliveryMode: 'in_person', startsAt: range.startsAt, endsAt: range.endsAt } }]))
    expect(await screen.findByText('تم إنشاء الدرس «الدوال»')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
    // The drawer opens on the created lesson.
    expect(await screen.findByText(ar.lessons.fields.origin)).toBeInTheDocument()
  })

  it('shows each row in its own zone, names a zone that is not the device’s under its time, says so once above the table, and reads the filter days in the academy’s zone (D-R41 — J-F28)', async () => {
    const device = deviceTimeZone()
    expect(device).not.toBe(FAR_TIME_ZONE)
    // 10:00–11:30 UTC: 00:00–01:30 on the 11th in UTC+14; the second lesson sits in the device's own zone.
    const far = makeLesson({ timeZone: FAR_TIME_ZONE })
    const local = makeLesson({ id: LESSON_ID_2, title: { ar: 'الحلقات' }, timeZone: device })
    const api = mockLessonsApi(makeLessonList([far, local]), undefined, makeAcademy({ timezone: FAR_TIME_ZONE }))
    renderPage(LESSON_STAFF_PERMISSIONS)

    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    // «From today» is the academy's today, from its midnight (10:00 UTC the day before).
    expect(api.queries[0]!.get('from')).toBe(todayStart(FAR_TIME_ZONE))
    expect(screen.getByLabelText(ar.lessons.filters.from)).toHaveValue(todayIn(FAR_TIME_ZONE))
    const [farRow, localRow] = bodyRows() as [HTMLElement, HTMLElement]
    expect(within(farRow).getByText('00:00 – 01:30')).toBeInTheDocument()
    expect(within(farRow).getByText(formatLessonDay(far.startsAt, 'ar', FAR_TIME_ZONE))).toBeInTheDocument()
    expect(within(farRow).getByTestId('lesson-row-zone')).toHaveTextContent(FAR_TIME_ZONE)
    expect(within(localRow).getByText(formatLessonTimes(local.startsAt, local.endsAt, 'ar', device))).toBeInTheDocument()
    expect(within(localRow).queryByTestId('lesson-row-zone')).not.toBeInTheDocument()
    // One note for the page: the rows' zones against the device's, and the zone of the filter days.
    const note = screen.getByTestId('lesson-zone-note')
    expect(note).toHaveTextContent(ar.lessons.zone.rows.replace('{{zone}}', device))
    expect(note).toHaveTextContent(ar.lessons.zone.days.replace('{{zone}}', FAR_TIME_ZONE))

    fireEvent.change(screen.getByLabelText(ar.lessons.filters.to), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).toBe('2026-11-30T09:59:59.999Z'))
    expect(api.queries.at(-1)?.get('to')).toBe(dayEndInstant('2026-11-30', FAR_TIME_ZONE))
  })

  it('says nothing about zones when the academy and every lesson are in the device’s zone', async () => {
    const device = deviceTimeZone()
    mockLessonsApi(makeLessonList([makeLesson({ timeZone: device })]), undefined, makeAcademy({ timezone: device }))
    renderPage(LESSON_STAFF_PERMISSIONS)
    expect(await screen.findByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-zone-note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lesson-row-zone')).not.toBeInTheDocument()
  })

  it('waits for the academy’s zone before its first request, and reads the days in the device’s zone when the academy cannot be read', async () => {
    let release: (response: Response) => void = () => {}
    const academy = new Promise<Response>((resolve) => {
      release = resolve
    })
    const api = mockLessonsApi(makeLessonList([]), undefined, academy)
    const { unmount } = renderPage(LESSON_STAFF_PERMISSIONS)
    await waitFor(() => expect(api.paths).toContain('GET /api/academy'))
    // No list request in the device's zone first: one request, with the academy's «today».
    expect(api.queries).toHaveLength(0)
    release(jsonResponse(200, makeAcademy({ timezone: FAR_TIME_ZONE })))
    await waitFor(() => expect(api.queries).toHaveLength(1))
    expect(api.queries[0]!.get('from')).toBe(todayStart(FAR_TIME_ZONE))
    unmount()

    const failed = mockLessonsApi(makeLessonList([]), undefined, jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'nope' }))
    renderPage(LESSON_STAFF_PERMISSIONS)
    await waitFor(() => expect(failed.queries).toHaveLength(1))
    expect(failed.queries[0]!.get('from')).toBe(todayStart(deviceTimeZone()))
    expect(await screen.findByText(ar.lessons.empty)).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-zone-note')).not.toBeInTheDocument()
  })
})
