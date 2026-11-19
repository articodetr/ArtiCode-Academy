// TEST-251 (MOD-20) — the course player: the redirect to the resume target,
// the access refusals, the curriculum sidebar, moving between lessons, the
// manual completion and its answer, the content by kind, and the «course
// complete» confirmation that follows the server's word only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompletionResult, LearningItem, LearningWorkspace } from '../api/learning'
import { makeCounts, makeItem, makeProgress, makeWorkspace } from '../learn/learn.fixtures'
import type { FixtureItemId } from '../learn/learn.fixtures'
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
      '/my-school': <LocationProbe />,
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
    expect(screen.getByRole('link', { name: 'عرض طلبات اشتراكي' })).toHaveAttribute('href', '/my-school?section=requests')
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
    const back = screen.getAllByRole('link', { name: /العودة إلى مدرستي/ })
    expect(back.every((link) => link.getAttribute('href') === '/my-school')).toBe(true)
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'العودة إلى مدرستي' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/my-school'))
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
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(frame).toHaveAttribute('title', 'فيديو الترحيب')
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    expect(screen.getByText('لا تُقاس مشاهدة هذا الفيديو: بعد مشاهدته اضغط «تحديد كمكتمل».')).toBeInTheDocument()
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
