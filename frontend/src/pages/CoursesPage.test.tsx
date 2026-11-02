import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { CourseList } from '../api/courses'
import { ar } from '../i18n/ar'
import { COURSE_MANAGER_PERMISSIONS, COURSE_READER_PERMISSIONS, makeCourse, makeCourseList, makeLevelList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CoursesPage } from './CoursesPage'

const python = makeCourse({ status: 'published' })
const web = makeCourse({ id: '0193a000-0000-7000-8000-00000000c002', code: 'WEB-201', name: { ar: 'تطوير الويب' }, level: null, status: 'draft' })

/** Serves the list (recording its queries), the levels, the detail and POST /api/courses. */
function mockCoursesApi(list: CourseList | Response, created: Response = jsonResponse(201, makeCourse({ id: 'new-1', code: 'NEW-1', name: { ar: 'دورة جديدة' } }))) {
  const queries: URLSearchParams[] = []
  const posts: unknown[] = []
  const fetchMock = mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/levels') return jsonResponse(200, makeLevelList())
    if (parsed.pathname === '/api/courses' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list : jsonResponse(200, list)
    }
    if (parsed.pathname === '/api/courses' && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return created
    }
    if (parsed.pathname.startsWith('/api/courses/') && method === 'GET') return jsonResponse(200, makeCourse({ id: 'new-1', code: 'NEW-1', name: { ar: 'دورة جديدة' } }))
    return jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'nope' })
  })
  return { fetchMock, queries, posts }
}

function renderPage(permissions: string[]) {
  return renderWithProviders(<CoursesPage />, { auth: makeAuth({ user: makeUser({ permissions }) }), route: '/courses' })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('CoursesPage', () => {
  it('shows a reader the courses of GET /api/courses read-only: no add button, no status filter, a hint; the first query is the default page', async () => {
    const api = mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_READER_PERMISSIONS)

    expect(await screen.findByText('PY-101')).toBeInTheDocument()
    const rows = bodyRows()
    expect(rows).toHaveLength(1)
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('مبتدئ')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.published)).toBeInTheDocument()
    expect(screen.getByText(ar.courses.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.courses.addCourse)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: ar.common.status })).not.toBeInTheDocument()
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ sort: 'code', limit: '20' })
  })

  it('gives a manager the add button and the status filter; filters and search re-query from the first page', async () => {
    const api = mockCoursesApi(makeCourseList([python, web]))
    renderPage(COURSE_MANAGER_PERMISSIONS)

    expect(await screen.findByText('WEB-201')).toBeInTheDocument()
    expect(screen.queryByText(ar.courses.readOnlyHint)).not.toBeInTheDocument()
    expect(screen.getByText(ar.courses.addCourse).closest('button')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.common.status }))
    fireEvent.click(await screen.findByText(ar.labels.draft, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries.at(-1)?.get('status')).toBe('draft'))

    const search = screen.getByRole('searchbox', { name: ar.common.search })
    await userEvent.type(search, 'web{Enter}')
    await waitFor(() => expect(api.queries.at(-1)?.get('q')).toBe('web'))
    expect(api.queries.at(-1)?.get('status')).toBe('draft')
  })

  it('creates a draft through the modal: POST with the normalised body, then the list reloads and the success message shows', async () => {
    const api = mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.code), 'new-1')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.nameAr), 'دورة جديدة')
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ code: 'NEW-1', name: { ar: 'دورة جديدة' } }]))
    expect(await screen.findByText('تم إنشاء الدورة «دورة جديدة» كمسودة')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
  })

  it('shows a taken code on the code field and keeps the modal open', async () => {
    mockCoursesApi(makeCourseList([python]), jsonResponse(409, { statusCode: 409, code: 'course_code_taken', courseCode: 'PY-101', message: 'taken' }))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.code), 'py-101')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.nameAr), 'مكرر')
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    expect(await within(dialog).findByText(ar.courses.errors.course_code_taken)).toBeInTheDocument()
  })

  it('refuses locally a code with a space and an English summary without Arabic, before any request', async () => {
    const api = mockCoursesApi(makeCourseList([]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await waitFor(() => expect(api.queries).toHaveLength(1))

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.code), 'PY 101')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.nameAr), 'بايثون')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.summaryEn), 'English only')
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    expect(await within(dialog).findByText(ar.courses.validation.codeFormat)).toBeInTheDocument()
    expect(await within(dialog).findByText(ar.courses.validation.arabicFirst)).toBeInTheDocument()
    expect(api.posts).toEqual([])
  })

  it('gives a manager the levels tab (MOD-04-T06) and a reader no tabs at all', async () => {
    mockCoursesApi(makeCourseList([python]))
    const view = renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.tabs.levels))
    expect(await screen.findByLabelText(`${ar.courses.levels.delete}: BEG`)).toBeDisabled()
    expect(screen.queryByText(ar.courses.addCourse)).not.toBeInTheDocument()
    expect(screen.getByText(ar.courses.levels.add)).toBeInTheDocument()
    view.unmount()

    mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_READER_PERMISSIONS)
    await screen.findByText('PY-101')
    expect(screen.queryByText(ar.courses.tabs.levels)).not.toBeInTheDocument()
  })
})
