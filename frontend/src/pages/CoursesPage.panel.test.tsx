import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { COURSE_MANAGER_PERMISSIONS, makeCourse, makeCourseList, makeLevelList } from '../test/courses'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { CoursesPage } from './CoursesPage'

// Redesign (2026-11-14): on a wide screen a course opens in a side panel beside the list, not over it.
const python = makeCourse({ id: 'c-a', code: 'PY-101', name: { ar: 'أساسيات بايثون' }, status: 'published' })
const web = makeCourse({ id: 'c-b', code: 'WEB-201', name: { ar: 'تطوير الويب' }, level: null, status: 'draft' })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/levels') return jsonResponse(200, makeLevelList())
    if (path === '/api/courses') return jsonResponse(200, makeCourseList([python, web]))
    if (path === '/api/courses/c-a') return jsonResponse(200, python)
    if (path === '/api/courses/c-b') return jsonResponse(200, web)
    if (path.endsWith('/syllabus')) return jsonResponse(200, { courseId: 'c-a', items: [] })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
}

/** A window wide enough for the docked panel: only that one media query matches. */
function wideScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1360px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

const drawerTitle = () => document.querySelector('.record-drawer--docked .ant-drawer-title')

describe('CoursesPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a course inside the panel beside the list, without a mask, keeps three columns, and switches course on another row', async () => {
    renderWithProviders(<CoursesPage />, { auth: makeAuth({ user: makeUser({ permissions: COURSE_MANAGER_PERMISSIONS }) }), route: '/courses' })

    fireEvent.click(await screen.findByText('أساسيات بايثون'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('أساسيات بايثون'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.common.name, ar.courses.level, ar.common.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('تطوير الويب'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('تطوير الويب'))
  })
})
