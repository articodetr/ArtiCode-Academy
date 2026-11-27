// A course's lessons on «دوراتي» (J-F64's panel, on «دوراتي» — «فصولي» — since J-F67) and «دروسي» after J-F67: the summary
// and the same panel for every course (a guardian: the lessons newest first). Moved from MyLessonsPage.hub.test.tsx.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LearningItem, LearningWorkspace, MyLearningCourse, WorkspaceItemExam } from '../api/learning'
import type { MyExamItem } from '../api/myExams'
import { ar } from '../i18n/ar'
import { TITLES, makeItem, makeWorkspace, withSecondLevelClosed } from '../learn/learn.fixtures'
import { resetWatchedMemory } from '../learn/watched.store'
import { makeLearningCourse } from '../mySchool/mySchool.fixtures'
import { makeAcademy } from '../test/academy'
import { makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyExam, makePublishedMyExam } from '../test/myExams'
import type { MyLessonItem } from '../api/myLessons'
import { makeMyLesson, makeMyLessonList } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyClassesPage } from './MyClassesPage'
import { MyLessonsPage } from './MyLessonsPage'

const hub = ar.myLessons.hub
const COURSE = makeLearningCourse({ course: { ...makeLearningCourse().course, id: 'c1', name: { ar: 'أساسيات البرمجة' } } })
const CLASS = makeMyClassItem({ enrollmentId: COURSE.enrollmentId })

