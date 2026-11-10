import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ExamList } from '../api/exams'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { dayEndIn, dayStartIn } from '../assignments/assignments.zone'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { CLASS_ID, makeClass, makeClassList } from '../test/classes'
import { EXAM_ADMIN_PERMISSIONS, EXAM_ID_2, EXAM_LESSON, EXAM_READER_PERMISSIONS, EXAM_TEACHER_PERMISSIONS, EXAM_TIME_ZONE, makeExam, makeExamList } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamsPage } from './ExamsPage'

const midterm = makeExam({ status: 'scheduled', lesson: EXAM_LESSON, results: { students: 14, scored: 12, absent: 1, excused: 1 } })
const undated = makeExam({ id: EXAM_ID_2, title: { ar: 'مشروع الوحدة' }, type: 'project', scheduledAt: null, durationMinutes: null, description: null })
const created = makeExam({ id: 'new-1', title: { ar: 'اختبار قصير' }, type: 'quiz' })

/** Serves the list (recording its queries), the academy, the pickers, the detail and POST /api/classes/:id/exams. */
function mockExamsApi(list: ExamList | Response) {
  const queries: URLSearchParams[] = []
  const posts: unknown[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    paths.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/exams' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list.clone() : jsonResponse(200, list)
    }
    if (parsed.pathname.startsWith('/api/exams/') && method === 'GET') return jsonResponse(200, parsed.pathname.endsWith('new-1') ? created : midterm)
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' })]))
    if (parsed.pathname === '/api/lessons') return jsonResponse(200, makeLessonList([]))
    if (parsed.pathname === `/api/classes/${CLASS_ID}/exams` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return jsonResponse(201, created)
    }
    return jsonResponse(404, { statusCode: 404, code: 'exam_not_found', message: 'nope' })
  })
  return { queries, posts, paths }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<ExamsPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/exams' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('ExamsPage', () => {
  it('shows a teacher the exams of GET /api/exams: the date in its zone, title and lesson, type, class, course, the server’s results and the status', async () => {
    const api = mockExamsApi(makeExamList([midterm, undated]))
    renderPage(EXAM_TEACHER_PERMISSIONS)

    expect(await screen.findByText('اختبار منتصف الفصل')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ order: 'asc', limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText(formatZonedDateTime(midterm.scheduledAt!, EXAM_TIME_ZONE, 'ar'))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(EXAM_TIME_ZONE)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('60 دقيقة')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.exams.types.midterm)).toBeInTheDocument()
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('14 / 18')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('من 50')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.scheduled)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('مشروع الوحدة')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.exams.drawer.noDate)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.exams.types.project)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('0 / 18')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.labels.draft)).toBeInTheDocument()
    // A teacher sees the classes assigned to them (D-R16) and adds exams there.
    expect(screen.getByText(ar.exams.readOnlyHint)).toBeInTheDocument()
    expect(screen.getByText(ar.exams.addExam).closest('button')).toBeEnabled()
  })

  it('re-queries from the first page on every filter: status, type, order, class and the days as instants of the academy zone', async () => {
    const api = mockExamsApi(makeExamList([midterm]))
    renderPage(EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.exams.readOnlyHint)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.exams.columns.status))
    const statuses = await screen.findAllByText(new RegExp(`^(${ar.labels.draft}|${ar.labels.scheduled}|${ar.labels.published})$`), { selector: '.ant-select-item-option-content' })
    expect(statuses.map((option) => option.textContent)).toEqual([ar.labels.draft, ar.labels.scheduled, ar.labels.published])
    fireEvent.click(screen.getByText(ar.labels.published, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('published'))

    fireEvent.mouseDown(screen.getByLabelText(ar.exams.columns.type))
    fireEvent.click(await screen.findByText(ar.exams.types.final, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('type')).toBe('final'))

    fireEvent.mouseDown(screen.getByLabelText(ar.exams.filters.order))
    fireEvent.click(await screen.findByText(ar.exams.filters.orderDesc, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))

    fireEvent.mouseDown(screen.getByLabelText(ar.exams.columns.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe(CLASS_ID))

    // The academy (makeAcademy) lives in Asia/Riyadh: the days are read there, and the page says so.
    await waitFor(() => expect(screen.getByTestId('exam-filter-zone')).toHaveTextContent('Asia/Riyadh'))
    expect(screen.queryByText(ar.exams.filters.undatedHint)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(ar.exams.filters.from), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('from')).toBe(dayStartIn('2026-11-01', 'Asia/Riyadh')!))
    fireEvent.change(screen.getByLabelText(ar.exams.filters.to), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).toBe(dayEndIn('2026-11-30', 'Asia/Riyadh')!))
    // A date range never matches an undated exam: the page says so.
    expect(screen.getByText(ar.exams.filters.undatedHint)).toBeInTheDocument()
    const last = api.queries.at(-1)!
    expect(last.get('from')).toBe('2026-10-31T21:00:00.000Z')
    expect(last.get('to')).toBe('2026-11-30T20:59:59.999Z')
    expect(last.get('status')).toBe('published')
    expect(last.get('type')).toBe('final')
    expect(last.get('cursor')).toBeNull()
  })

  it('says «no exams yet» to a holder of classes.manage, «none in your classes» to a teacher and «nothing matches» once filtered', async () => {
    const api = mockExamsApi(makeExamList([]))
    const { unmount } = renderPage(EXAM_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.exams.empty)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(ar.exams.filters.to), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('to')).not.toBeNull())
    expect(await screen.findByText(ar.exams.emptyFiltered)).toBeInTheDocument()
    unmount()

    renderPage(EXAM_TEACHER_PERMISSIONS)
    expect(await screen.findByText(ar.exams.emptyAssigned)).toBeInTheDocument()
  })

  it('gives a reader without exams.manage no add button; without classes.read the add button is disabled with the reason and no class is asked for', async () => {
    const api = mockExamsApi(makeExamList([midterm]))
    const { unmount } = renderPage(EXAM_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.exams.addExam)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.exams.columns.class)).toBeInTheDocument()
    unmount()

    const before = api.paths.length
    renderPage(['exams.read', 'exams.manage', 'classes.manage'])
    await screen.findByText('PY-101-A')
    expect(screen.queryByLabelText(ar.exams.columns.class)).not.toBeInTheDocument()
    const add = screen.getByText(ar.exams.addExam).closest('button')!
    expect(add).toBeDisabled()
    await userEvent.hover(add.parentElement!)
    expect(await screen.findByText(ar.exams.hints.needsClassesRead)).toBeInTheDocument()
    expect(api.paths.slice(before).filter((path) => path.startsWith('GET /api/classes'))).toEqual([])
  })

  it('pages with the server cursor and back to the first page', async () => {
    const api = mockExamsApi(makeExamList([midterm], 'cursor-2'))
    renderPage(EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.exams.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(await screen.findByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.exams.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('الصفحة 1')).toBeInTheDocument()
  })

  it('shows a failed list with a retry button, and starts over on a cursor of another order', async () => {
    let answer = jsonResponse(500, { statusCode: 500, message: 'boom' })
    const api = mockExamsApi(answer)
    const { unmount } = renderPage(EXAM_ADMIN_PERMISSIONS)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(within(alert).getByText(ar.exams.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.length).toBe(2))
    unmount()

    answer = jsonResponse(400, { statusCode: 400, code: 'cursor_invalid', message: 'cursor' })
    mockExamsApi(answer)
    renderPage(EXAM_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.exams.errors.cursor_invalid)).toBeInTheDocument()
  })

  it('creates an exam for a chosen class: POST carries the body, the list reloads and the new exam opens', async () => {
    const api = mockExamsApi(makeExamList([midterm]))
    renderPage(EXAM_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.exams.addExam).closest('button')!)
    const dialog = (await screen.findByText(ar.exams.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.exams.fields.type))
    fireEvent.click(await screen.findByText(ar.exams.types.quiz, { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.titleAr), 'اختبار قصير')
    await userEvent.type(within(dialog).getByLabelText(ar.exams.fields.maxScore), '10')
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.exams.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 10 }]))
    expect(await screen.findByText('أُنشئ الاختبار «اختبار قصير» مسودةً')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
    // The drawer opens on the created exam.
    expect(await screen.findByTestId('exam-results-summary')).toBeInTheDocument()
  })
})
