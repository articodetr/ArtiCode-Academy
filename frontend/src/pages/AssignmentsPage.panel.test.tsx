import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { ASSIGNMENT_ID_2, ASSIGNMENT_TEACHER_PERMISSIONS, makeAssignment, makeAssignmentList } from '../test/assignments'
import { makeClass, makeClassList } from '../test/classes'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { AssignmentsPage } from './AssignmentsPage'

// Redesign (2026-11-14): on a wide screen an assignment opens in a side panel beside the table, not over it.
const loops = makeAssignment({ status: 'open' })
const project = makeAssignment({ id: ASSIGNMENT_ID_2, title: { ar: 'مشروع صغير' }, dueAt: null })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (path === '/api/assignments') return jsonResponse(200, makeAssignmentList([loops, project]))
    if (path === `/api/assignments/${loops.id}`) return jsonResponse(200, loops)
    if (path === `/api/assignments/${ASSIGNMENT_ID_2}`) return jsonResponse(200, project)
    if (path === '/api/classes') return jsonResponse(200, makeClassList([makeClass({ status: 'open' })]))
    if (path === '/api/lessons') return jsonResponse(200, makeLessonList([]))
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

describe('AssignmentsPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens an assignment inside the panel beside the table, without a mask, keeps four columns, and switches on another row', async () => {
    renderWithProviders(<AssignmentsPage />, { auth: makeAuth({ user: makeUser({ permissions: ASSIGNMENT_TEACHER_PERMISSIONS }) }), route: '/assignments' })

    fireEvent.click(await screen.findByText('تمارين الحلقات'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('تمارين الحلقات'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.assignments.columns.due, ar.assignments.columns.assignment, ar.assignments.columns.class, ar.assignments.columns.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('مشروع صغير'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('مشروع صغير'))
  })
})