function serve(options: { courses?: MyLearningCourse[]; workspace?: LearningWorkspace; items?: Record<string, LearningItem>; exams?: MyExamItem[]; classLessons?: MyLessonItem[] } = {}) {
  const { courses = [COURSE], workspace = makeWorkspace(), items = { i2: makeItem('i2'), i3: makeItem('i3') }, exams = [], classLessons = [] } = options
  const paths: string[] = []
  const lessonQueries: URLSearchParams[] = []
  mockFetch((url, init) => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    paths.push(`${init?.method ?? 'GET'} ${pathname}`)
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/me/learning') return jsonResponse(200, { items: courses })
    if (pathname === '/api/me/learning/courses/c1') return jsonResponse(200, workspace)
    const visit = /^\/api\/me\/learning\/items\/([^/]+)\/visit$/.exec(pathname)
    if (visit) return jsonResponse(200, { progress: items[visit[1]!]!.progress })
    const item = /^\/api\/me\/learning\/items\/([^/]+)$/.exec(pathname)
    if (item) return items[item[1]!] ? jsonResponse(200, items[item[1]!]) : jsonResponse(404, { statusCode: 404, code: 'lesson_not_found' })
    if (pathname === '/api/me/lessons') {
      lessonQueries.push(searchParams)
      return jsonResponse(200, makeMyLessonList(classLessons))
    }
    if (pathname === '/api/me/classes') return jsonResponse(200, makeMyClassList([CLASS]))
    // J-F68: «اختبارات الدورة» at the end of a course's lessons (none here) and the cards' certificates.
    if (pathname === '/api/me/exams') return jsonResponse(200, { items: exams, nextCursor: null })
    if (pathname === '/api/me/certificates') return jsonResponse(200, { items: [] })
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return { paths, lessonQueries }
}

/** The address with its query: the chosen course and the opened lesson live there. */
function AddressProbe() {
  const { pathname, search } = useLocation()
  return <output data-testid="location">{`${pathname}${search}`}</output>
}

function renderClasses(route = '/my-classes', roles = ['student']) {
  return renderWithProviders(
    <>
      <MyClassesPage />
      <AddressProbe />
    </>,
    { auth: makeAuth({ user: makeUser({ id: 'student-1', role: roles.includes('student') ? 'student' : 'guardian', roles, permissions: [] }) }), route, path: '/my-classes' },
  )
}

function renderLessons(roles = ['student'], route = '/my-lessons') {
  return renderWithProviders(<MyLessonsPage />, {
    auth: makeAuth({ user: makeUser({ id: 'student-1', role: roles.includes('student') ? 'student' : 'guardian', roles, permissions: [] }) }),
    route,
  })
}

const row = (title: string) => screen.getByText(title, { selector: '.hub-row__title, .hub-row__title *' }).closest('li')!

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('«فصولي» — a course’s lessons below the cards (J-F67)', () => {
  it('shows no lessons until a card is chosen, then the chosen course’s lessons by level below the cards', async () => {
    const { paths } = serve()
    renderClasses()

    const card = await screen.findByTestId(`class-card-${CLASS.enrollmentId}`)
    await waitFor(() => expect(within(card).getByRole('progressbar')).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: hub.panel.label.replace('{{course}}', 'أساسيات البرمجة') })).not.toBeInTheDocument()
    expect(paths).not.toContain('GET /api/me/learning/courses/c1')

    // The whole card chooses the course (its own button covers it).
    fireEvent.click(within(card).getByRole('button', { name: ar.myClasses.card.select.replace('{{course}}', 'أساسيات بايثون') }))
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/my-classes?course=c1')
    expect(card).toHaveClass('is-active')
    const panel = screen.getByRole('region', { name: hub.panel.label.replace('{{course}}', 'أساسيات البرمجة') })
    expect(screen.getByText('المستوى الأول — أساسيات')).toBeInTheDocument()
    // The panel comes after the cards in the page.
    expect(card.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(row(TITLES.i1)).getByText(hub.row.completed)).toBeInTheDocument()
    expect(within(row(TITLES.i2)).getByRole('button', { name: new RegExp(hub.row.play) })).toBeInTheDocument()
    expect(within(row(TITLES.i3)).getByRole('button', { name: new RegExp(hub.row.open) })).toBeInTheDocument()
  })

  it('chooses the course from «استعراض الدروس» too, and scrolls to its lessons', async () => {
    serve()
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this)
    }
    try {
      renderClasses()
      const card = await screen.findByTestId(`class-card-${CLASS.enrollmentId}`)
      await waitFor(() => expect(within(card).getByRole('progressbar')).toBeInTheDocument())
      fireEvent.click(within(card).getByText(ar.myClasses.card.browse).closest('button')!)
      expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
      expect(scrolled.some((element) => element.classList.contains('hub-panel-anchor'))).toBe(true)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('plays a YouTube lesson inside the page, keeps the list and closes back to it', async () => {
    const { paths } = serve()
    const { container } = renderClasses('/my-classes?course=c1')
    await screen.findByText(TITLES.i2)

    fireEvent.click(within(row(TITLES.i2)).getByRole('button', { name: new RegExp(hub.row.play) }))

    const player = await screen.findByRole('region', { name: hub.player.label })
    await waitFor(() => expect(player.querySelector('iframe')).not.toBeNull())
    expect(player.querySelector('iframe')!.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(within(player).getByRole('progressbar', { name: ar.learn.lesson.watch.label })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/my-classes?course=c1&lesson=i2')
    expect(within(row(TITLES.i2)).getByText(hub.row.playing)).toBeInTheDocument()
    await waitFor(() => expect(paths).toContain('POST /api/me/learning/items/i2/visit'))

    fireEvent.click(within(player).getByRole('button', { name: new RegExp(hub.player.close) }))
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull())
    expect(screen.getByTestId('location')).toHaveTextContent('/my-classes?course=c1')
  })

  it('opens the lesson the address names', async () => {
    serve()
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await screen.findByRole('region', { name: hub.player.label })
    await waitFor(() => expect(player.querySelector('iframe')).not.toBeNull())
  })

  it('never opens a lesson of a level that is not open yet', async () => {
    const { paths } = serve({ workspace: withSecondLevelClosed(makeWorkspace()) })
    renderClasses('/my-classes?course=c1&lesson=i3')
    await screen.findByText(TITLES.i3)
    expect(within(row(TITLES.i3)).queryByRole('button')).not.toBeInTheDocument()
    expect(row(TITLES.i3)).toHaveTextContent('يُفتح في')
    expect(screen.queryByRole('region', { name: hub.player.label })).not.toBeInTheDocument()
    expect(paths).not.toContain('GET /api/me/learning/items/i3')
  })

  it('filters the lessons by type', async () => {
    serve()
    renderClasses('/my-classes?course=c1')
    await screen.findByText(TITLES.i2)
    fireEvent.click(screen.getByRole('button', { name: hub.filters.live }))
    expect(await screen.findByText(hub.emptyFilter)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: hub.filters.recorded }))
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
  })
})

