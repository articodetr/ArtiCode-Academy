import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Lesson, LessonList } from '../api/lessons'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ADMIN_PERMISSIONS, makeAssignment } from '../test/assignments'
import { CLASS_ID, makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, LESSON_ID_2, makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { CreateAssignmentModal } from './CreateAssignmentModal'
import { formatZonedDay } from './assignments.format'
import { instantIn } from './assignments.zone'

/** The lessons of API-093 carry their display zone (D-R41) — the frontend Lesson type may not declare it yet. */
const withZone = (lesson: Lesson, timeZone: string) => ({ ...lesson, timeZone }) as Lesson
const branchLesson = withZone(makeLesson(), 'Europe/London')
const cancelledLesson = withZone(makeLesson({ id: LESSON_ID_2, title: { ar: 'الحلقات' }, startsAt: '2026-11-12T14:00:00.000Z', endsAt: '2026-11-12T15:00:00.000Z', status: 'cancelled' }), 'Asia/Riyadh')

interface CreateApiOptions {
  /** A promise answers when the test says so (the academy's first read still running). */
  academy?: Response | Promise<Response>
  createResponse?: Response
  /** The answer of GET /api/lessons for its query; default: the two lessons, one page. */
  lessons?: (query: URLSearchParams) => LessonList
}

/** Serves the class picker (an open and a completed class), the class's lessons, the academy and POST /api/classes/:id/assignments. */
function mockCreateApi({
  academy = jsonResponse(200, makeAcademy({ timezone: 'Pacific/Kiritimati' })),
  createResponse = jsonResponse(201, makeAssignment({ id: 'new-1' })),
  lessons = () => makeLessonList([branchLesson, cancelledLesson]),
}: CreateApiOptions = {}) {
  const posts: Record<string, unknown>[] = []
  const lessonQueries: URLSearchParams[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return academy instanceof Response ? academy.clone() : academy
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' }), makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === '/api/lessons') {
      lessonQueries.push(parsed.searchParams)
      return jsonResponse(200, lessons(parsed.searchParams))
    }
    if (parsed.pathname === `/api/classes/${CLASS_ID}/assignments` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return createResponse
    }
    return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'nope' })
  })
  return { posts, lessonQueries }
}

async function renderOpen(permissions: string[] = ASSIGNMENT_ADMIN_PERMISSIONS) {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(<CreateAssignmentModal open onClose={onClose} onCreated={onCreated} />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/assignments' })
  const dialog = (await screen.findByText(ar.assignments.create.title)).closest('[role="dialog"]') as HTMLElement
  return { dialog, onCreated, onClose }
}

async function chooseClass(dialog: HTMLElement) {
  fireEvent.mouseDown(within(dialog).getByLabelText(ar.assignments.fields.class))
  fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
}

async function chooseLesson(dialog: HTMLElement, label: string) {
  const lesson = within(dialog).getByLabelText(ar.assignments.fields.lesson)
  await waitFor(() => expect(lesson.closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
  fireEvent.mouseDown(lesson)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }))
}

function setDue(dialog: HTMLElement, date: string, time: string) {
  fireEvent.change(within(dialog).getByLabelText(ar.assignments.fields.dueDate), { target: { value: date } })
  fireEvent.change(within(dialog).getByLabelText(ar.assignments.fields.dueTime), { target: { value: time } })
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByText(ar.assignments.create.submit).closest('button')!)
}

