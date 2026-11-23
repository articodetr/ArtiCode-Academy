// TEST-251 (MOD-20) — the course player: the redirect to the resume target,
// the access refusals, the curriculum sidebar, moving between lessons, the
// manual completion and its answer, the content by kind, and the «course
// complete» confirmation that follows the server's word only.
// TEST-263 (LRN-T06) — the class sessions under the levels (D-R143), a level
// that opens on a date (D-R145): its lessons listed, not links, the steps
// toward them disabled, and a 403 level_not_open back to the resume target.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompletionResult, LearningItem, LearningWorkspace } from '../api/learning'
import { makeCounts, makeItem, makeProgress, makeSession, makeWorkspace, withSecondLevelClosed } from '../learn/learn.fixtures'
import type { FixtureItemId } from '../learn/learn.fixtures'
import { formatLessonTimes } from '../lessons/lessons.format'
import { formatDay } from '../users/users.format'
import { makeAcademy } from '../test/academy'
import { jsonResponse, mockFetch } from '../test/http'
import { LocationProbe } from '../test/LocationProbe'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LearnPage } from './LearnPage'

interface Server {
  workspace: LearningWorkspace | Response
  items: Partial<Record<string, LearningItem | Response>>
  complete?: (itemId: string) => CompletionResult | Response
  /** Called after a completion answers: the next workspace read returns this. */
  afterComplete?: LearningWorkspace
}

interface Call {
  method: string
  path: string
}

function serve(server: Server) {
  const calls: Call[] = []
  let completed = false
  const fetchMock = mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    calls.push({ method, path })
    if (path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (path === '/api/me/learning/courses/c1') {
      if (completed && server.afterComplete) return jsonResponse(200, server.afterComplete)
      return server.workspace instanceof Response ? server.workspace.clone() : jsonResponse(200, server.workspace)
    }
    const match = path.match(/^\/api\/me\/learning\/items\/([^/]+)(?:\/(visit|complete))?$/)
    if (match) {
      const [, id, action] = match
      const item = server.items[id!]
      if (action === 'visit') {
        const progress = item && !(item instanceof Response) ? item.progress : makeProgress()
        return jsonResponse(200, { progress: progress.state === 'completed' ? progress : { ...progress, state: 'in_progress' } })
      }
      if (action === 'complete') {
        completed = true
        const answer = server.complete?.(id!)
        if (!answer) return jsonResponse(500, {})
        return answer instanceof Response ? answer.clone() : jsonResponse(200, answer)
      }
      if (!item) return jsonResponse(404, { statusCode: 404, code: 'lesson_not_found', message: 'No lesson with this id', itemId: id })
      return item instanceof Response ? item.clone() : jsonResponse(200, item)
    }
    return jsonResponse(404, {})
  })
  return { calls, fetchMock, count: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path).length }
}

function allItems(overrides: Partial<Record<FixtureItemId, Partial<LearningItem>>> = {}): Record<string, LearningItem> {
  return {
    i1: makeItem('i1', overrides.i1),
    i2: makeItem('i2', overrides.i2),
    i3: makeItem('i3', overrides.i3),
    i4: makeItem('i4', overrides.i4),
  }
}

const student = () => makeAuth({ user: makeUser({ id: 'st-1', role: 'student', roles: ['student'], permissions: [] }) })

function renderLearn(route: string) {
  const deep = route.split('/').filter(Boolean).length > 2
  return renderWithProviders(<LearnPage />, {
    auth: student(),
    route,
    path: deep ? '/learn/:courseId/:itemId' : '/learn/:courseId',
    routes: {
      [deep ? '/learn/:courseId' : '/learn/:courseId/:itemId']: <LearnPage />,
      '/my-classes': <LocationProbe />,
    },
  })
}

const curriculum = () => screen.getByRole('navigation', { name: 'محتوى الدورة' })
const lessonHeading = () => screen.getByRole('heading', { level: 1 })

function forbidden(reason: 'pending' | 'not_enrolled') {
  return jsonResponse(403, { statusCode: 403, code: 'not_enrolled', message: 'No active or completed enrollment', courseId: 'c1', reason })
}

