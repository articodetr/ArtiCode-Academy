import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAcademy } from '../test/academy'
import { makeMyClassItem } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyAssignment } from '../test/myAssignments'
import { CHILD_ONE, CHILD_TWO, makeMyLesson } from '../test/myLessons'
import { GUARDIAN_GRADES_PERMISSIONS } from '../test/myGrades'
import { makeMyInvoice } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { DashboardPage } from './DashboardPage'

// Redesign (2026-11-14): a guardian (no other role) lands on the learner home, built from the «my …» reads only.
function mockLearnerApi() {
  const urls: string[] = []
  const soon = new Date(Date.now() + 2 * 3600_000)
  mockFetch((url) => {
    urls.push(url)
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
    if (path === '/api/me/classes') return jsonResponse(200, { items: [makeMyClassItem({ relation: 'child', student: CHILD_ONE }), makeMyClassItem({ relation: 'child', student: CHILD_TWO, enrollmentId: 'e2' })] })
    if (path === '/api/me/lessons') return jsonResponse(200, { items: [makeMyLesson({ id: 'l1', relation: 'child', student: CHILD_ONE, startsAt: soon.toISOString(), endsAt: new Date(soon.getTime() + 3600_000).toISOString(), timeZone: 'UTC' })], nextCursor: null })
    if (path === '/api/me/assignments') return jsonResponse(200, { items: new URL(url, 'http://localhost').searchParams.get('pending') ? [makeMyAssignment({ id: 'a1', relation: 'child', student: CHILD_ONE, title: { ar: 'تمرين الحلقات' }, dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), submitBlocker: null })] : [], nextCursor: null })
    if (path === '/api/me/exams') return jsonResponse(200, { items: [], nextCursor: null })
    if (path === '/api/me/invoices') return jsonResponse(200, { items: [makeMyInvoice({ id: 'i1', status: 'issued', balance: 300, overdue: true, currency: 'TRY', relation: 'child' })] })
    if (path === '/api/me/grades') return jsonResponse(200, { items: [] })
    if (path === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
    return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
  })
  return urls
}

describe('DashboardPage — the learner home (redesign)', () => {
  it('shows a guardian the coming lessons, what is waiting and a switch per child; a child narrows every read', async () => {
    const urls = mockLearnerApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'guardian', roles: ['guardian'], permissions: [...GUARDIAN_GRADES_PERMISSIONS, 'invoices.read_linked'] }) }), route: '/' })

    expect(await screen.findByText(ar.dashboard.learner.week)).toBeInTheDocument()
    expect(await screen.findByText('تمرين الحلقات')).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.learner.overdue)).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/lessons'))).toBe(false)

    fireEvent.click(screen.getByText(CHILD_TWO.fullName))
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/me/lessons') && url.includes(`studentId=${CHILD_TWO.id}`))).toBe(true))
    expect(urls.some((url) => url.startsWith('/api/me/invoices') && url.includes(`studentId=${CHILD_TWO.id}`))).toBe(true)
  })

  it('keeps the staff dashboard for a teacher who is also a guardian', async () => {
    mockLearnerApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: [] }) }), route: '/' })
    expect(await screen.findByText(ar.dashboard.todayLessons)).toBeInTheDocument()
    expect(screen.queryByText(ar.dashboard.learner.week)).not.toBeInTheDocument()
  })
})
