import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeClass, makeClassList } from '../test/classes'
import { EXAM_ID_2, EXAM_TEACHER_PERMISSIONS, makeExam, makeExamList } from '../test/exams'
import { jsonResponse, mockFetch } from '../test/http'
import { makeLessonList } from '../test/lessons'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { ExamsPage } from './ExamsPage'

// Redesign (2026-11-14): on a wide screen an exam opens in a side panel beside the table, not over it.
const midterm = makeExam({ status: 'scheduled' })
const project = makeExam({ id: EXAM_ID_2, title: { ar: 'مشروع الوحدة' }, type: 'project', scheduledAt: null, durationMinutes: null })

function mockApi() {
  mockFetch((url) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/academy') return jsonResponse(200, makeAcademy())
    if (path === '/api/exams') return jsonResponse(200, makeExamList([midterm, project]))
    if (path === `/api/exams/${midterm.id}`) return jsonResponse(200, midterm)
    if (path === `/api/exams/${EXAM_ID_2}`) return jsonResponse(200, project)
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

describe('ExamsPage — the side panel on a wide screen (redesign)', () => {
  beforeEach(() => {
    wideScreen()
    mockApi()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens an exam inside the panel beside the table, without a mask, keeps four columns, and switches on another row', async () => {
    renderWithProviders(<ExamsPage />, { auth: makeAuth({ user: makeUser({ permissions: EXAM_TEACHER_PERMISSIONS }) }), route: '/exams' })

    fireEvent.click(await screen.findByText('اختبار منتصف الفصل'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('اختبار منتصف الفصل'))
    const panel = document.querySelector('.list-panel') as HTMLElement
    expect(panel.querySelector('.ant-drawer')).not.toBeNull()
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
    expect(document.querySelector('.list-with-panel--open')).not.toBeNull()
    const headers = within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([ar.exams.columns.scheduledAt, ar.exams.columns.exam, ar.exams.columns.class, ar.exams.columns.status])

    fireEvent.click(within(screen.getAllByRole('table')[0]!).getByText('مشروع الوحدة'))
    await waitFor(() => expect(drawerTitle()).toHaveTextContent('مشروع الوحدة'))
  })
})
