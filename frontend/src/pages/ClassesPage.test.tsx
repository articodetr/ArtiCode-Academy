import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ClassList } from '../api/classes'
import { ar } from '../i18n/ar'
import { CLASS_ADMIN_PERMISSIONS, CLASS_COURSE_ID, CLASS_READER_PERMISSIONS, makeClass, makeClassList, makeClassTeacher, makeTeacherCandidate } from '../test/classes'
import { makeCourse, makeCourseList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeUserList } from '../test/users'
import { ClassesPage } from './ClassesPage'

const pyA = makeClass({ enrolledCount: 12 })
const webB = makeClass({
  id: '0193b000-0000-7000-8000-00000000e002',
  code: 'WEB-B',
  name: { ar: 'الويب — ب' },
  status: 'running',
  capacity: 10,
  enrolledCount: 10,
  startsOn: null,
  endsOn: null,
  teachers: [makeClassTeacher(), makeClassTeacher({ userId: 'x-2', fullName: 'مساعد', role: 'assistant' }), makeClassTeacher({ userId: 'x-3', fullName: 'مساعد 2', role: 'assistant' })],
})
const published = makeCourse({ id: CLASS_COURSE_ID, status: 'published' })

/** Serves the classes list (recording its queries), the course and teacher pickers, the detail and POST /api/classes. */
function mockClassesApi(list: ClassList | Response, created: Response = jsonResponse(201, makeClass({ id: 'new-1', code: 'NEW-A', name: { ar: 'فصل جديد' } }))) {
  const queries: URLSearchParams[] = []
  const courseQueries: URLSearchParams[] = []
  const posts: unknown[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/courses') {
      courseQueries.push(parsed.searchParams)
      return jsonResponse(200, makeCourseList([published]))
    }
    if (parsed.pathname === '/api/users') return jsonResponse(200, makeUserList([makeTeacherCandidate()]))
    if (parsed.pathname === '/api/classes' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list : jsonResponse(200, list)
    }
    if (parsed.pathname === '/api/classes' && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return created
    }
    if (parsed.pathname.startsWith('/api/classes/') && method === 'GET') return jsonResponse(200, makeClass({ id: 'new-1', code: 'NEW-A', name: { ar: 'فصل جديد' } }))
    return jsonResponse(404, { statusCode: 404, code: 'class_not_found', message: 'nope' })
  })
  return { queries, courseQueries, posts }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<ClassesPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/classes' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

async function openCreateDialog() {
  fireEvent.click(screen.getByText(ar.classes.addClass).closest('button')!)
  return (await screen.findByText(ar.classes.create.title)).closest('[role="dialog"]') as HTMLElement
}

async function fillRequired(dialog: HTMLElement, code: string) {
  fireEvent.mouseDown(within(dialog).getByLabelText(ar.classes.fields.course))
  fireEvent.click(await screen.findByText('PY-101 — أساسيات بايثون', { selector: '.ant-select-item-option-content' }))
  await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.code), code)
  await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.nameAr), 'فصل جديد')
  await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.capacity), '15')
}

