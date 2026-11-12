import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Lesson, LessonList } from '../api/lessons'
import { formatZonedDay } from '../assignments/assignments.format'
import { instantIn } from '../assignments/assignments.zone'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, makeClass, makeClassList } from '../test/classes'
import { EXAM_ADMIN_PERMISSIONS, makeExam } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CreateExamModal } from './CreateExamModal'

/** A lesson of a branch room in another zone (D-R41): the exam linked to it is typed in that zone. */
const branchLesson: Lesson = { ...makeLesson(), timeZone: 'Europe/London' }

interface CreateApiOptions {
  /** The academy's first read answers when the test resolves it (J-F56). */
  academy?: Promise<Response>
  /** The answer of GET /api/lessons for its query; default: the branch lesson, one page. */
  lessons?: (query: URLSearchParams) => LessonList
}

/** Serves the class picker (an open and a completed class), the class's lessons, the academy and POST /api/classes/:id/exams. */
function mockCreateApi(createResponse: () => Response = () => jsonResponse(201, makeExam({ id: 'new-1' })), { academy, lessons = () => makeLessonList([branchLesson]) }: CreateApiOptions = {}) {
  const posts: Record<string, unknown>[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return academy ?? jsonResponse(200, makeAcademy({ timezone: 'Pacific/Kiritimati' }))
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' }), makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === '/api/lessons') return jsonResponse(200, lessons(parsed.searchParams))
    if (parsed.pathname === `/api/classes/${CLASS_ID}/exams` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return createResponse()
    }
    return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'nope' })
  })
  return { posts }
}

async function renderOpen() {
  const onCreated = vi.fn()
  renderWithProviders(<CreateExamModal open onClose={vi.fn()} onCreated={onCreated} />, { auth: makeAuth({ user: makeUser({ permissions: EXAM_ADMIN_PERMISSIONS }) }), route: '/exams' })
  const dialog = (await screen.findByText(ar.exams.create.title)).closest('[role="dialog"]') as HTMLElement
  return { dialog, onCreated }
}

async function chooseClass(dialog: HTMLElement) {
  fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.class))
  fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
}

async function chooseType(dialog: HTMLElement, label: string) {
  fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.type))
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }))
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByText(ar.exams.create.submit).closest('button')!)
}