describe('«دروسي» after J-F67 — one list of every course’s lessons, newest first, in the look of «دوراتي»', () => {
  it('gives a student the summary and one list naming each lesson’s course — no tabs, no cards, no sessions read', async () => {
    const { paths } = serve()
    renderLessons()

    expect(await screen.findByRole('heading', { name: hub.title })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: ar.myLessons.feed.title })).toBeInTheDocument()
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
    // Newest first (the fixture adds i1 … i4 a day apart), each row naming its course and level.
    const titles = [...document.querySelectorAll('.hub-row__title')].map((node) => node.textContent ?? '')
    expect(titles.findIndex((text) => text.includes(TITLES.i4))).toBeLessThan(titles.findIndex((text) => text.includes(TITLES.i1)))
    expect(within(row(TITLES.i2)).getByText(/أساسيات البرمجة/)).toBeInTheDocument()
    expect(within(row(TITLES.i2)).getByRole('button', { name: new RegExp(hub.row.play) })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(document.querySelector('.hub-card, .hub-grid')).toBeNull()
    // J-F80: the class lessons their teachers add are read too (API-101), in their own panel.
    expect(paths).toContain('GET /api/me/lessons')
    expect(await screen.findByRole('region', { name: ar.myLessons.feed.classTitle })).toBeInTheDocument()
  })

  it('J-F80 — shows a student the class lessons their teacher adds, with the join link, the video and the attachments (none for a cancelled lesson)', async () => {
    const live = makeMyLesson({ id: 'live-1', title: { ar: 'درس الحلقات المباشر' }, deliveryMode: 'live_online', status: 'scheduled', startsAt: '2099-01-10T10:00:00Z', endsAt: '2099-01-10T11:00:00Z', meetingUrl: 'https://meet.example.com/loops', attachments: [{ kind: 'book', title: { ar: 'كتاب الحلقات' }, url: 'https://cdn.example.org/loops.pdf' }] })
    const recorded = makeMyLesson({ id: 'rec-1', title: { ar: 'مراجعة مسجّلة' }, deliveryMode: 'recorded', status: 'completed', recordingUrl: 'https://videos.example.com/review', attachments: [{ kind: 'link', title: { ar: 'تمارين' }, url: 'https://example.org/drills' }] })
    const cancelled = makeMyLesson({ id: 'off-1', title: { ar: 'درس ملغى' }, status: 'cancelled', recordingUrl: 'https://videos.example.com/off', attachments: [{ kind: 'link', title: { ar: 'رابط الدرس الملغى' }, url: 'https://example.org/off' }] })
    serve({ classLessons: [live, recorded, cancelled] })
    renderLessons()

    const panel = await screen.findByRole('region', { name: ar.myLessons.feed.classTitle })
    expect(within(panel).getByText(ar.myLessons.feed.classHint)).toBeInTheDocument()
    const liveRow = (await within(panel).findByText('درس الحلقات المباشر')).closest('li')!
    expect(within(liveRow).getByText(ar.myLessons.feed.join).closest('a')).toHaveAttribute('href', 'https://meet.example.com/loops')
    // J-F81: the attachments are a button beside «الانضمام» (one = «المرفق», opening it in a new tab).
    expect(within(liveRow).getByText(ar.myLessons.hub.row.file).closest('a')).toHaveAttribute('href', 'https://cdn.example.org/loops.pdf')
    const recordedRow = within(panel).getByText('مراجعة مسجّلة').closest('li')!
    const watch = within(recordedRow).getByText(ar.lessons.attachments.watchVideo).closest('a')!
    expect(watch).toHaveAttribute('href', 'https://videos.example.com/review')
    expect(watch).toHaveAttribute('target', '_blank')
    expect(within(recordedRow).getByText(ar.myLessons.hub.row.file).closest('a')).toHaveAttribute('href', 'https://example.org/drills')
    const cancelledRow = within(panel).getByText('درس ملغى').closest('li')!
    expect(within(cancelledRow).queryByText(ar.lessons.attachments.watchVideo)).not.toBeInTheDocument()
    expect(within(cancelledRow).queryByText(ar.myLessons.hub.row.file)).not.toBeInTheDocument()
  })

  it('plays a lesson inside the page from «دروسي» too', async () => {
    serve()
    renderLessons(['student'], '/my-lessons?course=c1&lesson=i2')
    const player = await screen.findByRole('region', { name: hub.player.label })
    await waitFor(() => expect(player.querySelector('iframe')).not.toBeNull())
  })

  it('offers the catalog when the student has no course', async () => {
    serve({ courses: [] })
    renderLessons()
    expect(await screen.findByText(hub.empty.title)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.empty.action })).toHaveAttribute('href', '/catalog')
  })

  it('keeps the old link of the learner home working: the same page', async () => {
    serve()
    renderLessons(['student'], '/my-lessons?view=sessions')
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
  })

  it('gives a guardian their children’s lessons newest first: they follow, they do not study', async () => {
    const { paths, lessonQueries } = serve()
    renderLessons(['guardian'])
    await waitFor(() => expect(lessonQueries.length).toBeGreaterThan(0))
    expect(lessonQueries.at(-1)!.get('order')).toBe('desc')
    expect(paths).not.toContain('GET /api/me/learning')
    expect(screen.getByRole('heading', { name: ar.myLessons.title })).toBeInTheDocument()
  })
})


