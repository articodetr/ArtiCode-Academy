import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { MyClassList } from '../api/enrollments'
import type { MyLearningCourse } from '../api/learning'
import { RequireAccess } from '../auth/RequireAuth'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { LEARNING_SUBJECT, makeChildCourse, makeLearningCourse, makeProgress } from '../mySchool/mySchool.fixtures'
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
    // J-F67: the issued certificates behind «الشهادة» (none in these tests).
    if (parsed.pathname === '/api/me/certificates') {
      other.push(parsed.pathname)
      return jsonResponse(200, { items: [] })
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

/** The class cards (J-F67), in the server's order. */
function classCards() {
  return screen.getAllByTestId(/^class-card-/)
}

describe('MyClassesPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('J-F67: a card never leads to another page — no link on the name, no «استعراض الدروس» without lessons below', async () => {
    const withdrawn = makeMyClassItem({
      enrollmentId: ENROLLMENT_IDS[1],
      enrollmentStatus: 'withdrawn',
      withdrawnAt: '2026-10-01T12:00:00.000Z',
      class: { ...own.class, id: 'c-3', code: 'OLD-1', name: { ar: 'فصل منسحب منه' } },
    })
    mockMyClassesApi(makeMyClassList([own, withdrawn]))
    renderPage(['student'])

    expect(await screen.findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // Without API-229's answer no card can show lessons below, so none offers «استعراض الدروس».
    const [ownCard, withdrawnCard] = classCards()
    expect(within(ownCard!).queryByText(ar.myClasses.card.browse)).not.toBeInTheDocument()
    expect(within(withdrawnCard!).queryByText(ar.myClasses.card.browse)).not.toBeInTheDocument()
  })

  it('shows a student their own classes from GET /api/me/classes as cards, with no student line and no contact details', async () => {
    const api = mockMyClassesApi(makeMyClassList([own, completed]))
    renderPage(['student'])

    expect(await screen.findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(api.urls).toEqual(['/api/me/classes'])
    expect(Object.fromEntries(api.queries[0]!)).toEqual({})
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = classCards()
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(cards[1]!).getByText(ar.classes.noTeacher)).toBeInTheDocument()
    // At Jallal's request: no class code, no enrollment badge, no period, class status or enrollment day.
    for (const card of cards) {
      for (const hidden of ['PY-101-A', 'WEB-B', ar.labels.running, ar.labels.active, ar.labels.completed]) {
        expect(within(card).queryByText(hidden)).not.toBeInTheDocument()
      }
    }
    expect(screen.queryByRole('definition')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.relation.self)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('@')
  })

  it('shows a guardian the linked students with the relation tag', async () => {
    mockMyClassesApi(makeMyClassList([child, own]))
    renderPage(['guardian', 'student'])

    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()
    const [childCard, ownCard] = classCards()
    expect(within(childCard!).getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(within(ownCard!).getByText('عمر خالد')).toBeInTheDocument()
    expect(within(ownCard!).getByText(ar.myClasses.relation.self)).toBeInTheDocument()
  })

  it('shows nothing above the cards — no visible title, no tabs, no status filter, no requests read (J-F67)', async () => {
    const api = mockMyClassesApi(makeMyClassList([own]))
    renderPage(['student'])

    expect(await screen.findByTestId(`class-card-${own.enrollmentId}`)).toBeInTheDocument()
    // The heading is kept for screen readers only.
    expect(screen.getByRole('heading', { level: 1, name: ar.myClasses.title })).toHaveClass('hub-sr-only')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.sections.requests)).not.toBeInTheDocument()
    expect(api.other).not.toContain('/api/me/enrollment-requests')
  })

  it('says so when the learner has no active or completed class', async () => {
    mockMyClassesApi(makeMyClassList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myClasses.empty)).toBeInTheDocument()
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

  it('names the course’s school subject on its card and never its difficulty level (PORTAL-04)', async () => {
    const base = makeLearningCourse().course
    const withSubject = makeLearningCourse({ enrollmentId: own.enrollmentId, course: { ...base, subject: LEARNING_SUBJECT, level: { id: '0195a000-0000-7000-8000-00000000b201', name: { ar: 'مستوى متقدّم', en: 'Advanced' } } } })
    mockMyClassesApi(makeMyClassList([own]), { learning: [withSubject] })
    renderPage(['student'])

    const subject = await screen.findByTestId('class-card-subject')
    expect(screen.getByTestId(`class-card-${own.enrollmentId}`)).toContainElement(subject)
    expect(subject).toHaveTextContent(LEARNING_SUBJECT.name.ar)
    expect(screen.queryByText('مستوى متقدّم')).not.toBeInTheDocument()
  })

  it('shows no subject badge when the course has none (PORTAL-04)', async () => {
    mockMyClassesApi(makeMyClassList([own]), { learning: [makeLearningCourse({ enrollmentId: own.enrollmentId })] })
    renderPage(['student'])
    await screen.findByTestId(`class-progress-${own.enrollmentId}`)
    expect(screen.queryByTestId('class-card-subject')).not.toBeInTheDocument()
  })

  it('shows the progress of each class on its card and opens its lessons from there (J-F61, J-F67)', async () => {
    const course = makeLearningCourse({ enrollmentId: own.enrollmentId })
    mockMyClassesApi(makeMyClassList([own]), { learning: [course] })
    renderPage(['student'])

    const progress = await screen.findByTestId(`class-progress-${own.enrollmentId}`)
    const card = screen.getByTestId(`class-card-${own.enrollmentId}`)
    expect(card).toContainElement(progress)
    // The server's counts and percent only, as on the cards of «دروسي».
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37')
    expect(progress.textContent).toContain('3 / 9')
    expect(progress.textContent).toContain('37٪')
    expect(within(card).getByText(ar.myClasses.card.lessons.replace('{{total}}', '9'), { exact: false })).toBeInTheDocument()
    // «استعراض الدروس» is a button of this page (the lessons show below) — no «واصل التعلم», no link anywhere.
    expect(within(card).getByText(ar.myClasses.card.browse).closest('button')).not.toBeNull()
    expect(within(card).queryByText(ar.mySchool.card.actions.continue)).not.toBeInTheDocument()
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the course cover on the card only from an https address (J-F67)', async () => {
    const base = makeLearningCourse().course
    const withCover = makeLearningCourse({ enrollmentId: own.enrollmentId, course: { ...base, coverImageUrl: 'https://cdn.example.test/python.png' } })
    const insecure = makeLearningCourse({ enrollmentId: completed.enrollmentId, course: { ...base, coverImageUrl: 'http://cdn.example.test/web.png' } })
    mockMyClassesApi(makeMyClassList([own, completed]), { learning: [withCover, insecure] })
    renderPage(['student'])

    await screen.findByTestId(`class-progress-${own.enrollmentId}`)
    const [ownCard, completedCard] = classCards()
    expect(ownCard!.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.test/python.png')
    expect(completedCard!.querySelector('img')).toBeNull()
  })

  it('says a course has no published lesson yet, with no way to another page (J-F61, J-F67)', async () => {
    mockMyClassesApi(makeMyClassList([own]), { learning: [makeLearningCourse({ enrollmentId: own.enrollmentId, progress: makeProgress({ total: 0, required: 0, completed: 0, completedRequired: 0, percent: null }) })] })
    renderPage(['student'])

    expect(await screen.findByText(ar.mySchool.card.noLessons)).toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.open)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.continue)).not.toBeInTheDocument()
  })

  it('shows a guardian the progress of a child with no way into the lessons, no requests tab and no API-222 read (J-F61)', async () => {
    const api = mockMyClassesApi(makeMyClassList([child]), { learning: [makeChildCourse({ enrollmentId: child.enrollmentId })] })
    renderPage(['guardian'], '/my-classes?section=requests')

    expect(await screen.findByTestId(`class-progress-${child.enrollmentId}`)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.continue)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.card.actions.start)).not.toBeInTheDocument()
    expect([...api.other].sort()).toEqual(['/api/me/certificates', '/api/me/learning'])
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
    // J-F67: no tabs — the requests have their own heading and a way back to the cards.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ar.myClasses.sections.requests })).toBeInTheDocument()
    expect(screen.queryByTestId(/^class-card-/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { level: 1, name: en.myClasses.title })).toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.title)).not.toBeInTheDocument()
    // Both cards render; neither offers «Browse lessons» without API-229's answer (not served here — J-F67).
    expect(classCards()).toHaveLength(2)
    expect(screen.queryByText(en.myClasses.card.browse)).not.toBeInTheDocument()
    expect(screen.getByText(en.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.getByText(en.myClasses.relation.self)).toBeInTheDocument()
  })
})