describe('CreateAssignmentModal', () => {
  it('offers a completed class disabled; the lesson select waits for a class, then lists its lessons by day in their own zone', async () => {
    const { lessonQueries } = mockCreateApi()
    const { dialog } = await renderOpen()
    const lesson = within(dialog).getByLabelText(ar.assignments.fields.lesson)
    expect(lesson.closest('.ant-select')).toHaveClass('ant-select-disabled')
    expect(within(dialog).getByText(ar.assignments.pickers.lessonNeedsClass)).toBeInTheDocument()

    fireEvent.mouseDown(within(dialog).getByLabelText(ar.assignments.fields.class))
    const closed = await screen.findByText('OLD-A — فصل قديم', { selector: '.ant-select-item-option-content' })
    expect(closed.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(screen.getByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))

    await waitFor(() => expect(lesson.closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
    expect(Object.fromEntries(lessonQueries[0]!)).toEqual({ classId: CLASS_ID, order: 'asc', limit: '100' })
    fireEvent.mouseDown(lesson)
    expect(await screen.findByText(`${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`, { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.getByText(`${formatZonedDay(cancelledLesson.startsAt, 'Asia/Riyadh', 'ar')} — الحلقات · ${ar.labels.cancelled}`, { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
  })

  it('refuses locally, in Arabic and before any request: no class, no title, no score, an English title alone, a third decimal, a penalty without late submissions, a date without its time', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleEn), 'Loops')
    submit(dialog)
    expect(await within(dialog).findByText(ar.assignments.validation.classRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.assignments.validation.titleArRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.assignments.validation.arabicFirst)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.assignments.validation.maxScoreRequired)).toBeInTheDocument()

    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'الحلقات')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '12.345')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.latePenaltyPercent), '10')
    fireEvent.change(within(dialog).getByLabelText(ar.assignments.fields.dueDate), { target: { value: '2026-11-20' } })
    submit(dialog)
    expect(await within(dialog).findByText(ar.assignments.validation.maxScore)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.assignments.validation.latePenaltyNeedsAllowLate)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.assignments.validation.dueTimeRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('sends the smallest body: the title and the maximum score, the defaults left to the server', async () => {
    const { posts } = mockCreateApi()
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), ' تمارين الحلقات ')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '20')
    submit(dialog)
    await waitFor(() => expect(posts).toEqual([{ title: { ar: 'تمارين الحلقات' }, maxScore: 20 }]))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-1' })))
  })

  it('sends the whole body, the due date read in the zone of the linked lesson (D-R41) and named in the hint', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await chooseClass(dialog)
    await chooseLesson(dialog, `${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'تمارين')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleEn), 'Exercises')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.instructionsAr), 'حلّ التمارين')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '12.5')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.weight), '10')
    await userEvent.clear(within(dialog).getByLabelText(ar.assignments.fields.maxAttempts))
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxAttempts), '3')
    fireEvent.click(within(dialog).getByLabelText(ar.assignments.fields.allowLate))
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.latePenaltyPercent), '15')
    setDue(dialog, '2026-11-20', '23:59')

    const hint = within(dialog).getByTestId('assignment-due-zone')
    expect(hint).toHaveTextContent(ar.assignments.zone.lesson)
    expect(hint).toHaveTextContent('Europe/London')
    submit(dialog)

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      title: { ar: 'تمارين', en: 'Exercises' },
      instructions: { ar: 'حلّ التمارين' },
      lessonId: LESSON_ID,
      maxScore: 12.5,
      weight: 10,
      dueAt: '2026-11-20T23:59:00.000Z',
      allowLate: true,
      latePenaltyPercent: 15,
      maxAttempts: 3,
    })
  })

  it('reads the due date in the academy zone when no lesson is linked, and names it only when it is not this device zone', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await chooseClass(dialog)
    const hint = await within(dialog).findByTestId('assignment-due-zone')
    expect(hint).toHaveTextContent(ar.assignments.zone.academy)
    expect(hint).toHaveTextContent('Pacific/Kiritimati')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'واجب')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '20')
    setDue(dialog, '2026-11-21', '10:59')
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.dueAt).toBe(instantIn('2026-11-21', '10:59', 'Pacific/Kiritimati'))
    expect(posts[0]!.dueAt).toBe('2026-11-20T20:59:00.000Z')
  })

  it('names no zone when the academy uses this device zone', async () => {
    mockCreateApi({ academy: jsonResponse(200, makeAcademy({ timezone: deviceTimeZone() })) })
    const { dialog } = await renderOpen()
    await chooseClass(dialog)
    await waitFor(() => expect(within(dialog).getByLabelText(ar.assignments.fields.lesson).closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
    expect(within(dialog).queryByTestId('assignment-due-zone')).not.toBeInTheDocument()
  })

  it('falls back to this device zone, and says so, when the academy cannot be read', async () => {
    const { posts } = mockCreateApi({ academy: jsonResponse(503, { statusCode: 503, code: 'academy_not_configured', message: 'No academy' }) })
    const { dialog } = await renderOpen()
    const hint = await within(dialog).findByTestId('assignment-due-zone')
    expect(hint).toHaveTextContent(ar.assignments.zone.device)
    expect(hint).toHaveTextContent(deviceTimeZone())
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'واجب')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '20')
    setDue(dialog, '2026-11-20', '23:59')
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.dueAt).toBe(instantIn('2026-11-20', '23:59', deviceTimeZone()))
  })

  it('says the academy zone is still being read — not that it failed — until the academy answers, then types in it (the owner’s note 3 on #87)', async () => {
    let answer!: (response: Response) => void
    const academy = new Promise<Response>((resolve) => {
      answer = resolve
    })
    const { posts } = mockCreateApi({ academy })
    const { dialog } = await renderOpen()

    const pending = await within(dialog).findByTestId('assignment-due-zone')
    expect(pending).toHaveTextContent(ar.assignments.zone.pending)
    expect(pending).not.toHaveTextContent(ar.assignments.zone.device)
    expect(pending).toHaveTextContent(deviceTimeZone())

    await act(async () => answer(jsonResponse(200, makeAcademy({ timezone: 'Pacific/Kiritimati' }))))
    await waitFor(() => expect(within(dialog).getByTestId('assignment-due-zone')).toHaveTextContent(ar.assignments.zone.academy))
    expect(within(dialog).getByTestId('assignment-due-zone')).toHaveTextContent('Pacific/Kiritimati')
    // What the hint names is what the form submits with.
    await chooseClass(dialog)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'واجب')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '20')
    setDue(dialog, '2026-11-21', '10:59')
    submit(dialog)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.dueAt).toBe('2026-11-20T20:59:00.000Z')
  })

  it('offers the recent and coming lessons of a class longer than one page, and says so (the owner’s note 2 on #87)', async () => {
    const old = withZone(makeLesson({ id: 'old-lesson', title: { ar: 'درس قديم' }, startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' }), 'Asia/Riyadh')
    const { lessonQueries } = mockCreateApi({ lessons: (query) => (query.has('from') ? makeLessonList([branchLesson], 'next-2') : makeLessonList([old], 'next-1')) })
    const { dialog } = await renderOpen()
    await chooseClass(dialog)

    expect(await within(dialog).findByText('للفصل أكثر من 100 درس: تُعرض دروس آخر 30 يوماً والقادمة (حتى 100)')).toBeInTheDocument()
    expect(lessonQueries).toHaveLength(2)
    expect(lessonQueries[1]!.get('from')).not.toBeNull()
    const lesson = within(dialog).getByLabelText(ar.assignments.fields.lesson)
    fireEvent.mouseDown(lesson)
    expect(await screen.findByText(`${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`, { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.queryByText(/درس قديم/, { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
  })

  it('shows a server refusal on its field: lesson_mismatch on the lesson', async () => {
    mockCreateApi({ createResponse: jsonResponse(422, { statusCode: 422, code: 'lesson_mismatch', lessonId: LESSON_ID, classId: CLASS_ID, message: 'The lesson belongs to another class' }) })
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await chooseLesson(dialog, `${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`)
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'واجب')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '20')
    submit(dialog)
    const message = await within(dialog).findByText(ar.assignments.errors.lesson_mismatch)
    // On the lesson field itself, not in the alert above the form.
    expect(message.closest('.ant-form-item')).toBe(within(dialog).getByLabelText(ar.assignments.fields.lesson).closest('.ant-form-item'))
    expect(onCreated).not.toHaveBeenCalled()
  })
})
