import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useLocation } from 'react-router'
import type { CourseList } from '../api/courses'
import type { FeePlan } from '../api/feePlans'
import { ar } from '../i18n/ar'
import { COURSE_MANAGER_PERMISSIONS, COURSE_READER_PERMISSIONS, makeCourse, makeCourseList, makeLevelList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeFeePlan } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { THREE_SUBJECTS } from '../test/subjects'
import { CoursesPage } from './CoursesPage'

const python = makeCourse({ status: 'published' })
const web = makeCourse({ id: '0193a000-0000-7000-8000-00000000c002', code: 'WEB-201', name: { ar: 'تطوير الويب' }, level: null, status: 'draft' })

/** Serves the list (recording its queries), the levels, the fee plans, the detail and POST /api/courses. */
function mockCoursesApi(
  list: CourseList | Response,
  created: Response = jsonResponse(201, makeCourse({ id: 'new-1', code: 'CRS-00001', name: { ar: 'دورة جديدة' } })),
  feePlans: FeePlan[] = [],
) {
  const queries: URLSearchParams[] = []
  const posts: unknown[] = []
  const moves: { id: string; body: unknown }[] = []
  const fetchMock = mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    if (parsed.pathname === '/api/levels') return jsonResponse(200, makeLevelList())
    if (parsed.pathname === '/api/subjects') return jsonResponse(200, { items: THREE_SUBJECTS() })
    if (parsed.pathname === '/api/fee-plans') return jsonResponse(200, { items: feePlans })
    if (parsed.pathname === '/api/courses' && method === 'GET') {
      queries.push(parsed.searchParams)
      return list instanceof Response ? list : jsonResponse(200, list)
    }
    if (parsed.pathname === '/api/courses' && method === 'POST') {
      posts.push(JSON.parse(String(init?.body)))
      return created
    }
    const moved = /^\/api\/courses\/([^/]+)\/move$/.exec(parsed.pathname)
    if (moved && method === 'POST') {
      moves.push({ id: moved[1]!, body: JSON.parse(String(init?.body)) })
      return jsonResponse(200, makeCourse({ id: moved[1]! }))
    }
    if (parsed.pathname.startsWith('/api/courses/') && method === 'GET') return jsonResponse(200, makeCourse({ id: 'new-1', code: 'NEW-1', name: { ar: 'دورة جديدة' } }))
    return jsonResponse(404, { statusCode: 404, code: 'course_not_found', message: 'nope' })
  })
  return { fetchMock, queries, posts, moves }
}

