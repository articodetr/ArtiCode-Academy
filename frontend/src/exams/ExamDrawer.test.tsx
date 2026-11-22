import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExamQuestions } from '../api/examQuestions'
import type { ExamResultsSheet } from '../api/examResults'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { instantIn } from '../assignments/assignments.zone'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeExamQuestions } from '../test/examQuestions'
import { EXAM_ADMIN_PERMISSIONS, EXAM_ID, EXAM_READER_PERMISSIONS, EXAM_TIME_ZONE, ONLINE_EXAM_ADMIN_PERMISSIONS, makeExam, makeOnlineExam, makeOnlineSummary, makeResultsSheet } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamDrawer } from './ExamDrawer'

interface Call {
  method: string
  url: string
  body: unknown
}

type Respond = (method: string, url: string, body: unknown) => Response | undefined

interface DrawerApiOptions {
  /** GET /api/exams/:id — re-read on every call. */
  detail: () => Exam
  /** GET /api/exams/:id/results — re-read on every call. */
  sheet?: () => ExamResultsSheet
  /** GET /api/exams/:id/questions (an online exam's «الأسئلة» tab) — re-read on every call. */
  questions?: () => ExamQuestions
  /** The answer of a write; any other write fails. */
  respond?: Respond
}

/** The exam (API-114), its sheet (API-119), its questions (API-270), the academy and the class's lessons (the edit form's lesson select); `calls` records the exam requests. */
function mockExamApi({ detail, sheet = () => makeResultsSheet(), questions = () => makeExamQuestions(), respond = () => undefined }: DrawerApiOptions) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/lessons') return jsonResponse(200, makeLessonList([makeLesson()]))
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: pathname, body })
    if (method === 'GET') return jsonResponse(200, pathname.endsWith('/results') ? sheet() : pathname.endsWith('/questions') ? questions() : detail())
    return respond(method, pathname, body) ?? jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

function renderDrawer(permissions: string[] = EXAM_ADMIN_PERMISSIONS) {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  const view = renderWithProviders(<ExamDrawer examId={EXAM_ID} onClose={onClose} onUpdated={onUpdated} onDeleted={onDeleted} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/exams',
  })
  return { ...view, onUpdated, onDeleted, onClose }
}

async function openMenu() {
  fireEvent.click(screen.getByText(ar.exams.actions.menu).closest('button')!)
  return screen.findAllByRole('menuitem')
}

async function chooseAction(label: string) {
  fireEvent.click(screen.getByText(ar.exams.actions.menu).closest('button')!)
  fireEvent.click(await screen.findByText(label, { selector: '.ant-dropdown-menu-title-content' }))
}

async function openEdit() {
  fireEvent.click(screen.getByText(ar.common.edit).closest('button')!)
  return screen.findByLabelText(ar.exams.fields.titleAr)
}

function save() {
  fireEvent.click(screen.getByText(ar.common.save).closest('button')!)
}

const writes = (calls: Call[], method: string) => calls.filter((call) => call.method === method)
const examReads = (calls: Call[]) => calls.filter((call) => call.method === 'GET' && call.url === `/api/exams/${EXAM_ID}`)
const withResults = (students: number) => ({ students, scored: students, absent: 0, excused: 0 })
const cancelledClass = { ...makeExam().class, status: 'cancelled' as const }

