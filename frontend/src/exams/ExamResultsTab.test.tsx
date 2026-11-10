import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExamResultsSheet } from '../api/examResults'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { ar } from '../i18n/ar'
import { EXAM_ID, EXAM_READER_PERMISSIONS, EXAM_TEACHER_PERMISSIONS, EXAM_TIME_ZONE, RESULT_STUDENT_IDS, fourResultStudents, makeExamResult, makeResultsSheet } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { FAR_TIME_ZONE } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamResultsTab } from './ExamResultsTab'
import { RESULT_STATUS_COLORS } from './exams.format'

const [SARA, YOUSEF, , OMAR] = RESULT_STUDENT_IDS

interface Call {
  method: string
  url: string
  body: unknown
}

/** GET answers `get()` (re-read on every call), PUT answers `put(body)`; every request is recorded. */
function mockSheetApi(get: () => ExamResultsSheet | Response, put?: (body: unknown) => Response) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
    calls.push({ method, url, body })
    if (method === 'GET') {
      const answer = get()
      return answer instanceof Response ? answer : jsonResponse(200, answer)
    }
    if (method === 'PUT' && put) return put(body)
    return jsonResponse(500, { statusCode: 500, message: 'unexpected' })
  })
  return calls
}

/** `timeZone` = the exam's (D-R41): the sheet shows when each result was written in it. `onUnsavedChange` is what the drawer hears. */
function renderTab(permissions: string[], timeZone: string = EXAM_TIME_ZONE) {
  const onSaved = vi.fn()
  const onExamStale = vi.fn()
  const onUnsavedChange = vi.fn()
  const view = renderWithProviders(<ExamResultsTab exam={{ id: EXAM_ID, timeZone }} onSaved={onSaved} onExamStale={onExamStale} onUnsavedChange={onUnsavedChange} />, {
    auth: makeAuth({ user: makeUser({ permissions }) }),
    route: '/exams',
  })
  return { ...view, onSaved, onExamStale, onUnsavedChange }
}

const lastReported = (onUnsavedChange: ReturnType<typeof vi.fn>) => onUnsavedChange.mock.calls.at(-1)?.[0] as boolean | undefined
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
const findRow = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement
const saveButton = () => screen.getByText(ar.exams.results.save).closest('button') as HTMLButtonElement
const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT')
const gets = (calls: Call[]) => calls.filter((call) => call.method === 'GET')
const scoreOf = (name: string) => within(row(name)).getByLabelText(`${ar.exams.results.columns.scoreLabel}: ${name}`)
const feedbackOf = (name: string) => within(row(name)).getByLabelText(`${ar.exams.results.columns.feedback}: ${name}`)
const mark = (name: string, status: keyof typeof ar.exams.results.status) => fireEvent.click(within(row(name)).getByLabelText(ar.exams.results.status[status]))

