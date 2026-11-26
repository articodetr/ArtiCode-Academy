import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LearningItem, LearningWorkspace, MyLearningCourse } from '../api/learning'
import { ar } from '../i18n/ar'
import { TITLES, makeItem, makeWorkspace, withSecondLevelClosed } from '../learn/learn.fixtures'
import { resetWatchedMemory } from '../learn/watched.store'
import { makeLearningCourse } from '../mySchool/mySchool.fixtures'
import { makeAcademy } from '../test/academy'
import { makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyLessonList } from '../test/myLessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { MyLessonsPage } from './MyLessonsPage'

const hub = ar.myLessons.hub
const COURSE = makeLearningCourse({ course: { ...makeLearningCourse().course, id: 'c1', name: { ar: 'أساسيات البرمجة' } } })

function serve(options: { courses?: MyLearningCourse[]; workspace?: LearningWorkspace; items?: Record<string, LearningItem> } = {}) {
  const { courses = [COURSE], workspace = makeWorkspace(), items = { i2: makeItem('i2'), i3: makeItem('i3') } } = options
  const paths: string[] = []
  mockFetch((url, init) => {
    const { pathname } = new URL(url, 'http://localhost')
    paths.push(`${init?.method ?? 'GET'} ${pathname}`)
    if (pathname === '/api/academy') return jsonResponse(200, makeAcademy())
    if (pathname === '/api/me/learning') return jsonResponse(200, { items: courses })
    if (pathname === '/api/me/learning/courses/c1') return jsonResponse(200, workspace)
    const visit = /^\/api\/me\/learning\/items\/([^/]+)\/visit$/.exec(pathname)
    if (visit) return jsonResponse(200, { progress: items[visit[1]!]!.progress })
    const item = /^\/api\/me\/learning\/items\/([^/]+)$/.exec(pathname)
    if (item) return items[item[1]!] ? jsonResponse(200, items[item[1]!]) : jsonResponse(404, { statusCode: 404, code: 'lesson_not_found' })
    if (pathname === '/api/me/lessons') return jsonResponse(200, makeMyLessonList([]))
    if (pathname === '/api/me/classes') return jsonResponse(200, makeMyClassList([]))
    return jsonResponse(404, { statusCode: 404, message: 'nope' })
  })
  return paths
}

/** The address with its query: the opened lesson lives there. */
function AddressProbe() {
  const { pathname, search } = useLocation()
  return <output data-testid="location">{`${pathname}${search}`}</output>
}

function renderHub(route = '/my-lessons', roles = ['student']) {
  return renderWithProviders(
    <>
      <MyLessonsPage />
      <AddressProbe />
    </>,
    { auth: makeAuth({ user: makeUser({ id: 'student-1', role: roles.includes('student') ? 'student' : 'guardian', roles, permissions: [] }) }), route },
  )
}