/** The address's query string, to see that `?create=` is dropped once read (J-F59). */
function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>
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
    expect(within(rows[0]!).getByText(ar.labels.published)).toBeInTheDocument()
    expect(screen.getByText(ar.courses.readOnlyHint)).toBeInTheDocument()
    expect(screen.queryByText(ar.courses.addCourse)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: ar.common.status })).not.toBeInTheDocument()
    // PORTAL-04-COURSE-ORDER: the office's order by default — the order the catalogs show; no order column for a reader.
    expect(Object.fromEntries(api.queries[0]!)).toEqual({ sort: 'position', limit: '20' })
    expect(within(screen.getByRole('table')).queryByText(ar.courses.columns.order)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(ar.courses.level)).not.toBeInTheDocument()
  })

  it('keeps the table in its own horizontal scroll box, so a phone never scrolls the page sideways (KI-095)', async () => {
    mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_READER_PERMISSIONS)
    await screen.findByText('PY-101')

    // jsdom has no layout: assert the configuration, as the KI-094 test of /users does. `x: true` keeps the table
    // at its box's width whenever it fits (an unchanged desktop); 'max-content' would scroll a desktop table.
    const table = screen.getByRole('table')
    expect(table.closest('.ant-table')).toHaveClass('ant-table-scroll-horizontal')
    expect(table.style.width).toBe('auto')
    expect(table.style.minWidth).toBe('100%')
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
    // API-042 accepts q of 1–100 characters (PR #26 note 5 — J-F14).
    expect(search).toHaveAttribute('maxlength', '100')
    await userEvent.type(search, 'web{Enter}')
    await waitFor(() => expect(api.queries.at(-1)?.get('q')).toBe('web'))
    expect(api.queries.at(-1)?.get('status')).toBe('draft')
  })

  it('creates a draft through the simplified modal: POST without a code, English, level, hours or sessions, then the list reloads and the success message shows', async () => {
    const api = mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    for (const removed of [ar.courses.fields.code, ar.courses.fields.nameEn, ar.courses.fields.level, ar.courses.fields.durationHours, ar.courses.fields.sessionsCount]) {
      expect(within(dialog).queryByLabelText(removed)).not.toBeInTheDocument()
    }
    // Without fee_plans.manage the course type is not asked: the course is created free.
    expect(within(dialog).queryByText(ar.courses.fields.pricing)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.name), ' دورة جديدة ')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.summary), 'ملخص قصير')
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.description), 'وصف الدورة كاملاً')
    const before = api.queries.length
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ name: { ar: 'دورة جديدة' }, summary: { ar: 'ملخص قصير' }, description: { ar: 'وصف الدورة كاملاً' } }]))
    expect(await screen.findByText('تم إنشاء الدورة «دورة جديدة» كمسودة')).toBeInTheDocument()
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(before))
  })

  it('shows a refusal that names a field the form no longer has (a taken code) above the form, and keeps the modal open', async () => {
    const api = mockCoursesApi(makeCourseList([python]), jsonResponse(409, { statusCode: 409, code: 'course_code_taken', courseCode: 'CRS-00001', message: 'taken' }))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.name), 'مكرر')
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    const shown = await within(dialog).findByText(ar.courses.errors.course_code_taken)
    expect(shown.closest('.ant-alert')).toBeInTheDocument()
    expect(api.posts).toEqual([{ name: { ar: 'مكرر' } }])
  })


  it('refuses locally an empty name, a too long summary and a bad cover link, each under its field, before any request', async () => {
    const api = mockCoursesApi(makeCourseList([]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await waitFor(() => expect(api.queries).toHaveLength(1))

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.change(within(dialog).getByLabelText(ar.courses.fields.summary), { target: { value: 'م'.repeat(201) } })
    fireEvent.change(within(dialog).getByLabelText(ar.courses.fields.coverImageUrl), { target: { value: 'cdn.example.org/a.jpg' } })
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    expect((await within(dialog).findByText(ar.courses.validation.nameRequired)).closest('.ant-form-item')).toHaveTextContent(ar.courses.fields.name)
    expect((await within(dialog).findByText('الحد الأقصى 200 حرفاً')).closest('.ant-form-item')).toHaveTextContent(ar.courses.fields.summary)
    expect((await within(dialog).findByText(ar.courses.validation.coverUrl)).closest('.ant-form-item')).toHaveTextContent(ar.courses.fields.coverImageUrl)
    expect(api.posts).toEqual([])
  })

  it('creates a course with no subject and no age range, and reads no subjects list (PORTAL-04-COURSE-ORDER)', async () => {
    const api = mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    expect(within(dialog).queryByText('أصغر عمر')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('أكبر عمر')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(ar.courses.fields.subject)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.name), 'دورة جديدة')
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ name: { ar: 'دورة جديدة' } }]))
    expect(api.fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/subjects'))).toBe(false)
  })

  it('creates a paid course with a general fee plan as its price; only the general active plans are offered (fee_plans.manage)', async () => {
    const general = makeFeePlan({ id: 'plan-general', name: { ar: 'رسوم عامة' }, total: 750 })
    const ofCourse = makeFeePlan({ id: 'plan-course', name: { ar: 'رسوم دورة أخرى' }, course: { id: 'other', code: 'X', name: { ar: 'أخرى' } } })
    const ofClass = makeFeePlan({ id: 'plan-class', name: { ar: 'رسوم فصل' }, class: { id: 'cls', code: 'X-A', name: { ar: 'فصل' } } })
    const off = makeFeePlan({ id: 'plan-off', name: { ar: 'رسوم معطلة' }, isActive: false })
    const api = mockCoursesApi(makeCourseList([python]), undefined, [general, ofCourse, ofClass, off])
    renderPage([...COURSE_MANAGER_PERMISSIONS, 'fee_plans.manage'])
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.name), 'دورة مدفوعة')
    // Free by default: no price field until «مدفوعة» is chosen.
    expect(within(dialog).queryByLabelText(ar.courses.fields.price)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByText(ar.courses.pricing.paid))

    // Paid without a plan: the error under the price field, nothing sent.
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)
    expect((await within(dialog).findByText(ar.courses.validation.feePlanRequired)).closest('.ant-form-item')).toHaveTextContent(ar.courses.fields.price)
    expect(api.posts).toEqual([])

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: ar.courses.fields.price }))
    await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(1))
    // The option names the plan and its total.
    fireEvent.click(screen.getByText(/رسوم عامة — 750\.00/, { selector: '.ant-select-item-option-content' }))
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)

    await waitFor(() => expect(api.posts).toEqual([{ name: { ar: 'دورة مدفوعة' }, enrollmentFeePlanId: 'plan-general' }]))
  })

  it('creates a free course with no plan when the type stays «مجانية», and explains where a price comes from when no general plan exists', async () => {
    const ofClass = makeFeePlan({ id: 'plan-class', name: { ar: 'رسوم فصل' }, class: { id: 'cls', code: 'X-A', name: { ar: 'فصل' } } })
    const api = mockCoursesApi(makeCourseList([python]), undefined, [ofClass])
    renderPage([...COURSE_MANAGER_PERMISSIONS, 'fee_plans.manage'])
    await screen.findByText('PY-101')

    fireEvent.click(screen.getByText(ar.courses.addCourse).closest('button')!)
    const dialog = (await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(dialog).getByText(ar.courses.pricing.paid))
    const warning = await within(dialog).findByTestId('course-no-fee-plans')
    expect(warning).toHaveTextContent(ar.courses.hints.noFeePlansCreate)

    fireEvent.click(within(dialog).getByText(ar.courses.pricing.free))
    await userEvent.type(within(dialog).getByLabelText(ar.courses.fields.name), 'دورة مجانية')
    fireEvent.click(within(dialog).getByText(ar.courses.create.submit).closest('button')!)
    await waitFor(() => expect(api.posts).toEqual([{ name: { ar: 'دورة مجانية' } }]))
  })

  it('has no levels or subjects tab, no level column and no level filter (PORTAL-04-COURSE-ORDER)', async () => {
    const api = mockCoursesApi(makeCourseList([python]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('PY-101')

    expect(document.querySelector('.ant-tabs')).toBeNull()
    expect(screen.queryByText(ar.courses.tabs.levels)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.courses.tabs.subjects)).not.toBeInTheDocument()
    const headers = [...within(screen.getByRole('table')).getAllByRole('columnheader')].map((cell) => cell.textContent)
    expect(headers).not.toContain(ar.courses.level)
    expect(screen.queryByRole('combobox', { name: ar.courses.level })).not.toBeInTheDocument()
    expect(within(bodyRows()[0]!).queryByText('مبتدئ')).not.toBeInTheDocument()
    // Neither the levels nor the subjects are read any more.
    expect(api.fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/levels'))).toBe(false)
    expect(api.fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/subjects'))).toBe(false)
  })

  it('moves a course with the arrows: POST …/move with the direction, then the page is read again; the first row cannot go up nor the last down', async () => {
    const first = makeCourse({ id: 'c-1', code: 'AAA', name: { ar: 'الأولى' }, sortOrder: 1 })
    const second = makeCourse({ id: 'c-2', code: 'BBB', name: { ar: 'الثانية' }, sortOrder: 2 })
    const api = mockCoursesApi(makeCourseList([first, second]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('AAA')
    expect(screen.getByTestId('courses-order-note')).toHaveTextContent(ar.courses.order.note)

    const up = (name: string) => screen.getByLabelText(`تقديم «${name}»`)
    const down = (name: string) => screen.getByLabelText(`تأخير «${name}»`)
    expect(up('الأولى')).toBeDisabled()
    expect(down('الثانية')).toBeDisabled()
    expect(down('الأولى')).toBeEnabled()
    expect(up('الثانية')).toBeEnabled()

    const reads = api.queries.length
    fireEvent.click(up('الثانية'))
    await waitFor(() => expect(api.moves).toEqual([{ id: 'c-2', body: { direction: 'up' } }]))
    await waitFor(() => expect(api.queries.length).toBeGreaterThan(reads))
    // The arrow never opens the row's drawer.
    expect(api.fetchMock.mock.calls.some(([url]) => String(url) === '/api/courses/c-2')).toBe(false)
  })

  it('turns the arrows off with a search, a status filter or another sort, and says why', async () => {
    mockCoursesApi(makeCourseList([python, web]))
    renderPage(COURSE_MANAGER_PERMISSIONS)
    await screen.findByText('WEB-201')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.courses.sort }))
    fireEvent.click(await screen.findByText(ar.courses.sortByCode, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(screen.getByTestId('courses-order-note')).toHaveTextContent(ar.courses.order.hint))
    for (const button of screen.getAllByLabelText(/^(تقديم|تأخير) «/)) expect(button).toBeDisabled()
  })

  it('opens the creation modal from ?create=course for a manager and drops the parameter; a reader gets no modal (J-F59)', async () => {
    mockCoursesApi(makeCourseList([python]))
    const { unmount } = renderWithProviders(
      <>
        <CoursesPage />
        <SearchProbe />
      </>,
      { auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }), route: '/courses?create=course' },
    )
    expect((await screen.findByText(ar.courses.create.title)).closest('[role="dialog"]')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    unmount()

    renderWithProviders(
      <>
        <CoursesPage />
        <SearchProbe />
      </>,
      { auth: makeAuth({ user: makeUser({ permissions: COURSE_READER_PERMISSIONS }) }), route: '/courses?create=course' },
    )
    await screen.findByText('PY-101')
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    expect(screen.queryByText(ar.courses.create.title)).not.toBeInTheDocument()
  })
})
