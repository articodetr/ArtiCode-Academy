import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExamResultsSheet } from '../api/examResults'
import type { Exam } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { instantIn } from '../assignments/assignments.zone'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { EXAM_ADMIN_PERMISSIONS, EXAM_ID, EXAM_READER_PERMISSIONS, EXAM_TIME_ZONE, makeExam, makeResultsSheet } from '../test/exams'
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
  /** The answer of a write; any other write fails. */
  respond?: Respond
}

/** The exam (API-114), its sheet (API-119), the academy and the class's lessons (the edit form's lesson select); `calls` records the exam requests. */
function mockExamApi({ detail, sheet = () => makeResultsSheet(), respond = () => undefined }: DrawerApiOptions) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const { pathname } = new URL(url, 'http://localhost')
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/lessons') return jsonResponse(200, makeLessonList([makeLesson()]))
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: pathname, body })
    if (method === 'GET') return jsonResponse(200, pathname.endsWith('/results') ? sheet() : detail())
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
})