const row = (title: string) => screen.getByText(title, { selector: '.hub-row__title, .hub-row__title *' }).closest('li')!

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('MyLessonsPage — the student’s lessons (J-F64)', () => {
  it('shows the summary, the course card with its progress and the lessons by level', async () => {
    serve()
    renderHub()

    expect(await screen.findByRole('heading', { name: hub.title })).toBeInTheDocument()
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${hub.card.browse}: أساسيات البرمجة` })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: hub.card.progress })).toHaveAttribute('aria-valuenow', '33')
    expect(screen.getByText('المستوى الأول — أساسيات')).toBeInTheDocument()
    expect(within(row(TITLES.i1)).getByText(hub.row.completed)).toBeInTheDocument()
    expect(within(row(TITLES.i2)).getByRole('button', { name: new RegExp(hub.row.play) })).toBeInTheDocument()
    expect(within(row(TITLES.i3)).getByRole('button', { name: new RegExp(hub.row.open) })).toBeInTheDocument()
  })

  it('plays a YouTube lesson inside the page, keeps the list and closes back to it', async () => {
    const paths = serve()
    const { container } = renderHub()
    await screen.findByText(TITLES.i2)

    fireEvent.click(within(row(TITLES.i2)).getByRole('button', { name: new RegExp(hub.row.play) }))

    const player = await screen.findByRole('region', { name: hub.player.label })
    await waitFor(() => expect(player.querySelector('iframe')).not.toBeNull())
    expect(player.querySelector('iframe')!.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(within(player).getByRole('progressbar', { name: ar.learn.lesson.watch.label })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/my-lessons?course=c1&lesson=i2')
    expect(within(row(TITLES.i2)).getByText(hub.row.playing)).toBeInTheDocument()
    expect(within(row(TITLES.i3)).getByRole('button', { name: new RegExp(hub.row.open) })).toBeInTheDocument()
    await waitFor(() => expect(paths).toContain('POST /api/me/learning/items/i2/visit'))

    fireEvent.click(within(player).getByRole('button', { name: new RegExp(hub.player.close) }))
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull())
    expect(screen.getByTestId('location')).toHaveTextContent('/my-lessons?course=c1')
  })

  it('leads from the last required lesson to the exams and the certificate (J-F67)', async () => {
    serve({ items: { i2: makeItem('i2'), i3: makeItem('i3') } })
    const done = { total: 4, required: 3, completed: 3, completedRequired: 3, percent: 100, isComplete: true, completedAt: '2026-11-24T10:00:00.000Z' }
    const inner = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/api/me/learning/items/i3/complete')
        ? Promise.resolve(jsonResponse(200, { progress: { state: 'completed', completedAt: done.completedAt, completionSource: 'manual', positionSeconds: null, watchedSeconds: 0, watchedPercent: null }, section: done, course: done, completedNow: true }))
        : inner(input, init)) as typeof fetch
    renderHub()
    await screen.findByText(TITLES.i3)

    fireEvent.click(within(row(TITLES.i3)).getByRole('button', { name: new RegExp(hub.row.open) }))
    fireEvent.click(await screen.findByRole('button', { name: ar.learn.completion.markComplete }))

    const next = await screen.findByRole('button', { name: hub.finish.goToExams })
    expect(screen.queryByRole('button', { name: ar.learn.done.backToMySchool })).not.toBeInTheDocument()
    fireEvent.click(next)
    await waitFor(() => expect(screen.queryByRole('button', { name: hub.finish.goToExams })).not.toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent('/my-lessons')
  })

  it('opens the lesson the address names', async () => {
    serve()
    renderHub('/my-lessons?course=c1&lesson=i2')
    const player = await screen.findByRole('region', { name: hub.player.label })
    await waitFor(() => expect(player.querySelector('iframe')).not.toBeNull())
  })

  it('never opens a lesson of a level that is not open yet', async () => {
    const paths = serve({ workspace: withSecondLevelClosed(makeWorkspace()) })
    renderHub('/my-lessons?course=c1&lesson=i3')
    await screen.findByText(TITLES.i3)
    expect(within(row(TITLES.i3)).queryByRole('button')).not.toBeInTheDocument()
    expect(row(TITLES.i3)).toHaveTextContent('يُفتح في')
    expect(screen.queryByRole('region', { name: hub.player.label })).not.toBeInTheDocument()
    expect(paths).not.toContain('GET /api/me/learning/items/i3')
  })

  it('filters the lessons by type', async () => {
    serve()
    renderHub()
    await screen.findByText(TITLES.i2)
    fireEvent.click(screen.getByRole('button', { name: hub.filters.live }))
    expect(await screen.findByText(hub.emptyFilter)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: hub.filters.recorded }))
    expect(await screen.findByText(TITLES.i2)).toBeInTheDocument()
  })

  it('offers the catalog when the student has no course', async () => {
    serve({ courses: [] })
    renderHub()
    expect(await screen.findByText(hub.empty.title)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.empty.action })).toHaveAttribute('href', '/catalog')
  })

  it('keeps the table of class sessions in its own tab', async () => {
    const paths = serve()
    renderHub('/my-lessons?view=sessions')
    expect(await screen.findByRole('link', { name: hub.tabs.sessions })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(paths).toContain('GET /api/me/lessons'))
    expect(paths).not.toContain('GET /api/me/learning')
  })

  it('gives a guardian the table alone: they follow, they do not study', async () => {
    const paths = serve()
    renderHub('/my-lessons', ['guardian'])
    await waitFor(() => expect(paths).toContain('GET /api/me/lessons'))
    expect(paths).not.toContain('GET /api/me/learning')
    expect(screen.queryByRole('navigation', { name: hub.tabs.label })).not.toBeInTheDocument()
  })
})
