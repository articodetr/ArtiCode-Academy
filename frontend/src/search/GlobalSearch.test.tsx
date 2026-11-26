import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeAssignment, makeAssignmentList } from '../test/assignments'
import { makeLesson } from '../test/lessons'
import { makeListItem } from '../test/users'
import { GlobalSearch } from './GlobalSearch'

function mockApi() {
  const urls: string[] = []
  mockFetch((url) => {
    urls.push(url)
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/users') return jsonResponse(200, { items: [makeListItem({ id: 'u-lina', fullName: 'لينا السالم', email: 'lina@example.com', roles: ['student'] })], nextCursor: null })
    if (path === '/api/classes' || path === '/api/courses' || path === '/api/invoices' || path === '/api/payments' || path === '/api/certificates') return jsonResponse(200, { items: [], nextCursor: null })
    if (path === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return urls
}

describe('GlobalSearch (redesign)', () => {
  afterEach(() => localStorage.clear())

  it('opens with Ctrl+K, suggests the actions this viewer may take, and searches people with the typed text', async () => {
    const urls = mockApi()
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'users.create', 'payments.record', 'invoices.read_all'] }) }), route: '/' })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByText(ar.search.actions.addUser)).toBeInTheDocument()
    expect(screen.getByText(ar.search.actions.recordPayment)).toBeInTheDocument()
    expect(screen.queryByText(ar.search.actions.takeAttendance)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ar.search.placeholder), { target: { value: 'لينا' } })
    expect(await screen.findByText('لينا السالم')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/users?') && url.includes(encodeURIComponent('لينا')))).toBe(true)
    // A word is no invoice number: the finance lists are not asked.
    expect(urls.some((url) => url.startsWith('/api/invoices'))).toBe(false)
  })

  it('sends an invoice number to the invoices only and finds pages by their Arabic words with spelling variants', async () => {
    const urls = mockApi()
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['users.read', 'invoices.read_all'] }) }), route: '/' })
    fireEvent.click(screen.getByLabelText(ar.search.open))
    const input = await screen.findByLabelText(ar.search.placeholder)

    fireEvent.change(input, { target: { value: 'INV-2026' } })
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/invoices?'))).toBe(true))
    expect(urls.some((url) => url.startsWith('/api/users?'))).toBe(false)

    fireEvent.change(input, { target: { value: 'فاتوره' } })
    expect(await screen.findByText(ar.nav.payments)).toBeInTheDocument()
  })
  it('searches no classes and offers no class action or page, even to a holder of every classes key (2026-11-26)', async () => {
    const urls = mockApi()
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['classes.read', 'classes.manage', 'classes.teachers.assign', 'courses.read'] }) }), route: '/' })
    fireEvent.click(screen.getByLabelText(ar.search.open))
    const input = await screen.findByLabelText(ar.search.placeholder)
    // Before typing: the suggestions hold no «create a class».
    expect(screen.queryByText('إنشاء فصل')).not.toBeInTheDocument()

    // A word that named the classes page (its label and its keywords) finds no page now, and asks the courses only.
    fireEvent.change(input, { target: { value: 'الفصول' } })
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/courses?'))).toBe(true))
    expect(urls.some((url) => url.startsWith('/api/classes'))).toBe(false)
    expect(screen.queryByText(ar.nav.classes)).not.toBeInTheDocument()
    expect(screen.queryByText('إنشاء فصل')).not.toBeInTheDocument()
    expect(document.querySelector('.gsearch-group')?.textContent ?? '').not.toContain('الفصول')
  })

  it('offers a teacher-only viewer no assignment, exam or lesson page, action or record, even with the keys — they are inside each class (CH-0374); their classes are still searched; an admin keeps them (2026-11-26)', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/assignments') return jsonResponse(200, makeAssignmentList([makeAssignment({ id: 'a-7', title: { ar: 'واجب الحلقات' } })]))
      if (path === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
      return jsonResponse(200, { items: [], nextCursor: null })
    })
    // A session from before the seed change still carries the assignments keys: the teacher gets nothing of them all the same.
    const teacherKeys = ['classes.read', 'lessons.read', 'attendance.record', 'exams.read', 'exams.grade', 'assignments.read', 'assignments.manage', 'assignments.grade']
    for (const roles of [['teacher'], ['teacher', 'guardian']]) {
      urls.length = 0
      const { unmount } = renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles, permissions: teacherKeys }) }), route: '/' })
      fireEvent.click(screen.getByLabelText(ar.search.open))
      const input = await screen.findByLabelText(ar.search.placeholder)
      // Before typing: neither the exam action nor the review of submissions (CH-0374: both live in the class's page).
      expect(screen.queryByText(ar.search.actions.enterResults)).not.toBeInTheDocument()
      expect(screen.queryByText(ar.search.actions.reviewSubmissions)).not.toBeInTheDocument()

      fireEvent.change(input, { target: { value: 'الواجبات' } })
      await waitFor(() => expect(urls.some((url) => url.startsWith('/api/classes?'))).toBe(true))
      expect(urls.some((url) => url.startsWith('/api/exams?'))).toBe(false)
      expect(urls.some((url) => url.startsWith('/api/lessons?'))).toBe(false)
      expect(urls.some((url) => url.startsWith('/api/assignments'))).toBe(false)
      expect(screen.queryByText(ar.nav.assignments)).not.toBeInTheDocument()
      expect(screen.queryByText('واجب الحلقات')).not.toBeInTheDocument()
      unmount()
    }

    urls.length = 0
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['assignments.read', 'assignments.grade'] }) }), route: '/' })
    fireEvent.click(screen.getByLabelText(ar.search.open))
    const input = await screen.findByLabelText(ar.search.placeholder)
    expect(await screen.findByText(ar.search.actions.reviewSubmissions)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'الواجبات' } })
    expect(await screen.findByText('واجب الحلقات')).toBeInTheDocument()
    // «الواجبات» twice: the page found by its name and the heading of the records.
    expect(screen.getAllByText(ar.nav.assignments)).toHaveLength(2)
    expect(urls.some((url) => url.startsWith('/api/assignments?'))).toBe(true)
  })

  it('finds lessons by title (q, CH-0226) through the lessons list and opens them on their page', async () => {
    const urls: string[] = []
    mockFetch((url) => {
      urls.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/lessons') return jsonResponse(200, { items: [makeLesson({ id: 'l-9', title: { ar: 'الحلقات التكرارية' } })], nextCursor: null })
      return jsonResponse(200, { items: [], nextCursor: null })
    })
    renderWithProviders(<GlobalSearch />, { auth: makeAuth({ user: makeUser({ permissions: ['lessons.read'] }) }), route: '/' })
    fireEvent.click(screen.getByLabelText(ar.search.open))
    fireEvent.change(await screen.findByLabelText(ar.search.placeholder), { target: { value: 'الحلقات' } })
    expect(await screen.findByText('الحلقات التكرارية')).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/lessons?') && url.includes(`q=${encodeURIComponent('الحلقات')}`))).toBe(true)
  })
})