describe('ExamDrawer', () => {
  it('shows a reader the exam read-only: class, course, type, date in its zone, duration, scores, weight, description, the status hint and the counts; no edit, no actions', async () => {
    mockExamApi({ detail: () => makeExam({ status: 'scheduled', results: { students: 14, scored: 12, absent: 1, excused: 1 } }) })
    renderDrawer(EXAM_READER_PERMISSIONS)

    expect(await screen.findByText('الفصول 1 إلى 4')).toBeInTheDocument()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByText(/أساسيات بايثون/)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.types.midterm)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.drawer.noLesson)).toBeInTheDocument()
    // The date in the exam's zone (D-R41), named because it is neither the CI runner's nor this machine's zone.
    expect(screen.getByText(formatZonedDateTime('2026-11-20T07:00:00.000Z', EXAM_TIME_ZONE, 'ar'))).toBeInTheDocument()
    expect(screen.getByText(EXAM_TIME_ZONE)).toBeInTheDocument()
    expect(screen.getByText('60 دقيقة')).toBeInTheDocument()
    expect(screen.getByTestId('exam-status-hint')).toHaveTextContent(ar.exams.drawer.statusHint.scheduled)
    const counts = screen.getByTestId('exam-results-summary')
    expect(within(counts).getByText('سُجّلت نتائج 14 من 18')).toBeInTheDocument()
    expect(within(counts).getByText('بدرجة: 12')).toBeInTheDocument()
    expect(within(counts).getByText('غائب: 1')).toBeInTheDocument()
    expect(within(counts).getByText('معذور: 1')).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.exams.actions.menu)).not.toBeInTheDocument()
  })

  it('says "not found or not in a class assigned to you" when the server answers 404', async () => {
    mockFetch((url) =>
      url.startsWith('/api/academy') ? jsonResponse(200, makeAcademy()) : jsonResponse(404, { statusCode: 404, code: 'exam_not_found', examId: EXAM_ID, message: 'No exam' }),
    )
    renderDrawer()
    expect(await screen.findByText(ar.exams.errors.exam_not_found)).toBeInTheDocument()
  })

  it('offers the actions of the mirrored state machine: schedule and delete for a draft, unschedule/publish/delete for a scheduled exam, publish only once results exist, unpublish for a published one', async () => {
    const cases: [Exam, string[]][] = [
      [makeExam({ status: 'draft' }), [ar.exams.actions.schedule, ar.exams.actions.delete]],
      [makeExam({ status: 'scheduled' }), [ar.exams.actions.unschedule, ar.exams.actions.publish, ar.exams.actions.delete]],
      [makeExam({ status: 'scheduled', results: withResults(3) }), [ar.exams.actions.publish]],
      [makeExam({ status: 'published', results: withResults(3), publishedAt: '2026-11-21T09:00:00.000Z' }), [ar.exams.actions.unpublish]],
    ]
    for (const [exam, labels] of cases) {
      mockExamApi({ detail: () => exam })
      const { unmount } = renderDrawer()
      await screen.findByText('PY-101-A')
      expect((await openMenu()).map((item) => item.textContent)).toEqual(labels)
      unmount()
    }
  })

  it('freezes an exam of a cancelled class: the warning, no edit, only what may still undo or remove it', async () => {
    mockExamApi({ detail: () => makeExam({ status: 'scheduled', class: cancelledClass }) })
    renderDrawer()
    expect(await screen.findByText(ar.exams.drawer.classCancelled)).toBeInTheDocument()
    expect(screen.queryByText(ar.common.edit)).not.toBeInTheDocument()
    expect((await openMenu()).map((item) => item.textContent)).toEqual([ar.exams.actions.unschedule, ar.exams.actions.delete])
  })

  it('schedules with the reason (POST /status) and hands the scheduled exam back', async () => {
    const scheduled = makeExam({ status: 'scheduled', updatedAt: '2026-11-09T10:00:00.000Z' })
    const calls = mockExamApi({ detail: () => makeExam(), respond: (method) => (method === 'POST' ? jsonResponse(200, scheduled) : undefined) })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.schedule)
    const dialog = screen.getByText(ar.exams.confirm.schedule).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.exams.confirm.reason), ' جاهز ')
    fireEvent.click(within(dialog).getByText(ar.exams.actions.schedule, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(scheduled))
    expect(writes(calls, 'POST')).toEqual([{ method: 'POST', url: `/api/exams/${EXAM_ID}/status`, body: { action: 'schedule', reason: 'جاهز' } }])
    expect(await screen.findByText(ar.exams.done.schedule)).toBeInTheDocument()
    expect(await screen.findByText(ar.exams.drawer.statusHint.scheduled)).toBeInTheDocument()
  })

  it('deletes a draft (DELETE without a body), reports it and closes', async () => {
    const calls = mockExamApi({ detail: () => makeExam(), respond: (method) => (method === 'DELETE' ? jsonResponse(204) : undefined) })
    const { onDeleted, onClose } = renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.delete)
    const dialog = screen.getByText(ar.exams.confirm.delete).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).queryByLabelText(ar.exams.confirm.reason)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.exams.actions.delete, { selector: 'button span' }).closest('button')!)

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(EXAM_ID))
    expect(onClose).toHaveBeenCalled()
    expect(writes(calls, 'DELETE')).toEqual([{ method: 'DELETE', url: `/api/exams/${EXAM_ID}`, body: undefined }])
  })

  it('re-reads the exam when unschedule meets results recorded elsewhere (exam_has_results), and the menu follows the fresh counts', async () => {
    let current = makeExam({ status: 'scheduled' })
    const calls = mockExamApi({
      detail: () => current,
      respond: (method) => {
        if (method !== 'POST') return undefined
        current = makeExam({ status: 'scheduled', results: withResults(2) })
        return jsonResponse(409, { statusCode: 409, code: 'exam_has_results', action: 'unschedule', resultCount: 2, message: 'results' })
      },
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.unschedule)
    const dialog = screen.getByText(ar.exams.confirm.unschedule).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.exams.actions.unschedule, { selector: 'button span' }).closest('button')!)
    expect(await within(dialog).findByText(ar.exams.errors.exam_has_results)).toBeInTheDocument()
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
    await waitFor(() => expect(within(screen.getByTestId('exam-results-summary')).getByText('سُجّلت نتائج 2 من 18')).toBeInTheDocument())
  })

  it('edits with the smallest PATCH: a new type and title and a cleared weight; the drawer shows the server answer', async () => {
    const saved = makeExam({ type: 'final', title: { ar: 'الاختبار النهائي', en: 'Midterm exam' }, weight: null, updatedAt: '2026-11-09T11:00:00.000Z' })
    const calls = mockExamApi({ detail: () => makeExam(), respond: (method) => (method === 'PATCH' ? jsonResponse(200, saved) : undefined) })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.clear(title)
    await userEvent.type(title, 'الاختبار النهائي')
    fireEvent.mouseDown(screen.getByLabelText(ar.exams.fields.type))
    fireEvent.click(await screen.findByText(ar.exams.types.final, { selector: '.ant-select-item-option-content' }))
    await userEvent.clear(screen.getByLabelText(ar.exams.fields.weight))
    save()

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { title: { ar: 'الاختبار النهائي', en: 'Midterm exam' }, type: 'final', weight: null } }])
    expect(await screen.findByText(ar.exams.drawer.saved)).toBeInTheDocument()
    expect(screen.queryByLabelText(ar.exams.fields.titleAr)).not.toBeInTheDocument()
    expect(screen.getByText(ar.exams.drawer.informational)).toBeInTheDocument()
  })

  it('sends nothing when nothing changed', async () => {
    const calls = mockExamApi({ detail: () => makeExam() })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    save()
    expect(await screen.findByText(ar.exams.drawer.nothingChanged)).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([])
  })

  it('types the exam date in the exam zone, named in the hint, and sends that instant', async () => {
    const calls = mockExamApi({
      detail: () => makeExam(),
      respond: (method) => (method === 'PATCH' ? jsonResponse(200, makeExam({ scheduledAt: '2026-11-25T06:30:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z' })) : undefined),
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByLabelText(ar.exams.fields.scheduledDate)).toHaveValue('2026-11-20')
    expect(screen.getByLabelText(ar.exams.fields.scheduledTime)).toHaveValue('10:00')
    const hint = await screen.findByTestId('exam-date-zone')
    expect(hint).toHaveTextContent(ar.exams.zone.exam)
    expect(hint).toHaveTextContent(EXAM_TIME_ZONE)
    fireEvent.change(screen.getByLabelText(ar.exams.fields.scheduledDate), { target: { value: '2026-11-25' } })
    fireEvent.change(screen.getByLabelText(ar.exams.fields.scheduledTime), { target: { value: '09:30' } })
    save()
    await waitFor(() => expect(writes(calls, 'PATCH')).toHaveLength(1))
    expect(writes(calls, 'PATCH')[0]!.body).toEqual({ scheduledAt: instantIn('2026-11-25', '09:30', EXAM_TIME_ZONE) })
    expect(writes(calls, 'PATCH')[0]!.body).toEqual({ scheduledAt: '2026-11-25T06:30:00.000Z' })
  })

  it('refuses locally a pass score above the maximum, and shows the server’s pass_score_invalid on that field', async () => {
    const calls = mockExamApi({
      detail: () => makeExam(),
      respond: (method) => (method === 'PATCH' ? jsonResponse(400, { statusCode: 400, code: 'pass_score_invalid', passScore: 45, maxScore: 40, message: 'pass' }) : undefined),
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    const pass = screen.getByLabelText(ar.exams.fields.passScore)
    await userEvent.clear(pass)
    await userEvent.type(pass, '60')
    save()
    expect(await screen.findByText(ar.exams.validation.passScoreAboveMax)).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([])

    // Within the maximum the form knows; the server's maximum is lower (changed elsewhere) and names it — on the field itself.
    await userEvent.clear(pass)
    await userEvent.type(pass, '45')
    save()
    const passItem = screen.getByLabelText(ar.exams.fields.passScore).closest('.ant-form-item') as HTMLElement
    expect(await within(passItem).findByText('درجة النجاح لا تتجاوز الدرجة القصوى (40).')).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { passScore: 45 } }])
  })

  it('locks the maximum score once a result exists: read-only with the reason, everything else still edits', async () => {
    mockExamApi({ detail: () => makeExam({ status: 'scheduled', results: withResults(1) }) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    expect(screen.getByText(ar.exams.hints.maxScoreLocked)).toBeInTheDocument()
    expect(screen.getByLabelText(ar.exams.fields.maxScore)).toBeDisabled()
    expect(title).toBeEnabled()
    expect(screen.getByLabelText(ar.exams.fields.passScore)).toBeEnabled()
    expect(screen.getByLabelText(ar.exams.fields.weight)).toBeEnabled()
  })

  it('maps exam_locked onto the form: the stored maximum returns with the reason, the other change stays, and the re-read locks it', async () => {
    let current = makeExam({ status: 'scheduled' })
    const calls = mockExamApi({
      detail: () => current,
      respond: (method) => {
        if (method !== 'PATCH') return undefined
        // A result was recorded meanwhile.
        current = makeExam({ status: 'scheduled', results: withResults(1) })
        return jsonResponse(409, { statusCode: 409, code: 'exam_locked', status: 'scheduled', fields: ['maxScore'], resultCount: 1, message: 'Locked' })
      },
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.clear(title)
    await userEvent.type(title, 'اختبار الفصل')
    const max = screen.getByLabelText(ar.exams.fields.maxScore)
    await userEvent.clear(max)
    await userEvent.type(max, '60')
    save()

    expect(await screen.findByText(ar.exams.validation.lockedAfterResult)).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { title: { ar: 'اختبار الفصل', en: 'Midterm exam' }, maxScore: 60 } }])
    expect(screen.getByLabelText(ar.exams.fields.maxScore)).toHaveValue('50')
    expect(screen.getByLabelText(ar.exams.fields.titleAr)).toHaveValue('اختبار الفصل')
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText(ar.exams.fields.maxScore)).toBeDisabled())
  })

  it('closes the form and re-reads when the class was cancelled meanwhile (class_closed)', async () => {
    const calls = mockExamApi({
      detail: () => makeExam(),
      respond: (method) => (method === 'PATCH' ? jsonResponse(409, { statusCode: 409, code: 'class_closed', classId: 'c-1', status: 'cancelled', message: 'Closed' }) : undefined),
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    const title = await openEdit()
    await userEvent.type(title, '!')
    save()
    expect(await screen.findByText(ar.exams.errors.class_closed)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText(ar.exams.fields.titleAr)).not.toBeInTheDocument())
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
  })

  it('opens the results sheet in its tab; a saved sheet updates the counts above the tabs and hands the exam with the server’s counts to the list', async () => {
    const answer = makeResultsSheet({ counts: { students: 3, scored: 1, absent: 1, excused: 1 } })
    const calls = mockExamApi({
      detail: () => makeExam({ status: 'scheduled', results: { students: 2, scored: 1, absent: 1, excused: 0 } }),
      respond: (method) => (method === 'PUT' ? jsonResponse(200, answer) : undefined),
    })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    // The sheet is read when its tab opens, not before.
    expect(calls.some((call) => call.url.endsWith('/results'))).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: ar.exams.drawer.tabs.results }))
    const omar = (await screen.findByText('عمر الخريج')).closest('tr') as HTMLElement
    fireEvent.click(within(omar).getByLabelText(ar.exams.results.status.excused))
    fireEvent.click(screen.getByText(ar.exams.results.save).closest('button')!)

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: EXAM_ID, results: answer.counts })))
    expect(within(screen.getByTestId('exam-results-summary')).getByText('سُجّلت نتائج 3 من 18')).toBeInTheDocument()
    expect(writes(calls, 'PUT')).toHaveLength(1)
    expect(examReads(calls)).toHaveLength(1)
  })

  it('shows the results tab’s «published» note right after «publish results» and drops it after «unpublish», without reading the sheet again (V2 D1)', async () => {
    const scheduled = makeExam({ status: 'scheduled', results: withResults(3) })
    const published = makeExam({ status: 'published', results: withResults(3), publishedAt: '2026-11-21T09:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z' })
    const calls = mockExamApi({
      detail: () => scheduled,
      sheet: () => makeResultsSheet({ examStatus: 'scheduled' }),
      respond: (method, _url, body) => (method === 'POST' ? jsonResponse(200, (body as { action: string }).action === 'publish' ? published : { ...scheduled, updatedAt: '2026-11-21T10:00:00.000Z' }) : undefined),
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    fireEvent.click(screen.getByRole('tab', { name: ar.exams.drawer.tabs.results }))
    await screen.findByText('عمر الخريج')
    expect(screen.queryByText(ar.exams.results.publishedNote)).not.toBeInTheDocument()

    await chooseAction(ar.exams.actions.publish)
    let dialog = screen.getByText(ar.exams.confirm.publish).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.exams.actions.publish, { selector: 'button span' }).closest('button')!)
    expect(await screen.findByText(ar.exams.results.publishedNote)).toBeInTheDocument()

    await chooseAction(ar.exams.actions.unpublish)
    dialog = screen.getByText(ar.exams.confirm.unpublish).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.exams.actions.unpublish, { selector: 'button span' }).closest('button')!)
    await waitFor(() => expect(screen.queryByText(ar.exams.results.publishedNote)).not.toBeInTheDocument())
    expect(writes(calls, 'POST').map((call) => call.body)).toEqual([{ action: 'publish' }, { action: 'unpublish' }])
    expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith('/results'))).toHaveLength(1)
  })
})

