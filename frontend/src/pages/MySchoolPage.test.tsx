// MOD-20 — «My School» (TEST-250): the sections and the URL, the course cards with the server's progress and their
// one action, a guardian's child card without a learn button, the request actions, the assessments and the
// certificates, every source failing and retrying on its own, the local search and the phone's section bar.
// TEST-263 (LRN-T06, D-R143): the class's next session on a card — day and times in its own zone, title, meeting link
// (never on a guardian's card), nothing when the class has none left.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router'
import type { MyEnrollmentRequest } from '../api/catalog'
import type { MyLearningCourse } from '../api/learning'
import type { MyAssignmentItem } from '../api/myAssignments'
import type { MyCertificateItem } from '../api/myCertificates'
import type { MyExamItem } from '../api/myExams'
import { ar } from '../i18n/ar'
import { formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { LEARNING_COURSE_IDS, LEARNING_ENROLLMENT_IDS, makeChildCourse, makeCompletedCourse, makeLearningCourse, makeNextSession, makeProgress } from '../mySchool/mySchool.fixtures'
import { CATALOG_COURSE_IDS, REQUEST_IDS, makeMyRequest, makeMyRequestList } from '../test/catalog'
import { CERTIFICATE_ID, CERTIFICATE_ID_2 } from '../test/certificates'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeMyAssignment, makeMyAssignmentList } from '../test/myAssignments'
import { makeMyCertificate, makeMyCertificateList } from '../test/myCertificates'
import { makeMyExam, makeMyExamList } from '../test/myExams'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MySchoolPage } from './MySchoolPage'

type Source<T> = T[] | ((call: number) => Response)

interface Sources {
  learning?: Source<MyLearningCourse>
  requests?: Source<MyEnrollmentRequest>
  certificates?: Source<MyCertificateItem>
  assignments?: Source<MyAssignmentItem>
  exams?: Source<MyExamItem>
}

interface Api {
  /** Every GET, path and query. */
  urls: string[]
  posts: string[]
  count: (path: string) => number
}

function answer<T>(source: Source<T> | undefined, call: number, wrap: (items: T[]) => unknown): Response {
  if (typeof source === 'function') return source(call)
  return jsonResponse(200, wrap(source ?? []))
}

function mockSchoolApi(sources: Sources, cancel?: MyEnrollmentRequest): Api {
  const urls: string[] = []
  const posts: string[] = []
  const calls = new Map<string, number>()
  mockFetch((url, init) => {
    if (init?.method === 'POST') {
      posts.push(url)
      return jsonResponse(200, cancel)
    }
    const parsed = new URL(url, 'http://localhost')
    urls.push(`${parsed.pathname}${parsed.search}`)
    const call = calls.get(parsed.pathname) ?? 0
    calls.set(parsed.pathname, call + 1)
    switch (parsed.pathname) {
      case '/api/me/learning':
        return answer(sources.learning, call, (items) => ({ items }))
      case '/api/me/enrollment-requests':
        return answer(sources.requests, call, makeMyRequestList)
      case '/api/me/certificates':
        return answer(sources.certificates, call, makeMyCertificateList)
      case '/api/me/assignments':
        return answer(sources.assignments, call, (items) => makeMyAssignmentList(items))
      case '/api/me/exams':
        return answer(sources.exams, call, (items) => makeMyExamList(items))
      default:
        return jsonResponse(404, { statusCode: 404, message: 'not mocked' })
    }
  })
  return { urls, posts, count: (path) => urls.filter((url) => url.split('?')[0] === path).length }
}

function SearchProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderPage(options: { roles?: string[]; route?: string } = {}) {
  const roles = options.roles ?? ['student']
  return renderWithProviders(
    <>
      <MySchoolPage />
      <SearchProbe />
    </>,
    {
      auth: makeAuth({ user: makeUser({ id: 'student-1', role: roles.includes('student') ? 'student' : 'guardian', roles, permissions: ['courses.read', 'certificates.read_own'] }) }),
      route: options.route ?? '/my-school',
      path: '/my-school',
      routes: {
        '/learn/:courseId': <LocationProbe />,
        '/payments': <LocationProbe />,
        '/catalog': <LocationProbe />,
        '/catalog/:courseId': <LocationProbe />,
        '/my-assignments': <LocationProbe />,
        '/my-exams': <LocationProbe />,
        '/my-grades': <LocationProbe />,
        '/my-certificates': <LocationProbe />,
        '/my-certificates/:id/print': <LocationProbe />,
      },
    },
  )
}

const sectionsNav = () => within(screen.getByTestId('my-school-sections'))
const card = (enrollmentId: string) => within(screen.getByTestId(`course-card-${enrollmentId}`))
const statValue = (key: string) => screen.getByTestId(`stat-${key}`).querySelector('.ms-stat__value')?.textContent
const failure = (status: number) => () => jsonResponse(status, { statusCode: status, message: 'boom' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MySchoolPage', () => {
  it('continues a student’s unfinished courses with the server’s progress and opens the workspace', async () => {
    const older = makeLearningCourse({ enrollmentId: 'older', lastActivityAt: '2026-11-10T10:00:00.000Z', course: { ...makeLearningCourse().course, id: 'course-older', code: 'OLD-1', name: { ar: 'دورة أقدم' } } })
    const api = mockSchoolApi({
      learning: [makeCompletedCourse(), older, makeLearningCourse()],
      requests: [makeMyRequest(), makeMyRequest({ id: REQUEST_IDS[1], status: 'cancelled', state: 'rejected' })],
      certificates: [makeMyCertificate(), makeMyCertificate({ id: CERTIFICATE_ID_2, status: 'revoked' })],
    })
    renderPage()

    expect(await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)).toBeInTheDocument()
    const python = card(LEARNING_ENROLLMENT_IDS[0])
    expect(screen.getByRole('heading', { level: 2, name: ar.mySchool.sections.continue })).toBeInTheDocument()
    expect(python.getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(python.getByText('المعلم: خالد المعلم')).toBeInTheDocument()
    expect(python.getByText('أنجزت 3 من 8 دروس')).toBeInTheDocument()
    expect(python.getByText('آخر درس: المتغيرات')).toBeInTheDocument()
    expect(python.getByText('37%')).toBeInTheDocument()
    expect(python.getByText(ar.mySchool.card.states.inProgress)).toBeInTheDocument()
    expect(python.getByText(ar.mySchool.card.enrollment.active)).toBeInTheDocument()
    // Most recent activity first; the finished course is not in «continue learning».
    const cards = within(screen.getByTestId('my-school-courses')).getAllByTestId(/^course-card-/)
    expect(cards.map((element) => element.getAttribute('data-testid'))).toEqual([`course-card-${LEARNING_ENROLLMENT_IDS[0]}`, 'course-card-older'])
    // Real counts only: two unfinished, one done, one pending request, one valid certificate.
    await waitFor(() => expect(statValue('certificates')).toBe('1'))
    expect(statValue('activeCourses')).toBe('2')
    expect(statValue('completedCourses')).toBe('1')
    expect(statValue('pendingRequests')).toBe('1')
    // KI-125: the «requests» section counts every request it lists (the rejected one too); the summary keeps the pending.
    expect(sectionsNav().getByText(ar.mySchool.sections.requests).querySelector('.ms-nav-count')?.textContent).toBe('2')
    expect([...api.urls].sort()).toEqual(['/api/me/certificates', '/api/me/enrollment-requests', '/api/me/learning'])

    fireEvent.click(python.getByText(ar.mySchool.card.actions.continue).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/learn/${LEARNING_COURSE_IDS[0]}`)
  })

  it('switches sections from the menu, keeps the choice in the URL and offers «review» on a completed course', async () => {
    mockSchoolApi({ learning: [makeLearningCourse(), makeCompletedCourse()] })
    renderPage()
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)

    fireEvent.click(sectionsNav().getByText(ar.mySchool.sections.completed))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?section=completed'))
    const done = card(LEARNING_ENROLLMENT_IDS[1])
    expect(screen.queryByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)).not.toBeInTheDocument()
    expect(done.getByText(ar.mySchool.card.states.complete)).toBeInTheDocument()
    expect(done.getByText(ar.mySchool.card.enrollment.completed)).toBeInTheDocument()
    fireEvent.click(done.getByText(ar.mySchool.card.actions.review).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/learn/${LEARNING_COURSE_IDS[1]}`)
  })

  it('opens the section the URL names and lists every course in «my courses», a course without required lessons too', async () => {
    const fresh = makeLearningCourse({ action: 'start', lastActivityAt: null, lastLesson: null, leadTeacher: null, progress: makeProgress({ total: 0, required: 0, completed: 0, completedRequired: 0, percent: null }) })
    mockSchoolApi({ learning: [fresh, makeCompletedCourse()] })
    renderPage({ route: '/my-school?section=courses' })
    expect(await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[1]}`)).toBeInTheDocument()
    const first = card(LEARNING_ENROLLMENT_IDS[0])
    expect(screen.getByRole('heading', { level: 2, name: ar.mySchool.sections.courses })).toBeInTheDocument()
    expect(first.getByText(ar.mySchool.card.noRequired)).toBeInTheDocument()
    expect(first.getByText(ar.mySchool.card.states.notStarted)).toBeInTheDocument()
    expect(first.queryByText(/^المعلم:/)).not.toBeInTheDocument()
    expect(first.queryByText(/^آخر درس:/)).not.toBeInTheDocument()
    expect(first.getByTestId('course-cover-placeholder')).toBeInTheDocument()
    fireEvent.click(first.getByText(ar.mySchool.card.actions.start).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/learn/${LEARNING_COURSE_IDS[0]}`)
  })

  it('shows a guardian the child’s progress without a learn button, and no request section', async () => {
    const api = mockSchoolApi({ learning: [makeChildCourse()] })
    renderPage({ roles: ['guardian'], route: '/my-school?section=continue' })
    expect(await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[2]}`)).toBeInTheDocument()
    const child = card(LEARNING_ENROLLMENT_IDS[2])
    // «continue learning» is a student's; the guardian lands on the courses they follow.
    expect(screen.getByRole('heading', { level: 2, name: ar.mySchool.sections.courses })).toBeInTheDocument()
    expect(child.getByText('الطالب: ليلى سعيد')).toBeInTheDocument()
    expect(child.getByText('المنجز: 1 من درسين')).toBeInTheDocument()
    expect(child.queryByRole('button')).not.toBeInTheDocument()
    expect(sectionsNav().queryByText(ar.mySchool.sections.requests)).not.toBeInTheDocument()
    expect(sectionsNav().queryByText(ar.mySchool.sections.continue)).not.toBeInTheDocument()
    expect(screen.queryByTestId('stat-pendingRequests')).not.toBeInTheDocument()
    expect(api.count('/api/me/enrollment-requests')).toBe(0)
  })

  it('gives each request its action: pay on «my invoices», wait for approval, or ask again from the course page', async () => {
    mockSchoolApi({
      learning: [],
      requests: [
        makeMyRequest(),
        makeMyRequest({ id: REQUEST_IDS[1], state: 'pending_approval', payment: { state: 'paid', required: true, total: 1200, paid: 1200, balance: 0, currency: 'SAR', invoices: [] } }),
        makeMyRequest({ id: REQUEST_IDS[2], status: 'cancelled', state: 'rejected', rejectionReason: 'يلزم اختبار تحديد المستوى أولاً', decidedAt: '2026-11-19T11:00:00.000Z' }),
      ],
    })
    renderPage({ route: '/my-school?section=requests' })

    const approval = within(await screen.findByTestId(`request-${REQUEST_IDS[1]}`))
    expect(approval.getByRole('button', { name: ar.mySchool.requests.awaitingApproval })).toBeDisabled()
    const rejected = within(screen.getByTestId(`request-${REQUEST_IDS[2]}`))
    expect(rejected.getByText('يلزم اختبار تحديد المستوى أولاً')).toBeInTheDocument()
    expect(rejected.queryByText(ar.myCourses.requests.cancel)).not.toBeInTheDocument()
    // A pending or rejected request is never a course card.
    expect(screen.queryByTestId(/^course-card-/)).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId(`request-${REQUEST_IDS[0]}`)).getByText(ar.mySchool.requests.pay).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/payments')
  })

  it('asks again for a rejected request from the course page, and cancels a pending one after a confirmation', async () => {
    const cancelled = makeMyRequest({ status: 'cancelled', state: 'cancelled', decidedAt: '2026-11-19T10:00:00.000Z' })
    const api = mockSchoolApi({ requests: [makeMyRequest(), makeMyRequest({ id: REQUEST_IDS[2], status: 'cancelled', state: 'rejected' })] }, cancelled)
    renderPage({ route: '/my-school?section=requests' })

    const pending = () => within(screen.getByTestId(`request-${REQUEST_IDS[0]}`))
    await screen.findByTestId(`request-${REQUEST_IDS[0]}`)
    await waitFor(() => expect(statValue('pendingRequests')).toBe('1'))
    fireEvent.click(pending().getByText(ar.myCourses.requests.cancel).closest('button')!)
    fireEvent.click((await screen.findByText(ar.myCourses.requests.cancelOk)).closest('button')!)
    expect(await screen.findByText(ar.mySchool.requests.cancelled)).toBeInTheDocument()
    expect(api.posts).toEqual([`/api/me/enrollment-requests/${REQUEST_IDS[0]}/cancel`])
    await waitFor(() => expect(pending().getByText(ar.catalog.states.cancelled)).toBeInTheDocument())
    expect(pending().queryByText(ar.mySchool.requests.pay)).not.toBeInTheDocument()
    expect(statValue('pendingRequests')).toBe('0')

    fireEvent.click(within(screen.getByTestId(`request-${REQUEST_IDS[2]}`)).getByText(ar.mySchool.requests.requestAgain).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/catalog/${CATALOG_COURSE_IDS[1]}`)
  })

  it('shows a failed source with its own retry while the others keep their content', async () => {
    const api = mockSchoolApi({
      learning: (call) => (call === 0 ? failure(500)() : jsonResponse(200, { items: [makeLearningCourse()] })),
      certificates: [makeMyCertificate()],
      requests: [makeMyRequest()],
    })
    renderPage()

    const alert = await screen.findByText(ar.mySchool.courses.loadError)
    expect(screen.getByText(ar.mySchool.errors.server)).toBeInTheDocument()
    // The summary never guesses: the course counts are unknown, the others are the server's.
    await waitFor(() => expect(statValue('certificates')).toBe('1'))
    expect(statValue('activeCourses')).toBe('—')
    expect(statValue('pendingRequests')).toBe('1')

    fireEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByText(ar.mySchool.retry).closest('button')!)
    expect(await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)).toBeInTheDocument()
    expect(screen.queryByText(ar.mySchool.courses.loadError)).not.toBeInTheDocument()
    expect(statValue('activeCourses')).toBe('1')
    expect(api.count('/api/me/learning')).toBe(2)
    expect(api.count('/api/me/certificates')).toBe(1)
  })

  it('filters the loaded cards by course name or code, locally', async () => {
    const api = mockSchoolApi({ learning: [makeLearningCourse(), makeCompletedCourse()] })
    renderPage({ route: '/my-school?section=courses' })
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[1]}`)

    const search = sectionsNav().getByLabelText(ar.mySchool.search.label)
    fireEvent.change(search, { target: { value: 'web' } })
    expect(screen.queryByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[1]}`)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'بايثون' } })
    expect(screen.getByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'كيمياء' } })
    expect(screen.getByText('لا دورة تطابق «كيمياء».')).toBeInTheDocument()
    expect(api.count('/api/me/learning')).toBe(1)
  })

  it('offers the catalog when nothing is enrolled yet', async () => {
    mockSchoolApi({ learning: [] })
    renderPage()
    const empty = await screen.findByText(ar.mySchool.courses.empty)
    fireEvent.click(within(empty.closest('.ant-empty') as HTMLElement).getByText(ar.mySchool.explore).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/catalog')
  })

  it('reads the assessments only when their section opens and links to the full pages', async () => {
    const api = mockSchoolApi({
      learning: [makeLearningCourse()],
      assignments: [makeMyAssignment()],
      exams: (call) => (call === 0 ? failure(503)() : jsonResponse(200, makeMyExamList([makeMyExam({ scheduledAt: '2030-01-20T07:00:00.000Z' })]))),
    })
    renderPage()
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)
    expect(api.count('/api/me/assignments')).toBe(0)
    expect(api.count('/api/me/exams')).toBe(0)

    fireEvent.click(sectionsNav().getByText(ar.mySchool.sections.assessments))
    const assignments = within(await screen.findByTestId('my-school-assignments'))
    expect(await assignments.findByText('تمارين الحلقات')).toBeInTheDocument()
    const assignmentsUrl = api.urls.find((url) => url.startsWith('/api/me/assignments'))!
    expect(assignmentsUrl).toContain('pending=true')
    expect(assignmentsUrl).toContain('status=open')

    const exams = within(screen.getByTestId('my-school-exams'))
    fireEvent.click((await exams.findByText(ar.mySchool.retry)).closest('button')!)
    expect(await exams.findByText('اختبار منتصف الفصل')).toBeInTheDocument()
    expect(exams.getByText(ar.exams.types.midterm)).toBeInTheDocument()
    expect(api.urls.find((url) => url.startsWith('/api/me/exams'))).toContain('status=scheduled')

    fireEvent.click(screen.getByText(ar.mySchool.assessments.grades).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe('/my-grades')
  })

  it('lists the certificates with the print page of an issued one', async () => {
    mockSchoolApi({ learning: [], certificates: [makeMyCertificate(), makeMyCertificate({ id: CERTIFICATE_ID_2, status: 'revoked', serial: 'CERT-2026-00002' })] })
    renderPage({ route: '/my-school?section=certificates' })
    const issued = within(await screen.findByTestId(`certificate-${CERTIFICATE_ID}`))
    expect(issued.getByText('CERT-2026-00001')).toBeInTheDocument()
    const revoked = within(screen.getByTestId(`certificate-${CERTIFICATE_ID_2}`))
    expect(revoked.getByText(ar.certificates.status.revoked)).toBeInTheDocument()
    expect(revoked.queryByText(ar.mySchool.certificates.print)).not.toBeInTheDocument()
    fireEvent.click(issued.getByText(ar.mySchool.certificates.print).closest('button')!)
    expect((await screen.findByTestId('location')).getAttribute('data-pathname')).toBe(`/my-certificates/${CERTIFICATE_ID}/print`)
  })

  it('words a refused certificates read and reads it again on «try again», the requests on their own', async () => {
    const api = mockSchoolApi({
      learning: [],
      certificates: (call) => (call === 0 ? failure(403)() : jsonResponse(200, makeMyCertificateList([makeMyCertificate()]))),
      requests: (call) => (call === 0 ? failure(500)() : jsonResponse(200, makeMyRequestList([makeMyRequest()]))),
    })
    renderPage({ route: '/my-school?section=certificates' })
    const alert = (await screen.findByText(ar.mySchool.certificates.loadError)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText(ar.mySchool.errors.permission)).toBeInTheDocument()
    expect(statValue('certificates')).toBe('—')
    fireEvent.click(within(alert).getByText(ar.mySchool.retry).closest('button')!)
    expect(await screen.findByTestId(`certificate-${CERTIFICATE_ID}`)).toBeInTheDocument()
    expect(statValue('certificates')).toBe('1')

    fireEvent.click(sectionsNav().getByText(ar.mySchool.sections.requests))
    const requestsAlert = (await screen.findByText(ar.mySchool.requests.loadError)).closest('[role="alert"]') as HTMLElement
    fireEvent.click(within(requestsAlert).getByText(ar.mySchool.retry).closest('button')!)
    expect(await screen.findByTestId(`request-${REQUEST_IDS[0]}`)).toBeInTheDocument()
    expect(api.count('/api/me/certificates')).toBe(2)
    expect(api.count('/api/me/enrollment-requests')).toBe(2)
  })

  it('puts the sections in a bar above the content on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767.98px)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    mockSchoolApi({ learning: [makeLearningCourse(), makeCompletedCourse()] })
    const { container } = renderPage()
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[0]}`)
    expect(container.querySelector('.ms-layout--phone')).not.toBeNull()
    expect(container.querySelector('.ant-menu')).toBeNull()

    fireEvent.click(sectionsNav().getByText(ar.mySchool.sections.completed))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?section=completed'))
    expect(await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[1]}`)).toBeInTheDocument()
  })

  it('shows the class’s next session on a card — in its own zone, with the meeting link — and nothing without one', async () => {
    const zone = 'Asia/Riyadh'
    const session = makeNextSession({ timeZone: zone })
    mockSchoolApi({ learning: [makeLearningCourse({ nextSession: session }), makeCompletedCourse()] })
    renderPage({ route: '/my-school?section=courses' })
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[1]}`)

    const python = card(LEARNING_ENROLLMENT_IDS[0])
    const line = within(python.getByTestId('next-session'))
    expect(line.getByText('الحصة القادمة: حصة الحلقات')).toBeInTheDocument()
    expect(line.getByText(formatLessonTimes(session.startsAt, session.endsAt, 'ar', zone))).toBeInTheDocument()
    expect(python.getByTestId('next-session')).toHaveTextContent(formatLessonDay(session.startsAt, 'ar', zone))
    const link = line.getByText(ar.mySchool.card.meetingLink).closest('a')!
    expect(link).toHaveAttribute('href', 'https://meet.example.org/loops')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // A course whose class has no session left shows no line.
    expect(card(LEARNING_ENROLLMENT_IDS[1]).queryByTestId('next-session')).not.toBeInTheDocument()
  })

  it('names a guardian’s child’s next session without a meeting link, and never renders a non-https link', async () => {
    mockSchoolApi({
      learning: [
        makeChildCourse({ nextSession: makeNextSession() }),
        makeLearningCourse({ nextSession: makeNextSession({ title: { ar: 'حصة بلا رابط آمن' }, meetingUrl: 'http://meet.example.org/plain' }) }),
      ],
    })
    renderPage({ roles: ['student', 'guardian'], route: '/my-school?section=courses' })
    await screen.findByTestId(`course-card-${LEARNING_ENROLLMENT_IDS[2]}`)

    const child = card(LEARNING_ENROLLMENT_IDS[2])
    expect(child.getByText('الحصة القادمة: حصة الحلقات')).toBeInTheDocument()
    expect(child.queryByText(ar.mySchool.card.meetingLink)).not.toBeInTheDocument()
    const own = card(LEARNING_ENROLLMENT_IDS[0])
    expect(own.getByText('الحصة القادمة: حصة بلا رابط آمن')).toBeInTheDocument()
    expect(own.queryByText(ar.mySchool.card.meetingLink)).not.toBeInTheDocument()
  })
})
