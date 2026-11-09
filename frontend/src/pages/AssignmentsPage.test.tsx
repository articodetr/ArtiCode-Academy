import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AssignmentList } from '../api/assignments'
import { formatZonedDateTime } from '../assignments/assignments.format'
import { dayEndIn, dayStartIn } from '../assignments/assignments.zone'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ADMIN_PERMISSIONS, ASSIGNMENT_ID_2, ASSIGNMENT_READER_PERMISSIONS, ASSIGNMENT_TEACHER_PERMISSIONS, LINKED_LESSON, makeAssignment, makeAssignmentList } from '../test/assignments'
import { CLASS_ID, makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AssignmentsPage } from './AssignmentsPage'

const loops = makeAssignment({ status: 'open', lesson: LINKED_LESSON, submissions: { students: 14, submitted: 6, graded: 7, returned: 1 } })
const draft = makeAssignment({ id: ASSIGNMENT_ID_2, title: { ar: 'مشروع صغير' }, dueAt: null, instructions: null })
const created = makeAssignment({ id: 'new-1', title: { ar: 'الدوال' } })

/** Serves the list (recording its queries), the academy, the pickers, the detail and POST /api/classes/:id/assignments. */
function mockAssignmentsApi(list: AssignmentList | Response) {
  const queries: URLSearchParams[] = []
  const posts: unknown[] = []
  const paths: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    paths.push(`${method} ${parsed.pathname}`)
    if (parsed.pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (parsed.pathname === '/api/assignments' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list.clone() : jsonResponse(200, list)
    }
    if (parsed.pathname.startsWith('/api/assignments/') && method === 'GET') return jsonResponse(200, parsed.pathname.endsWith('new-1') ? created : loops)
    if (parsed.pathname === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' })]))
    if (parsed.pathname === '/api/lessons') return jsonResponse(200, makeLessonList([]))
    if (parsed.pathname === `/api/classes/${CLASS_ID}/assignments` && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return jsonResponse(201, created)
    }
    return jsonResponse(404, { statusCode: 404, code: 'assignment_not_found', message: 'nope' })
  })
  return { queries, posts, paths }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<AssignmentsPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/assignments' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('AssignmentsPage', () => {
  it('shows a teacher the assignments of GET /api/assignments: the due date in its zone, title and lesson, class, course, submissions and status', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([loops, draft]))
    renderPage(ASSIGNMENT_TEACHER_PERMISSIONS)

    expect(await screen.findByText('تمارين الحلقات')).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ order: 'asc', limit: '20' })
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText(formatZonedDateTime(loops.dueAt!, 'Asia/Riyadh', 'ar'))).toBeInTheDocument()
    // The zone is named: Asia/Riyadh is neither the CI runner's zone nor this machine's.
    expect(within(rows[0]!).getByText('Asia/Riyadh')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('المتغيرات وأنواع البيانات')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('14 / 18')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('بانتظار التصحيح: 6')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.open)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('مشروع صغير')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.assignments.drawer.noDue)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('0 / 18')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.labels.draft)).toBeInTheDocument()
    // A teacher sees the classes assigned to them (D-R16) and adds assignments there.
    expect(screen.getByText(ar.assignments.readOnlyHint)).toBeInTheDocument()
    expect(screen.getByText(ar.assignments.addAssignment).closest('button')).toBeEnabled()
  })

  it('re-queries from the first page on every filter: status, order, class and the due days as instants of the academy zone', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([loops]))
    renderPage(ASSIGNMENT_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.assignments.readOnlyHint)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText(ar.assignments.columns.status))
    // grading/graded are unused (D-R37): the filter offers the three statuses of the first version.
    const options = await screen.findAllByText(/مسودة|مفتوح|مغلق|قيد التصحيح|مصحّح/, { selector: '.ant-select-item-option-content' })
    expect(options.map((option) => option.textContent)).toEqual([ar.labels.draft, ar.labels.open, ar.labels.closed])
    fireEvent.click(screen.getByText(ar.labels.closed, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('closed'))

    fireEvent.mouseDown(screen.getByLabelText(ar.assignments.filters.order))
    fireEvent.click(await screen.findByText(ar.assignments.filters.orderDesc, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('order')).toBe('desc'))

    fireEvent.mouseDown(screen.getByLabelText(ar.assignments.columns.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('classId')).toBe(CLASS_ID))

    // The academy (makeAcademy) lives in Asia/Riyadh: the days are read there, and the page says so.
    await waitFor(() => expect(screen.getByTestId('assignment-filter-zone')).toHaveTextContent('Asia/Riyadh'))
    fireEvent.change(screen.getByLabelText(ar.assignments.filters.dueFrom), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('dueFrom')).toBe(dayStartIn('2026-11-01', 'Asia/Riyadh')!))
    fireEvent.change(screen.getByLabelText(ar.assignments.filters.dueTo), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('dueTo')).toBe(dayEndIn('2026-11-30', 'Asia/Riyadh')!))
    const last = api.queries.at(-1)!
    expect(last.get('dueFrom')).toBe('2026-10-31T21:00:00.000Z')
    expect(last.get('dueTo')).toBe('2026-11-30T20:59:59.999Z')
    expect(last.get('status')).toBe('closed')
    expect(last.get('order')).toBe('desc')
    expect(last.get('classId')).toBe(CLASS_ID)
    expect(last.get('cursor')).toBeNull()
  })

  it('says «no assignments yet» to a holder of classes.manage, «none in your classes» to a teacher and «nothing matches» once filtered', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([]))
    const { unmount } = renderPage(ASSIGNMENT_ADMIN_PERMISSIONS)
    expect(await screen.findByText(ar.assignments.empty)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(ar.assignments.filters.dueTo), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(api.queries.at(-1)?.get('dueTo')).not.toBeNull())
    expect(await screen.findByText(ar.assignments.emptyFiltered)).toBeInTheDocument()
    unmount()

    renderPage(ASSIGNMENT_TEACHER_PERMISSIONS)
    expect(await screen.findByText(ar.assignments.emptyAssigned)).toBeInTheDocument()
  })

  it('gives a reader without assignments.manage no add button; classes.read alone decides the class filter', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([loops]))
    const { unmount } = renderPage(ASSIGNMENT_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.queryByText(ar.assignments.addAssignment)).not.toBeInTheDocument()
    expect(screen.getByLabelText(ar.assignments.columns.class)).toBeInTheDocument()
    unmount()

    // assignments.manage without classes.read: no class filter and a disabled add button with the reason — GET /api/classes would be 403.
    const before = api.paths.length
    renderPage(['assignments.read', 'assignments.manage', 'classes.manage'])
    await screen.findByText('PY-101-A')
    expect(screen.queryByLabelText(ar.assignments.columns.class)).not.toBeInTheDocument()
    const add = screen.getByText(ar.assignments.addAssignment).closest('button')!
    expect(add).toBeDisabled()
    await userEvent.hover(add.parentElement!)
    expect(await screen.findByText(ar.assignments.hints.needsClassesRead)).toBeInTheDocument()
    expect(api.paths.slice(before).filter((path) => path.startsWith('GET /api/classes'))).toEqual([])
  })

  it('pages with the server cursor and back to the first page', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([loops], 'cursor-2'))
    renderPage(ASSIGNMENT_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    expect(screen.getByText('الصفحة 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.assignments.pagination.next).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBe('cursor-2'))
    expect(await screen.findByText('الصفحة 2')).toBeInTheDocument()

    fireEvent.click(screen.getByText(ar.assignments.pagination.previous).closest('button')!)
    await waitFor(() => expect(api.queries.at(-1)?.get('cursor')).toBeNull())
    expect(await screen.findByText('الصفحة 1')).toBeInTheDocument()
  })

  it('shows a failed list with a retry button', async () => {
    const api = mockAssignmentsApi(jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage(ASSIGNMENT_ADMIN_PERMISSIONS)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(within(alert).getByText(ar.assignments.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.length).toBe(2))
  })

  it('creates an assignment for a chosen class: POST carries the body, the list reloads and the new assignment opens', async () => {
    const api = mockAssignmentsApi(makeAssignmentList([loops]))
    renderPage(ASSIGNMENT_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    fireEvent.click(screen.getByText(ar.assignments.addAssignment).closest('button')!)
    const dialog = (await screen.findByText(ar.assignments.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.mouseDown(within(dialog).getByLabelText(ar.assignments.fields.class))
    fireEvent.click(await screen.findByText('PY-101-A — بايثون — الفصل أ', { selector: '.ant-select-item-option-content' }))
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.titleAr), 'الدوال')
    await userEvent.type(within(dialog).getByLabelText(ar.assignments.fields.maxScore), '10')
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.assignments.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ title: { ar: 'الدوال' }, maxScore: 10 }]))
    expect(await screen.findByText('أُنشئ الواجب «الدوال» مسودةً')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
    // The drawer opens on the created assignment.
    expect(await screen.findByTestId('assignment-submissions')).toBeInTheDocument()
  })
})