/** The fixture workspace with `exams` on its lesson i2 (API-230 since J-F67). */
function withLessonExams(exams: WorkspaceItemExam[]): LearningWorkspace {
  const workspace = makeWorkspace()
  return {
    ...workspace,
    sections: workspace.sections.map((section) => ({ ...section, items: section.items.map((item) => (item.id === 'i2' ? { ...item, exams } : item)) })),
  }
}

/** The learner's row of an exam of their class in «my exams» (API-121): the workspace's class `k1`, the card's student. */
function ownExam(item: MyExamItem): MyExamItem {
  return { ...item, class: { ...item.class, id: 'k1' }, student: { ...item.student, id: COURSE.student.id } }
}

function lessonExamOf(item: MyExamItem, done: boolean): WorkspaceItemExam {
  return { id: item.id, title: item.title, delivery: 'manual', status: item.status === 'published' ? 'published' : 'scheduled', scheduledAt: item.scheduledAt, closesAt: null, done }
}

describe('the lesson popup as in Jallal’s reference (J-F69)', () => {
  const popup = () => screen.findByRole('region', { name: hub.player.label })
  const facts = hub.player.facts

  it('heads the popup with the lesson’s title and «×», then the card of the course, level, teacher, kind and time', async () => {
    serve()
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    expect(await within(player).findByRole('heading', { name: TITLES.i2 })).toBeInTheDocument()
    expect(within(player).getByRole('button', { name: hub.player.close })).toBeInTheDocument()

    const card = within(player).getByLabelText(facts.label)
    const fact = (label: string) => within(card).getByText(label).closest('div')!
    expect(fact(facts.course)).toHaveTextContent('أساسيات البرمجة')
    expect(fact(facts.level)).toHaveTextContent('المستوى الأول — أساسيات')
    expect(fact(facts.teacher)).toHaveTextContent('خالد المعلم')
    expect(fact(facts.kind)).toHaveTextContent(facts.kinds.recorded)
    expect(fact(facts.when)).toHaveTextContent(facts.noDate)

    // The video in its dark frame, «مشاهدة على YouTube» and «المشاهدة المحتسبة» under it; no bottom navigation.
    await waitFor(() => expect(player.querySelector('.learn-embed--framed iframe')).not.toBeNull())
    expect(within(player).getByRole('link', { name: new RegExp(ar.learn.lesson.watch.openOnYouTube) })).toBeInTheDocument()
    expect(within(player).getByText(ar.learn.lesson.watch.counted)).toBeInTheDocument()
    expect(within(player).queryByText(ar.learn.nav.backToContents)).not.toBeInTheDocument()
  })

  it('says «غير محدد» without a lead teacher', async () => {
    serve({ courses: [{ ...COURSE, leadTeacher: null }] })
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    const card = await within(player).findByLabelText(facts.label)
    expect(within(card).getByText(facts.teacher).closest('div')).toHaveTextContent(facts.noTeacher)
  })

  it('steps to the next and the previous lesson with the side arrows, the popup staying open', async () => {
    const { paths } = serve({ items: { i1: makeItem('i1'), i2: makeItem('i2'), i3: makeItem('i3') } })
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    await within(player).findByRole('heading', { name: TITLES.i2 })

    const steps = within(player).getByRole('navigation', { name: ar.learn.nav.label })
    const next = within(steps).getByRole('button', { name: hub.player.next.replace('{{title}}', TITLES.i3) })
    expect(next).toHaveClass('hub-player__step--next')
    fireEvent.click(next)

    expect(await within(player).findByRole('heading', { name: TITLES.i3 })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/my-classes?course=c1&lesson=i3')
    expect(screen.getByRole('region', { name: hub.player.label })).toBe(player)
    expect(paths).toContain('GET /api/me/learning/items/i3')

    fireEvent.click(within(steps).getByRole('button', { name: hub.player.previous.replace('{{title}}', TITLES.i2) }))
    expect(await within(player).findByRole('heading', { name: TITLES.i2 })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/my-classes?course=c1&lesson=i2')

    // The first lesson has no previous one: no arrow on that side.
    fireEvent.click(within(steps).getByRole('button', { name: hub.player.previous.replace('{{title}}', TITLES.i1) }))
    expect(await within(player).findByRole('heading', { name: TITLES.i1 })).toBeInTheDocument()
    await waitFor(() => expect(within(steps).queryByRole('button', { name: /الدرس السابق/ })).not.toBeInTheDocument())
    expect(within(steps).getByRole('button', { name: hub.player.next.replace('{{title}}', TITLES.i2) })).toBeInTheDocument()
  })

  it('disables the arrow toward a lesson whose level is not open yet', async () => {
    const locked = makeItem('i2', { neighbors: { previous: { id: 'i1', title: { ar: TITLES.i1 }, available: true }, next: { id: 'i3', title: { ar: TITLES.i3 }, available: false } } })
    const { paths } = serve({ items: { i2: locked } })
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    await within(player).findByRole('heading', { name: TITLES.i2 })
    const label = `${hub.player.next.replace('{{title}}', TITLES.i3)} — ${ar.learn.nav.locked}`
    const next = within(player).getByRole('button', { name: label })
    expect(next).toBeDisabled()
    fireEvent.click(next)
    expect(paths).not.toContain('GET /api/me/learning/items/i3')
  })

  it('shows «تم الاجتياز» in green once the learner’s result passes the lesson’s exam', async () => {
    const passed = ownExam(makePublishedMyExam())
    serve({ workspace: withLessonExams([lessonExamOf(passed, true)]), exams: [passed] })
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    const box = await within(player).findByText(hub.player.exam.passed.replace('{{title}}', passed.title.ar))
    expect(box.closest('li')).toHaveClass('is-passed')
  })

  it('says where an exam not passed yet stands, with no button for an exam taken in class', async () => {
    const pending = ownExam(makeMyExam())
    serve({ workspace: withLessonExams([lessonExamOf(pending, false)]), exams: [pending] })
    renderClasses('/my-classes?course=c1&lesson=i2')
    const player = await popup()
    const box = (await within(player).findByText(hub.player.exam.title.replace('{{title}}', pending.title.ar))).closest('li')!
    await waitFor(() => expect(box).toHaveTextContent(ar.myClasses.certificateGaps.exams.state.awaitingResult))
    expect(within(box).queryByRole('button')).not.toBeInTheDocument()
  })
})