describe('ClassesPage', () => {
  it('shows a teacher the assigned classes of GET /api/classes read-only: lead teacher, seats, status; no add button and no teacher filter', async () => {
    const api = mockClassesApi(makeClassList([pyA, webB]))
    renderPage(CLASS_READER_PERMISSIONS)

    expect(await screen.findByText('PY-101-A')).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('12 / 20')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.planned)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('خالد المعلم (+2)')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.labels.running)).toBeInTheDocument()
    expect(screen.getByText(ar.classes.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.classes.addClass)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: ar.common.teacher })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: ar.common.course })).toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ sort: 'code', limit: '20' })
  })

  it('says "no classes assigned to you" to a teacher without classes, and "no match" once a filter is set', async () => {
    const api = mockClassesApi(makeClassList([]))
    renderPage(CLASS_READER_PERMISSIONS)
    expect(await screen.findByText(ar.classes.emptyAssigned)).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: ar.common.search }), 'zzz{Enter}')
    await waitFor(() => expect(api.queries.at(-1)?.get('q')).toBe('zzz'))
    expect(await screen.findByText(ar.classes.emptyFiltered)).toBeInTheDocument()
  })

  it('gives an admin the add button and the teacher filter; status, course and search filters re-query from the first page', async () => {
    const api = mockClassesApi(makeClassList([pyA, webB]))
    renderPage(CLASS_ADMIN_PERMISSIONS)

    expect(await screen.findByText('WEB-B')).toBeInTheDocument()
    expect(screen.queryByText(ar.classes.readOnlyHint)).not.toBeInTheDocument()
    expect(screen.getByText(ar.classes.addClass).closest('button')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: ar.common.teacher })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.common.status }))
    fireEvent.click(await screen.findByText(ar.labels.running, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('running'))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.common.course }))
    fireEvent.click(await screen.findByText('PY-101 — أساسيات بايثون', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('courseId')).toBe(CLASS_COURSE_ID))
    // The filter picker asks for any course the caller may read (no status filter).
    expect(api.courseQueries[0]?.get('status')).toBeNull()

    await userEvent.type(screen.getByRole('searchbox', { name: ar.common.search }), 'web{Enter}')
    await waitFor(() => expect(api.queries.at(-1)?.get('q')).toBe('web'))
    expect(api.queries.at(-1)?.get('status')).toBe('running')
    expect(api.queries.at(-1)?.get('courseId')).toBe(CLASS_COURSE_ID)
  })

  it('creates a planned class: the course picker offers published courses, POST carries the normalised body, the list reloads', async () => {
    const api = mockClassesApi(makeClassList([pyA]))
    renderPage(CLASS_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    const dialog = await openCreateDialog()
    await fillRequired(dialog, 'new-a')
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.classes.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ courseId: CLASS_COURSE_ID, code: 'NEW-A', name: { ar: 'فصل جديد' }, capacity: 15 }]))
    expect(await screen.findByText('تم إنشاء الفصل «فصل جديد» بحالة «مخطَّط»')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
    expect(api.courseQueries.some((query) => query.get('status') === 'published')).toBe(true)
  })

  it('shows a taken code on the code field and keeps the dialog open', async () => {
    mockClassesApi(makeClassList([pyA]), jsonResponse(409, { statusCode: 409, code: 'class_code_taken', classCode: 'PY-101-A', message: 'taken' }))
    renderPage(CLASS_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')

    const dialog = await openCreateDialog()
    await fillRequired(dialog, 'py-101-a')
    fireEvent.click(within(dialog).getByText(ar.classes.create.submit).closest('button')!)

    expect(await within(dialog).findByText(ar.classes.errors.class_code_taken)).toBeInTheDocument()
  })

  it('refuses locally a missing course, a code with a space and an end date before the start, before any request', async () => {
    const api = mockClassesApi(makeClassList([]))
    renderPage(CLASS_ADMIN_PERMISSIONS)
    await waitFor(() => expect(api.queries).toHaveLength(1))

    const dialog = await openCreateDialog()
    await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.code), 'PY A')
    await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.nameAr), 'فصل')
    await userEvent.type(within(dialog).getByLabelText(ar.classes.fields.capacity), '10')
    fireEvent.change(within(dialog).getByLabelText(ar.classes.fields.startsOn), { target: { value: '2026-12-01' } })
    fireEvent.change(within(dialog).getByLabelText(ar.classes.fields.endsOn), { target: { value: '2026-11-01' } })
    fireEvent.click(within(dialog).getByText(ar.classes.create.submit).closest('button')!)

    expect(await within(dialog).findByText(ar.classes.validation.courseRequired)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.classes.validation.codeFormat)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.classes.validation.dateRange)).toBeInTheDocument()
    expect(api.posts).toEqual([])
  })

  it('shows a failed list with a retry button', async () => {
    const api = mockClassesApi(jsonResponse(500, { statusCode: 500, message: 'boom' }))
    renderPage(CLASS_ADMIN_PERMISSIONS)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    fireEvent.click(within(alert).getByText(ar.classes.refresh).closest('button')!)
    await waitFor(() => expect(api.queries.length).toBe(2))
  })

  it('keeps «next» off after a failed page: the rows stay behind the error, the cursor of the page before is not offered again (PR #26 note 4)', async () => {
    const cursors: (string | null)[] = []
    mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === '/api/courses') return jsonResponse(200, makeCourseList([published]))
      if (parsed.pathname === '/api/users') return jsonResponse(200, makeUserList([]))
      const cursor = parsed.searchParams.get('cursor')
      cursors.push(cursor)
      return cursor ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeClassList([pyA], 'c2'))
    })
    renderPage(CLASS_ADMIN_PERMISSIONS)
    await screen.findByText('PY-101-A')
    const next = screen.getByText(ar.classes.pagination.next).closest('button')!
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    expect(screen.getByText('PY-101-A')).toBeInTheDocument()
    expect(screen.getByText(ar.classes.pagination.next).closest('button')).toBeDisabled()
    expect(screen.getByText(ar.classes.pagination.previous).closest('button')).toBeEnabled()
    expect(cursors).toEqual([null, 'c2'])
  })

  it('caps the search at the 100 characters API-050 accepts for q (PR #26 note 5)', async () => {
    const api = mockClassesApi(makeClassList([pyA]))
    renderPage(CLASS_READER_PERMISSIONS)
    await screen.findByText('PY-101-A')

    const search = screen.getByRole('searchbox', { name: ar.common.search })
    expect(search).toHaveAttribute('maxlength', '100')
    await userEvent.click(search)
    await userEvent.paste('x'.repeat(150))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.queries.at(-1)?.get('q')).toBe('x'.repeat(100)))
  })
})
