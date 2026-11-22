import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../api/lessons'
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

/** Serves the class picker (an open and a completed class), the class's lessons, the academy and POST /api/classes/:id/exams. */
function mockCreateApi(createResponse: () => Response = () => jsonResponse(201, makeExam({ id: 'new-1' }))) {
  const posts: Record<string, unknown>[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'Pacific/Kiritimati' }))
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' }), makeClass({ id: 'closed-1', code: 'OLD-A', name: { ar: 'فصل قديم' }, status: 'completed' })]))
    if (parsed.pathname === '/api/lessons') return jsonResponse(200, makeLessonList([branchLesson]))
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

// --- MOD-09 phase 2: «طريقة الأداء» ---------------------------------------------

const online = ar.examOnline

/** Class, type, title and maximum score — what every new exam needs. */
async function fillBasics(dialog: HTMLElement) {
  await chooseClass(dialog)
  await chooseType(dialog, ar.exams.types.quiz)
  await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار قصير إلكتروني')
  await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '10')
}

/** Switches the form to an online exam and waits for its fields. */
async function chooseOnline(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByLabelText(online.delivery.online))
  return within(dialog).findByLabelText(online.fields.closesDate)
}

const setValue = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })

describe('CreateExamModal — an online exam (MOD-09 phase 2)', () => {
  it('starts as a manual exam with none of the online fields, and says the delivery may change while the exam is a draft', async () => {
    mockCreateApi()
    const { dialog } = await renderOpen()
    expect(within(dialog).getByLabelText(online.delivery.manual)).toBeChecked()
    expect(within(dialog).getByLabelText(online.delivery.online)).not.toBeChecked()
    expect(within(dialog).getByRole('radiogroup', { name: online.delivery.label })).toBeInTheDocument()
    expect(within(dialog).getByText(online.delivery.hint)).toBeInTheDocument()
    for (const label of [online.fields.closesDate, online.fields.closesTime, online.fields.attemptsAllowed, online.fields.resultsRelease, online.fields.revealAnswers, online.fields.opensDate]) {
      expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument()
    }
    expect(within(dialog).queryByTestId('exam-window-hint')).not.toBeInTheDocument()
    // The first-phase words of the date and the duration.
    expect(within(dialog).getByLabelText(ar.exams.fields.scheduledDate)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(ar.exams.fields.durationMinutes)).toBeInTheDocument()
  })

  it('creates an online exam: the window in the academy zone, one attempt’s limit and its settings — attempts as a JSON number, the reveal as a JSON boolean', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await fillBasics(dialog)
    await chooseOnline(dialog)

    // The date is now when the window opens and the duration one attempt's time limit; one line says how the three fit.
    expect(within(dialog).queryByLabelText(ar.exams.fields.scheduledDate)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(ar.exams.fields.durationMinutes)).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('exam-window-hint')).toHaveTextContent(online.hints.window)
    // The closing is typed in the same zone as the opening, and says so.
    expect(within(dialog).getByTestId('exam-closes-zone')).toHaveTextContent('Pacific/Kiritimati')
    // The server's defaults, ready to change.
    expect(within(dialog).getByLabelText(online.fields.attemptsAllowed)).toHaveValue('1')
    expect(within(dialog).getByLabelText(online.fields.revealAnswers)).not.toBeChecked()
    expect(within(dialog).getByText(online.release.on_publish)).toBeInTheDocument()

    setValue(dialog, online.fields.opensDate, '2026-11-20')
    setValue(dialog, online.fields.opensTime, '10:00')
    setValue(dialog, online.fields.closesDate, '2026-11-20')
    setValue(dialog, online.fields.closesTime, '12:00')
    await userEvent.type(within(dialog).getByLabelText(online.fields.attemptDuration), '30')
    const attempts = within(dialog).getByLabelText(online.fields.attemptsAllowed)
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '3')
    fireEvent.mouseDown(within(dialog).getByLabelText(online.fields.resultsRelease))
    fireEvent.click(await screen.findByText(online.release.on_submit, { selector: '.ant-select-item-option-content' }))
    fireEvent.click(within(dialog).getByLabelText(online.fields.revealAnswers))
    submit(dialog)

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      title: { ar: 'اختبار قصير إلكتروني' },
      type: 'quiz',
      maxScore: 10,
      scheduledAt: instantIn('2026-11-20', '10:00', 'Pacific/Kiritimati'),
      durationMinutes: 30,
      delivery: 'online',
      closesAt: instantIn('2026-11-20', '12:00', 'Pacific/Kiritimati'),
      attemptsAllowed: 3,
      resultsRelease: 'on_submit',
      revealAnswers: true,
    })
    // Kiritimati is UTC+14: 10:00–12:00 there is 20:00–22:00 UTC the day before.
    expect(posts[0]!.scheduledAt).toBe('2026-11-19T20:00:00.000Z')
    expect(posts[0]!.closesAt).toBe('2026-11-19T22:00:00.000Z')
    expect(typeof posts[0]!.attemptsAllowed).toBe('number')
    expect(typeof posts[0]!.revealAnswers).toBe('boolean')
  })

  it('creates an online draft without its window yet, with the defaults the form showed', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await fillBasics(dialog)
    await chooseOnline(dialog)
    submit(dialog)
    await waitFor(() => expect(posts).toEqual([{ title: { ar: 'اختبار قصير إلكتروني' }, type: 'quiz', maxScore: 10, delivery: 'online', attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false }]))
  })

  it('sends a manual exam’s body exactly as before after a switch to online and back — no delivery, no online setting', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await fillBasics(dialog)
    await chooseOnline(dialog)
    setValue(dialog, online.fields.closesDate, '2026-11-20')
    setValue(dialog, online.fields.closesTime, '12:00')
    fireEvent.click(within(dialog).getByLabelText(online.fields.revealAnswers))
    fireEvent.click(within(dialog).getByLabelText(online.delivery.manual))
    await waitFor(() => expect(within(dialog).queryByLabelText(online.fields.closesDate)).not.toBeInTheDocument())
    expect(within(dialog).getByLabelText(ar.exams.fields.scheduledDate)).toBeInTheDocument()
    submit(dialog)
    await waitFor(() => expect(posts).toEqual([{ title: { ar: 'اختبار قصير إلكتروني' }, type: 'quiz', maxScore: 10 }]))
  })

  it('refuses locally, in Arabic and before any request: a window that closes before it opens, half a closing, attempts out of range or emptied', async () => {
    const { posts } = mockCreateApi()
    const { dialog } = await renderOpen()
    await fillBasics(dialog)
    await chooseOnline(dialog)
    setValue(dialog, online.fields.opensDate, '2026-11-20')
    setValue(dialog, online.fields.opensTime, '10:00')
    setValue(dialog, online.fields.closesDate, '2026-11-20')
    setValue(dialog, online.fields.closesTime, '10:00')
    const attempts = within(dialog).getByLabelText(online.fields.attemptsAllowed)
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '21')
    submit(dialog)
    // Closing at the opening is no window either (window_invalid: at or before).
    expect(await within(dialog).findByText(online.validation.windowInvalid)).toBeInTheDocument()
    expect(await within(dialog).findByText(online.validation.attemptsAllowed.replace('{{max}}', '20'))).toBeInTheDocument()

    setValue(dialog, online.fields.closesTime, '')
    await userEvent.clear(attempts)
    submit(dialog)
    expect(await within(dialog).findByText(online.validation.closesTimeRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(online.validation.attemptsRequired)).toBeInTheDocument()
    expect(posts).toEqual([])
  })

  it('shows the server’s window_invalid on the closing', async () => {
    const { posts } = mockCreateApi(() => jsonResponse(400, { statusCode: 400, code: 'window_invalid', opensAt: '2026-11-19T20:00:00.000Z', closesAt: '2026-11-19T19:00:00.000Z', message: 'window' }))
    const { dialog, onCreated } = await renderOpen()
    await fillBasics(dialog)
    await chooseOnline(dialog)
    setValue(dialog, online.fields.closesDate, '2026-11-20')
    setValue(dialog, online.fields.closesTime, '12:00')
    submit(dialog)
    const closing = within(dialog).getByLabelText(online.fields.closesDate).closest('.ant-form-item') as HTMLElement
    expect(await within(closing).findByText(online.errors.window_invalid)).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
