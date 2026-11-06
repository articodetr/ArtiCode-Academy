import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MyClassList } from '../api/enrollments'
import { RequireAccess } from '../auth/RequireAuth'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { ENROLLMENT_IDS, ROSTER_TEACHER_PERMISSIONS, STUDENT_IDS, makeMyClassItem, makeMyClassList } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
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

function mockMyClassesApi(list: MyClassList | Response) {
  const queries: URLSearchParams[] = []
  const urls: string[] = []
  mockFetch((url) => {
    const parsed = new URL(url, 'http://localhost')
    urls.push(parsed.pathname)
    queries.push(parsed.searchParams)
    return list instanceof Response ? list : jsonResponse(200, list)
  })
  return { queries, urls }
}

function renderPage(roles: string[]) {
  return renderWithProviders(<MyClassesPage />, {
    auth: makeAuth({ user: makeUser({ id: STUDENT_IDS[0], role: roles.includes('guardian') ? 'guardian' : 'student', roles, permissions: ['courses.read'] }) }),
    route: '/my-classes',
  })
}

function bodyRows() {
  const [, ...rows] = within(screen.getByRole('table')).getAllByRole('row')
  return rows.filter((row) => row.textContent && row.textContent.trim() !== '')
}

describe('MyClassesPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ar')
  })

  it('shows a student their own classes from GET /api/me/classes with no student column and no contact details', async () => {
    const api = mockMyClassesApi(makeMyClassList([own, completed]))
    renderPage(['student'])

    expect(await screen.findByText('بايثون — الفصل أ')).toBeInTheDocument()
    expect(api.urls).toEqual(['/api/me/classes'])
    expect(Object.fromEntries(api.queries[0]!)).toEqual({})
    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('PY-101-A')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('أساسيات بايثون')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('خالد المعلم')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.running)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(ar.labels.active)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(ar.classes.noTeacher)).toBeInTheDocument()
    expect(within(rows[1]!).getAllByText(ar.labels.completed)).toHaveLength(2)
    expect(screen.queryAllByText(ar.myClasses.columns.student)).toHaveLength(0)
    expect(screen.queryByText(ar.myClasses.relation.self)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('@')
  })

  it('shows a guardian the linked students with the relation tag', async () => {
    mockMyClassesApi(makeMyClassList([child, own]))
    renderPage(['guardian', 'student'])

    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()
    expect(screen.getAllByText(ar.myClasses.columns.student).length).toBeGreaterThan(0)
    expect(screen.getByText(ar.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.getByText(ar.myClasses.relation.self)).toBeInTheDocument()
  })

  it('asks the server for one status through the filter, and reloads on demand', async () => {
    const api = mockMyClassesApi(makeMyClassList([]))
    renderPage(['student'])
    expect(await screen.findByText(ar.myClasses.empty)).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: ar.myClasses.filterLabel }))
    fireEvent.click(await screen.findByText(ar.labels.withdrawn, { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.queries).toHaveLength(2))
    expect(Object.fromEntries(api.queries[1]!)).toEqual({ status: 'withdrawn' })
    expect(await screen.findByText(ar.myClasses.emptyFiltered)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(ar.myClasses.refresh))
    await waitFor(() => expect(api.queries).toHaveLength(3))
    expect(Object.fromEntries(api.queries[2]!)).toEqual({ status: 'withdrawn' })
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

  it('renders left-to-right in English with the translated texts (J-F04 test 08)', async () => {
    mockMyClassesApi(makeMyClassList([child, own]))
    renderPage(['guardian', 'student'])
    expect(await screen.findByText('ليلى سعيد')).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText(en.myClasses.title)).toBeInTheDocument()
    expect(screen.queryByText(ar.myClasses.title)).not.toBeInTheDocument()
    expect(screen.getAllByText(en.myClasses.columns.student).length).toBeGreaterThan(0)
    expect(screen.getByText(en.myClasses.relation.child)).toBeInTheDocument()
    expect(screen.getByText(en.myClasses.relation.self)).toBeInTheDocument()
    expect(screen.getAllByText(en.labels.running).length).toBeGreaterThan(0)
  })
})