describe('LearnPage — the course player (TEST-251)', () => {
  it('opens the resume target from /learn/:courseId and reads the workspace once', async () => {
    const server = serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1')

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    const current = within(curriculum()).getByRole('link', { name: /فيديو الترحيب/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    // Opening records a visit (API-232) and never a completion.
    await waitFor(() => expect(server.count('POST', '/api/me/learning/items/i2/visit')).toBe(1))
    expect(server.count('POST', '/api/me/learning/items/i2/complete')).toBe(0)
    expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(1)
    expect(screen.queryByText('الدرس الذي توقفت عنده لم يعد متاحاً، فانتقلنا إلى التالي')).not.toBeInTheDocument()
  })

  it('tells the learner once when the last lesson was replaced', async () => {
    serve({ workspace: makeWorkspace({ resume: { itemId: 'i3', reason: 'replaced', positionSeconds: null } }), items: allItems() })
    renderLearn('/learn/c1')

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))
    expect(screen.getByText('الدرس الذي توقفت عنده لم يعد متاحاً، فانتقلنا إلى التالي')).toBeInTheDocument()

    // Moving on drops the notice.
    fireEvent.click(within(curriculum()).getByRole('link', { name: /قراءة إضافية/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('قراءة إضافية'))
    expect(screen.queryByText('الدرس الذي توقفت عنده لم يعد متاحاً، فانتقلنا إلى التالي')).not.toBeInTheDocument()
  })

  it('explains a pending enrollment with a link to the requests of «My School»', async () => {
    serve({ workspace: forbidden('pending'), items: {} })
    renderLearn('/learn/c1')

    expect(await screen.findByRole('heading', { name: 'اشتراكك بانتظار الدفع أو الموافقة' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'عرض طلبات اشتراكي' })).toHaveAttribute('href', '/my-classes?section=requests')
  })

  it('explains a missing enrollment with a link to the course in the catalog', async () => {
    serve({ workspace: forbidden('not_enrolled'), items: { i2: forbidden('not_enrolled') } })
    renderLearn('/learn/c1/i2')

    expect(await screen.findByRole('heading', { name: 'لست مسجّلاً في هذه الدورة' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'عرض الدورة' })).toHaveAttribute('href', '/catalog/c1')
  })

  it('shows an unknown course as not found with the way back to «My School»', async () => {
    serve({
      workspace: jsonResponse(404, { statusCode: 404, code: 'learning_course_not_found', message: 'No course with this id', courseId: 'c1' }),
      items: {},
    })
    renderLearn('/learn/c1')

    expect(await screen.findByRole('heading', { name: 'الدورة غير موجودة أو لم تعد متاحة' })).toBeInTheDocument()
    const back = screen.getAllByRole('link', { name: /العودة إلى فصولي/ })
    expect(back.every((link) => link.getAttribute('href') === '/my-classes')).toBe(true)
  })

  it('lists the levels with their counts and opens the level of the current lesson', async () => {
    serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1/i2')

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    const nav = curriculum()
    const first = within(nav).getByRole('button', { name: /المستوى الأول — أساسيات/ })
    const second = within(nav).getByRole('button', { name: /المستوى الثاني/ })
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(first).toHaveTextContent('1/2')
    expect(second).toHaveTextContent('0/2')
    // Durations: a medium by its clock, a reading by the estimate.
    expect(within(nav).getByRole('link', { name: /فيديو الترحيب/ })).toHaveTextContent('4:05')
    expect(within(nav).getByRole('link', { name: /مقدمة الدورة/ })).toHaveTextContent('45 د')
    expect(within(nav).getByRole('link', { name: /مقدمة الدورة/ })).toHaveAccessibleName(/مكتمل/)
    expect(within(nav).queryByRole('link', { name: /دليل الدورة/ })).not.toBeInTheDocument()

    // Every level opens — no lock between levels.
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: /قراءة إضافية/ })).toHaveTextContent('اختياري')
  })

  it('switches lessons through the sidebar without reading the workspace again', async () => {
    const server = serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    fireEvent.click(within(curriculum()).getByRole('link', { name: /مقدمة الدورة/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة الدورة'))
    expect(within(curriculum()).getByRole('link', { name: /مقدمة الدورة/ })).toHaveAttribute('aria-current', 'page')
    expect(server.count('GET', '/api/me/learning/items/i1')).toBe(1)
    await waitFor(() => expect(server.count('POST', '/api/me/learning/items/i1/visit')).toBe(1))
    expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(1)
    // A completed lesson stays completed on review.
    expect(screen.getByText('مكتمل', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تحديد كمكتمل' })).not.toBeInTheDocument()
  })

  it('moves previous/next across the level boundary and opens the new level', async () => {
    serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    const lessonNav = screen.getByRole('navigation', { name: 'التنقل بين الدروس' })
    fireEvent.click(within(lessonNav).getByRole('button', { name: /التالي/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))
    expect(within(curriculum()).getByRole('button', { name: /المستوى الثاني/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(curriculum()).getByRole('link', { name: /دليل الدورة/ })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(within(screen.getByRole('navigation', { name: 'التنقل بين الدروس' })).getByRole('button', { name: /السابق/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    // The first lesson has no previous one.
    fireEvent.click(within(curriculum()).getByRole('link', { name: /مقدمة الدورة/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة الدورة'))
    expect(within(screen.getByRole('navigation', { name: 'التنقل بين الدروس' })).getByRole('button', { name: /السابق/ })).toBeDisabled()
    // The heading of a lesson reached from another lesson takes the focus.
    expect(lessonHeading()).toHaveFocus()

    // «Back to the course content» moves the focus to the current lesson of the sidebar.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'التنقل بين الدروس' })).getByRole('button', { name: /العودة إلى محتوى الدورة/ }))
    expect(within(curriculum()).getByRole('link', { name: /مقدمة الدورة/ })).toHaveFocus()
  })

  it('moves the curriculum into a drawer on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 991.98px)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))
    serve({ workspace: makeWorkspace(), items: allItems() })
    const { container } = renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    expect(container.querySelector('.learn-sidebar')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'محتوى الدورة' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'محتوى الدورة' }))
    const nav = await screen.findByRole('navigation', { name: 'محتوى الدورة' })
    fireEvent.click(within(nav).getByRole('link', { name: /مقدمة الدورة/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة الدورة'))
  })

  it('marks a manual lesson complete and moves the sidebar, the level and the course from the answer', async () => {
    const after = makeWorkspace()
    after.sections[1]!.items[0] = { ...after.sections[1]!.items[0]!, state: 'completed', completedAt: '2026-11-19T09:00:00.000Z' }
    after.sections[1]!.progress = makeCounts({ total: 2, required: 1, completed: 1, completedRequired: 1, percent: 100, isComplete: true })
    after.progress = makeCounts({ total: 4, required: 3, completed: 2, completedRequired: 2, percent: 66 })
    const server = serve({
      workspace: makeWorkspace(),
      items: allItems(),
      afterComplete: after,
      complete: () => ({
        progress: makeProgress({ state: 'completed', completedAt: '2026-11-19T09:00:00.000Z', completionSource: 'manual' }),
        section: after.sections[1]!.progress,
        course: after.progress,
        completedNow: true,
      }),
    })
    renderLearn('/learn/c1/i3')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))
    expect(screen.getByTestId('learn-course-percent')).toHaveTextContent('33٪')
    expect(within(curriculum()).getByRole('link', { name: /دليل الدورة/ })).toHaveAccessibleName(/لم يبدأ|قيد التقدّم/)

    fireEvent.click(screen.getByRole('button', { name: 'تحديد كمكتمل' }))

    await waitFor(() => expect(screen.getByTestId('learn-course-percent')).toHaveTextContent('66٪'))
    const nav = curriculum()
    expect(within(nav).getByRole('link', { name: /دليل الدورة/ })).toHaveAccessibleName(/مكتمل/)
    expect(within(nav).getByRole('button', { name: /المستوى الثاني/ })).toHaveTextContent('1/2')
    expect(screen.getByText('مكتمل', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تحديد كمكتمل' })).not.toBeInTheDocument()
    expect(server.count('POST', '/api/me/learning/items/i3/complete')).toBe(1)
    // The workspace is read again after the completion.
    await waitFor(() => expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(2))
    // The course is not complete: no confirmation.
    expect(screen.queryByText('أتممت جميع دروس الدورة المطلوبة')).not.toBeInTheDocument()
  })

  it('confirms the course only once the server says it became complete', async () => {
    const nearlyDone = makeWorkspace({ progress: makeCounts({ total: 4, required: 3, completed: 2, completedRequired: 2, percent: 66 }) })
    nearlyDone.sections[0]!.items[1] = { ...nearlyDone.sections[0]!.items[1]!, state: 'completed' }
    const done = makeCounts({ total: 4, required: 3, completed: 3, completedRequired: 3, percent: 100, isComplete: true, completedAt: '2026-11-19T09:00:00.000Z' })
    serve({
      workspace: nearlyDone,
      items: allItems(),
      afterComplete: { ...nearlyDone, progress: done },
      complete: () => ({
        progress: makeProgress({ state: 'completed', completedAt: '2026-11-19T09:00:00.000Z', completionSource: 'manual' }),
        section: makeCounts({ total: 2, required: 1, completed: 1, completedRequired: 1, percent: 100, isComplete: true }),
        course: done,
        completedNow: true,
      }),
    })
    // Opening the last lesson of the course confirms nothing.
    renderLearn('/learn/c1/i4')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('قراءة إضافية'))
    expect(screen.queryByText('أتممت جميع دروس الدورة المطلوبة')).not.toBeInTheDocument()

    fireEvent.click(within(curriculum()).getByRole('link', { name: /دليل الدورة/ }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))
    fireEvent.click(screen.getByRole('button', { name: 'تحديد كمكتمل' }))

    const dialog = (await screen.findByText('أتممت جميع دروس الدورة المطلوبة')).closest('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'العودة إلى فصولي' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/my-classes'))
  })

  it('renders a text lesson as text — markup shows literally, nothing runs', async () => {
    serve({
      workspace: makeWorkspace(),
      items: allItems({ i1: { content: { body: { ar: 'الفقرة الأولى\nسطر ثانٍ\n\n<script>alert(1)</script>' } } } }),
    })
    const { container } = renderLearn('/learn/c1/i1')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('مقدمة الدورة'))

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    const first = screen.getByText(/الفقرة الأولى/)
    expect(first.tagName).toBe('P')
    expect(first.textContent).toBe('الفقرة الأولى\nسطر ثانٍ')
  })

  it('embeds a YouTube video through the privacy-enhanced player', async () => {
    serve({ workspace: makeWorkspace(), items: allItems() })
    const { container } = renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    const src = new URL(frame!.getAttribute('src')!)
    expect(`${src.origin}${src.pathname}`).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    // J-F64: the player reports to this page, so the learner sees how much they have watched.
    expect(src.searchParams.get('enablejsapi')).toBe('1')
    expect(src.searchParams.get('origin')).toBe(window.location.origin)
    expect(frame).toHaveAttribute('title', 'فيديو الترحيب')
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    expect(screen.getByRole('progressbar', { name: 'نسبة المشاهدة' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.queryByText('لا تُقاس مشاهدة هذا الفيديو: بعد مشاهدته اضغط «تحديد كمكتمل».')).not.toBeInTheDocument()
  })

  it('opens a PDF in a new tab instead of framing it', async () => {
    serve({ workspace: makeWorkspace(), items: allItems() })
    const { container } = renderLearn('/learn/c1/i3')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))

    const open = screen.getByRole('link', { name: /فتح المستند/ })
    expect(open).toHaveAttribute('href', 'https://files.example.org/guide.pdf')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('goes back to the resume target with a notice when a lesson is gone', async () => {
    const server = serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1/gone')

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    expect(screen.getByText('هذا الدرس غير متاح حالياً، فانتقلنا إلى درس متاح')).toBeInTheDocument()
    expect(server.count('GET', '/api/me/learning/items/gone')).toBe(1)
    expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(2)
  })

  it('shows the playback rule and the watched share of a measured video from the server', async () => {
    serve({
      workspace: makeWorkspace(),
      items: allItems({
        i2: {
          content: { provider: 'file', url: 'https://media.example.org/intro.mp4', durationSeconds: 245, captions: [] },
          completionMode: 'playback',
          progress: makeProgress({ state: 'in_progress', watchedSeconds: 98, watchedPercent: 40, positionSeconds: 98 }),
        },
      }),
    })
    const { container } = renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', 'https://media.example.org/intro.mp4')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(screen.getByText('يكتمل الدرس بعد مشاهدة 90٪ منه')).toBeInTheDocument()
    expect(screen.getByText('شاهدت 40٪ منه حتى الآن')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تحديد كمكتمل' })).not.toBeInTheDocument()
  })
})

describe('LearnPage — class sessions and levels that open on a date (TEST-263)', () => {
  const sessionsPanel = () => within(screen.getByTestId('learn-class-sessions'))

  // The expanded levels are remembered for the browser session (useLevelToggles): start every test from none.
  beforeEach(() => window.sessionStorage.clear())

  it('lists the class sessions under the levels — upcoming first, the past behind their toggle — each with the learner’s own attendance', async () => {
    const workspace = makeWorkspace({
      sessions: [
        makeSession({ id: 'past', title: { ar: 'الحصة الأولى' }, startsAt: '2026-01-10T10:00:00.000Z', endsAt: '2026-01-10T11:00:00.000Z', status: 'completed', attendance: { status: 'late', minutesLate: 10 } }),
        makeSession({ id: 'later', title: { ar: 'حصة التطبيق' }, startsAt: '2030-01-27T10:00:00.000Z', endsAt: '2030-01-27T11:00:00.000Z', meetingUrl: 'https://meet.example.org/apply' }),
        makeSession({ id: 'cancelled', title: { ar: 'حصة ملغاة' }, startsAt: '2030-01-24T10:00:00.000Z', endsAt: '2030-01-24T11:00:00.000Z', status: 'cancelled', meetingUrl: null }),
        makeSession({ id: 'soon', title: { ar: 'حصة الدليل' }, syllabusItemId: 'i3' }),
      ],
    })
    const server = serve({ workspace, items: allItems() })
    renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    const panel = sessionsPanel()
    const toggle = panel.getByText('حصص الفصل').closest('button')!
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('3 حصص قادمة')
    // The soonest first; a cancelled session keeps its place, says so and offers no link.
    const upcoming = within(panel.getByRole('list', { name: 'الحصص القادمة' }))
    const rows = upcoming.getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-session-id'))).toEqual(['soon', 'cancelled', 'later'])
    const soon = within(rows[0]!)
    expect(soon.getByText(formatLessonTimes('2030-01-20T10:00:00.000Z', '2030-01-20T11:00:00.000Z', 'ar', 'UTC'))).toBeInTheDocument()
    expect(soon.getByText('مجدولة')).toBeInTheDocument()
    expect(soon.getByRole('link', { name: /رابط الحصة/ })).toHaveAttribute('href', 'https://meet.example.org/review')
    expect(soon.getByRole('link', { name: /رابط الحصة/ })).toHaveAttribute('target', '_blank')
    // Nothing to say about attendance before a session starts.
    expect(soon.queryByText('لم يُسجَّل حضورك بعد')).not.toBeInTheDocument()
    const cancelled = within(rows[1]!)
    expect(cancelled.getByText('ملغاة')).toBeInTheDocument()
    expect(cancelled.queryByRole('link')).not.toBeInTheDocument()

    // The past sessions are folded; opening them shows the learner's own attendance.
    const pastToggle = panel.getByText('الحصص السابقة (1)').closest('button')!
    expect(pastToggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel.queryByText('الحصة الأولى')).not.toBeInTheDocument()
    fireEvent.click(pastToggle)
    const past = within(panel.getByRole('list', { name: 'الحصص السابقة' }))
    expect(past.getByText('الحصة الأولى')).toBeInTheDocument()
    expect(past.getByText('انعقدت')).toBeInTheDocument()
    expect(past.getByText('حضرت متأخراً 10 د')).toBeInTheDocument()

    // A session covering a curriculum lesson opens that lesson.
    fireEvent.click(soon.getByRole('link', { name: 'الدرس: دليل الدورة' }))
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('دليل الدورة'))
    expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(1)

    // The panel folds.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel.queryByRole('list', { name: 'الحصص القادمة' })).not.toBeInTheDocument()
  })

  it('shows no sessions panel for a class without sessions', async () => {
    serve({ workspace: makeWorkspace(), items: allItems() })
    renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    expect(screen.queryByTestId('learn-class-sessions')).not.toBeInTheDocument()
  })

  it('locks a level that opens on a date: its lessons are listed, never links, and «next» does not step into it', async () => {
    const workspace = withSecondLevelClosed(makeWorkspace({ sessions: [makeSession({ syllabusItemId: 'i3' })] }))
    const nextLocked = { ...makeItem('i2').neighbors, next: { id: 'i3', title: { ar: 'دليل الدورة' }, available: false } }
    serve({ workspace, items: allItems({ i2: { neighbors: nextLocked } }) })
    renderLearn('/learn/c1/i2')
    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))

    const nav = curriculum()
    const opensOn = `يُفتح في ${formatDay('2030-02-01', 'ar')}`
    const second = within(nav).getByText('المستوى الثاني').closest('button')!
    expect(second).toHaveTextContent(opensOn)
    expect(within(second).getByRole('img', { name: 'مستوى مقفل حتى موعد فتحه' })).toBeInTheDocument()
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    // Listed, but not links.
    const guide = within(nav).getByText('دليل الدورة').closest('.learn-item')!
    expect(guide).toHaveAttribute('aria-disabled', 'true')
    expect(guide.tagName).not.toBe('A')
    expect(guide.closest('a')).toBeNull()
    expect(within(nav).getByText('قراءة إضافية').closest('[aria-disabled="true"]')).not.toBeNull()
    // The first level stays open and its lessons stay links.
    expect(within(nav).getByText('مقدمة الدورة').closest('a')).not.toBeNull()

    // «Next» names the locked lesson but does not step into it.
    const lessonNav = within(screen.getByRole('navigation', { name: 'التنقل بين الدروس' }))
    const next = lessonNav.getByText('التالي').closest('button')!
    expect(next).toBeDisabled()
    expect(next).toHaveTextContent('دليل الدورة')
    expect(next).toHaveTextContent('(لم يُفتح بعد)')

    // A session covering a locked lesson names it without a link.
    const session = within(screen.getByTestId('learn-class-sessions'))
    expect(session.getByText('الدرس: دليل الدورة (لم يُفتح بعد)')).toBeInTheDocument()
    expect(session.queryByRole('link', { name: /الدرس:/ })).not.toBeInTheDocument()
  })

  it('goes back to the resume target naming the day when a lesson’s level is not open', async () => {
    const workspace = withSecondLevelClosed(makeWorkspace())
    const server = serve({
      workspace,
      items: {
        ...allItems(),
        i3: jsonResponse(403, { statusCode: 403, code: 'level_not_open', message: 'This level is not open yet', itemId: 'i3', opensOn: '2030-02-01' }),
      },
    })
    renderLearn('/learn/c1/i3')

    await waitFor(() => expect(lessonHeading()).toHaveTextContent('فيديو الترحيب'))
    expect(screen.getByText(`هذا الدرس في مستوى يُفتح في ${formatDay('2030-02-01', 'ar')}، فانتقلنا إلى درس متاح`)).toBeInTheDocument()
    expect(server.count('GET', '/api/me/learning/items/i3')).toBe(1)
    // A refused lesson is never visited; the workspace is read afresh.
    expect(server.count('POST', '/api/me/learning/items/i3/visit')).toBe(0)
    expect(server.count('GET', '/api/me/learning/courses/c1')).toBe(2)
  })

  it('never opens a locked lesson as the resume target, and says when nothing can be opened yet', async () => {
    const closed = withSecondLevelClosed(makeWorkspace({ resume: null }), '2030-02-01')
    const workspace = {
      ...closed,
      sections: closed.sections.map((section) =>
        section.id === 's1' ? { ...section, isOpen: false, opensOn: '2030-01-15', items: section.items.map((item) => ({ ...item, available: false })) } : section,
      ),
    }
    const server = serve({ workspace, items: allItems() })
    renderLearn('/learn/c1')

    expect(await screen.findByText(`لم يُفتح أي مستوى من هذه الدورة بعد: تُفتح أولى دروسها في ${formatDay('2030-01-15', 'ar')}.`)).toBeInTheDocument()
    expect(server.calls.some((call) => call.path.startsWith('/api/me/learning/items/'))).toBe(false)
  })
})