describe('ExamResultsTab', () => {
  it('shows a teacher one row per student with the enrollment and the result; a student withdrawn after the exam stays read-only', async () => {
    const calls = mockSheetApi(() => makeResultsSheet())
    renderTab(EXAM_TEACHER_PERMISSIONS)

    const yousef = await findRow('يوسف الطالب')
    expect(gets(calls).map((call) => call.url)).toEqual([`/api/exams/${EXAM_ID}/results`])
    expect(within(yousef).getByText(ar.exams.results.enrollment.active)).toBeInTheDocument()
    expect(within(yousef).getByLabelText(ar.exams.results.status.scored)).toBeChecked()
    expect(scoreOf('يوسف الطالب')).toHaveValue('41.5')
    expect(feedbackOf('يوسف الطالب')).toHaveValue('أحسنت في السؤال الثالث')
    expect(within(yousef).getByText(/خالد المعلم/)).toBeInTheDocument()

    const layla = row('ليلى المنسحبة')
    expect(within(layla).getByText(ar.exams.results.enrollment.withdrawn)).toBeInTheDocument()
    expect(within(layla).getByText(ar.exams.results.readOnlyRow)).toBeInTheDocument()
    expect(within(layla).getByText(ar.exams.results.status.absent)).toHaveClass(`ant-tag-${RESULT_STATUS_COLORS.absent}`)
    expect(within(layla).queryByLabelText(ar.exams.results.status.scored)).not.toBeInTheDocument()

    expect(within(row('عمر الخريج')).getByText(ar.exams.results.enrollment.completed)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByLabelText(ar.exams.results.status.scored)).not.toBeChecked()
    // The score input waits for «scored».
    expect(scoreOf('سارة الطالبة')).toBeDisabled()
    // The server's counts and maximum — nothing is added up here.
    expect(screen.getByText('نتائج مسجّلة: 2')).toBeInTheDocument()
    expect(screen.getByText(`${ar.exams.results.status.scored}: 1`)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.results.columns.score.replace('{{max}}', '50'), { selector: 'th' })).toBeInTheDocument()
    expect(screen.getByText(ar.exams.results.noChanges)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('saves ONE PUT with the changed rows only, each as its whole result, then shows the server answer in a new session', async () => {
    const items = fourResultStudents()
    const answer = makeResultsSheet({
      counts: { students: 4, scored: 2, absent: 1, excused: 1 },
      items: [
        { ...items[0]!, result: makeExamResult({ score: 47.25, feedback: 'ممتاز', recordedBy: { userId: 'u-9', fullName: 'منى المساعدة' } }) },
        items[1]!,
        items[2]!,
        { ...items[3]!, result: makeExamResult({ status: 'excused', score: null, recordedBy: { userId: 'u-9', fullName: 'منى المساعدة' } }) },
      ],
    })
    const calls = mockSheetApi(
      () => makeResultsSheet(),
      () => jsonResponse(200, answer),
    )
    const { onSaved } = renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')

    mark('سارة الطالبة', 'scored')
    await userEvent.type(scoreOf('سارة الطالبة'), '47.25')
    await userEvent.type(feedbackOf('سارة الطالبة'), ' ممتاز ')
    mark('عمر الخريج', 'excused')
    expect(screen.getByText(ar.exams.results.unsaved.replace('{{count}}', '2'))).toBeInTheDocument()
    fireEvent.click(saveButton())

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(answer))
    expect(puts(calls)).toEqual([
      {
        method: 'PUT',
        url: `/api/exams/${EXAM_ID}/results`,
        body: { results: [{ studentId: SARA, status: 'scored', score: 47.25, feedback: 'ممتاز' }, { studentId: OMAR, status: 'excused' }] },
      },
    ])
    expect(await screen.findByText(ar.exams.results.saved)).toBeInTheDocument()
    expect(await screen.findByText('نتائج مسجّلة: 4')).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByText(/منى المساعدة/)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.results.noChanges)).toBeInTheDocument()
    expect(gets(calls)).toHaveLength(1)
  })

  it('sends nothing while nothing changed: an undone row and a score typed back with another number of zeros drop out', async () => {
    const calls = mockSheetApi(
      () => makeResultsSheet(),
      () => jsonResponse(200, makeResultsSheet()),
    )
    renderTab(EXAM_TEACHER_PERMISSIONS)
    const yousef = await findRow('يوسف الطالب')

    mark('يوسف الطالب', 'absent')
    expect(saveButton()).toBeEnabled()
    fireEvent.click(within(yousef).getByText(ar.exams.results.revert).closest('button')!)
    expect(within(yousef).getByLabelText(ar.exams.results.status.scored)).toBeChecked()
    expect(saveButton()).toBeDisabled()
    await userEvent.clear(scoreOf('يوسف الطالب'))
    await userEvent.type(scoreOf('يوسف الطالب'), '41.50')
    expect(saveButton()).toBeDisabled()
    // A feedback typed for a row without a result is nothing the save sends.
    await userEvent.type(feedbackOf('سارة الطالبة'), 'غاب بعذر')
    expect(screen.getByText(ar.exams.results.noChanges)).toBeInTheDocument()

    mark('سارة الطالبة', 'absent')
    fireEvent.click(saveButton())
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect(puts(calls)[0]!.body).toEqual({ results: [{ studentId: SARA, status: 'absent', feedback: 'غاب بعذر' }] })
  })

  it('sends the whole new state: leaving scored drops the score, and an emptied feedback is cleared on the server', async () => {
    const calls = mockSheetApi(
      () => makeResultsSheet(),
      () => jsonResponse(200, makeResultsSheet()),
    )
    renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('يوسف الطالب')

    mark('يوسف الطالب', 'excused')
    expect(scoreOf('يوسف الطالب')).toBeDisabled()
    expect(scoreOf('يوسف الطالب')).toHaveValue('')
    await userEvent.clear(feedbackOf('يوسف الطالب'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect(puts(calls)[0]!.body).toEqual({ results: [{ studentId: YOUSEF, status: 'excused' }] })
  })

  it('refuses locally a scored row without a score and a score above the maximum, marks them and sends nothing', async () => {
    const calls = mockSheetApi(() => makeResultsSheet())
    renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')

    mark('سارة الطالبة', 'scored')
    await userEvent.clear(scoreOf('يوسف الطالب'))
    await userEvent.type(scoreOf('يوسف الطالب'), '55')
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.exams.results.validation.fixRows)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByText(ar.exams.results.validation.scoreRequired)).toBeInTheDocument()
    expect(within(row('يوسف الطالب')).getByText(ar.exams.results.validation.score.replace('{{max}}', '50'))).toBeInTheDocument()
    // No clamping: the typed score stays as typed.
    expect(scoreOf('يوسف الطالب')).toHaveValue('55')
    expect(puts(calls)).toEqual([])
  })

  it('shows a reader (exams.read without exams.grade) the sheet read-only with the reason', async () => {
    mockSheetApi(() => makeResultsSheet())
    renderTab(EXAM_READER_PERMISSIONS)

    expect(await screen.findByText(ar.exams.results.readOnly)).toBeInTheDocument()
    const yousef = row('يوسف الطالب')
    expect(within(yousef).getByText(ar.exams.results.status.scored)).toBeInTheDocument()
    expect(within(yousef).getByText('41.5')).toBeInTheDocument()
    expect(within(yousef).getByText('أحسنت في السؤال الثالث')).toBeInTheDocument()
    expect(within(yousef).queryByLabelText(ar.exams.results.status.absent)).not.toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByText(ar.exams.results.notRecorded)).toBeInTheDocument()
    expect(screen.queryByText(ar.exams.results.save)).not.toBeInTheDocument()
  })

  it('keeps a draft exam and an exam of a cancelled class read-only even for a teacher, saying why; a published sheet warns that students see every save', async () => {
    const cases: [ExamResultsSheet, string][] = [
      [makeResultsSheet({ examStatus: 'draft', recordable: false, closedReason: 'not_scheduled' }), ar.exams.results.closed.not_scheduled],
      [makeResultsSheet({ recordable: false, closedReason: 'class_cancelled' }), ar.exams.results.closed.class_cancelled],
    ]
    for (const [sheet, text] of cases) {
      mockSheetApi(() => sheet)
      const { unmount } = renderTab(EXAM_TEACHER_PERMISSIONS)
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(within(row('يوسف الطالب')).queryByLabelText(ar.exams.results.status.absent)).not.toBeInTheDocument()
      expect(screen.queryByText(ar.exams.results.save)).not.toBeInTheDocument()
      unmount()
    }

    mockSheetApi(() => makeResultsSheet({ examStatus: 'published' }))
    renderTab(EXAM_TEACHER_PERMISSIONS)
    expect(await screen.findByText(ar.exams.results.publishedNote)).toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
  })

  it('says when each result was written in the exam’s zone, not the browser’s (D-R41)', async () => {
    mockSheetApi(() => makeResultsSheet())
    renderTab(EXAM_TEACHER_PERMISSIONS, FAR_TIME_ZONE)
    const yousef = await findRow('يوسف الطالب')
    expect(within(yousef).getByText(formatZonedDateTime('2026-11-20T09:00:00.000Z', FAR_TIME_ZONE, 'ar'), { exact: false })).toBeInTheDocument()
  })

  it('re-reads the sheet and asks the drawer to re-read the exam when the server says it takes no results any more', async () => {
    let reads = 0
    const calls = mockSheetApi(
      () => (++reads === 1 ? makeResultsSheet() : makeResultsSheet({ examStatus: 'draft', recordable: false, closedReason: 'not_scheduled' })),
      () => jsonResponse(409, { statusCode: 409, code: 'exam_not_recordable', reason: 'not_scheduled', message: 'draft' }),
    )
    const { onExamStale, onSaved } = renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')
    mark('سارة الطالبة', 'absent')
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.exams.results.errors.not_scheduled)).toBeInTheDocument()
    expect(await screen.findByText(ar.exams.results.closed.not_scheduled)).toBeInTheDocument()
    expect(onExamStale).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(gets(calls)).toHaveLength(2)
  })

  it('refuses the whole batch when a student is no longer enrolled, or a score is out of range: names them, marks their row and keeps the other changes', async () => {
    let answer: Response = jsonResponse(422, { statusCode: 422, code: 'not_enrolled', studentIds: [OMAR], message: 'nope' })
    const calls = mockSheetApi(
      () => makeResultsSheet(),
      () => answer,
    )
    renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')
    mark('سارة الطالبة', 'absent')
    mark('عمر الخريج', 'excused')
    fireEvent.click(saveButton())

    expect(await screen.findByText(ar.exams.results.errors.not_enrolled.replace('{{names}}', 'عمر الخريج'))).toBeInTheDocument()
    expect(within(row('عمر الخريج')).getByText(ar.exams.results.refusedRow)).toBeInTheDocument()
    expect(within(row('سارة الطالبة')).getByLabelText(ar.exams.results.status.absent)).toBeChecked()

    // The maximum changed elsewhere (no result existed yet): the server names the student and its maximum.
    answer = jsonResponse(400, { statusCode: 400, code: 'score_out_of_range', score: 41.5, maxScore: 40, studentId: YOUSEF, message: 'range' })
    await waitFor(() => expect(saveButton()).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.exams.results.errors.score_out_of_range.replace('{{names}}', 'يوسف الطالب').replace('{{max}}', '40'))).toBeInTheDocument()
    expect(within(row('يوسف الطالب')).getByText(ar.exams.results.refusedRow)).toBeInTheDocument()
    expect(within(row('عمر الخريج')).queryByText(ar.exams.results.refusedRow)).not.toBeInTheDocument()
    expect(puts(calls)).toHaveLength(2)
    expect(gets(calls)).toHaveLength(1)
  })

  it('shows a too-large batch and a validation refusal above the table, and hands a vanished exam back to the drawer', async () => {
    let status = 413
    mockSheetApi(
      () => makeResultsSheet(),
      () =>
        status === 413
          ? jsonResponse(413, { statusCode: 413, message: 'request entity too large' })
          : status === 400
            ? jsonResponse(400, { statusCode: 400, message: 'score is required with status scored' })
            : jsonResponse(404, { statusCode: 404, code: 'exam_not_found', examId: EXAM_ID, message: 'No exam' }),
    )
    const { onExamStale } = renderTab(EXAM_TEACHER_PERMISSIONS)
    await findRow('سارة الطالبة')
    mark('سارة الطالبة', 'absent')

    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.exams.results.errors.too_large)).toBeInTheDocument()
    status = 400
    await waitFor(() => expect(saveButton()).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(saveButton())
    expect(await screen.findByText('رفض الخادم البيانات: score is required with status scored')).toBeInTheDocument()
    status = 404
    await waitFor(() => expect(saveButton()).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(onExamStale).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(ar.exams.errors.exam_not_found)).toBeInTheDocument()
  })

  it('shows a failed read with a retry that reads the sheet again', async () => {
    let reads = 0
    const calls = mockSheetApi(() => (++reads === 1 ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : makeResultsSheet()))
    renderTab(EXAM_TEACHER_PERMISSIONS)

    expect(await screen.findByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.exams.results.reload).closest('button')!)
    expect(await screen.findByText('يوسف الطالب')).toBeInTheDocument()
    expect(gets(calls)).toHaveLength(2)
  })

  it('tells the drawer whether a row would be sent: on a change, not once changed back, not after the saved answer, not after it leaves; never for a read-only sheet', async () => {
    mockSheetApi(
      () => makeResultsSheet(),
      () => jsonResponse(200, makeResultsSheet()),
    )
    const { onUnsavedChange, unmount } = renderTab(EXAM_TEACHER_PERMISSIONS)
    const yousef = await findRow('يوسف الطالب')
    expect(lastReported(onUnsavedChange)).toBe(false)

    mark('يوسف الطالب', 'absent')
    expect(lastReported(onUnsavedChange)).toBe(true)
    fireEvent.click(within(yousef).getByText(ar.exams.results.revert).closest('button')!)
    expect(lastReported(onUnsavedChange)).toBe(false)

    mark('سارة الطالبة', 'excused')
    expect(lastReported(onUnsavedChange)).toBe(true)
    fireEvent.click(saveButton())
    expect(await screen.findByText(ar.exams.results.saved)).toBeInTheDocument()
    await waitFor(() => expect(lastReported(onUnsavedChange)).toBe(false))

    mark('عمر الخريج', 'absent')
    expect(lastReported(onUnsavedChange)).toBe(true)
    unmount()
    expect(lastReported(onUnsavedChange)).toBe(false)

    mockSheetApi(() => makeResultsSheet())
    const reader = renderTab(EXAM_READER_PERMISSIONS)
    expect(await screen.findByText(ar.exams.results.readOnly)).toBeInTheDocument()
    expect(reader.onUnsavedChange.mock.calls.every(([unsaved]) => unsaved === false)).toBe(true)
  })
})
