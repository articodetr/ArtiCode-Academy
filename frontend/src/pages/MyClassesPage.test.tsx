import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { MyClassList } from '../api/enrollments'
import type { MyLearningCourse } from '../api/learning'
import { RequireAccess } from '../auth/RequireAuth'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { makeChildCourse, makeLearningCourse, makeProgress } from '../mySchool/mySchool.fixtures'
import { REQUEST_IDS, makeMyRequest, makeMyRequestList } from '../test/catalog'
import { ENROLLMENT_IDS, ROSTER_TEACHER_PERMISSIONS, STUDENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyClassesPage } from './MyClassesPage'

const own = makeMyClassItem()
const completed = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[1],
  enrollmentStatus: 'completed',
  completedAt: '2026-10-01T12:00:00.000Z',
  class: { ...own.class, id: 'c-2', code: 'WEB-B', name: { ar: 'الويب — ب' }, status: 'completed', startsOn: null, endsOn: null, leadTeacher: null },
})
const child = makeMyClassItem({
  enrollmentId: ENROLLMENT_IDS[2],
  relation: 'child',
  student: { id: STUDENT_IDS[1], fullName: 'ليلى سعيد', displayName: null },
})

interface Sources {
  learning?: MyLearningCourse[] | Response
  requests?: MyEnrollmentRequest[]
  cancelled?: MyEnrollmentRequest
}

/** `/api/me/classes` answers `list`; API-229 and API-222 answer their own sources (empty by default). */
function mockMyClassesApi(list: MyClassList | Response, sources: Sources = {}) {
  const queries: URLSearchParams[] = []
  const urls: string[] = []
  const other: string[] = []
  mockFetch((url, init) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/me/learning') {
      other.push(parsed.pathname)
      return sources.learning instanceof Response ? sources.learning : jsonResponse(200, { items: sources.learning ?? [] })
    }
    if (parsed.pathname === '/api/me/enrollment-requests') {
      other.push(parsed.pathname)
      return jsonResponse(200, makeMyRequestList(sources.requests ?? []))
    }
    if (parsed.pathname.startsWith('/api/me/enrollment-requests/')) {
      other.push(`${init?.method ?? 'GET'} ${parsed.pathname}`)
      return jsonResponse(200, sources.cancelled)
    }
    urls.push(parsed.pathname)
    queries.push(parsed.searchParams)
    return list instanceof Response ? list : jsonResponse(200, list)
  })
  return { queries, urls, other }
}