describe('CreateExamModal', () => {
  it('offers a completed class disabled and the seven types of the contract', async () => {
    mockCreateApi()
    const { dialog } = await renderOpen()
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.class))
    const closed = await screen.findByText('OLD-A — فصل قديم', { selector: '.ant-select-item-option-content' })
    expect(closed.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled')
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.type))
    const types = await screen.findAllByText(new RegExp(Object.values(ar.exams.types).join('|')), { selector: '.ant-select-item-option-content' })
    expect(types.map((option) => option.textContent)).toEqual(Object.values(ar.exams.types))
  })

  it('refuses locally, in Arabic and before any request: no class, no type, no title, no maximum, a pass score above it, a whole duration, a date without its time', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    submit(dialog)
    expect(await within(dialog).findByText(ar.exams.validation.classRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.exams.validation.typeRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.exams.validation.titleArRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.exams.validation.maxScoreRequired)).toBeInTheDocument()

    await chooseClass(dialog)
    await chooseType(dialog, ar.exams.types.quiz)
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار قصير')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '20')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.passScore), '25')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.durationMinutes), '45.5')
    fireEvent.change(within(dialog).getByLabelText(ar.exams.fields.scheduledDate), { target: { value: '2026-11-20' } })
    submit(dialog)
    expect(await within(dialog).findByText(ar.exams.validation.passScoreAboveMax)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.exams.validation.duration)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.exams.validation.scheduledTimeRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('sends the smallest body — title, type and maximum score — and hands the created exam back', async () => {
    const { posts } = mockCreateApi()
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await chooseType(dialog, ar.exams.types.midterm)
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), ' اختبار منتصف الفصل ')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '50')
    submit(dialog)
    await waitFor(() => expect(posts).toEqual([{ title: { ar: 'اختبار منتصف الفصل' }, type: 'midterm', maxScore: 50 }]))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-1' })))
  })

  it('sends the whole body, the date read in the zone of the linked lesson (D-R41) and named in the hint; without a lesson, the academy zone', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await chooseClass(dialog)
    const hint = await within(dialog).findByTestId('exam-date-zone')
    expect(hint).toHaveTextContent(ar.exams.zone.academy)
    expect(hint).toHaveTextContent('Pacific/Kiritimati')

    const lesson = within(dialog).getByLabelText(ar.exams.fields.lesson)
    await waitFor(() => expect(lesson.closest('.ant-select')).not.toHaveClass('ant-select-disabled'))
    fireEvent.mouseDown(lesson)
    fireEvent.click(await screen.findByText(`${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`, { selector: '.ant-select-item-option-content' }))
    await chooseType(dialog, ar.exams.types.oral)
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار شفهي')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleEn), 'Oral exam')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.descriptionAr), 'أسئلة الوحدة الأولى')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '20')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.passScore), '10')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.weight), '15.5')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.durationMinutes), '30')
    fireEvent.change(within(dialog).getByLabelText(ar.exams.fields.scheduledDate), { target: { value: '2026-11-20' } })
    fireEvent.change(within(dialog).getByLabelText(ar.exams.fields.scheduledTime), { target: { value: '10:00' } })
    expect(within(dialog).getByTestId('exam-date-zone')).toHaveTextContent(ar.exams.zone.lesson)
    expect(within(dialog).getByTestId('exam-date-zone')).toHaveTextContent('Europe/London')
    submit(dialog)

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      title: { ar: 'اختبار شفهي', en: 'Oral exam' },
      type: 'oral',
      maxScore: 20,
      description: { ar: 'أسئلة الوحدة الأولى' },
      lessonId: LESSON_ID,
      scheduledAt: instantIn('2026-11-20', '10:00', 'Europe/London'),
      durationMinutes: 30,
      passScore: 10,
      weight: 15.5,
    })
    expect(posts[0]!.scheduledAt).toBe('2026-11-20T10:00:00.000Z')
  })

  it('says the academy zone is still being read — not that it failed — until the academy answers (J-F56, as the assignments’)', async () => {
    let answer!: (response: Response) => void
    const academy = new Promise<Response>((resolve) => {
      answer = resolve
    })
    mockCreateApi(undefined, { academy })
    const { dialog } = await renderOpen()

    const pending = await within(dialog).findByTestId('exam-date-zone')
    expect(pending).toHaveTextContent(ar.exams.zone.pending)
    expect(pending).not.toHaveTextContent(ar.exams.zone.device)
    expect(pending).toHaveTextContent(deviceTimeZone())

    await act(async () => answer(jsonResponse(200, makeAcademy({ timezone: 'Pacific/Kiritimati' }))))
    await waitFor(() => expect(within(dialog).getByTestId('exam-date-zone')).toHaveTextContent(ar.exams.zone.academy))
    expect(within(dialog).getByTestId('exam-date-zone')).toHaveTextContent('Pacific/Kiritimati')
  })

  it('offers the recent and coming lessons of a class longer than one page, and says so (J-F56)', async () => {
    const old: Lesson = { ...makeLesson({ id: 'old-lesson', title: { ar: 'درس قديم' }, startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' }), timeZone: 'Asia/Riyadh' }
    mockCreateApi(undefined, { lessons: (query) => (query.has('from') ? makeLessonList([branchLesson], 'next-2') : makeLessonList([old], 'next-1')) })
    const { dialog } = await renderOpen()
    await chooseClass(dialog)

    expect(await within(dialog).findByText('للفصل أكثر من 100 درس: تُعرض دروس آخر 30 يوماً والقادمة (حتى 100)')).toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.lesson))
    expect(await screen.findByText(`${formatZonedDay(branchLesson.startsAt, 'Europe/London', 'ar')} — المتغيرات وأنواع البيانات`, { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.queryByText(/درس قديم/, { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
  })

  it('shows a server refusal that names a field on that field, and any other one above the form', async () => {
    let answer = jsonResponse(409, { statusCode: 409, code: 'class_closed', classId: CLASS_ID, status: 'completed', message: 'closed' })
    const { posts } = mockCreateApi(() => answer)
    const { dialog, onCreated } = await renderOpen()
    await chooseClass(dialog)
    await chooseType(dialog, ar.exams.types.quiz)
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '20')
    submit(dialog)
    const classItem = within(dialog).getByLabelText(ar.exams.fields.class).closest('.ant-form-item') as HTMLElement
    expect(await within(classItem).findByText(ar.exams.errors.class_closed)).toBeInTheDocument()

    answer = jsonResponse(403, { statusCode: 403, code: 'permission_denied', missing: ['exams.manage'], message: 'denied' })
    submit(dialog)
    expect(await within(dialog).findByText('ليست لديك الصلاحية اللازمة لهذا الإجراء (exams.manage)')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