// --- MOD-09 phase 2: an online exam ----------------------------------------------

const online = ar.examOnline
const startedBy = (students: number, inProgress = 0, finished = students) => makeOnlineSummary({ frozen: true, attempts: { students, inProgress, finished } })
/** A translated text with its placeholders filled. */
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)

/**
 * The dialog of the latest confirmation with this title — a new one when `previous` is given: antd shows a confirm's
 * title twice, and jsdom never ends the closing animation of an answered one, so it may linger.
 */
async function confirmationOf(title: string, previous?: HTMLElement): Promise<HTMLElement> {
  const latest = () => {
    const titles = screen.queryAllByText(title)
    return titles.length > 0 ? (titles[titles.length - 1]!.closest('[role="dialog"]') as HTMLElement) : null
  }
  await waitFor(() => {
    const dialog = latest()
    if (!dialog || dialog === previous) throw new Error(`no new «${title}» confirmation yet`)
  })
  return latest()!
}

/** Clicks the button of a dialog by its exact label (the title of an action dialog starts with the same word). */
const clickIn = (dialog: HTMLElement, label: string) => fireEvent.click(within(dialog).getByText(label, { selector: 'button span' }).closest('button')!)
const setInput = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const itemOf = (label: string) => screen.getByLabelText(label).closest('.ant-form-item') as HTMLElement