function renderPage(roles: string[], route = '/my-classes') {
  return renderWithProviders(<MyClassesPage />, {
    auth: makeAuth({ user: makeUser({ id: STUDENT_IDS[0], role: roles.includes('guardian') ? 'guardian' : 'student', roles, permissions: ['courses.read'] }) }),
    route,
    path: '/my-classes',
    routes: { '/learn/:courseId': <LocationProbe /> },
  })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('MyClassesPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('J-F62: the class name opens its lessons page, only for an enrollment with lessons', async () => {
    const withdrawn = makeMyClassItem({
      enrollmentId: ENROLLMENT_IDS[1],
      enrollmentStatus: 'withdrawn',
      withdrawnAt: '2026-10-01T12:00:00.000Z',
      class: { ...own.class, id: 'c-3', code: 'OLD-1', name: { ar: 'فصل منسحب منه' } },
    })
    mockMyClassesApi(makeMyClassList([own, withdrawn]))
    renderPage(['student'])

    const link = await screen.findByRole('link', { name: 'بايثون — الفصل أ' })
    expect(link).toHaveAttribute('href', `/my-classes/${own.class.id}`)
    expect(screen.getByText('فصل منسحب منه').closest('a')).toBeNull()
  })

  it('shows a student their own classes from GET /api/me/classes with no student column and no contact details', async () => {
    const api = mockMyClassesApi(makeMyClassList([own, completed]))
    renderPage(['student'])

    expect(await screen.findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(api.urls).toEqual(['/api/me/classes'])
    expect(Object.fromEntries(api.queries[0]!)).toEqual({})
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.running)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.active)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.classes.noTeacher)).toBeInTheDocument()
    expect(within(rows[1]!).getAllByText(ar.labels.completed)).toHaveLength(2)
    expect(screen.queryAllByText(ar.myClasses.columns.student)).toHaveLength(0)
    expect(screen.queryByText(ar.myClasses.relation.self)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('@')
  })

  it('shows a guardian the linked students with the relation tag', async () => {
    mockMyClassesApi(makeMyClassList([child, own]))
    renderPage(['guardian', 'student'])

    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()
    expect(screen.getAllByText(ar.myClasses.columns.student).length).toBeGreaterThan(0)
    expect(screen.getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.getByText(ar.myClasses.relation.self)).toBeInTheDocument()
  })

  it('asks the server for one status through the filter, and reloads on demand', async () => {
    const api = mockMyClassesApi(makeMyClassList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myClasses.empty)).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.myClasses.filterLabel }))
    fireEvent.click(await screen.findByText(ar.labels.withdrawn, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.queries[1]!)).toEqual({ status: 'withdrawn' })
    expect(await screen.findByText(ar.myClasses.emptyFiltered)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(ar.myClasses.refresh))
    await waitFor(() => expect(api.queries).toHaveLength(3))
    expect(Object.fromEntries(api.queries[2]!)).toEqual({ status: 'withdrawn' })
  })

  it('shows a server failure with a retry button', async () => {
    mockMyClassesApi(jsonResponse(503, { statusCode: 503, message: 'down' }))
    renderPage(['student'])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ar.login.errors.server)).toBeInTheDocument()
    expect(within(alert).getByText(ar.myClasses.refresh)).toBeInTheDocument()
  })

  it('keeps /my-classes closed to a user without the student or guardian role — the 403 page and no request (J-F04 test 07; the server answers by ownership anyway)', () => {
    const api = mockMyClassesApi(makeMyClassList([own]))
    const teacher = makeUser({ role: 'teacher', roles: ['teacher'], permissions: ROSTER_TEACHER_PERMISSIONS })
    for (const user of [teacher, makeUser()]) {
      const { unmount } = renderWithProviders(
        <RequireAccess navKey="myClasses">
          <MyClassesPage />
        </RequireAccess>,
        { auth: makeAuth({ user }), route: '/my-classes' },
      )
      expect(screen.getByText(ar.errors.forbidden)).toBeInTheDocument()
      expect(screen.queryByText(ar.myClasses.title)).not.toBeInTheDocument()
      unmount()
    }
    expect(api.urls).toEqual([])
  })

  it('shows the progress of each class and opens its lessons from the row (J-F61)', async () => {
    const course = makeLearningCourse({ enrollmentId: own.enrollmentId })
    mockMyClassesApi(makeMyClassList([own]), { learning: [course] })
    renderPage(['student'])

    const progress = await screen.findByTestId(`class-progress-${own.enrollmentId}`)
    expect(within(progress).getByText('37%')).toBeInTheDocument()
    fireEvent.click(screen.getByText(ar.mySchool.card.actions.continue).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/learn/${course.course.id}`)
  })

  it('keeps the progress and the way into the lessons in the first column on a phone (J-F61)', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('max-width'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList,
    )
    try {
      mockMyClassesApi(makeMyClassList([own]), { learning: [makeLearningCourse({ enrollmentId: own.enrollmentId })] })
      renderPage(['student'])

      const progress = await screen.findByTestId(`class-progress-${own.enrollmentId}`)
      const firstCell = progress.closest('td')!
      expect(within(firstCell).getByText('بايثون — الفصل أ')).toBeInTheDocument()
      expect(within(firstCell).getByText(ar.mySchool.card.actions.continue)).toBeInTheDocument()
      expect(screen.queryAllByText(ar.myClasses.columns.progress)).toHaveLength(0)
    } finally {
      matchMedia.mockRestore()
    }
  })

  it('says a course has no published lesson yet, and only opens it (J-F61)', async () => {
    mockMyClassesApi(makeMyClassList([own]), { learning: [makeLearningCourse({ enrollmentId: own.enrollmentId, progress: makeProgress({ total: 0, required: 0, completed: 0, completedRequired: 0, percent: null }) })] })
    renderPage(['student'])

    expect(await screen.findByText(ar.mySchool.card.noLessons)).toBeInTheDocument()
    expect(screen.getByText(ar.mySchool.card.actions.open)).toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.continue)).not.toBeInTheDocument()
  })

  it('shows a guardian the progress of a child with no way into the lessons, no requests tab and no API-222 read (J-F61)', async () => {
    const api = mockMyClassesApi(makeMyClassList([child]), { learning: [makeChildCourse({ enrollmentId: child.enrollmentId })] })
    renderPage(['guardian'], '/my-classes?section=requests')

    expect(await screen.findByTestId(`class-progress-${child.enrollmentId}`)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.continue)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.start)).not.toBeInTheDocument()
    expect(api.other).toEqual(['/api/me/learning'])
  })

  it('keeps the classes on screen when the progress cannot be read, with its own retry (J-F61)', async () => {
    const api = mockMyClassesApi(makeMyClassList([own]), { learning: jsonResponse(503, { statusCode: 503, message: 'down' }) })
    renderPage(['student'])

    expect(await screen.findByText(ar.myClasses.learningError)).toBeInTheDocument()
    expect(screen.getByText('بايثون — الفصل أ')).toBeInTheDocument()
    const before = api.other.filter((path) => path === '/api/me/learning').length
    fireEvent.click(screen.getByText(ar.mySchool.retry).closest('button')!)
    await waitFor(() => expect(api.other.filter((path) => path === '/api/me/learning').length).toBe(before + 1))
  })

  it('opens the requests from the old link and cancels a pending one through API-223 (J-F61)', async () => {
    const pending = makeMyRequest()
    const cancelled = makeMyRequest({ status: 'cancelled', state: 'cancelled', decidedAt: '2026-11-19T10:00:00.000Z' })
    const api = mockMyClassesApi(makeMyClassList([own]), { requests: [pending, makeMyRequest({ id: REQUEST_IDS[2], status: 'cancelled', state: 'rejected' })], cancelled })
    renderPage(['student'], '/my-classes?section=requests')

    const card = await screen.findByTestId(`request-${pending.id}`)
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain(ar.myClasses.sections.requests)
    fireEvent.click(within(card).getByText(ar.myCourses.requests.cancel).closest('button')!)
    fireEvent.click((await screen.findByText(ar.myCourses.requests.cancelOk)).closest('button')!)
    await waitFor(() => expect(api.other.some((call) => call.startsWith('POST /api/me/enrollment-requests/'))).toBe(true))
    await waitFor(() => expect(screen.getByTestId(`request-${pending.id}`)).toHaveAttribute('data-state', 'cancelled'))
  })

  it('renders left-to-right in English with the translated texts (J-F04 test 08)', async () => {
    mockMyClassesApi(makeMyClassList([child, own]))
    renderPage(['guardian', 'student'])
    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText(en.myClasses.title)).toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.title)).not.toBeInTheDocument()
    expect(screen.getAllByText(en.myClasses.columns.student).length).toBeGreaterThan(0)
    expect(screen.getByText(en.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.getByText(en.myClasses.relation.self)).toBeInTheDocument()
    expect(screen.getAllByText(en.labels.running).length).toBeGreaterThan(0)
  })
})
