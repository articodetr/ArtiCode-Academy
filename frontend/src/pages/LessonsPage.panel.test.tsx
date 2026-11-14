import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ADMIN_PERMISSIONS, LESSON_ID, LESSON_ID_2, makeLesson, makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { LessonsPage } from './LessonsPage'

// Redesign (2026-11-14): on a wide screen a lesson opens in a side panel beside the table, not over it.
const variables = makeLesson()
const loops = makeLesson({ id: LESSON_ID_2, title: { ar: 'الحلقات' } })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (path === '/api/lessons') return jsonResponse(200, makeLessonList([variables, loops]))
    if (path === `/api/lessons/${LESSON_ID}`) return jsonResponse(200, variables)
    if (path === `/api/lessons/${LESSON_ID_2}`) return jsonResponse(200, loops)
    if (path === '/api/classes') return jsonResponse(200, makeClassList([makeClass()]))
    return jsonResponse(200, { items: [], nextCursor: null })
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

describe('LessonsPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a lesson inside the panel beside the table, without a mask, keeps four columns, and switches lesson on another row', async () => {
    renderWithProviders(<LessonsPage />, { auth: makeAuth({ user: makeUser({ permissions: LESSON_ADMIN_PERMISSIONS }) }), route: '/lessons' })

    fireEvent.click(await screen.findByText('المتغيرات وأنواع البيانات'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('المتغيرات وأنواع البيانات'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.lessons.columns.when, ar.lessons.columns.lesson, ar.lessons.columns.class, ar.lessons.columns.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('الحلقات'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('الحلقات'))
  })
})