describe('ExamDrawer — a manual exam shows none of the online parts (MOD-09 phase 2)', () => {
  it('keeps its details, its hint and its two tabs as they were', async () => {
    const calls = mockExamApi({ detail: () => makeExam({ status: 'scheduled' }) })
    renderDrawer(ONLINE_EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    expect(screen.getByTestId('exam-status-hint')).toHaveTextContent(ar.exams.drawer.statusHint.scheduled)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([ar.exams.drawer.tabs.details, ar.exams.drawer.tabs.results])
    expect(screen.queryByTestId('exam-readiness')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-online-tag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-online-questions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-online-attempts')).not.toBeInTheDocument()
    // The first-phase words of the date and the duration, and none of the online rows.
    expect(screen.getByText(ar.exams.fields.scheduledAt)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.fields.durationMinutes)).toBeInTheDocument()
    for (const label of [online.details.delivery, online.details.opensAt, online.details.closesAt, online.details.attemptDuration, online.details.attemptsAllowed, online.details.resultsRelease, online.details.revealAnswers, online.details.questions, online.details.attempts]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    expect(calls.some((call) => call.url.endsWith('/questions'))).toBe(false)
  })

  it('shows the delivery read-only in the edit form of an exam that is no longer a draft', async () => {
    mockExamApi({ detail: () => makeExam({ status: 'scheduled' }) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByLabelText(online.delivery.manual)).toBeChecked()
    expect(screen.getByLabelText(online.delivery.manual)).toBeDisabled()
    expect(screen.getByLabelText(online.delivery.online)).toBeDisabled()
    expect(screen.getByText(online.delivery.draftOnly)).toBeInTheDocument()
    expect(screen.queryByLabelText(online.fields.closesDate)).not.toBeInTheDocument()
  })
})

describe('ExamDrawer — the details of an online exam', () => {
  it('lists what keeps an online draft from being made available — the server’s problems in words, each with where it is put right', async () => {
    const draft = makeOnlineExam({ online: makeOnlineSummary({ questionCount: 2, totalPoints: 8, problems: ['questions_not_ready', 'points_mismatch', 'window_closed'] }) })
    const calls = mockExamApi({ detail: () => draft })
    renderDrawer(ONLINE_EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    expect(screen.getByTestId('exam-status-hint')).toHaveTextContent(online.statusHint.draft)
    const readiness = screen.getByTestId('exam-readiness')
    expect(within(readiness).getByText(online.readiness.title)).toBeInTheDocument()
    const problems = within(readiness).getAllByRole('listitem').map((item) => item.textContent)
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain(online.readiness.problems.questions_not_ready)
    expect(problems[0]).toContain(online.readiness.fix.questions)
    // The server's two numbers, not a sum of ours.
    expect(problems[1]).toContain(fill(online.readiness.problems.points_mismatch, { total: 8, max: 10 }))
    expect(problems[2]).toContain(online.readiness.problems.window_closed)
    expect(problems[2]).toContain(online.readiness.fix.settings)

    // The way to the «الأسئلة» tab: its questions are read when it opens.
    expect(calls.some((call) => call.url.endsWith('/questions'))).toBe(false)
    fireEvent.click(within(readiness).getByText(online.readiness.openQuestions).closest('button')!)
    await waitFor(() => expect(screen.getByRole('tab', { name: online.tab })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(calls.some((call) => call.url === `/api/exams/${EXAM_ID}/questions`)).toBe(true))
  })

  it('opens the edit form from the readiness list, and says a draft with nothing in the way is ready', async () => {
    let current = makeOnlineExam({ scheduledAt: null, closesAt: null, durationMinutes: null, online: makeOnlineSummary({ problems: ['window_missing', 'duration_missing'] }) })
    mockExamApi({ detail: () => current })
    const { unmount } = renderDrawer(ONLINE_EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const readiness = screen.getByTestId('exam-readiness')
    expect(readiness).toHaveTextContent(online.readiness.problems.window_missing)
    expect(readiness).toHaveTextContent(online.readiness.problems.duration_missing)
    // Nothing to put right in the questions: only the way to the settings shows.
    expect(within(readiness).queryByText(online.readiness.openQuestions)).not.toBeInTheDocument()
    fireEvent.click(within(readiness).getByText(online.readiness.openEdit).closest('button')!)
    expect(await screen.findByLabelText(online.fields.closesDate)).toHaveValue('')
    unmount()

    current = makeOnlineExam()
    renderDrawer(ONLINE_EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByTestId('exam-readiness')).toHaveTextContent(online.readiness.ready)
    expect(within(screen.getByTestId('exam-readiness')).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows the settings and the server’s summary: the window in the exam zone, the limit, the attempts, the release, the reveal, the questions and who has taken it', async () => {
    const taken = makeOnlineExam({ status: 'scheduled', resultsRelease: 'on_submit', revealAnswers: true, online: startedBy(3, 1, 4) })
    mockExamApi({ detail: () => taken })
    renderDrawer(EXAM_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    expect(screen.getByTestId('exam-status-hint')).toHaveTextContent(online.statusHint.scheduled)
    expect(screen.getByTestId('exam-online-tag')).toHaveTextContent(online.delivery.tag)
    // No readiness list once the exam was made available.
    expect(screen.queryByTestId('exam-readiness')).not.toBeInTheDocument()
    // The date is the opening of the window; the closing follows, both in the exam's zone.
    expect(screen.getByText(online.details.opensAt)).toBeInTheDocument()
    expect(screen.queryByText(ar.exams.fields.scheduledAt)).not.toBeInTheDocument()
    expect(screen.getByText(formatZonedDateTime('2026-11-20T07:00:00.000Z', EXAM_TIME_ZONE, 'ar'))).toBeInTheDocument()
    expect(screen.getByText(formatZonedDateTime('2026-11-20T09:00:00.000Z', EXAM_TIME_ZONE, 'ar'))).toBeInTheDocument()
    expect(screen.getAllByText(EXAM_TIME_ZONE)).toHaveLength(2)
    expect(screen.getByText(online.details.attemptDuration)).toBeInTheDocument()
    expect(screen.getByText('30 دقيقة')).toBeInTheDocument()
    expect(screen.getByText(online.details.attemptsAllowedValue_two)).toBeInTheDocument()
    expect(screen.getByText(online.release.on_submit)).toBeInTheDocument()
    expect(screen.getByText(online.details.revealYes)).toBeInTheDocument()
    const questions = screen.getByTestId('exam-online-questions')
    expect(questions).toHaveTextContent(fill(online.details.questionCount_few, { count: 5 }))
    expect(questions).toHaveTextContent(fill(online.details.points, { total: 10, max: 10 }))
    expect(within(questions).getByText(online.details.pointsMatch)).toBeInTheDocument()
    const attempts = screen.getByTestId('exam-online-attempts')
    expect(attempts).toHaveTextContent(fill(online.details.startedBy_few, { count: 3 }))
    expect(attempts).toHaveTextContent(fill(online.details.inProgress, { value: 1 }))
    expect(attempts).toHaveTextContent(fill(online.details.finished, { value: 4 }))
    // The three tabs of an online exam beside the details.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([ar.exams.drawer.tabs.details, online.tab, ar.examAttempts.tab, ar.exams.drawer.tabs.results])
  })

  it('says «not set yet» for a draft without its window, and marks points that do not equal the maximum score by the server’s word', async () => {
    mockExamApi({ detail: () => makeOnlineExam({ scheduledAt: null, closesAt: null, durationMinutes: null, online: makeOnlineSummary({ questionCount: 1, totalPoints: 4, problems: ['points_mismatch', 'window_missing', 'duration_missing'] }) }) })
    renderDrawer(EXAM_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getAllByText(online.details.notSet)).toHaveLength(3)
    const questions = screen.getByTestId('exam-online-questions')
    expect(questions).toHaveTextContent(online.details.questionCount_one)
    expect(within(questions).getByText(online.details.pointsMismatch)).toBeInTheDocument()
    expect(screen.getByTestId('exam-online-attempts')).toHaveTextContent(online.details.startedBy)
    // A reader gets the list of problems without the ways to act on them.
    const readiness = screen.getByTestId('exam-readiness')
    expect(within(readiness).queryByText(online.readiness.openEdit)).not.toBeInTheDocument()
    expect(within(readiness).getByText(online.readiness.openQuestions)).toBeInTheDocument()
  })
})

describe('ExamDrawer — the status actions of an online exam', () => {
  it('offers neither unschedule nor delete once somebody has started, and says what each action means for an online exam', async () => {
    const cases: [Exam, string[]][] = [
      [makeOnlineExam(), [ar.exams.actions.schedule, ar.exams.actions.delete]],
      [makeOnlineExam({ status: 'scheduled' }), [ar.exams.actions.unschedule, ar.exams.actions.publish, ar.exams.actions.delete]],
      [makeOnlineExam({ status: 'scheduled', online: startedBy(1) }), [ar.exams.actions.publish]],
      [makeOnlineExam({ status: 'published', online: startedBy(1), publishedAt: '2026-11-21T09:00:00.000Z' }), [ar.exams.actions.unpublish]],
    ]
    for (const [exam, labels] of cases) {
      mockExamApi({ detail: () => exam })
      const { unmount } = renderDrawer()
      await screen.findByText('PY-101-A')
      expect((await openMenu()).map((item) => item.textContent)).toEqual(labels)
      unmount()
    }

    mockExamApi({ detail: () => makeOnlineExam() })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.schedule)
    expect(await screen.findByText(online.confirm.schedule)).toBeInTheDocument()
    expect(screen.queryByText(ar.exams.confirm.schedule)).not.toBeInTheDocument()
  })

  it('lists the problems of exam_not_ready in the confirmation and re-reads the exam', async () => {
    let current = makeOnlineExam()
    const calls = mockExamApi({
      detail: () => current,
      respond: (method) => {
        if (method !== 'POST') return undefined
        // A question went back to draft in its bank meanwhile.
        current = makeOnlineExam({ online: makeOnlineSummary({ totalPoints: 8.5, problems: ['questions_not_ready', 'points_mismatch'] }) })
        return jsonResponse(409, { statusCode: 409, code: 'exam_not_ready', problems: ['questions_not_ready', 'points_mismatch'], totalPoints: 8.5, maxScore: 10, questionIds: ['q-1'], message: 'not ready' })
      },
    })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    expect(screen.getByTestId('exam-readiness')).toHaveTextContent(online.readiness.ready)
    await chooseAction(ar.exams.actions.schedule)
    const dialog = (await screen.findByText(online.confirm.schedule)).closest('[role="dialog"]') as HTMLElement
    clickIn(dialog, ar.exams.actions.schedule)

    const refusal = await within(dialog).findByTestId('exam-not-ready')
    expect(within(refusal).getByText(online.errors.notReadyTitle)).toBeInTheDocument()
    expect(within(refusal).getAllByRole('listitem').map((item) => item.textContent)).toEqual([online.readiness.problems.questions_not_ready, fill(online.readiness.problems.points_mismatch, { total: 8.5, max: 10 })])
    expect(writes(calls, 'POST')).toEqual([{ method: 'POST', url: `/api/exams/${EXAM_ID}/status`, body: { action: 'schedule' } }])
    expect(onUpdated).not.toHaveBeenCalled()
    // The details now list what the server found.
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('exam-readiness')).toHaveTextContent(online.readiness.problems.questions_not_ready))
  })

  it('says when the window closes when publish comes too early (exam_window_open), in the exam’s zone', async () => {
    const calls = mockExamApi({
      detail: () => makeOnlineExam({ status: 'scheduled', online: startedBy(2) }),
      respond: (method) => (method === 'POST' ? jsonResponse(409, { statusCode: 409, code: 'exam_window_open', closesAt: '2026-11-20T09:00:00.000Z', message: 'open' }) : undefined),
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.publish)
    const dialog = (await screen.findByText(online.confirm.publish)).closest('[role="dialog"]') as HTMLElement
    clickIn(dialog, ar.exams.actions.publish)
    expect(await within(dialog).findByText(fill(online.errors.exam_window_open, { when: formatZonedDateTime('2026-11-20T09:00:00.000Z', EXAM_TIME_ZONE, 'ar') }))).toBeInTheDocument()
    expect(within(dialog).getByText(EXAM_TIME_ZONE)).toBeInTheDocument()
    // Nothing changed elsewhere: no re-read.
    expect(examReads(calls)).toHaveLength(1)
  })

  it('re-reads when unschedule or delete meets a student who started meanwhile, and the menu follows', async () => {
    let current = makeOnlineExam({ status: 'scheduled' })
    const calls = mockExamApi({
      detail: () => current,
      respond: (method) => {
        current = makeOnlineExam({ status: 'scheduled', online: startedBy(1, 1, 0) })
        if (method === 'POST') return jsonResponse(409, { statusCode: 409, code: 'exam_has_attempts', action: 'unschedule', attemptCount: 1, message: 'attempts' })
        if (method === 'DELETE') return jsonResponse(409, { statusCode: 409, code: 'exam_not_deletable', status: 'scheduled', resultCount: 0, attemptCount: 1, message: 'started' })
        return undefined
      },
    })
    const { unmount } = renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.unschedule)
    let dialog = (await screen.findByText(online.confirm.unschedule)).closest('[role="dialog"]') as HTMLElement
    clickIn(dialog, ar.exams.actions.unschedule)
    expect(await within(dialog).findByText(fill(online.errors.exam_has_attempts, { attempts: 1 }))).toBeInTheDocument()
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('exam-online-attempts')).toHaveTextContent(online.details.startedBy_one))
    unmount()

    current = makeOnlineExam({ status: 'scheduled' })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await chooseAction(ar.exams.actions.delete)
    dialog = (await screen.findByText(online.confirm.delete)).closest('[role="dialog"]') as HTMLElement
    clickIn(dialog, ar.exams.actions.delete)
    expect(await within(dialog).findByText(fill(online.errors.exam_not_deletable, { attempts: 1 }))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('exam-online-attempts')).toHaveTextContent(online.details.startedBy_one))
  })
})

describe('ExamDrawer — editing an online exam', () => {
  it('edits the settings with the smallest PATCH: the attempts as a number and the reveal as a boolean', async () => {
    const saved = makeOnlineExam({ attemptsAllowed: 3, revealAnswers: true, updatedAt: '2026-11-09T11:00:00.000Z' })
    const calls = mockExamApi({ detail: () => makeOnlineExam(), respond: (method) => (method === 'PATCH' ? jsonResponse(200, saved) : undefined) })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByLabelText(online.delivery.online)).toBeChecked()
    expect(screen.getByLabelText(online.delivery.online)).toBeEnabled()
    expect(screen.getByLabelText(online.fields.opensDate)).toHaveValue('2026-11-20')
    expect(screen.getByLabelText(online.fields.opensTime)).toHaveValue('10:00')
    expect(screen.getByLabelText(online.fields.closesDate)).toHaveValue('2026-11-20')
    expect(screen.getByLabelText(online.fields.closesTime)).toHaveValue('12:00')
    expect(screen.getByLabelText(online.fields.attemptDuration)).toHaveValue('30')
    const attempts = screen.getByLabelText(online.fields.attemptsAllowed)
    expect(attempts).toHaveValue('2')
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '3')
    fireEvent.click(screen.getByLabelText(online.fields.revealAnswers))
    save()

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { attemptsAllowed: 3, revealAnswers: true } }])
    expect(await screen.findByText(online.details.revealYes)).toBeInTheDocument()
  })

  it('asks before turning an online draft manual — its linked questions are removed — and then sends `delivery` alone', async () => {
    const manual = makeExam({ maxScore: 10, updatedAt: '2026-11-09T11:00:00.000Z' })
    const calls = mockExamApi({ detail: () => makeOnlineExam(), respond: (method) => (method === 'PATCH' ? jsonResponse(200, manual) : undefined) })
    const { onUpdated } = renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    fireEvent.click(screen.getByLabelText(online.delivery.manual))
    await waitFor(() => expect(screen.queryByLabelText(online.fields.closesDate)).not.toBeInTheDocument())
    save()

    const first = await confirmationOf(online.toManual.title)
    expect(first).toHaveTextContent(online.toManual.content)
    // The server's count of linked questions.
    expect(first).toHaveTextContent(fill(online.toManual.questions, { value: 5 }))
    clickIn(first, online.toManual.cancel)
    expect(writes(calls, 'PATCH')).toEqual([])
    expect(screen.getByLabelText(online.delivery.manual)).toBeChecked()

    save()
    clickIn(await confirmationOf(online.toManual.title, first), online.toManual.ok)
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(manual))
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { delivery: 'manual' } }])
    // A manual exam again: no online tab, no online rows.
    await waitFor(() => expect(screen.queryByRole('tab', { name: online.tab })).not.toBeInTheDocument())
    expect(screen.queryByTestId('exam-online-tag')).not.toBeInTheDocument()
  })

  it('warns before extending a window that has closed on an exam that reveals its answers (KI-130), and sends only after «extend anyway»', async () => {
    // A window that closed years ago, whatever today is.
    const closed = makeOnlineExam({ status: 'scheduled', revealAnswers: true, scheduledAt: '2020-01-10T07:00:00.000Z', closesAt: '2020-01-10T09:00:00.000Z', online: startedBy(2) })
    const calls = mockExamApi({ detail: () => closed, respond: (method) => (method === 'PATCH' ? jsonResponse(200, { ...closed, closesAt: '2020-01-11T09:00:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z' }) : undefined) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    setInput(online.fields.closesDate, '2020-01-11')
    save()

    const first = await confirmationOf(online.reopen.title)
    expect(first).toHaveTextContent(online.reopen.content)
    clickIn(first, online.reopen.cancel)
    expect(writes(calls, 'PATCH')).toEqual([])

    save()
    clickIn(await confirmationOf(online.reopen.title, first), online.reopen.ok)
    await waitFor(() => expect(writes(calls, 'PATCH')).toHaveLength(1))
    expect(writes(calls, 'PATCH')[0]!.body).toEqual({ closesAt: '2020-01-11T09:00:00.000Z' })
  })

  it('asks nothing when the same window is extended on an exam that does not reveal its answers', async () => {
    const closed = makeOnlineExam({ status: 'scheduled', revealAnswers: false, scheduledAt: '2020-01-10T07:00:00.000Z', closesAt: '2020-01-10T09:00:00.000Z', online: startedBy(2) })
    const calls = mockExamApi({ detail: () => closed, respond: (method) => (method === 'PATCH' ? jsonResponse(200, { ...closed, closesAt: '2020-01-11T09:00:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z' }) : undefined) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    setInput(online.fields.closesDate, '2020-01-11')
    save()
    await waitFor(() => expect(writes(calls, 'PATCH')).toHaveLength(1))
    expect(screen.queryByText(online.reopen.title)).not.toBeInTheDocument()
  })

  it('once the learners see the exam: the maximum score is read-only with its reason, and the window and the time limit cannot be emptied', async () => {
    const calls = mockExamApi({ detail: () => makeOnlineExam({ status: 'scheduled' }) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByTestId('exam-online-lock-hint')).toHaveTextContent(online.hints.visible)
    expect(screen.getByText(online.hints.maxScoreFrozen)).toBeInTheDocument()
    expect(screen.queryByText(ar.exams.hints.maxScoreLocked)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.exams.fields.maxScore)).toBeDisabled()
    expect(screen.getByLabelText(online.delivery.manual)).toBeDisabled()
    // Not started: the window and the limit still move.
    expect(screen.getByLabelText(online.fields.opensDate)).toBeEnabled()
    expect(screen.getByLabelText(online.fields.attemptDuration)).toBeEnabled()

    setInput(online.fields.opensDate, '')
    setInput(online.fields.opensTime, '')
    setInput(online.fields.closesDate, '')
    setInput(online.fields.closesTime, '')
    await userEvent.clear(screen.getByLabelText(online.fields.attemptDuration))
    save()
    expect(await within(itemOf(online.fields.opensDate)).findByText(online.validation.opensRequired)).toBeInTheDocument()
    expect(await within(itemOf(online.fields.closesDate)).findByText(online.validation.closesRequired)).toBeInTheDocument()
    expect(await within(itemOf(online.fields.attemptDuration)).findByText(online.validation.durationRequired)).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([])
  })

  it('once somebody has started: the opening and the time limit are read-only, the closing only moves later and the attempts only rise', async () => {
    const taken = makeOnlineExam({ status: 'scheduled', online: startedBy(2) })
    const calls = mockExamApi({ detail: () => taken, respond: (method) => (method === 'PATCH' ? jsonResponse(200, { ...taken, closesAt: '2026-11-20T10:00:00.000Z', attemptsAllowed: 3, updatedAt: '2026-11-20T08:00:00.000Z' }) : undefined) })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    expect(screen.getByTestId('exam-online-lock-hint')).toHaveTextContent(online.hints.started)
    expect(screen.getByLabelText(online.fields.opensDate)).toBeDisabled()
    expect(screen.getByLabelText(online.fields.opensTime)).toBeDisabled()
    expect(screen.getByLabelText(online.fields.attemptDuration)).toBeDisabled()
    expect(screen.getByLabelText(online.fields.closesDate)).toBeEnabled()

    const attempts = screen.getByLabelText(online.fields.attemptsAllowed)
    setInput(online.fields.closesTime, '11:00')
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '1')
    save()
    expect(await within(itemOf(online.fields.closesDate)).findByText(online.validation.closesOnlyLater)).toBeInTheDocument()
    expect(await within(itemOf(online.fields.attemptsAllowed)).findByText(fill(online.validation.attemptsOnlyRise, { current: 2 }))).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([])

    // Later and more are both fine.
    setInput(online.fields.closesTime, '13:00')
    await userEvent.clear(attempts)
    await userEvent.type(attempts, '3')
    save()
    await waitFor(() => expect(writes(calls, 'PATCH')).toHaveLength(1))
    expect(writes(calls, 'PATCH')[0]!.body).toEqual({ closesAt: instantIn('2026-11-20', '13:00', EXAM_TIME_ZONE), attemptsAllowed: 3 })
  })

  it('maps exam_locked onto the form when a student started meanwhile: each refused field returns with its own reason, the other change stays, the re-read locks them', async () => {
    let current = makeOnlineExam({ status: 'scheduled' })
    const calls = mockExamApi({
      detail: () => current,
      respond: (method) => {
        if (method !== 'PATCH') return undefined
        current = makeOnlineExam({ status: 'scheduled', online: startedBy(1, 1, 0) })
        return jsonResponse(409, { statusCode: 409, code: 'exam_locked', status: 'scheduled', fields: ['scheduledAt', 'durationMinutes'], resultCount: 0, attemptCount: 1, message: 'Locked' })
      },
    })
    renderDrawer()
    await screen.findByText('PY-101-A')
    await openEdit()
    setInput(online.fields.opensTime, '09:00')
    const duration = screen.getByLabelText(online.fields.attemptDuration)
    await userEvent.clear(duration)
    await userEvent.type(duration, '45')
    fireEvent.click(screen.getByLabelText(online.fields.revealAnswers))
    save()

    expect(await within(itemOf(online.fields.opensDate)).findByText(online.locked.fixedOnceStarted)).toBeInTheDocument()
    expect(within(itemOf(online.fields.attemptDuration)).getByText(online.locked.fixedOnceStarted)).toBeInTheDocument()
    expect(writes(calls, 'PATCH')).toEqual([{ method: 'PATCH', url: `/api/exams/${EXAM_ID}`, body: { scheduledAt: instantIn('2026-11-20', '09:00', EXAM_TIME_ZONE), durationMinutes: 45, revealAnswers: true } }])
    // The stored values are back; the change the server did not refuse stays as typed.
    expect(screen.getByLabelText(online.fields.opensTime)).toHaveValue('10:00')
    expect(screen.getByLabelText(online.fields.attemptDuration)).toHaveValue('30')
    expect(screen.getByLabelText(online.fields.revealAnswers)).toBeChecked()
    await waitFor(() => expect(examReads(calls)).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText(online.fields.opensTime)).toBeDisabled())
    expect(screen.getByLabelText(online.fields.attemptDuration)).toBeDisabled()
  })

  it('warns in the schedule confirmation while the «الأسئلة» tab holds questions that were not saved', async () => {
    mockExamApi({ detail: () => makeOnlineExam() })
    renderDrawer(ONLINE_EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    fireEvent.click(screen.getByRole('tab', { name: online.tab }))
    const points = await screen.findByLabelText(fill(online.editor.pointsOf, { number: 1 }))
    await userEvent.clear(points)
    await userEvent.type(points, '5')
    await screen.findByTestId('exam-questions-unsaved')

    await chooseAction(ar.exams.actions.schedule)
    const dialog = (await screen.findByText(online.confirm.schedule)).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByText(online.confirm.unsavedQuestions)).toBeInTheDocument()
  })
})
