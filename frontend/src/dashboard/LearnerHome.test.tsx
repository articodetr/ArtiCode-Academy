import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makeItem, makeWorkspace } from '../learn/learn.fixtures'
import { makeLearningCourse } from '../mySchool/mySchool.fixtures'
import { makeAcademy } from '../test/academy'
import { makeMyClassItem } from '../test/enrollments'
import { jsonResponse, mockFetch } from '../test/http'
import { makeMyAssignment } from '../test/myAssignments'
import { STUDENT_EXAM_PERMISSIONS, makeOnlineMyExam } from '../test/myExams'
import { CHILD_ONE, CHILD_TWO, SELF_STUDENT, makeMyLesson } from '../test/myLessons'
import { GUARDIAN_GRADES_PERMISSIONS } from '../test/myGrades'
import { makeMyInvoice } from '../test/payments'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { DashboardPage } from '../pages/DashboardPage'

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

    expect(await screen.findByText(ar.dashboard.learner.lessons)).toBeInTheDocument()
    expect(await screen.findByText('تمرين الحلقات')).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.learner.overdue)).toBeInTheDocument()
    expect(urls.some((url) => url.startsWith('/api/lessons'))).toBe(false)
    // A guardian follows and has no lessons to open: no content panel, no read of API-229.
    expect(screen.queryByText(ar.dashboard.learner.materials)).toBeNull()
    expect(urls.some((url) => url.startsWith('/api/me/learning'))).toBe(false)

    fireEvent.click(screen.getByText(CHILD_TWO.fullName))
    await waitFor(() => expect(urls.some((url) => url.startsWith('/api/me/lessons') && url.includes(`studentId=${CHILD_TWO.id}`))).toBe(true))
    expect(urls.some((url) => url.startsWith('/api/me/invoices') && url.includes(`studentId=${CHILD_TWO.id}`))).toBe(true)
  })

  it('gives a student the live lesson with «join», the open exam with «start» and the course files', async () => {
    const urls: string[] = []
    const now = Date.now()
    const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString()
    mockFetch((url) => {
      urls.push(url)
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/academy') return jsonResponse(200, makeAcademy({ timezone: 'UTC' }))
      if (path === '/api/me/classes') return jsonResponse(200, { items: [makeMyClassItem({ relation: 'self', student: SELF_STUDENT })] })
      if (path === '/api/me/lessons') return jsonResponse(200, { items: [makeMyLesson({ id: 'l1', title: { ar: 'درس الحلقات' }, relation: 'self', student: SELF_STUDENT, status: 'scheduled', deliveryMode: 'live_online', meetingUrl: 'https://meet.example.org/room', startsAt: iso(-10), endsAt: iso(50), timeZone: 'UTC' })], nextCursor: null })
      if (path === '/api/me/assignments') return jsonResponse(200, { items: [], nextCursor: null })
      if (path === '/api/me/exams') return jsonResponse(200, { items: [makeOnlineMyExam({ id: 'x1', title: { ar: 'اختبار قصير' }, scheduledAt: iso(-60), timeZone: 'UTC' }, { closesAt: iso(120), serverNow: iso(0) })], nextCursor: null })
      if (path === '/api/me/grades') return jsonResponse(200, { items: [] })
      if (path === '/api/me/learning') return jsonResponse(200, { items: [makeLearningCourse({ course: { ...makeLearningCourse().course, id: 'c1' } })] })
      if (path === '/api/me/learning/courses/c1') return jsonResponse(200, makeWorkspace())
      const item = /^\/api\/me\/learning\/items\/(i[1-4])$/.exec(path)?.[1] as 'i1' | 'i2' | 'i3' | 'i4' | undefined
      if (item) return jsonResponse(200, makeItem(item))
      if (path === '/api/me/notifications/unread-count') return jsonResponse(200, { unread: 0 })
      return jsonResponse(404, { statusCode: 404, message: 'unexpected' })
    })
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: STUDENT_EXAM_PERMISSIONS }) }), route: '/' })

    const lesson = (await screen.findByText('درس الحلقات')).closest('article') as HTMLElement
    expect(within(lesson).getByText(ar.dashboard.learner.liveNow)).toBeInTheDocument()
    expect(within(lesson).getByText(ar.dashboard.learner.join).closest('a')).toHaveAttribute('href', 'https://meet.example.org/room')

    const exam = (await screen.findByText('اختبار قصير')).closest('article') as HTMLElement
    fireEvent.click(within(exam).getByText(ar.dashboard.learner.startExam))
    // The rules are confirmed first: the click alone never starts the clock.
    expect(await screen.findByTestId('start-now')).toBeInTheDocument()
    expect(urls.some((url) => url.includes('/attempts'))).toBe(false)

    // The title, and again the hidden words of the two buttons.
    const file = (await screen.findAllByText('دليل الدورة'))[0]!.closest('li') as HTMLElement
    expect(within(file).getByText(ar.dashboard.learner.openFile).closest('a')).toHaveAttribute('href', 'https://files.example.org/guide.pdf')
    expect(within(file).getByText(ar.dashboard.learner.downloadFile).closest('a')).toHaveAttribute('download', 'guide.pdf')
    // Looking at the panel never records a visit (API-232).
    expect(urls.some((url) => url.endsWith('/visit'))).toBe(false)
  })

  it('keeps the staff dashboard for a teacher who is also a guardian', async () => {
    mockLearnerApi()
    renderWithProviders(<DashboardPage />, { auth: makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher', 'guardian'], permissions: [] }) }), route: '/' })
    // The original staff dashboard (its notifications card — the one a caller without any key still gets).
    expect(await screen.findByText(ar.dashboard.recentNotifications)).toBeInTheDocument()
    expect(document.querySelector('.lh')).toBeNull()
  })
})
